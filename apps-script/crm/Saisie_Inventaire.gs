/**
 * ============================================================================
 *  SAISIE DEPUIS LE CLASSEUR « INVENTAIRE 2026 2027 » — Spacer's Toulouse Volley
 * ----------------------------------------------------------------------------
 *  La personne en charge de la boutique travaille UNIQUEMENT dans son classeur
 *  « Inventaire 2026 2027 » (aucun accès au code ni au CRM). Deux onglets :
 *
 *  📦 PRÉPARATION STOCK (avant le match)
 *     Une ligne par article actif du CRM, avec le stock Dépôt / GP / VIP du CRM.
 *     Elle remplit les colonnes jaunes (reçu au dépôt, dépôt → GP, dépôt → VIP,
 *     GP ↔ VIP, retours au dépôt), coche « Valider ». Le CRM applique :
 *     réception (02_ACHATS, coût moyen), répartitions et transferts
 *     (03_PRODUITS, 11_MOUVEMENTS_STOCK) via les fonctions de Stock_Boutique.gs.
 *
 *  🏁 APRÈS MATCH (contrôle)
 *     Elle choisit le match : le rapport des tablettes (01_VENTES) s'affiche :
 *     CA par boutique (CB / espèces / offerts), articles vendus, stock du CRM.
 *     Elle saisit le relevé TPE, les espèces comptées et le stock compté,
 *     coche « Valider le contrôle ». Le CRM enregistre les écarts de stock
 *     (AJUSTEMENT_INVENTAIRE), le contrôle de caisse (25_CONTROLES_CAISSE)
 *     et envoie le rapport par mail.
 *
 *  Tout reste tracé dans le CRM (« Saisi par » = son nom).
 *  Ce fichier corrige aussi les #ERROR! des onglets 🔄 STOCK LIVE / VENTES LIVE.
 *
 *  INSTALLATION (une fois)
 *   1. Projet Apps Script du classeur CRM Boutique (là où est Stock_Boutique.gs) :
 *      ➕ Fichier › Script, nom « Saisie_Inventaire », coller ce fichier.
 *   2. Sélectionner installerSaisieInventaire → ▶ Exécuter → autoriser
 *      (accès au classeur Inventaire + envoi de mails).
 *      Crée les 2 onglets, la réaction à ses saisies et la mise à jour toutes les 5 min.
 *  Aucun nouveau déploiement Web App n'est nécessaire.
 * ============================================================================
 */

const SI = {
  ID_DEFAUT: '1b33hMr4zkgKcwByCRNKket3LpRClclxTssxs25M6xY8',   // « Inventaire 2026 2027 »
  PREP: '📦 PRÉPARATION STOCK',
  APRES: '🏁 APRÈS MATCH',
  CONTROLES: '25_CONTROLES_CAISSE',
  ENTETES_CONTROLES: ['horodatage', 'match', 'boutique', 'CA_tablette_TTC', 'CB_tablette', 'CB_TPE', 'ecart_CB',
                      'especes_tablette', 'especes_comptees', 'ecart_especes', 'offerts_articles', 'controle_par', 'commentaire'],
  // Préparation : ligne des en-têtes et colonnes
  P_HDR: 7,
  P_COLS: ['Réf.', 'Article', 'Taille', 'Dépôt', 'Boutique GP', 'Boutique VIP', 'Total',
           '➕ Reçu au dépôt', 'Dépôt → GP', 'Dépôt → VIP', 'GP → VIP', 'VIP → GP', 'GP → Dépôt', 'VIP → Dépôt', 'Résultat'],
  P_SAISIE: ['recu', 'r2gp', 'r2vip', 'gp2vip', 'vip2gp', 'gp2r', 'vip2r'],   // colonnes H à N
  // Après match
  A_CAISSE: 8,     // en-têtes du bloc caisse
  A_ART: 14,       // en-têtes du bloc articles
  A_COLS_ART: ['Réf.', 'Article', 'Taille', 'Vendus GP', 'Vendus VIP', 'Offerts', 'CA TTC',
               'Stock GP (CRM)', 'Compté GP', 'Écart GP', 'Stock VIP (CRM)', 'Compté VIP', 'Écart VIP',
               'Dépôt (CRM)', 'Compté dépôt', 'Écart dépôt',
               'Départ GP (ce match)', 'Départ VIP (ce match)', '➕ À rajouter GP', '➕ À rajouter VIP', 'Remarque'],
  JAUNE: '#fff2cc', GRIS: '#eef1f5', NUIT: '#0b1f3a',
};

/* =============================== INSTALLATION =============================== */

function installerSaisieInventaire() {
  const id = si_idInventaire_();
  const inv = SpreadsheetApp.openById(id);
  ScriptApp.getProjectTriggers().forEach(t => {
    if (['si_surModification', 'majSaisieInventaire', 'si_traiterDemandes'].indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('si_surModification').forSpreadsheet(id).onEdit().create();
  ScriptApp.newTrigger('majSaisieInventaire').timeBased().everyMinutes(5).create();
  si_construirePreparation_(inv);
  si_construireApres_(inv, '');
  si_construireNotice_(inv);
  si_reparerLive_(inv);
  Logger.log('Classeur : « ' + inv.getName() + ' ». Onglets « ' + SI.PREP + ' » et « ' + SI.APRES + ' » prêts. ' +
             'Déclencheurs posés (modification + 5 min).');
}

/** Toutes les 5 min : traite les validations en attente, rafraîchit les chiffres du CRM, répare les #ERROR. */
function majSaisieInventaire() {
  const inv = SpreadsheetApp.openById(si_idInventaire_());
  si_traiterDemandes_(inv);
  si_construireNotice_(inv);
  si_construirePreparation_(inv);
  const shA = inv.getSheetByName(SI.APRES);
  si_construireApres_(inv, shA ? String(shA.getRange('B4').getValue()).trim() : '', true);
  si_reparerLive_(inv);
}

/**
 * Déclencheur « à la modification » du classeur Inventaire.
 * Il ne fait qu'enregistrer la demande et programme le traitement dans la minute :
 * le traitement tourne dans le contexte du CRM (fonctions Stock_Boutique.gs).
 */
function si_surModification(e) {
  if (!e || !e.range) return;
  const sh = e.range.getSheet();
  const nom = sh.getName();
  const a1 = e.range.getA1Notation();
  const coche = e.range.getValue() === true;
  if (nom === SI.PREP && a1 === 'J4') {
    sh.getRange('A5').setValue('⏳ Changement de match reçu : les tablettes le prendront dans 1 à 2 minutes.');
    si_programmer_();
  } else if (nom === SI.PREP && a1 === 'H4' && coche) {
    sh.getRange('A5').setValue('⏳ Validation reçue : prise en compte dans 1 à 2 minutes. Ne pas modifier les cases jaunes en attendant.');
    si_programmer_();
  } else if (nom === SI.APRES && a1 === 'B4') {
    sh.getRange('A6').setValue('⏳ Chargement du rapport du match… (1 à 2 minutes)');
    si_programmer_();
  } else if (nom === SI.APRES && a1 === 'N4' && coche) {
    sh.getRange('A6').setValue('⏳ « À rajouter » envoyé vers la préparation du match suivant (1 à 2 minutes)…');
    si_programmer_();
  } else if (nom === SI.PREP && a1 === 'N6' && coche) {
    sh.getRange('A5').setValue('⏳ Pré-remplissage « tout rapporter au dépôt » (1 à 2 minutes)…');
    si_programmer_();
  } else if (nom === SI.APRES && a1 === 'H4' && coche) {
    sh.getRange('A6').setValue('⏳ Contrôle reçu : enregistrement dans 1 à 2 minutes.');
    si_programmer_();
  }
}

/** Traitement immédiat (déclencheur ponctuel posé par si_surModification). */
function si_traiterDemandes() {
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() === 'si_traiterDemandes') ScriptApp.deleteTrigger(t); });
  const inv = SpreadsheetApp.openById(si_idInventaire_());
  si_traiterDemandes_(inv);
  const shA = inv.getSheetByName(SI.APRES);
  const match = shA ? String(shA.getRange('B4').getValue()).trim() : '';
  if (shA && match !== String(shA.getRange('B5').getNote() || '')) si_construireApres_(inv, match);
}

function si_programmer_() {
  const deja = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'si_traiterDemandes');
  if (!deja) ScriptApp.newTrigger('si_traiterDemandes').timeBased().after(5 * 1000).create();
}

