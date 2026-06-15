/**
 * Banco de pruebas del metaheurístico en Node (sin navegador). Carga el script real de index.html
 * en un contexto vm con el DOM/Workers simulados, parsea los datos reales, corre la pre-asignación
 * de inglés y la construcción voraz, y reporta DÓNDE se desincroniza el inglés de 5°.
 *
 *   node tools/harnessMeta.js "<carga.xlsx>" "<disp.xlsx>"
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { leerXlsx } = require('./leerXlsx.js');

// ── 1. Extraer el script inline principal de index.html ──────────────────────
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;
let m, src = null, srcChar = 0;
while ((m = re.exec(html))) {
  if (!/src=/.test(m[1]) && m[2].includes('const IS_WORKER')) { src = m[2]; srcChar = m.index + m[0].indexOf(m[2]); }
}
if (!src) throw new Error('no se encontró el script inline principal');
const startLine = html.slice(0, srcChar).split('\n').length; // línea de index.html donde empieza el script

// ── 2. Simular el entorno del navegador ──────────────────────────────────────
const sandbox = {};
sandbox.globalThis = sandbox;
sandbox.self = sandbox;            // typeof document === 'undefined' ⇒ IS_WORKER = true
sandbox.console = console;
sandbox.performance = { now: () => Date.now() };
sandbox.postMessage = () => {};
Object.defineProperty(sandbox, 'onmessage', { set() {}, get() { return null; }, configurable: true });
sandbox.localStorage = { _d: {}, getItem(k) { return k in this._d ? this._d[k] : null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
sandbox.Worker = class { constructor() {} postMessage() {} terminate() {} addEventListener() {} };
sandbox.URL = { createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} };
sandbox.Blob = class { constructor() {} };
sandbox.requestAnimationFrame = (cb) => setTimeout(cb, 0);
sandbox.setTimeout = setTimeout; sandbox.clearTimeout = clearTimeout;
sandbox.setInterval = setInterval; sandbox.clearInterval = clearInterval;
sandbox.navigator = { hardwareConcurrency: 1 };
sandbox.XLSX = {
  utils: {
    // Soporta los dos modos que usa el app: {header:1} → filas; {range:N} → objetos por columna.
    sheet_to_json: (sheet, opts) => {
      opts = opts || {};
      const rows = sheet._rows || [];
      if (opts.header === 1) return rows;
      const hdrIdx = typeof opts.range === 'number' ? opts.range : 0;
      const header = (rows[hdrIdx] || []).map((c) => String(c));
      const out = [];
      for (let r = hdrIdx + 1; r < rows.length; r++) {
        const obj = {};
        header.forEach((h, ci) => { obj[h] = rows[r][ci] !== undefined ? rows[r][ci] : (opts.defval !== undefined ? opts.defval : ''); });
        out.push(obj);
      }
      return out;
    },
    aoa_to_sheet: () => ({}), book_new: () => ({ SheetNames: [], Sheets: {} }), book_append_sheet: () => {},
  },
  read: () => ({}), writeFile: () => {},
};
vm.createContext(sandbox);

// ── 3. Pasar datos reales como "workbooks" que el parser del app entiende ─────
const mockWb = (ruta) => { const wb = leerXlsx(ruta); const Sheets = {}; wb.sheetNames.forEach((n) => { Sheets[n] = { _rows: wb.sheets[n] }; }); return { SheetNames: wb.sheetNames, Sheets }; };
sandbox.__wbCarga = mockWb(process.argv[2]);
sandbox.__wbDisp = mockWb(process.argv[3]);
sandbox.__out = (s) => console.log(s);

// Captura qué función mueve el inglés (1ª vez por función llamante).
const _vistosQuita = new Set();
sandbox.__QUITA_LOG = (grupoNombre, stack) => {
  const lines = String(stack).split('\n').map((l) => l.trim());
  const caller = lines[2] || '';
  const fn = (caller.match(/at (\S+)/) || [])[1] || caller;
  if (_vistosQuita.has(fn)) return;
  _vistosQuita.add(fn);
  console.log('  ⟵ [QUITA INGLES] grupo=' + grupoNombre + ' · llamado por: ' + fn);
  console.log('       ' + lines.slice(2, 6).join('\n       '));
};
const _vistosAplica = new Set();
sandbox.__APLICA_LOG = (grupoNombre, stack) => {
  const lines = String(stack).split('\n').map((l) => l.trim());
  const fn = (((lines[2] || '').match(/at (\S+)/) || [])[1]) || lines[2] || '';
  if (_vistosAplica.has(fn)) return;
  _vistosAplica.add(fn);
  console.log('  ⟵ [SOBRESCRIBE INGLES] grupo=' + grupoNombre + ' · por: ' + fn);
  console.log('       ' + lines.slice(2, 6).join('\n       '));
};

// ── 4. Código de prueba (corre en el MISMO scope que el script: ve MAPA_GRUPOS) ──
const test = `
(async () => {
  const DIAS = ['L','M','X','J','V','S'];
  function syncDe(cuat) {
    const gs = [];
    MAPA_GRUPOS.forEach(g => {
      const mm = String(g.nombre_grupo).match(/^(\\d+)/); const c = mm ? +mm[1] : 0;
      if (c !== cuat) return;
      const slots = [];
      diasSemana.forEach((dn,di) => g.baseHoras.forEach(h => { const b = g.horario[dn][h]; if (b && esIngles(b)) slots.push(DIAS[di]+h); }));
      gs.push(g.nombre_grupo + '=' + slots.sort().join(' '));
    });
    const ss = gs.map(s => s.split('=')[1]);
    const sync = gs.length > 1 && ss.every(s => s === ss[0]);
    return { sync, detalle: gs.join('  |  '), horas: ss.map(s => s ? s.split(' ').length : 0) };
  }
  function reporta(etapa) {
    const r5 = syncDe(5), r2 = syncDe(2);
    __out('['+etapa+'] 2°: '+(r2.sync?'✅SYNC':'⛔DESYNC')+' '+r2.horas.join('/')+'h   ·   5°: '+(r5.sync?'✅SYNC':'⛔DESYNC')+' '+r5.horas.join('/')+'h');
    if (!r5.sync) __out('        5° → '+r5.detalle);
  }

  try {
    parsearCargaAcademica(__wbCarga);
    parsearDisponibilidades(__wbDisp);
    __out('Grupos: '+MAPA_GRUPOS.size+'  Docentes: '+MAPA_DOCENTES.size);

    // Diagnóstico: disponibilidad que la app asignó a los docentes de inglés de 5°.
    const DD = ['L','M','X','J','V','S'];
    function profesIngles5() {
      const set = new Set();
      MAPA_GRUPOS.forEach(g => { if (/^5/.test(g.nombre_grupo)) g.bloques.forEach(b => { if (esIngles(b)) set.add(b.docente); }); });
      return [...set];
    }
    const p5 = profesIngles5();
    const slotsDoc = d => { const o=[]; diasSemana.forEach((dn,i)=>[...d.disponibilidad[dn]].forEach(h=>o.push(DD[i]+h))); return new Set(o); };
    const sets = p5.map(slotsDoc);
    p5.forEach((d,i)=>__out('  Ing5 doc: '+d.nombre_docente+' ('+sets[i].size+'h) '+[...sets[i]].sort().join(' ')));
    if (sets.length) { const inter=[...sets[0]].filter(x=>sets.every(s=>s.has(x))); __out('  INTERSECCIÓN: '+inter.length+'h → '+inter.sort().join(' ')); }

    // Replicar el arranque de ejecutarAlgoritmoFinal hasta la pre-asignación de inglés
    MAPA_GRUPOS.forEach(g => { g.reset(); g.bloques.forEach(b => { delete b.preAsignado; }); });
    MAPA_DOCENTES.forEach(d => d.reset());
    if (typeof calcularDiasDocentes === 'function') calcularDiasDocentes();

    // Igual que la app (worker): pre-asignar inglés UNA vez y pasarlo como inglesFixed.
    const inglesFixed = preAsignarInglesSimultaneo();
    reporta('pre-asignado');

    // Construcción voraz completa (greedy + reparaciones internas) reusando el inglés fijo.
    const fallos = await construccionVorazCascada(null, 0, null, false, null, inglesFixed);
    reporta('tras construccionVorazCascada');
    __out('Fallos (sin colocar): '+(fallos ? fallos.length : '?'));

    // Estresar fases posteriores: optimización exhaustiva + rescate por backtracking.
    try { if (typeof optimizacionExhaustiva === 'function') { await optimizacionExhaustiva(3000); reporta('tras optimizacionExhaustiva'); } } catch (e) { __out('  (optimizacionExhaustiva: '+e.message+')'); }
    try { if (typeof rescateBacktracking === 'function' && fallos && fallos.length) { await rescateBacktracking(fallos); reporta('tras rescateBacktracking'); } } catch (e) { __out('  (rescateBacktracking: '+e.message+')'); }
  } catch (e) { __out('ERROR: '+(e && e.stack || e)); }
})();
`;

vm.runInContext(src + '\n' + test, sandbox, { filename: 'index.html', lineOffset: startLine - 1 });
