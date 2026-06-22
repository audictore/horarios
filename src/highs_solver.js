/**
 * Motor de horarios EXACTO en el navegador — From Schedule FI.
 *
 * Modela la asignación como Programación Entera (MIP) y la resuelve con HiGHS
 * compilado a WebAssembly (highs-js). A diferencia del metaheurístico, es COMPLETO:
 * encuentra el óptimo o demuestra el máximo. Corre 100% en el cliente (sin servidor,
 * sin WSL): la misma vía que permite publicarlo en GitHub Pages.
 *
 * Reglas duras modeladas: ventana de turno, disponibilidad declarada, no-solape de
 * docente y de grupo, 1 sesión/día (normal e Inglés 8/9 = 1 bloque contiguo vía conteo
 * de "comienzos de bloque"; tutoría 2; Inglés 1-7 hasta 3), durMax horas/día por carga,
 * e inglés simultáneo (2°/5° a la misma hora entre los grupos del grado).
 *
 * API:  Highs.resolver(highs, datos)  →  { status, colocadas, total, horario }
 *   `highs` = instancia ya cargada de highs-js (await Module(...) / await require('highs')()).
 *   `datos` = { ventanas?, docentes:{nombre:{disponibilidad:{dia:[h]}}}, cargas:[{grupo,materia,docente,turno,horas,sync?}] }
 *   `horario` = [ { grupo, materia, docente, dia, hora } ]
 *
 * 100% JavaScript, sin dependencias. Navegador + Node (UMD-lite).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HighsSolver = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VENTANAS = { matutino: [7, 17], vespertino: [12, 21] };
  const DURMAX = 4;
  const norm = (s) => String(s).toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const maxSes = (mat) => { const u = norm(mat); if (/INGLES\s*[89]/.test(u)) return 1; if (u.includes('INGLES')) return 3; if (u.includes('TUTORIA')) return 2; return 1; };

  /** Construye el modelo en formato CPLEX LP a partir de los datos. Devuelve { lp, vars }. */
  function construirLP(datos) {
    const ventanas = datos.ventanas || VENTANAS;
    const docentes = datos.docentes, cargas = datos.cargas;
    const DIAS = [0, 1, 2, 3, 4, 5];

    const vars = [];                 // idx -> {i,d,h}
    const idx = new Map();           // "i|d|h" -> idx
    const xn = (i, d, h) => { const k = i + '|' + d + '|' + h; let v = idx.get(k); if (v === undefined) { v = vars.length; idx.set(k, v); vars.push({ i, d, h }); } return 'x' + v; };
    const has = (i, d, h) => idx.has(i + '|' + d + '|' + h);
    const dispDe = (doc) => (docentes[doc] && docentes[doc].disponibilidad) || {};

    // Variables x en slots legales (ventana ∩ disponibilidad declarada).
    cargas.forEach((c, i) => {
      const v = ventanas[c.turno], lo = v[0], hi = v[1], disp = dispDe(c.docente);
      for (const d of DIAS) { const dd = new Set(disp[d] || disp[String(d)] || []); for (let h = lo; h < hi; h++) if (dd.has(h)) xn(i, d, h); }
    });

    const R = []; let cn = 0;
    const add = (s) => R.push(' r' + (cn++) + ': ' + s);

    // Completitud (≤ horas) + durMax (≤ DURMAX horas/día por carga).
    cargas.forEach((c, i) => {
      const v = ventanas[c.turno], lo = v[0], hi = v[1], all = [];
      for (const d of DIAS) { const dd = []; for (let h = lo; h < hi; h++) if (has(i, d, h)) { dd.push(xn(i, d, h)); all.push(xn(i, d, h)); } if (dd.length) add(dd.join(' + ') + ' <= ' + DURMAX); }
      if (all.length) add(all.join(' + ') + ' <= ' + c.horas);
    });
    // No-solape de docente y de grupo (a lo sumo 1 clase por slot).
    const docs = {}, grupos = {};
    cargas.forEach((c, i) => { (docs[c.docente] = docs[c.docente] || []).push(i); (grupos[c.grupo] = grupos[c.grupo] || []).push(i); });
    const noSol = (mapa) => { for (const k in mapa) { const idxs = mapa[k]; for (const d of DIAS) for (let h = 7; h < 21; h++) { const t = []; for (const i of idxs) if (has(i, d, h)) t.push(xn(i, d, h)); if (t.length > 1) add(t.join(' + ') + ' <= 1'); } } };
    noSol(docs); noSol(grupos);
    // 1 sesión/día: contar "comienzos de bloque" (ini) y limitarlos a max_ses.
    const binExtra = [];
    cargas.forEach((c, i) => {
      const lim = maxSes(c.materia), v = ventanas[c.turno], lo = v[0], hi = v[1];
      for (const d of DIAS) { const inis = [];
        for (let h = lo; h < hi; h++) { if (!has(i, d, h)) continue; const ini = 'i_' + i + '_' + d + '_' + h; binExtra.push(ini); inis.push(ini); const xh = xn(i, d, h);
          if (has(i, d, h - 1)) { const xp = xn(i, d, h - 1); add(ini + ' - ' + xh + ' <= 0'); add(ini + ' + ' + xp + ' <= 1'); add(ini + ' - ' + xh + ' + ' + xp + ' >= 0'); }
          else add(ini + ' - ' + xh + ' = 0'); }
        if (inis.length) add(inis.join(' + ') + ' <= ' + lim); }
    });
    // Inglés simultáneo: igualar variables entre grupos del mismo `sync`; donde no todos
    // los grupos del grado tienen disponibilidad, ninguno lleva inglés en ese slot.
    const sync = {};
    cargas.forEach((c, i) => { if (c.sync) (sync[c.sync] = sync[c.sync] || []).push(i); });
    for (const k in sync) { const idxs = sync[k]; if (idxs.length < 2) continue;
      for (const d of DIAS) for (let h = 7; h < 21; h++) { const pres = idxs.filter((i) => has(i, d, h));
        if (pres.length === idxs.length) { for (let j = 1; j < pres.length; j++) add(xn(pres[0], d, h) + ' - ' + xn(pres[j], d, h) + ' = 0'); }
        else for (const i of pres) add(xn(i, d, h) + ' = 0'); } }

    const xterms = vars.map((_, v) => 'x' + v);
    const L = ['Maximize', ' obj: ' + xterms.join(' + '), 'Subject To'].concat(R, ['Binary']);
    const allBin = xterms.concat(binExtra);
    for (let k = 0; k < allBin.length; k += 100) L.push(' ' + allBin.slice(k, k + 100).join(' '));
    L.push('End');
    return { lp: L.join('\n'), vars };
  }

  /** Resuelve con HiGHS y devuelve el horario { grupo, materia, docente, dia, hora }. */
  function resolver(highs, datos, opciones) {
    const { lp, vars } = construirLP(datos);
    const t0 = Date.now();
    const sol = highs.solve(lp, (opciones && opciones.highs) || {});
    const ms = Date.now() - t0;
    const horario = [];
    if (sol && sol.Columns) {
      for (let v = 0; v < vars.length; v++) {
        const col = sol.Columns['x' + v];
        if (col && col.Primal > 0.5) { const o = vars[v], c = datos.cargas[o.i]; horario.push({ grupo: c.grupo, materia: c.materia, docente: c.docente, dia: o.d, hora: o.h }); }
      }
    }
    const total = datos.cargas.reduce((s, c) => s + c.horas, 0);
    return { status: sol ? sol.Status : 'Error', colocadas: horario.length, total, horario, ms };
  }

  return { VENTANAS, maxSes, construirLP, resolver };
});