function si_traiterDemandes_(inv) {
  const shP = inv.getSheetByName(SI.PREP);
  if (shP) { try { si_synchroMatch_(shP); } catch (e) { console.warn('Match préparé : ' + e.message); } }
  if (shP && shP.getRange('H4').getValue() === true) {
    let msg;
    try { msg = si_validerPreparation_(inv, shP); }
    catch (err) { msg = '❌ ' + err.message; }
    shP.getRange('H4').setValue(false);
    shP.getRange('A5').setValue(msg);
    si_construirePreparation_(inv);
  }
  if (shP && shP.getRange('N6').getValue() === true) {
    let msg;
    try { msg = si_resetBoutiques_(shP); } catch (err) { msg = '❌ ' + err.message; }
    shP.getRange('N6').setValue(false);
    shP.getRange('A5').setValue(msg);
  }
  const shA = inv.getSheetByName(SI.APRES);
  if (shA && shA.getRange('N4').getValue() === true) {
    let msg;
    try { msg = si_versPreparation_(inv, shA); } catch (err) { msg = '❌ ' + err.message; }
    shA.getRange('N4').setValue(false);
    shA.getRange('A6').setValue(msg);
  }
  if (shA && shA.getRange('H4').getValue() === true) {
    let msg;
    try { msg = si_validerControle_(inv, shA); }
    catch (err) { msg = '❌ ' + err.message; }
    shA.getRange('H4').setValue(false);
    si_construireApres_(inv, String(shA.getRange('B4').getValue()).trim());
    shA.getRange('A6').setValue(msg);
  }
}

/* ============================== 📖 MODE D'EMPLOI ============================== */

const SI_NOTICE_VERSION = 'notice-v3';

/** Onglet de notice pas à pas, en tête du classeur. Recréé seulement si absent ou si la version change. */
function si_construireNotice_(inv) {
  const NOM = '📖 MODE D\'EMPLOI';
  let sh = inv.getSheetByName(NOM);
  if (sh && sh.getRange('A1').getNote() === SI_NOTICE_VERSION) return;
  if (sh) sh.clear(); else sh = inv.insertSheet(NOM, 0);

  // [texte, style] — styles : T titre, S section, E étape, X exemple, I info, A attention, V vide
  const L = [
    ['📖 MODE D\'EMPLOI — Boutique : stock et contrôle des matchs', 'T'],
    ['Tu travailles uniquement dans ce classeur. Tout ce que tu valides part dans le CRM du club en 1 à 2 minutes.', 'I'],
    ['', 'V'],
    ['LES 3 RÈGLES', 'S'],
    ['🟨 Cases JAUNES = c\'est toi qui les remplis.', 'E'],
    ['⬜ Cases GRISES = elles viennent du CRM. On n\'y touche pas (Google affiche un avertissement si on essaie).', 'E'],
    ['☑️ Rien n\'est enregistré tant que tu n\'as pas coché la case « ✅ Valider ». Ton prénom est obligatoire.', 'E'],
    ['', 'V'],
    ['① AVANT LE MATCH — onglet « 📦 PRÉPARATION STOCK »', 'S'],
    ['Chaque ligne = un article (une taille). Les colonnes grises montrent le stock actuel : Dépôt · Boutique GP · Boutique VIP · Total.', 'I'],
    ['1. Vérifie le match en J4 « Match préparé » : le prochain match est choisi tout seul. Pour préparer un autre match, choisis-le dans la liste.', 'E'],
    ['   C\'est ce match que les tablettes chargeront, avec le stock que tu prépares ici.', 'I'],
    ['1 bis. Écris ton prénom en B4.', 'E'],
    ['2. Une livraison est arrivée ? Écris le fournisseur et le n° de facture en E4, puis la quantité reçue dans la colonne « ➕ Reçu au dépôt ».', 'E'],
    ['3. Ce que tu installes en boutique : colonnes « Dépôt → GP » et « Dépôt → VIP ».', 'E'],
    ['4. Si besoin : « GP → VIP » / « VIP → GP » (déplacer entre boutiques), « GP → Dépôt » / « VIP → Dépôt » (rapporter au dépôt).', 'E'],
    ['5. Coche « ✅ Valider » (H4). Le message « ⏳ Validation reçue » s\'affiche.', 'E'],
    ['6. Attends 1 à 2 minutes : la colonne « Résultat » affiche ✅ et le nouveau stock, les cases jaunes se vident toutes seules.', 'E'],
    ['EXEMPLE — livraison Monprinteur de samedi : 25 mugs reçus, 15 pour la boutique GP, 10 pour la VIP.', 'X'],
    ['→ Ligne MUG-BLC-TU : « Reçu au dépôt » = 25 · « Dépôt → GP » = 15 · « Dépôt → VIP » = 10. En E4 : « Monprinteur devis 527 ». Prénom en B4, puis Valider.', 'X'],
    ['→ Résultat : « ✅ +25 reçu, 15 → GP, 10 → VIP · maintenant dépôt 0 / GP 15 / VIP 10 ».', 'X'],
    ['', 'V'],
    ['② LE JOUR DU MATCH — la tablette', 'S'],
    ['1. Avant l\'ouverture, en wifi : Synchronisation → « 🎫 Charger le match ». Un seul bouton : le match, les billets ET le stock que tu as préparé arrivent sur la tablette.', 'E'],
    ['   Si la tablette est allumée en wifi sans caisse ouverte, elle passe toute seule au match suivant une fois le précédent joué.', 'I'],
    ['2. Pendant le match : la caisse marche sans internet.', 'E'],
    ['3. À la fermeture : clôturer la caisse, puis « Synchroniser tout » dès qu\'il y a du réseau. C\'est ça qui envoie les ventes au CRM.', 'E'],
    ['4. Remise à zéro de la tablette : seulement APRÈS la synchronisation (la tablette refuse tant que des ventes ne sont pas parties).', 'E'],
    ['', 'V'],
    ['③ APRÈS LE MATCH — onglet « 🏁 APRÈS MATCH »', 'S'],
    ['Le rapport des tablettes s\'affiche tout seul : chiffre d\'affaires par boutique (CB, espèces, offerts), articles vendus, stock restant.', 'I'],
    ['⚠ Ne compte rien tant que la tablette n\'a pas fait « Synchroniser tout » : sinon les ventes ne sont pas encore déduites.', 'A'],
    ['1. Vérifie le match en B4 (le dernier est choisi tout seul ; la liste déroulante donne les autres).', 'E'],
    ['2. CAISSE : « CB relevé TPE » = total du ticket de fin de journée du terminal. « Espèces comptées » = espèces dans la caisse MOINS le fond de caisse.', 'E'],
    ['3. STOCK : compte les articles et écris les quantités dans « Compté GP », « Compté VIP » (et « Compté dépôt » si tu le fais). Case vide = pas compté.', 'E'],
    ['4. Les écarts se calculent seuls : 0 = parfait ; en rouge = différence (négatif = il en manque).', 'E'],
    ['5. Ton prénom en E4, une adresse en J4 si tu veux une copie du mail, un commentaire en B5 si besoin (ex. « TPE en panne 10 minutes »).', 'E'],
    ['6. Coche « ✅ Valider le contrôle » (H4). En 1 à 2 minutes : le stock du CRM est corrigé, le contrôle de caisse est enregistré et le rapport part par mail à Clément.', 'E'],
    ['EXEMPLE : le CRM dit 33 écharpes en GP, tu en comptes 31 → écart −2 en rouge. Après validation, le CRM passe à 31 et Clément le voit dans le mail.', 'X'],
    ['', 'V'],
    ['④ PRÉPARER LE MATCH SUIVANT — fiche match (même onglet, colonnes Q à U)', 'S'],
    ['Pour chaque article : « Départ » (ce qu\'il y avait en boutique au début du match) → « Vendus » → reste (Stock GP / VIP) → « ➕ À rajouter ».', 'I'],
    ['Les restes restent en boutique. « À rajouter » propose de remettre ce qui est sorti pendant le match, dans la limite du dépôt (⚠ si le dépôt n\'en a pas assez).', 'I'],
    ['1. Corrige si besoin les chiffres jaunes « ➕ À rajouter GP / VIP » (0 ou vide = rien à rajouter).', 'E'],
    ['2. Coche « ➡ Préparer le match suivant » (N4) : les quantités arrivent dans 📦 PRÉPARATION STOCK, colonnes « Dépôt → GP / VIP ».', 'E'],
    ['3. Va dans 📦 PRÉPARATION STOCK, vérifie, puis coche « ✅ Valider ». Rien n\'est enregistré avant cette validation.', 'E'],
    ['EXEMPLE : 12 écharpes vendues en GP, 119 au dépôt → « À rajouter GP » = 12. Après validation, la boutique GP retrouve son niveau de départ.', 'X'],
    ['Occasionnel — vider les boutiques (fin de saison, rangement) : dans 📦 PRÉPARATION STOCK, coche « 🔁 Tout rapporter au dépôt » (N6), vérifie, puis Valider.', 'I'],
    ['', 'V'],
    ['EN CAS DE SOUCI', 'S'],
    ['❌ « Indiquez votre nom » → remplir B4 (ou E4 après match), puis recocher.', 'E'],
    ['❌ « pas assez au dépôt / en GP / en VIP » → la quantité demandée dépasse le stock : recompter ou corriger, puis revalider. Rien n\'a été changé.', 'E'],
    ['❌ « coût d\'achat inconnu » ou article absent de la liste → prévenir Clément.', 'E'],
    ['Rien ne bouge après 5 minutes → recocher la case Valider ; si ça continue, prévenir Clément.', 'E'],
    ['Dons, cadeaux partenaires, casse : ne passent pas par ce tableau, ils sont saisis par Clément.', 'I'],
    ['', 'V'],
    ['Les onglets « 🔄 … LIVE » sont en lecture seule (mis à jour automatiquement). Les anciens onglets (Stock Total, En boutique, Dépot) restent pour l\'historique.', 'I'],
  ];
  sh.getRange(1, 1, L.length, 1).setValues(L.map(l => [l[0]]));
  sh.setColumnWidth(1, 980);
  sh.getRange(1, 1, L.length, 1).setWrap(true).setVerticalAlignment('middle').setFontSize(11).setFontFamily('Arial');
  const style = { T: ['#0b1f3a', '#ffffff', 16, true], S: ['#0b1f3a', '#ffffff', 12, true], E: ['#ffffff', '#111111', 11, false],
                  X: ['#fff2cc', '#5b4400', 11, false], I: ['#eef1f5', '#333333', 11, false], A: ['#fde2e1', '#991b1b', 11, true], V: ['#ffffff', '#111111', 6, false] };
  L.forEach((l, i) => {
    const s = style[l[1]], r = sh.getRange(i + 1, 1);
    r.setBackground(s[0]).setFontColor(s[1]).setFontSize(s[2]).setFontWeight(s[3] ? 'bold' : 'normal');
    if (l[1] === 'X') r.setFontStyle('italic');
    if (l[1] === 'V' || l[1] === 'T') sh.setRowHeight(i + 1, l[1] === 'V' ? 8 : 36);   // les autres lignes s'ajustent au texte
  });
  sh.getRange('A1').setNote(SI_NOTICE_VERSION);
  sh.setHiddenGridlines(true);
  sh.setTabColor('#f59e0b');
}

