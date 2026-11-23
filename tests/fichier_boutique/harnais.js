// Maquette Apps Script : SpreadsheetApp en mémoire + vrai Stock_Boutique.gs + Fichier_Boutique.gs
const fs = require('fs');
const vm = require('vm');
const DIR = process.argv[2];

function colNum(l) { let n = 0; for (const ch of l) n = n * 26 + ch.charCodeAt(0) - 64; return n; }
function parseA1(a) {
  const [p1, p2] = a.split(':');
  const f = x => { const m = /^([A-Z]+)(\d+)$/.exec(x); return [Number(m[2]), colNum(m[1])]; };
  const [r1, c1] = f(p1); const [r2, c2] = p2 ? f(p2) : [r1, c1];
  return [r1, c1, r2 - r1 + 1, c2 - c1 + 1];
}

class Sheet {
  constructor(ss, name) { this.ss = ss; this.name = name; this.g = {}; this.notes = {}; this.prot = []; this.bg = {}; }
  getName() { return this.name; }
  key(r, c) { return r + ',' + c; }
  get(r, c) { const v = this.g[this.key(r, c)]; return v === undefined ? '' : v; }
  set(r, c, v) { if (v === '' || v === null || v === undefined) delete this.g[this.key(r, c)]; else this.g[this.key(r, c)] = v; }
  getLastRow() { let m = 0; for (const k in this.g) m = Math.max(m, Number(k.split(',')[0])); return m; }
  getLastColumn() { let m = 0; for (const k in this.g) m = Math.max(m, Number(k.split(',')[1])); return m; }
  getMaxRows() { return Math.max(1000, this.getLastRow()); }
  getMaxColumns() { return Math.max(26, this.getLastColumn()); }
  insertColumnsAfter() {}
  getRange(a, b, c, d) {
    if (typeof a === 'string') { const [r, cc, nr, nc] = parseA1(a); return new Range(this, r, cc, nr, nc); }
    return new Range(this, a, b, c || 1, d || 1);
  }
  getDataRange() { return new Range(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  appendRow(row) { const r = this.getLastRow() + 1; row.forEach((v, i) => this.set(r, i + 1, v)); }
  setFrozenRows() {} setFrozenColumns() {} setColumnWidth() {} setRowHeight() {} setHiddenGridlines() {} setTabColor() {}
  getProtections() { return this.prot; }
  clear() { this.g = {}; this.notes = {}; }
  copyTo() { return this; } setName(n) { this.name = n; return this; }
  // utilitaire de test
  row(r, n) { return Array.from({ length: n }, (_, i) => this.get(r, i + 1)); }
  find(col, val, from) { for (let r = from || 1; r <= this.getLastRow(); r++) if (this.get(r, col) === val) return r; return -1; }
}
class Range {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
  getValues() { const o = []; for (let i = 0; i < this.nr; i++) { const l = []; for (let j = 0; j < this.nc; j++) l.push(this.sh.get(this.r + i, this.c + j)); o.push(l); } return o; }
  getValue() { return this.sh.get(this.r, this.c); }
  getDisplayValues() { return this.getValues().map(l => l.map(String)); }
  setValues(v) {
    if (v.length !== this.nr || v.some(l => l.length !== this.nc)) throw new Error('setValues dims ' + this.nr + 'x' + this.nc + ' vs ' + v.length + 'x' + (v[0] || []).length + ' @' + this.sh.name);
    v.forEach((l, i) => l.forEach((x, j) => this.sh.set(this.r + i, this.c + j, x))); return this;
  }
  setValue(x) { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sh.set(this.r + i, this.c + j, x); return this; }
  clearContent() { return this.setValue(''); }
  insertCheckboxes() { return this.setValue(false); }
  getA1Notation() { let s = '', n = this.c; while (n) { s = String.fromCharCode(65 + (n - 1) % 26) + s; n = Math.floor((n - 1) / 26); } return s + this.r; }
  getSheet() { return this.sh; }
  setNote(n) { this.sh.notes[this.r + ',' + this.c] = n; return this; }
  getNote() { return this.sh.notes[this.r + ',' + this.c] || ''; }
  setBackgrounds(b) { b.forEach((l, i) => { this.sh.bg[(this.r + i) + ',' + this.c] = l[0]; }); return this; }
  setBackground(b) { for (let i = 0; i < this.nr; i++) this.sh.bg[(this.r + i) + ',' + this.c] = b; return this; }
  protect() { const p = { d: '', setDescription(d) { this.d = d; return this; }, getDescription() { return this.d; }, setWarningOnly() { return this; }, remove() {} }; this.sh.prot.push(p); return p; }
}
['setFontSize', 'setFontWeight', 'setFontColor', 'setWrap', 'setVerticalAlignment', 'setHorizontalAlignment', 'merge', 'setFontStyle',
 'setNumberFormat', 'setFontFamily', 'clearDataValidations', 'setDataValidation'].forEach(m => { Range.prototype[m] = function () { return this; }; });

class SS {
  constructor(name, id) { this.name = name; this.id = id; this.sheets = []; }
  getId() { return this.id; } getName() { return this.name; } getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id; }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  getSheets() { return this.sheets; }
  insertSheet(n, idx) { const s = new Sheet(this, n); if (idx === undefined) this.sheets.push(s); else this.sheets.splice(idx, 0, s); return s; }
  deleteSheet(s) { this.sheets = this.sheets.filter(x => x !== s); }
  setActiveSheet(s) { this.active = s; } moveActiveSheet() {}
  setSpreadsheetLocale() {} setSpreadsheetTimeZone() {} getSpreadsheetLocale() { return 'fr_FR'; }
  toast() {}
}

const pad = n => String(n).padStart(2, '0');
function fmt(d, z, motif) {
  const m = { yyyy: d.getFullYear(), MM: pad(d.getMonth() + 1), dd: pad(d.getDate()), HH: pad(d.getHours()), mm: pad(d.getMinutes()), u: d.getDay() || 7, M: d.getMonth() + 1 };
  return motif.replace(/yyyy|MM|dd|HH|mm|u|M/g, k => m[k]);
}

function creerContexte() {
  const crm = new SS('SPACERS_BOUTIQUE_CRM_V2', 'CRM');
  const fichiers = { CRM: crm };
  const props = {}, cache = {}, triggers = [], mails = [];
  let nid = 0;
  const builder = h => {
    const t = { h, getHandlerFunction: () => h };
    const b = { forSpreadsheet: () => b, onEdit: () => b, timeBased: () => b, everyMinutes: () => b, after: () => b, create: () => { triggers.push(t); return t; } };
    return b;
  };
  const ctx = {
    console, Math, Date, JSON, Number, String, Array, Object, isNaN, RegExp, Error, Set,
    SpreadsheetApp: {
      getActive: () => crm,
      openById: id => { if (!fichiers[id]) throw new Error('introuvable ' + id); return fichiers[id]; },
      create: n => { const s = new SS(n, 'F' + (++nid)); s.insertSheet('Feuille 1'); fichiers[s.id] = s; return s; },
      newDataValidation: () => { const v = { requireNumberGreaterThanOrEqualTo: () => v, requireValueInList: () => v, setAllowInvalid: () => v, setHelpText: () => v, build: () => ({}) }; return v; },
      ProtectionType: { RANGE: 'RANGE' }, getUi: () => ({})
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) },
    ScriptApp: { getProjectTriggers: () => triggers.slice(), deleteTrigger: t => { triggers.splice(triggers.indexOf(t), 1); }, newTrigger: builder },
    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {} }) },
    Utilities: { formatDate: fmt },
    Session: { getActiveUser: () => ({ getEmail: () => 'clement@club' }), getEffectiveUser: () => ({ getEmail: () => 'clement@club' }) },
    MailApp: { sendEmail: m => mails.push(m) },
    Logger: { log: () => {} },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(DIR + '/Stock_Boutique.gs', 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(DIR + '/Fichier_Boutique.gs', 'utf8'), ctx);
  vm.runInContext('rafraichirSynthese_ = function () {};', ctx);   // synthèse hors test
  return { ctx, crm, fichiers, props, triggers, mails };
}

module.exports = { creerContexte, Sheet };
