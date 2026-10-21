# Pilotage boutique — installation

Le pilotage est un **projet Apps Script séparé** (comme `Tickie_Receiver`) : ses `doGet`/`doPost` n'interfèrent pas avec ceux de `CRM_Boutique_V3` utilisés par les tablettes pour le catalogue et la synchro de fin de match.

## Installation (une fois, ~10 min)
1. https://script.google.com → **Nouveau projet**, le nommer `Pilotage Boutique`.
2. Remplacer `Code.gs` par le contenu de `Pilotage_Boutique.gs`.
3. **Paramètres du projet → Propriétés du script** :
   - `VIVENU_API_KEY` = la clé API Tickie (la même que pour la buvette / tickie-proxy) ;
   - `CRM_BOUTIQUE_ID` = l'identifiant du classeur « SPACERS — CRM Boutique » (la partie entre `/d/` et `/edit` de son URL). Sans cette propriété, l'identifiant par défaut du script est utilisé.
4. Sélectionner la fonction **installerPilotage** → ▶ Exécuter → autoriser.
   Le journal d'exécution affiche le **nom du classeur** (à vérifier) et le **jeton**. Crée les onglets 20 à 23 et le déclencheur 10 min.
5. **Déployer → Nouveau déploiement → Application Web** : exécuter en tant que *moi*, accès *Tout le monde*. Copier l'URL `…/exec`.
   Mises à jour ultérieures : **Gérer les déploiements → ✏️ → Nouvelle version** (l'URL ne change pas).
6. Ouvrir `https://spacers-boutique.spacersytb.workers.dev/pilotage.html`, coller l'URL et le jeton.
7. En bas du tableau de bord : copier le lien **B1** et le lien **B2**, l'ouvrir une fois sur la tablette correspondante (le pilotage se configure tout seul).

## Jour de match
1. **Tableau de bord** : choisir le match → « Envoyer ce match aux tablettes ».
2. **Chaque tablette, en wifi** : Synchronisation → « Mettre à jour le catalogue » puis « 🎫 Charger le match ». Le tableau de bord affiche « ✓ tablette chargée ».
3. **Ouvrir la caisse** : adversaire, date et heure sont pré-remplis depuis Tickie.
4. **En boutique** : « Scanner le billet » avant d'encaisser. Fonctionne hors ligne (liste des billets en mémoire). Les ventes partent au fil de l'eau ; hors ligne, elles attendent le retour du réseau (bandeau « 📡 Pilotage » en bas de la caisse).
5. **Après le match** : clôture et « Synchroniser tout » comme avant (01_VENTES, stock, Pennylane : inchangé).

## Onglets ajoutés au CRM Boutique
| Onglet | Contenu |
|---|---|
| 20_VENTES_LIVE | une ligne par vente : boutique, mode, total, articles, billet scanné (id, code, tarif), puis client Tickie, email et nom de l'acheteur (complétés toutes les 10 min) |
| 21_LIGNES_LIVE | une ligne par article vendu (réf., produit, qté, PU, CA) |
| 22_TABLETTES | dernier chargement du match et dernière remontée de ventes par boutique |
| 23_CLIENTS_BOUTIQUE | une ligne par acheteur identifié : achats, articles, CA, premier/dernier achat, matchs, tarifs |
| 24_TRANSFERTS_LIVE | une ligne par article passé d'une boutique à l'autre : course du volant pour un client ou réassort (de, vers, réf., qté, motif, match, bénévole) |

Les ventes « Offert » sont reçues mais exclues du CA et de la fiche client. Le tableau de bord du pilotage lit uniquement 20/21 ; la comptabilité reste sur 01_VENTES.

## Données personnelles
- La tablette ne garde que : identifiant du billet, code-barres, tarif (et le prénom affiché au scan quand le relais Tickie répond). Ni email ni nom complet.
- Le lien vers l'acheteur (client Tickie, email, nom) est fait côté serveur, dans le CRM.
- Le tableau de bord ne reçoit que des totaux.
- À afficher en boutique et dans la politique de confidentialité : le scan du billet sert à mesurer les achats par profil de spectateur et à alimenter le programme de fidélité.

## Organisation du classeur CRM (`Organisation_Classeur.gs`)

À coller dans le projet Apps Script **du classeur** (Extensions › Apps Script › ➕ Fichier › Script, nom `Organisation_Classeur`), puis sélectionner `organiserClasseur` et ▶ Exécuter. Relançable à volonté.

Crée 📖 SOMMAIRE, 📊 TABLEAU DE BORD (formules, sélecteur de saison) et 🔎 RECHERCHE ; range les onglets par familles colorées ; masque les onglets techniques/obsolètes ; fige et stylise les en-têtes, ajoute filtres, notes de colonnes et formats € / dates ; pose un avertissement non bloquant sur les onglets automatiques. Aucun onglet ni aucune en-tête n'est renommé : les scripts existants ne sont pas impactés.

## Passerelle acheteurs (`Passerelle_Acheteurs.gs`)

Fichier autonome : à ajouter au projet **du classeur** (App_Boutique) ou au projet **Pilotage Boutique** (➕ Fichier › Script, nom `Passerelle_Acheteurs`), puis ▶ `installerPasserelle` une fois. Le journal affiche le nom des deux classeurs et le premier bilan.

- **01_VENTES** : chaque ligne vendue en tablette reçoit à droite `ID vente`, `Client Tickie`, `Email acheteur`, `Nom acheteur`, `ID billet`, `Code-barres`, `Tarif billet`, `Profil acheteur` (Abonné / Billet payant / Invité / gratuit / Sans billet) ; la colonne historique `email` est aussi remplie. Rapprochement avec `21_LIGNES_LIVE` : même session de caisse, produit, quantité, CA, ±3 min. Relançable sans doublon.
- **CRM Billetterie** : onglet `BOUTIQUE_COMMANDES`, une ligne par article (acheteur, billet, profil, `ID_MATCH` lu dans 🏆 MATCHES, produit, montant, paiement), reconstruit à chaque passage — pendant de `BUVETTE_COMMANDES`.
- Déclencheur horaire `passerelleAcheteurs` ; si le fichier est dans le projet Pilotage, `relierAcheteurs` l'appelle aussi dès qu'un billet est relié.
- Propriété facultative `CRM_BILLETTERIE_ID` (posée par l'installation).
- La synchro de fin de match (`CRM_Boutique_V3`) et les tablettes ne changent pas. Aucun nouveau déploiement Web App n'est nécessaire.

## Mise à jour du classeur « Inventaire 2026 2027 » (`Inventaire_Boutique.gs`)

Fichier autonome, à ajouter au projet **du classeur** (App_Boutique) puis ▶ `installerInventaire` une fois (déclencheur 10 min). ▶ `diagnosticInventaire` liste les tableaux reconnus.

- Sources : ventes caisse (`21_LIGNES_LIVE`, en direct pendant le match) et retraits d'add-ons web remis au stand (`17b_REMISES`).
- Chaque article est décompté une fois dans les tableaux des onglets **En boutique** et **Stock Total** correspondant au produit, au stand (B1 → « … GP », B2 → « … VIP ») et à la taille. L'onglet **Dépot** n'est pas touché.
- **Journal ventes** (3 lieux : Boutique GP, Boutique VIP, Hors match) : les ventes caisse et retraits web y sont ajoutés (Info « 🔄 … ») ; les ventes saisies à la main y sont décomptées dès que la ligne est complète — GP/VIP → En boutique + Stock Total, Hors match → Stock Total. Colonne « Stock MAJ » : ✓ stock avant → après, ou ⚠ à vérifier ; une ligne marquée n'est jamais redécomptée.
- Trace technique / anti-doublon caisse : onglet masqué `🔄 MAJ auto (CRM)`.
- Seuls les mouvements postérieurs à l'installation sont pris en compte (propriété `INVENTAIRE_DEPUIS`).
- Nouveau produit : ajouter une ligne dans `INV_FAMILLES` (motif du nom CRM ↔ motif du nom de tableau).

## Transferts entre boutiques (courses du volant, réassort)

Les deux boutiques n'ont pas le même stock (le gros du stock est en GP) et il n'y a pas d'internet sur place.

**En caisse (tablette)**
- Article à 0 au stand mais présent dans l'autre boutique : la carte devient orange « 🏃 GP » avec le stock estimé (« 0 ici · ≈4 en GP »). Au toucher, la caisse demande si le volant va le chercher. Le client paie normalement ; la ligne du panier porte « 🏃 à chercher en GP ».
- Après l'encaissement, le bouton **« 🏃 N à rapporter de GP »** clignote. Quand le volant revient : **✔ Remis**. Article introuvable : **Introuvable** (la ligne est retirée de la vente, montant à rembourser affiché).
- **📦 Recevoir de GP** : le volant rapporte plusieurs articles d'un coup (réassort).
- Le stock GP affiché vient du CRM (`03_PRODUITS.stock_B1`, chargé avec le catalogue) : indicatif tant que la boutique GP n'a pas de tablette.

**Côté serveur** — la vente reste celle du stand qui encaisse (01_VENTES inchangé) ; seul l'emplacement du stock bouge. Tout passe par le projet **du classeur** (pas besoin du projet Pilotage) :
- `crm/CRM_Boutique_V3.gs` V3.5 : `doPost` action `transferts`, envoyée par la tablette avec **« Synchroniser tout »** (même URL que la synchro de fin de match).
- `crm/Transferts_Boutique.gs` : nouveau fichier à côté de `Stock_Boutique.gs`, puis ▶ `installerTransferts` une fois. Écrit 24_TRANSFERTS_LIVE (anti-doublon sur l'ID) et applique à `03_PRODUITS` (stock_B1 / stock_B2) avec deux mouvements TRANSFERT dans 11_MOUVEMENTS_STOCK ; colonne « Appliqué 03_PRODUITS » (✓ / ⚠).
- Puis **Déployer → Gérer les déploiements → ✏️ → Nouvelle version** (l'URL des tablettes ne change pas).
- `Inventaire_Boutique.gs` : lit 24_TRANSFERTS_LIVE ; −qté dans le tableau du stand de départ, +qté dans celui d'arrivée (En boutique + Stock Total).
- Facultatif : si le projet Pilotage est installé, la tablette lui envoie aussi les transferts au fil de l'eau (même onglet 24, pas de doublon).

## Saisie depuis le classeur « Inventaire 2026 2027 » (`crm/Saisie_Inventaire.gs`)

La personne en charge de la boutique travaille uniquement dans son classeur Inventaire (aucun accès au CRM ni au code).
À ajouter au projet **du classeur CRM** (➕ Fichier › Script, nom `Saisie_Inventaire`), puis ▶ `installerSaisieInventaire` une fois.

- **📦 PRÉPARATION STOCK** (avant match) : stock CRM Dépôt / GP / VIP par article ; cases jaunes = reçu au dépôt, dépôt → GP/VIP, GP ↔ VIP, retours au dépôt ; case « Valider » → `enregistrerReception` / `enregistrerRepartition` / `enregistrerTransfert` (02_ACHATS, 03_PRODUITS, 11_MOUVEMENTS_STOCK signés « Inventaire · prénom »). Ligne contrôlée avant application ; chaque case vidée dès son opération enregistrée (pas de double application en cas d'erreur).
- **🏁 APRÈS MATCH** : rapport des ventes tablette (01_VENTES) par match — CA GP/VIP, CB, espèces, offerts, articles vendus, stock CRM ; saisie relevé TPE, espèces comptées, stock compté ; « Valider le contrôle » → `enregistrerInventaire` (écarts), onglet `25_CONTROLES_CAISSE`, rapport par mail.
- Déclencheurs : à la modification du classeur Inventaire (programme le traitement dans la minute) + toutes les 5 min (traitement, rafraîchissement des colonnes grises sans toucher aux saisies, réparation des `#ERROR!` de 🔄 STOCK LIVE / VENTES LIVE).
- Propriété facultative `INVENTAIRE_ID` (sinon l'identifiant par défaut du classeur Inventaire).


## Espace Gestion du stock (`crm/Gestion_API.gs` + `gestion.html`)

Pour la personne qui gère le stock, sans passer par les onglets. Les bénévoles en boutique restent sur la caisse.

1. Projet Apps Script **du classeur CRM Boutique** : ➕ Fichier › Script, nom `Gestion_API`, coller `crm/Gestion_API.gs`.
2. Remplacer `CRM_Boutique_V3.gs` (V3.6 : route `gestion_etat` / `gestion`) et `Stock_Boutique.gs` (auteur des mouvements) par les versions du dépôt.
3. **Paramètres du projet › Propriétés du script** : `GESTION_PIN` = un code de 4 à 6 chiffres, à donner à la personne qui gère le stock.
4. **Déployer › Gérer les déploiements › ✏️ › Nouvelle version** (l'URL des tablettes ne change pas).
5. Ouvrir `https://spacers-boutique.spacersytb.workers.dev/gestion.html` : prénom + code PIN.

Écrans : Accueil (état dépôt / GP / VIP, alertes, badges) · Réception au dépôt · Remplir les boutiques (réassort proposé d'après le dernier match et les seuils) · Bilan du match (CA par boutique et par paiement, ventes rapprochées des sorties de stock, « à rajouter ») · Inventaire (par lieu, écarts tracés) · Sortie / don (bons DOT numérotés, contrôle 73 €) · Historique.
Chaque action passe par les fonctions existantes de `Stock_Boutique.gs` (03_PRODUITS, 11_MOUVEMENTS_STOCK, 02_ACHATS) ; le classeur « Inventaire 2026 2027 » continue d'être mis à jour par `Inventaire_Boutique.gs`. Les onglets de comptage du matériel club (chasubles, gobelets, gilets…) ne sont pas touchés.

### Un seul outil (21/10/2026)
La page Gestion fait tout : match préparé pour les tablettes, réception, remplissage des boutiques, bilan + contrôle de caisse (25_CONTROLES_CAISSE + mail), inventaire, vente hors match, sorties/dons.
Une fois adoptée : ▶ `retirerSaisieClasseur` (Gestion_API) masque « 📦 PRÉPARATION STOCK » / « 🏁 APRÈS MATCH », arrête leurs déclencheurs et réécrit le mode d'emploi. Le classeur Inventaire devient une copie en lecture (🔄 LIVE, via Lien_Inventaire.gs) ; le matériel club y reste tenu à la main.