/* ============================ 📦 PRÉPARATION STOCK ============================ */

function si_construirePreparation_(inv) {
  let sh = inv.getSheetByName(SI.PREP);
  const neuf = !sh;
  if (neuf) {
    sh = inv.insertSheet(SI.PREP, 0);
    sh.getRange('A1').setValue('📦 PRÉPARATION DU STOCK — avant le match').setFontSize(14).setFontWeight('bold').setFontColor(SI.NUIT);
    sh.getRange('A2').setValue('1. Mon nom en B4 · 2. Si livraison : fournisseur et n° de facture en E4 · ' +
      '3. Quantités dans les cases JAUNES (nombres positifs) · 4. Cocher « Valider » (H4). ' +
      'Les colonnes grises viennent du CRM : ne pas les modifier.').setWrap(false).setFontColor('#555555');
    sh.getRange('A4').setValue('Saisi par :').setFontWeight('bold').setHorizontalAlignment('right');
    sh.getRange('B4').setBackground(SI.JAUNE);
    sh.getRange('D4').setValue('Fournisseur / n° facture :').setFontWeight('bold').setHorizontalAlignment('right');
    sh.getRange('E4:F4').merge().setBackground(SI.JAUNE);
    sh.getRange('G4').setValue('✅ Valider →').setFontWeight('bold').setHorizontalAlignment('right');
    sh.getRange('H4').insertCheckboxes().setBackground(SI.JAUNE);
    sh.getRange('A5').setValue('Prêt.').setFontStyle('italic');
    sh.getRange(SI.P_HDR, 1, 1, SI.P_COLS.length).setValues([SI.P_COLS]).setFontWeight('bold')
      .setBackground(SI.NUIT).setFontColor('#ffffff').setWrap(true).setVerticalAlignment('middle');
    sh.setFrozenRows(SI.P_HDR);
    sh.setFrozenColumns(3);
    [110, 190, 60, 70, 90, 90, 60, 90, 80, 80, 75, 75, 80, 85, 330].forEach((w, i) => sh.setColumnWidth(i + 1, w));
    sh.setRowHeight(SI.P_HDR, 40);
    sh.getRange('A6').setValue('Rappel : réception = entrée au dépôt au coût d\'achat connu du CRM. Un article absent de la liste : prévenir Clément.')
      .setFontColor('#888888').setFontSize(9);
  }

  si_entetePrepMatch_(sh);
  si_entetePrepReset_(sh);

  // Saisies en cours (conservées par référence)
  const enCours = {}, ordre = [];
  const n0 = sh.getLastRow() - SI.P_HDR;
  if (!neuf && n0 > 0) {
    sh.getRange(SI.P_HDR + 1, 1, n0, SI.P_COLS.length).getValues().forEach(r => {
      const ref = String(r[0]).trim();
      ordre.push(ref);
      if (ref) enCours[ref] = { saisie: r.slice(7, 14), resultat: r[14] };
    });
  }

  const P = sb_lireProduits_();
  const actifs = P.rows.filter(x => x.actif && x.ref);

  // Même liste d'articles : on ne réécrit que les colonnes grises (A à G), sans toucher aux saisies.
  if (!neuf && n0 === actifs.length && actifs.every((x, i) => ordre[i] === x.ref)) {
    sh.getRange(SI.P_HDR + 1, 1, n0, 7).setValues(actifs.map(x => [x.ref, x.modele || x.produit, x.taille || 'TU', x.R, x.B1, x.B2, x.R + x.B1 + x.B2]));
    sh.getRange('A3').setValue('Stock CRM lu le ' + sb_fmt_(new Date()) + ' (mise à jour automatique toutes les 5 minutes)');
    return;
  }

  const lignes = actifs.map(x => {
    const s = enCours[x.ref] || { saisie: ['', '', '', '', '', '', ''], resultat: '' };
    return [x.ref, x.modele || x.produit, x.taille || 'TU', x.R, x.B1, x.B2, x.R + x.B1 + x.B2].concat(s.saisie, [s.resultat]);
  });

  if (n0 > 0) sh.getRange(SI.P_HDR + 1, 1, n0, SI.P_COLS.length).clearContent().clearDataValidations();
  if (lignes.length) {
    const r0 = SI.P_HDR + 1;
    sh.getRange(r0, 1, lignes.length, SI.P_COLS.length).setValues(lignes);
    sh.getRange(r0, 1, lignes.length, 7).setBackground(SI.GRIS);
    sh.getRange(r0, 7, lignes.length, 1).setFontWeight('bold');
    const zone = sh.getRange(r0, 8, lignes.length, 7);
    zone.setBackground(SI.JAUNE).setHorizontalAlignment('center');
    zone.setDataValidation(SpreadsheetApp.newDataValidation().requireNumberGreaterThanOrEqualTo(0)
      .setAllowInvalid(false).setHelpText('Nombre entier positif').build());
    sh.getRange(r0, 15, lignes.length, 1).setFontSize(9).setFontColor('#444444');
  }
  si_protegerAvertissement_(sh, 'si_prep_crm', sh.getRange(SI.P_HDR + 1, 1, Math.max(lignes.length, 1), 7));
  sh.getRange('A3').setValue('Stock CRM lu le ' + sb_fmt_(new Date()) + ' (mise à jour automatique toutes les 5 minutes)')
    .setFontColor('#888888').setFontSize(9);
}

/** Applique les saisies jaunes au CRM. Chaque ligne est contrôlée avant d'être appliquée. */
function si_validerPreparation_(inv, sh) {
  const auteur = String(sh.getRange('B4').getValue()).trim();
  if (!auteur) throw new Error('Indiquez votre nom en B4, puis cochez à nouveau « Valider ».');
  const fournisseur = String(sh.getRange('E4').getValue()).trim();
  const n = sh.getLastRow() - SI.P_HDR;
  if (n < 1) return 'Aucune ligne.';
  const data = sh.getRange(SI.P_HDR + 1, 1, n, SI.P_COLS.length).getValues();
  const P = sb_lireProduits_();

  const ok = [], resultats = [];
  data.forEach((r, i) => {
    const ref = String(r[0]).trim();
    const v = {};
    let vide = true, invalide = false;
    SI.P_SAISIE.forEach((k, j) => {
      const brut = r[7 + j];
      if (brut === '' || brut === null) { v[k] = 0; return; }
      const q = Number(String(brut).replace(',', '.'));
      if (!(q >= 0) || Math.round(q) !== q) invalide = true;
      v[k] = Math.round(q) || 0;
      if (v[k]) vide = false;
    });
    if (vide && !invalide) { resultats.push(null); return; }
    const x = P.rows.find(p => p.ref === ref);
    if (!x) { resultats.push('❌ référence inconnue du CRM'); return; }
    if (invalide) { resultats.push('❌ nombres entiers positifs uniquement'); return; }
    if (v.recu && !(x.cout > 0)) { resultats.push('❌ coût d\'achat inconnu dans le CRM : prévenir Clément'); return; }
    // Simulation dans l'ordre d'application
    let R = x.R + v.recu, B1 = x.B1, B2 = x.B2;
    const etapes = [
      () => { R -= v.r2gp + v.r2vip; B1 += v.r2gp; B2 += v.r2vip; return R >= 0 ? '' : 'pas assez au dépôt (' + (x.R + v.recu) + ')'; },
      () => { B1 -= v.gp2vip; B2 += v.gp2vip; return B1 >= 0 ? '' : 'pas assez en GP pour → VIP'; },
      () => { B2 -= v.vip2gp; B1 += v.vip2gp; return B2 >= 0 ? '' : 'pas assez en VIP pour → GP'; },
      () => { B1 -= v.gp2r; R += v.gp2r; return B1 >= 0 ? '' : 'pas assez en GP pour retour dépôt'; },
      () => { B2 -= v.vip2r; R += v.vip2r; return B2 >= 0 ? '' : 'pas assez en VIP pour retour dépôt'; },
    ];
    for (const e of etapes) { const pb = e(); if (pb) { resultats.push('❌ ' + pb + ' : rien n\'a été enregistré pour cette ligne'); return; } }
    ok.push({ i: i, x: x, v: v, apres: { R: R, B1: B1, B2: B2 } });
    resultats.push('');
  });

  if (!ok.length) {
    si_ecrireResultats_(sh, resultats);
    return resultats.some(r => r) ? '⚠ Aucune ligne enregistrée : voir la colonne Résultat.' : 'Aucune quantité saisie.';
  }

  const ref = fournisseur ? fournisseur : 'Inventaire ' + sb_fmt_(new Date(), 'dd/MM/yyyy');
  const trace = 'Inventaire · ' + auteur;
  const mt = si_matchTablettes_();
  SI_MATCH_COURANT = mt ? mt.nom : '';
  const heure = sb_fmt_(new Date(), 'dd/MM HH:mm');
  // Étapes dans l'ordre : chaque case jaune est vidée dès que son opération est enregistrée dans le CRM.
  // En cas d'erreur au milieu d'une ligne, ce qui est fait est vidé et ce qui reste est laissé en place :
  // revalider ne rejoue jamais une opération déjà enregistrée.
  const ETAPES = [
    ['recu', 8, '+%d reçu', o => si_appel_(enregistrerReception, { lignes: [{ ref: o.x.ref, R: o.v.recu }], prix_achat: o.x.cout,
      fournisseur: fournisseur || 'Saisie inventaire', reference: ref }, trace)],
    ['r2gp', 9, '%d → GP', o => si_appel_(enregistrerRepartition, { lignes: [{ ref: o.x.ref, B1: o.v.r2gp, B2: 0 }] }, trace)],
    ['r2vip', 10, '%d → VIP', o => si_appel_(enregistrerRepartition, { lignes: [{ ref: o.x.ref, B1: 0, B2: o.v.r2vip }] }, trace)],
    ['gp2vip', 11, '%d GP→VIP', o => si_appel_(enregistrerTransfert, { ref: o.x.ref, quantite: o.v.gp2vip, de: 'B1', vers: 'B2' }, trace)],
    ['vip2gp', 12, '%d VIP→GP', o => si_appel_(enregistrerTransfert, { ref: o.x.ref, quantite: o.v.vip2gp, de: 'B2', vers: 'B1' }, trace)],
    ['gp2r', 13, '%d GP→dépôt', o => si_appel_(enregistrerTransfert, { ref: o.x.ref, quantite: o.v.gp2r, de: 'B1', vers: 'R' }, trace)],
    ['vip2r', 14, '%d VIP→dépôt', o => si_appel_(enregistrerTransfert, { ref: o.x.ref, quantite: o.v.vip2r, de: 'B2', vers: 'R' }, trace)],
  ];
  let nbOk = 0;
  si_sansSynthese_(() => {
    ok.forEach(o => {
      const ligne = SI.P_HDR + 1 + o.i, faits = [];
      for (const e of ETAPES) {
        if (!o.v[e[0]]) continue;
        try { e[3](o); }
        catch (err) {
          resultats[o.i] = '❌ ' + err.message + (faits.length ? ' — déjà enregistré : ' + faits.join(', ') : '') +
                           ' — corriger les cases restantes puis revalider';
          return;
        }
        sh.getRange(ligne, e[1]).clearContent();
        faits.push(e[2].replace('%d', o.v[e[0]]));
      }
      resultats[o.i] = '✅ ' + heure + ' · ' + faits.join(', ') + ' · maintenant dépôt ' + o.apres.R + ' / GP ' + o.apres.B1 + ' / VIP ' + o.apres.B2;
      nbOk++;
    });
  });
  si_ecrireResultats_(sh, resultats);
  if (fournisseur && ok.every(o => !o.v.recu || String(resultats[o.i]).indexOf('✅') === 0)) sh.getRange('E4').clearContent();
  const nbPb = resultats.filter(r => r && r.indexOf('❌') === 0).length;
  return (nbOk ? '✅ ' : '⚠ ') + heure + ' — ' + nbOk + ' article(s) mis à jour dans le CRM par ' + auteur +
         (nbPb ? ' · ⚠ ' + nbPb + ' ligne(s) non enregistrée(s) : voir la colonne Résultat.' : '.');
}

function si_ecrireResultats_(sh, resultats) {
  resultats.forEach((r, i) => { if (r !== null) sh.getRange(SI.P_HDR + 1 + i, 15).setValue(r); });
}

/* ======================= 📅 MATCH PRÉPARÉ (calendrier) ======================= */

let SI_MATCH_COURANT = '';
const SI_CAL = '04b_CALENDRIER';   // écrit par le pilotage (Pilotage_Boutique.gs) depuis Tickie

/** Matchs du calendrier (CRM) : passés et à venir, avec le match envoyé aux tablettes. */
function si_calendrier_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(SI_CAL);
  if (!sh || sh.getLastRow() < 2) return [];
  const c = sb_cols_(sh);
  const auj = Utilities.formatDate(new Date(), 'Europe/Paris', 'yyyy-MM-dd');
  return sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues()
    .filter(r => r[c['ID événement Tickie'] - 1])
    .map((r, i) => {
      const d = r[c['Date'] - 1] instanceof Date ? r[c['Date'] - 1] : new Date(r[c['Date'] - 1]);
      const jour = Utilities.formatDate(d, 'Europe/Paris', 'yyyy-MM-dd');
      const nom = String(r[c['Match'] - 1]).trim();
      const j = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'][Number(Utilities.formatDate(d, 'Europe/Paris', 'u')) % 7];
      const hBrut = r[c['Heure'] - 1];
      const heure = hBrut instanceof Date ? Utilities.formatDate(d, 'Europe/Paris', 'HH:mm') : String(hBrut || '');
      return { ligne: i + 2, id: String(r[c['ID événement Tickie'] - 1]), nom: nom, jour: jour, passe: jour < auj,
               tablettes: String(r[c['Tablettes'] - 1]).indexOf('✅') === 0,
               libelle: j + ' ' + Utilities.formatDate(d, 'Europe/Paris', 'dd/MM') + ' ' + heure + ' — ' + nom };
    });
}

function si_matchTablettes_() {
  const cal = si_calendrier_();
  return cal.find(m => m.tablettes && !m.passe) || cal.find(m => !m.passe) || null;
}

/** Sélecteur « Match préparé » (J4) : la liste des matchs à venir ; installé une fois sur l'onglet existant. */
function si_entetePrepMatch_(sh) {
  if (String(sh.getRange('I4').getValue()) !== 'Match préparé :') {
    sh.getRange('I4').setValue('Match préparé :').setFontWeight('bold').setHorizontalAlignment('right');
    sh.getRange('J4:N4').merge().setBackground(SI.JAUNE).setFontWeight('bold');
  }
  const avenir = si_calendrier_().filter(m => !m.passe).map(m => m.libelle);
  if (avenir.length) sh.getRange('J4').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(avenir, true).setAllowInvalid(true).build());
}

/**
 * J4 changé par elle → le match choisi est coché « ✅ tablettes » dans 04b_CALENDRIER (le pilotage l'envoie aux tablettes).
 * Sinon → J4 suit le match des tablettes (qui passe tout seul au match suivant une fois le précédent joué).
 */
function si_synchroMatch_(sh) {
  si_entetePrepMatch_(sh);   // liste déroulante à jour AVANT toute écriture en J4 (sinon Google refuse la valeur)
  const cal = si_calendrier_();
  if (!cal.length) { sh.getRange('J4').setValue('(calendrier pas encore reçu du pilotage)'); return; }
  const choisi = String(sh.getRange('J4').getValue()).trim();
  const dernier = String(sh.getRange('J4').getNote() || '');
  const actuel = si_matchTablettes_();
  if (choisi && choisi !== dernier) {
    const m = cal.find(x => x.libelle === choisi && !x.passe);
    if (m) {
      const shC = SpreadsheetApp.getActive().getSheetByName(SI_CAL);
      const col = sb_cols_(shC)['Tablettes'];
      cal.forEach(x => shC.getRange(x.ligne, col).setValue(x.id === m.id ? '✅ tablettes' : ''));
      sh.getRange('J4').setNote(m.libelle);
      sh.getRange('A5').setValue('✅ Match préparé : ' + m.nom + '. Sur chaque tablette, en wifi : Synchronisation → « 🎫 Charger le match ».');
      return;
    }
  }
  if (actuel) { sh.getRange('J4').setValue(actuel.libelle).setNote(actuel.libelle); }
}

/* ============================== 🏁 APRÈS MATCH =============================== */

function si_construireApres_(inv, match, leger) {
  let sh = inv.getSheetByName(SI.APRES);
  if (!sh) {
    sh = inv.insertSheet(SI.APRES, 1);
    sh.getRange('A1').setValue('🏁 APRÈS MATCH — rapport des tablettes et contrôle').setFontSize(14).setFontWeight('bold').setFontColor(SI.NUIT);
    sh.getRange('A2').setValue('1. Choisir le match en B4 · 2. Saisir le relevé TPE, les espèces comptées (sans le fond de caisse) et le stock compté dans les cases JAUNES · ' +
      '3. Mon nom en E4 · 4. Cocher « Valider le contrôle » (H4). Le rapport part par mail et le stock du CRM est corrigé des écarts.').setFontColor('#555555');
    sh.getRange('A3').setValue('Avant de compter : la tablette doit avoir fait « Synchroniser tout » (sinon les ventes ne sont pas encore déduites).')
      .setFontColor('#b45309').setFontWeight('bold');
    sh.getRange('A4').setValue('Match :').setFontWeight('bold').setHorizontalAlignment('right');
    sh.getRange('B4:C4').merge().setBackground(SI.JAUNE);
    sh.getRange('D4').setValue('Contrôlé par :').setFontWeight('bold').setHorizontalAlignment('right');
    sh.getRange('E4').setBackground(SI.JAUNE);
    sh.getRange('G4').setValue('✅ Valider le contrôle →').setFontWeight('bold').setHorizontalAlignment('right');
    sh.getRange('H4').insertCheckboxes().setBackground(SI.JAUNE);
    sh.getRange('I4').setValue('Mail aussi à :').setFontWeight('bold').setHorizontalAlignment('right');
    sh.getRange('J4:L4').merge().setBackground(SI.JAUNE);
    sh.getRange('A5').setValue('Commentaire :').setFontWeight('bold').setHorizontalAlignment('right');
    sh.getRange('B5:L5').merge().setBackground(SI.JAUNE).setHorizontalAlignment('left');
    sh.setFrozenRows(5);
    [110, 190, 60, 80, 80, 70, 85, 90, 85, 70, 95, 85, 70, 85, 90, 75].forEach((w, i) => sh.setColumnWidth(i + 1, w));
  }

  si_enteteApres_(sh);

  // Liste des matchs (01_VENTES, ventes tablette), le plus récent d'abord
  const ventes = si_ventesTablette_();
  const matchs = [];
  ventes.forEach(v => { const m = matchs.find(y => y.nom === v.match); if (!m) matchs.push({ nom: v.match, d: v.date }); else if (v.date > m.d) m.d = v.date; });
  matchs.sort((a, b) => b.d - a.d);
  const liste = matchs.slice(0, 20).map(m => m.nom);
  if (liste.length) {
    sh.getRange('B4').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(liste, true).setAllowInvalid(true).build());
  }
  if (!match && liste.length) { match = liste[0]; sh.getRange('B4').setValue(match); }

  // Saisies en cours (conservées si même match)
  const memeMatch = String(sh.getRange('B5').getNote() || '') === match;

  // Rafraîchissement léger : même match, mêmes ventes, mêmes articles → seules les colonnes de stock CRM bougent
  const vmSig = ventes.filter(v => v.match === match);
  const Psig = sb_lireProduits_();
  const sig = [match, vmSig.length, vmSig.reduce((s, v) => s + v.q, 0), si_r2_(vmSig.reduce((s, v) => s + v.ca, 0)),
               Psig.rows.filter(x => x.ref && x.actif).length].join('|');
  if (leger && memeMatch && String(sh.getRange('A4').getNote() || '') === sig) {
    const n = sh.getLastRow() - SI.A_ART;
    if (n > 0) {
      const refs = sh.getRange(SI.A_ART + 1, 1, n, 1).getValues();
      const stock = sh.getRange(SI.A_ART + 1, 8, n, 7).getValues();
      refs.forEach((r, i) => {
        const x = Psig.rows.find(p => p.ref && p.ref === String(r[0]).trim());
        if (x) { stock[i][0] = x.B1; stock[i][3] = x.B2; stock[i][6] = x.R; }
      });
      // colonnes H, K, N uniquement (les saisies I, L, O et les formules ne sont pas réécrites)
      [[0, 8], [3, 11], [6, 14]].forEach(t => sh.getRange(SI.A_ART + 1, t[1], n, 1).setValues(stock.map(s => [s[t[0]] === undefined ? '' : s[t[0]]])));
      si_formulesApres_(inv, sh, SI.A_ART + 1, refs.filter(r => String(r[0]).trim() !== '').length);
    }
    return;
  }
  const caisseSaisie = { B1: ['', ''], B2: ['', ''] };
  const compte = {};
  if (memeMatch) {
    const c = sh.getRange(SI.A_CAISSE + 1, 1, 2, 11).getValues();
    c.forEach(r => { const k = r[0] === 'Boutique GP' ? 'B1' : r[0] === 'Boutique VIP' ? 'B2' : ''; if (k) caisseSaisie[k] = [r[7], r[8]]; });
    const n = sh.getLastRow() - SI.A_ART;
    if (n > 0) sh.getRange(SI.A_ART + 1, 1, n, SI.A_COLS_ART.length).getValues().forEach(r => {
      const ref = String(r[0]).trim(); if (ref) compte[ref] = [r[8], r[11], r[14], r[18], r[19]];
    });
  }

  // Effacer l'ancien rapport (lignes 7 et suivantes)
  const der = Math.max(sh.getLastRow(), 7);
  sh.getRange(7, 1, der - 6, Math.max(sh.getLastColumn(), SI.A_COLS_ART.length)).clear().clearDataValidations();
  sh.getRange('B5').setNote(match || '');
  if (!match) { sh.getRange('A7').setValue('Aucune vente tablette dans le CRM pour l\'instant.'); return; }

  const vm = vmSig;
  const P = Psig;
  sh.getRange('A4').setNote(sig);

  // ── Bloc caisse ──
  sh.getRange(SI.A_CAISSE - 1, 1).setValue('CAISSE — ' + match).setFontWeight('bold').setFontColor(SI.NUIT);
  const H1 = ['Boutique', 'Ventes', 'Articles', 'CA TTC tablette', 'dont CB', 'dont espèces', 'Offerts (art.)',
              'CB relevé TPE', 'Espèces comptées', 'Écart CB', 'Écart espèces'];
  sh.getRange(SI.A_CAISSE, 1, 1, H1.length).setValues([H1]).setFontWeight('bold').setBackground(SI.NUIT).setFontColor('#ffffff').setWrap(true);
  const lignesC = ['B1', 'B2'].map((b, j) => {
    const x = vm.filter(v => v.boutique === b);
    const payes = x.filter(v => !v.offert);
    const r = SI.A_CAISSE + 1 + j;
    return [b === 'B1' ? 'Boutique GP' : 'Boutique VIP', payes.length, payes.reduce((s, v) => s + v.q, 0),
      si_r2_(payes.reduce((s, v) => s + v.ca, 0)), si_r2_(payes.filter(v => v.mode === 'CB').reduce((s, v) => s + v.ca, 0)),
      si_r2_(payes.filter(v => v.mode === 'ESPECES').reduce((s, v) => s + v.ca, 0)), x.filter(v => v.offert).reduce((s, v) => s + v.q, 0),
      caisseSaisie[b][0], caisseSaisie[b][1], '=IF(H' + r + '="","",H' + r + '-E' + r + ')', '=IF(I' + r + '="","",I' + r + '-F' + r + ')'];
  });
  const rT = SI.A_CAISSE + 3;
  sh.getRange(SI.A_CAISSE + 1, 1, 2, H1.length).setValues(lignesC.map(l => l.map(v => (typeof v === 'string' && v[0] === '=') ? '' : v)));
  lignesC.forEach((l, j) => { const r = SI.A_CAISSE + 1 + j; sh.getRange(r, 10).setFormula(si_f_(inv, l[9])); sh.getRange(r, 11).setFormula(si_f_(inv, l[10])); });
  sh.getRange(rT, 1).setValue('TOTAL').setFontWeight('bold');
  ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'].forEach(col => {
    sh.getRange(col + rT).setFormula('=SUM(' + col + (SI.A_CAISSE + 1) + ':' + col + (SI.A_CAISSE + 2) + ')');
  });
  sh.getRange(rT, 1, 1, H1.length).setFontWeight('bold').setBackground(SI.GRIS);
  sh.getRange(SI.A_CAISSE + 1, 8, 2, 2).setBackground(SI.JAUNE);
  sh.getRange(SI.A_CAISSE + 1, 4, 3, 8).setNumberFormat('#,##0.00 "€"');
  const nbSansMode = vm.filter(v => !v.offert && v.mode !== 'CB' && v.mode !== 'ESPECES').length;
  sh.getRange(SI.A_CAISSE + 4, 1).setValue(
    (nbSansMode ? '⚠ ' + nbSansMode + ' vente(s) avec un autre mode de paiement (comptées dans le CA, ni CB ni espèces). ' : '') +
    'Écart positif = plus en caisse que prévu ; négatif = manque.').setFontSize(9).setFontColor('#666666');

  // ── Bloc articles ──
  sh.getRange(SI.A_ART - 1, 1).setValue('ARTICLES — vendus pendant le match et stock du CRM (après synchro)').setFontWeight('bold').setFontColor(SI.NUIT);
  sh.getRange(SI.A_ART, 1, 1, SI.A_COLS_ART.length).setValues([SI.A_COLS_ART]).setFontWeight('bold')
    .setBackground(SI.NUIT).setFontColor('#ffffff').setWrap(true);
  const parProduit = {};
  vm.forEach(v => {
    const k = sb_norm_(v.produit);
    const o = parProduit[k] = parProduit[k] || { nom: v.produit, B1: 0, B2: 0, off: 0, offB1: 0, offB2: 0, ca: 0 };
    if (v.offert) { o.off += v.q; o[v.boutique === 'B2' ? 'offB2' : 'offB1'] += v.q; } else { o[v.boutique === 'B2' ? 'B2' : 'B1'] += v.q; o.ca += v.ca; }
  });
  const lignesA = [];
  const vus = {};
  P.rows.filter(x => x.ref && (x.actif || parProduit[sb_norm_(x.produit)])).forEach(x => {
    const s = parProduit[sb_norm_(x.produit)] || { B1: 0, B2: 0, off: 0, offB1: 0, offB2: 0, ca: 0 };
    vus[sb_norm_(x.produit)] = true;
    const c = compte[x.ref] || ['', '', '', '', ''];
    // Fiche match (organisation d'Élise) : départ = reste + sorties du match ; « à rajouter » = ce qui est sorti,
    // pour revenir au niveau de départ, dans la limite du dépôt (GP servi d'abord).
    const sortGP = s.B1 + s.offB1, sortVIP = s.B2 + s.offB2;
    const propGP = Math.min(sortGP, Math.max(0, x.R)), propVIP = Math.min(sortVIP, Math.max(0, x.R - propGP));
    const manque = (sortGP - propGP) + (sortVIP - propVIP);
    const aGP = c[3] !== '' && c[3] !== undefined ? c[3] : (propGP || ''), aVIP = c[4] !== '' && c[4] !== undefined ? c[4] : (propVIP || '');
    lignesA.push({ vendu: s.B1 + s.B2 + s.off, row: [x.ref, x.modele || x.produit, x.taille || 'TU', s.B1, s.B2, s.off, si_r2_(s.ca),
      x.B1, c[0], '', x.B2, c[1], '', x.R, c[2], '',
      x.B1 + sortGP, x.B2 + sortVIP, aGP, aVIP, manque > 0 ? '⚠ dépôt insuffisant : il manque ' + manque : ''] });
  });
  Object.keys(parProduit).filter(k => !vus[k]).forEach(k => {
    const s = parProduit[k];
    lignesA.push({ vendu: s.B1 + s.B2 + s.off, row: ['—', s.nom + ' (hors catalogue CRM)', '', s.B1, s.B2, s.off, si_r2_(s.ca), '', '', '', '', '', '', '', '', '', '', '', '', '', 'article absent du CRM'] });
  });
  lignesA.sort((a, b) => (b.vendu > 0) - (a.vendu > 0));
  if (lignesA.length) {
    const r0 = SI.A_ART + 1, n = lignesA.length;
    sh.getRange(r0, 1, n, SI.A_COLS_ART.length).setValues(lignesA.map(l => l.row));
    const f = [];
    for (let i = 0; i < n; i++) {
      const r = r0 + i;
      f.push(['=IF(I' + r + '="","",I' + r + '-H' + r + ')']);
    }
    sh.getRange(r0, 10, n, 1).setFormulas(f.map(x => [si_f_(inv, x[0])]));
    sh.getRange(r0, 13, n, 1).setFormulas(f.map((_, i) => [si_f_(inv, '=IF(L' + (r0 + i) + '="","",L' + (r0 + i) + '-K' + (r0 + i) + ')')]));
    sh.getRange(r0, 16, n, 1).setFormulas(f.map((_, i) => [si_f_(inv, '=IF(O' + (r0 + i) + '="","",O' + (r0 + i) + '-N' + (r0 + i) + ')')]));
    [9, 12, 15].forEach(c => sh.getRange(r0, c, n, 1).setBackground(SI.JAUNE).setHorizontalAlignment('center')
      .setDataValidation(SpreadsheetApp.newDataValidation().requireNumberGreaterThanOrEqualTo(0).setAllowInvalid(false).build()));
    [8, 11, 14, 17, 18].forEach(c => sh.getRange(r0, c, n, 1).setBackground(SI.GRIS));
    sh.getRange(r0, 19, n, 2).setBackground(SI.JAUNE).setHorizontalAlignment('center')
      .setDataValidation(SpreadsheetApp.newDataValidation().requireNumberGreaterThanOrEqualTo(0).setAllowInvalid(false).build());
    sh.getRange(r0, 21, n, 1).setFontColor('#b45309').setFontSize(9);
    sh.getRange(r0, 7, n, 1).setNumberFormat('#,##0.00 "€"');
    const tot = r0 + n;
    sh.getRange(tot, 2).setValue('TOTAL').setFontWeight('bold');
    ['D', 'E', 'F', 'G'].forEach(col => sh.getRange(col + tot).setFormula('=SUM(' + col + r0 + ':' + col + (tot - 1) + ')'));
    sh.getRange(tot, 7).setNumberFormat('#,##0.00 "€"');
    sh.getRange(tot, 1, 1, SI.A_COLS_ART.length).setFontWeight('bold').setBackground(SI.GRIS);
    const regle = SpreadsheetApp.newConditionalFormatRule().whenNumberNotEqualTo(0).setFontColor('#b91c1c').setBold(true)
      .setRanges([sh.getRange(r0, 10, n, 1), sh.getRange(r0, 13, n, 1), sh.getRange(r0, 16, n, 1),
                  sh.getRange(SI.A_CAISSE + 1, 10, 3, 2)]).build();
    sh.setConditionalFormatRules([regle]);
  }
  sh.getRange('A6').setValue('Rapport mis à jour le ' + sb_fmt_(new Date()) + ' · ' + vm.length + ' ligne(s) de vente tablette pour ce match.')
    .setFontStyle('italic');
}

/** (Ré)écrit les formules d'écart de l'onglet APRÈS MATCH avec le séparateur du classeur (ne touche à aucune saisie). */
function si_formulesApres_(inv, sh, r0, n) {
  for (let j = 0; j < 2; j++) {
    const r = SI.A_CAISSE + 1 + j;
    sh.getRange(r, 10, 1, 2).setFormulas([[si_f_(inv, '=IF(H' + r + '="","",H' + r + '-E' + r + ')'), si_f_(inv, '=IF(I' + r + '="","",I' + r + '-F' + r + ')')]]);
  }
  if (n < 1) return;
  const f = (a, b, r) => si_f_(inv, '=IF(' + a + r + '="","",' + a + r + '-' + b + r + ')');
  const lignes = [];
  for (let i = 0; i < n; i++) lignes.push(r0 + i);
  sh.getRange(r0, 10, n, 1).setFormulas(lignes.map(r => [f('I', 'H', r)]));
  sh.getRange(r0, 13, n, 1).setFormulas(lignes.map(r => [f('L', 'K', r)]));
  sh.getRange(r0, 16, n, 1).setFormulas(lignes.map(r => [f('O', 'N', r)]));
}

/** En-tête de la fiche match (bouton « préparer le match suivant »), posé une fois sur l'onglet existant. */
function si_enteteApres_(sh) {
  if (String(sh.getRange('M4').getValue()) === '➡ Préparer le match suivant :') return;
  sh.getRange('M4').setValue('➡ Préparer le match suivant :').setFontWeight('bold').setHorizontalAlignment('right');
  sh.getRange('N4').insertCheckboxes().setBackground(SI.JAUNE);
  [100, 100, 95, 95, 230].forEach((w, i) => sh.setColumnWidth(17 + i, w));
}

/** Bouton « vider les boutiques » (reset occasionnel), posé une fois sur la préparation. */
function si_entetePrepReset_(sh) {
  if (String(sh.getRange('M6').getValue()) === '🔁 Tout rapporter au dépôt :') return;
  sh.getRange('M6').setValue('🔁 Tout rapporter au dépôt :').setFontWeight('bold').setHorizontalAlignment('right').setFontSize(9);
  sh.getRange('N6').insertCheckboxes();
}

/**
 * « ➕ À rajouter » de la fiche match → colonnes « Dépôt → GP / VIP » de la préparation.
 * Rien n'est enregistré dans le CRM ici : elle vérifie puis coche « Valider » dans la préparation.
 */
function si_versPreparation_(inv, shA) {
  const match = String(shA.getRange('B4').getValue()).trim();
  const n = shA.getLastRow() - SI.A_ART;
  if (n < 1) throw new Error('Aucun article dans la fiche.');
  const art = shA.getRange(SI.A_ART + 1, 1, n, SI.A_COLS_ART.length).getValues();
  const ajout = {};
  art.forEach(r => {
    const ref = String(r[0]).trim(), g = Math.round(Number(r[18]) || 0), v = Math.round(Number(r[19]) || 0);
    if (ref && ref !== '—' && (g > 0 || v > 0)) ajout[ref] = [Math.max(0, g), Math.max(0, v)];
  });
  const refs = Object.keys(ajout);
  if (!refs.length) return 'Rien à rajouter (colonnes « ➕ À rajouter » vides).';
  const shP = inv.getSheetByName(SI.PREP);
  const m = shP.getLastRow() - SI.P_HDR;
  const prep = shP.getRange(SI.P_HDR + 1, 1, m, 1).getValues();
  let nb = 0, pieces = 0;
  prep.forEach((r, i) => {
    const a = ajout[String(r[0]).trim()];
    if (!a) return;
    if (a[0]) shP.getRange(SI.P_HDR + 1 + i, 9).setValue(a[0]);
    if (a[1]) shP.getRange(SI.P_HDR + 1 + i, 10).setValue(a[1]);
    nb++; pieces += a[0] + a[1];
  });
  shP.getRange('A5').setValue('📝 Pré-rempli depuis « ' + match + ' » : ' + pieces + ' pièce(s) à mettre en boutique (' + nb +
    ' article(s), colonnes Dépôt → GP / VIP). Vérifie, puis coche « ✅ Valider ».');
  return '✅ ' + pieces + ' pièce(s) envoyée(s) vers 📦 PRÉPARATION STOCK. Rien n\'est encore enregistré : à valider là-bas.';
}

/** Reset occasionnel : pré-remplit « GP → Dépôt » et « VIP → Dépôt » avec tout le stock des boutiques (à valider). */
function si_resetBoutiques_(shP) {
  const n = shP.getLastRow() - SI.P_HDR;
  const data = shP.getRange(SI.P_HDR + 1, 1, n, 7).getValues();
  let pieces = 0;
  data.forEach((r, i) => {
    const gp = Math.round(Number(r[4]) || 0), vip = Math.round(Number(r[5]) || 0);
    if (gp > 0) { shP.getRange(SI.P_HDR + 1 + i, 13).setValue(gp); pieces += gp; }
    if (vip > 0) { shP.getRange(SI.P_HDR + 1 + i, 14).setValue(vip); pieces += vip; }
  });
  return pieces ? '📝 ' + pieces + ' pièce(s) pré-remplies en « GP → Dépôt » / « VIP → Dépôt ». Vérifie, puis coche « ✅ Valider » pour vider les boutiques.'
                : 'Les boutiques sont déjà vides.';
}

/** Enregistre le contrôle : écarts de stock → CRM, caisse → 25_CONTROLES_CAISSE, rapport par mail. */
function si_validerControle_(inv, sh) {
  const match = String(sh.getRange('B4').getValue()).trim();
  const auteur = String(sh.getRange('E4').getValue()).trim();
  if (!match) throw new Error('Choisissez le match en B4.');
  if (!auteur) throw new Error('Indiquez votre nom en E4, puis cochez à nouveau « Valider le contrôle ».');
  if (String(sh.getRange('B5').getNote() || '') !== match) throw new Error('Le rapport affiché ne correspond pas au match choisi : attendez sa mise à jour puis recochez.');
  const commentaire = String(sh.getRange('B5').getValue()).trim();
  const copie = String(sh.getRange('J4').getValue()).trim();
  const heure = sb_fmt_(new Date(), 'dd/MM HH:mm');

  // 1. Caisse
  const caisse = sh.getRange(SI.A_CAISSE + 1, 1, 3, 11).getValues();
  const shC = si_ongletCRM_(SI.CONTROLES, SI.ENTETES_CONTROLES);
  const cC = sb_cols_(shC);
  caisse.slice(0, 2).forEach(r => {
    const row = new Array(shC.getLastColumn()).fill('');
    const set = (k, v) => { if (cC[k]) row[cC[k] - 1] = v; };
    set('horodatage', new Date()); set('match', match); set('boutique', r[0]); set('CA_tablette_TTC', r[3]);
    set('CB_tablette', r[4]); set('CB_TPE', r[7]); set('ecart_CB', r[7] === '' ? '' : si_r2_(r[7] - r[4]));
    set('especes_tablette', r[5]); set('especes_comptees', r[8]); set('ecart_especes', r[8] === '' ? '' : si_r2_(r[8] - r[5]));
    set('offerts_articles', r[6]); set('controle_par', auteur); set('commentaire', commentaire);
    shC.appendRow(row);
  });

  // 2. Stock compté → écarts corrigés dans le CRM
  const n = sh.getLastRow() - SI.A_ART;
  const art = n > 0 ? sh.getRange(SI.A_ART + 1, 1, n, SI.A_COLS_ART.length).getValues() : [];
  const lignes = [], ecarts = [];
  const Pfrais = sb_lireProduits_();   // l'écart se calcule sur le stock CRM du moment, pas sur l'affichage
  art.forEach(r => {
    const ref = String(r[0]).trim();
    if (!ref || ref === '—') return;
    const l = { ref: ref, R: r[14], B1: r[8], B2: r[11] };
    if (l.R === '' && l.B1 === '' && l.B2 === '') return;
    const x = Pfrais.rows.find(p => p.ref === ref);
    if (!x) return;
    lignes.push(l);
    [['B1', 8, 'GP'], ['B2', 11, 'VIP'], ['R', 14, 'dépôt']].forEach(t => {
      if (r[t[1]] !== '' && Number(r[t[1]]) !== x[t[0]]) ecarts.push(r[1] + ' ' + r[2] + ' ' + t[2] + ' : CRM ' + x[t[0]] + ', compté ' + r[t[1]]);
    });
  });
  let msgStock = 'stock non compté';
  if (lignes.length) {
    msgStock = si_appel_(enregistrerInventaire, { lignes: lignes, commentaire: 'Contrôle après match ' + match + ' — ' + auteur }, 'Inventaire · ' + auteur);
  }

  // 3. Rapport par mail
  const dest = [Session.getEffectiveUser().getEmail()];
  if (/@/.test(copie)) dest.push(copie);
  try {
    MailApp.sendEmail({ to: dest.join(','), subject: '🏁 Boutique — contrôle ' + match + ' (' + auteur + ')',
      htmlBody: si_mailRapport_(match, auteur, caisse, art, ecarts, commentaire) });
  } catch (e) { console.warn('Mail : ' + e.message); }

  // Les comptages ont été appliqués : on les vide pour ne pas les réappliquer
  if (n > 0) [9, 12, 15].forEach(c => sh.getRange(SI.A_ART + 1, c, n, 1).clearContent());
  sh.getRange('A3').setValue('Dernier contrôle validé : ' + match + ' — ' + heure + ' par ' + auteur).setFontColor('#15803d');
  return '✅ ' + heure + ' — contrôle enregistré dans le CRM · caisse : ' + caisse.slice(0, 2).map(r => r[0] + ' ' + si_eur_(r[3])).join(', ') +
         ' · ' + (ecarts.length ? ecarts.length + ' écart(s) de stock corrigé(s)' : msgStock) + ' · rapport envoyé par mail.';
}

function si_mailRapport_(match, auteur, caisse, art, ecarts, commentaire) {
  const td = 'style="border:1px solid #ddd;padding:4px 8px"';
  const th = 'style="border:1px solid #ddd;padding:4px 8px;background:#0b1f3a;color:#fff"';
  const ec = (a, b) => (a === '' || a === null ? '—' : si_eur_(a - b));
  let h = '<h2 style="color:#0b1f3a">Boutique — ' + match + '</h2><p>Contrôle saisi par <b>' + auteur + '</b> le ' + sb_fmt_(new Date()) + '.</p>';
  h += '<table style="border-collapse:collapse;font-family:Arial;font-size:13px"><tr><th ' + th + '>Boutique</th><th ' + th + '>Articles</th><th ' + th +
       '>CA TTC</th><th ' + th + '>CB</th><th ' + th + '>Espèces</th><th ' + th + '>Offerts</th><th ' + th + '>Écart CB</th><th ' + th + '>Écart espèces</th></tr>';
  caisse.slice(0, 2).forEach(r => {
    h += '<tr><td ' + td + '>' + r[0] + '</td><td ' + td + '>' + r[2] + '</td><td ' + td + '>' + si_eur_(r[3]) + '</td><td ' + td + '>' + si_eur_(r[4]) +
         '</td><td ' + td + '>' + si_eur_(r[5]) + '</td><td ' + td + '>' + r[6] + '</td><td ' + td + '>' + ec(r[7], r[4]) + '</td><td ' + td + '>' + ec(r[8], r[5]) + '</td></tr>';
  });
  const tot = caisse.slice(0, 2).reduce((s, r) => s + (Number(r[3]) || 0), 0);
  h += '<tr><td ' + td + '><b>TOTAL</b></td><td ' + td + '></td><td ' + td + '><b>' + si_eur_(tot) + '</b></td><td ' + td + ' colspan="5"></td></tr></table>';
  const vendus = art.filter(r => (Number(r[3]) || 0) + (Number(r[4]) || 0) + (Number(r[5]) || 0) > 0);
  if (vendus.length) {
    h += '<h3>Articles vendus</h3><table style="border-collapse:collapse;font-family:Arial;font-size:13px"><tr><th ' + th + '>Article</th><th ' + th +
         '>Taille</th><th ' + th + '>GP</th><th ' + th + '>VIP</th><th ' + th + '>Offerts</th><th ' + th + '>CA TTC</th></tr>';
    vendus.forEach(r => { h += '<tr><td ' + td + '>' + r[1] + '</td><td ' + td + '>' + r[2] + '</td><td ' + td + '>' + r[3] + '</td><td ' + td + '>' + r[4] +
                               '</td><td ' + td + '>' + r[5] + '</td><td ' + td + '>' + si_eur_(r[6]) + '</td></tr>'; });
    h += '</table>';
  }
  h += '<h3>Stock</h3>' + (ecarts.length ? '<ul><li>' + ecarts.join('</li><li>') + '</li></ul><p>Ces écarts ont été corrigés dans le CRM (mouvements AJUSTEMENT_INVENTAIRE).</p>' : '<p>Aucun écart de stock signalé.</p>');
  const ruptures = art.filter(r => String(r[0]) !== '—' && (Number(r[7]) || 0) + (Number(r[10]) || 0) === 0 && (Number(r[13]) || 0) > 0);
  if (ruptures.length) h += '<p>À remettre en boutique depuis le dépôt : ' + ruptures.map(r => r[1] + ' ' + r[2] + ' (' + r[13] + ' au dépôt)').join(', ') + '.</p>';
  if (commentaire) h += '<h3>Commentaire</h3><p>' + commentaire.replace(/</g, '&lt;') + '</p>';
  return h;
}

/* ======================= Réparation des #ERROR! (🔄 LIVE) ======================= */

function si_reparerLive_(inv) {
  try {
    const st = inv.getSheetByName('🔄 STOCK LIVE');
    if (st && st.getLastRow() > 4) {
      const n = st.getLastRow() - 4;
      const vals = st.getRange(5, 1, n, 2).getValues();
      const aff = st.getRange(5, 10, n, 1).getDisplayValues();
      vals.forEach((r, i) => {
        const ligne = 5 + i;
        if (String(r[0]).trim() && String(r[1]).trim() !== 'TOTAL' && String(aff[i][0]).indexOf('#') === 0) {
          st.getRange(ligne, 10).setFormula(si_f_(inv, '=IF(I' + ligne + '="","",I' + ligne + '-G' + ligne + ')'));
        }
      });
    }
    const vl = inv.getSheetByName('🔄 VENTES LIVE');
    if (vl && vl.getLastRow() > 4 && String(vl.getRange('H2').getDisplayValue()).indexOf('#') === 0) {
      const der = vl.getLastRow();
      vl.getRange('H2').setFormula(si_f_(inv, '="Pointées : "&COUNTIF(A5:A' + der + ',TRUE)&" / ' + (der - 4) + '"'));
    }
  } catch (e) { console.warn('Réparation LIVE : ' + e.message); }
}

/* ================================== OUTILS =================================== */

function si_idInventaire_() {
  return PropertiesService.getScriptProperties().getProperty('INVENTAIRE_ID') || SI.ID_DEFAUT;
}

/** Appelle une fonction de Stock_Boutique.gs et signe les mouvements créés (colonne auteur). */
function si_appel_(fn, p, auteur) {
  const ss = SpreadsheetApp.getActive();
  const sh0 = ss.getSheetByName(SB.ONGLET_MOUVEMENTS);
  const avant = sh0 ? sh0.getLastRow() : 1;
  const msg = fn(p);
  const sh = ss.getSheetByName(SB.ONGLET_MOUVEMENTS);
  if (sh && sh.getLastRow() > avant) {
    const c = sb_cols_(sh);
    if (c.auteur) sh.getRange(avant + 1, c.auteur, sh.getLastRow() - avant, 1).setValue(auteur);
    if (c.match && SI_MATCH_COURANT) {
      const rg = sh.getRange(avant + 1, c.match, sh.getLastRow() - avant, 1);
      rg.setValues(rg.getValues().map(v => [v[0] || SI_MATCH_COURANT]));
    }
  }
  return msg;
}

/**
 * Exécute fn en suspendant le recalcul de 12_SYNTHESE_STOCK que chaque fonction de Stock_Boutique.gs
 * relance après chaque opération (lent) ; une seule synthèse est faite à la fin.
 */
function si_sansSynthese_(fn) {
  const original = rafraichirSynthese_;
  rafraichirSynthese_ = function () {};
  try { return fn(); }
  finally {
    rafraichirSynthese_ = original;
    try { rafraichirSynthese_(); } catch (e) { console.warn('Synthèse stock : ' + e.message); }
  }
}

/** Ventes tablette de 01_VENTES : match, boutique, produit, quantité, CA TTC, mode de paiement. */
function si_ventesTablette_() {
  const sh = SpreadsheetApp.getActive().getSheetByName('01_VENTES');
  if (!sh || sh.getLastRow() < 2) return [];
  const c = sb_cols_(sh);
  const g = (r, k) => (c[k] ? r[c[k] - 1] : '');
  return sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues()
    .filter(r => String(g(r, 'source')).trim() === 'tablette' && String(g(r, 'match_associe')).trim())
    .map(r => {
      const mode = sb_norm_(g(r, 'mode_paiement'));
      return {
        match: String(g(r, 'match_associe')).trim(),
        date: g(r, 'date') instanceof Date ? g(r, 'date') : new Date(0),
        boutique: String(g(r, 'boutique_id')).trim() === 'B2' ? 'B2' : 'B1',
        produit: String(g(r, 'produit')).trim(),
        q: sb_num_(g(r, 'quantite')) || 0,
        ca: sb_num_(g(r, 'CA')) || 0,
        offert: mode.indexOf('offert') !== -1,
        mode: mode.indexOf('espece') !== -1 ? 'ESPECES' : (mode === 'cb' || mode.indexOf('carte') !== -1) ? 'CB' : mode.toUpperCase(),
      };
    });
}

function si_ongletCRM_(nom, entetes) {
  const sh = sb_ongletOuCree_(nom, entetes);
  sb_assurerColonnes_(sh, entetes);
  return sh;
}

function si_protegerAvertissement_(sh, cle, range) {
  try {
    sh.getProtections(SpreadsheetApp.ProtectionType.RANGE).filter(p => p.getDescription() === cle).forEach(p => p.remove());
    range.protect().setDescription(cle).setWarningOnly(true);
  } catch (e) { /* protection facultative */ }
}

/**
 * Séparateur d'arguments selon la langue du classeur : un classeur réglé en français (virgule décimale)
 * n'accepte que « ; » — avec « , » la formule s'affiche #ERROR!. Nos formules n'ont pas de nombre décimal.
 */
function si_f_(ss, formule) {
  let loc = '';
  try { loc = String(ss.getSpreadsheetLocale() || ''); } catch (e) { loc = ''; }
  const virgule = /^(en|ja|zh|ko|he|iw|th|hi)(_|$)/i.test(loc) || !loc;
  return virgule ? formule : formule.replace(/,/g, ';');
}

function si_r2_(v) { return Math.round((Number(v) || 0) * 100) / 100; }
function si_eur_(v) { return (Number(v) || 0).toFixed(2).replace('.', ',') + ' €'; }
