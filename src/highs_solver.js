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

    // Aula no-overlap: for each aula, at most 1 session per (day, hour).
    // Priority: materia-specific aula > group base aula > pool capacity.
    // Single-aula assignments → direct no-overlap.
    // Multi-aula → solver picks exactly one via y variables; z = x·y linearization.
    const acSlacks = []; let acN = 0;
    if (datos.aulas && datos.aulas.aulas && datos.aulas.aulas.length > 0) {
      const aCfg = datos.aulas, singleMap = {}, multiMats = {};
      const grBase = aCfg.grupoAulas || {};
      let yCount = 0;
      const hourRestricted = {};
      const normGrp = s => String(s).toUpperCase().normalize('NFD').replace(/[^A-Z0-9 ]/g, '').trim();
      const grBaseNorm = {};
      for (const g in grBase) grBaseNorm[normGrp(g)] = grBase[g];
      // Aulas base compartidas entre turnos: turno más temprano tiene prioridad
      const grupoTurno = {};
      cargas.forEach(c => { const k = normGrp(c.grupo); if (!grupoTurno[k]) grupoTurno[k] = c.turno; });
      const baseAulaGs = {};
      for (const g in grBase) (baseAulaGs[grBase[g]] = baseAulaGs[grBase[g]] || []).push(normGrp(g));
      const sharedPrio = {};
      for (const aula in baseAulaGs) {
        const gs = baseAulaGs[aula];
        const byT = {};
        gs.forEach(g => { const t = grupoTurno[g]; if (t) (byT[t] = byT[t] || []).push(g); });
        const ts = Object.keys(byT);
        if (ts.length > 1) {
          const vs = ts.map(t => ({ t, lo: ventanas[t][0], hi: ventanas[t][1], gs: byT[t] }));
          vs.sort((a, b) => a.lo - b.lo);
          const oLo = Math.max(...vs.map(v => v.lo)), oHi = Math.min(...vs.map(v => v.hi));
          if (oLo < oHi) {
            const nonP = new Set();
            vs.slice(1).forEach(v => v.gs.forEach(g => nonP.add(g)));
            sharedPrio[aula] = { nonP, oLo, oHi };
          }
        }
      }
      cargas.forEach((c, i) => {
        // 1) Materia-specific aula assignment
        let asig = aCfg.asignaciones[c.materia];
        if (!asig) { for (const k in aCfg.asignaciones) if (norm(k) === norm(c.materia)) { asig = aCfg.asignaciones[k]; break; } }
        if (asig && asig.aulas.length > 0) {
          if (asig.aulas.length === 1) {
            (singleMap[asig.aulas[0]] = singleMap[asig.aulas[0]] || []).push(i);
          } else {
            const mn = norm(c.materia);
            if (!multiMats[mn]) multiMats[mn] = { aulas: asig.aulas, cIdxs: [], yIdx: yCount++ };
            multiMats[mn].cIdxs.push(i);
          }
          return;
        }
        // 2) Group base aula (default room)
        const base = grBaseNorm[normGrp(c.grupo)];
        if (base) {
          const sp = sharedPrio[base];
          if (sp && sp.nonP.has(normGrp(c.grupo))) {
            const v = ventanas[c.turno], lo = v[0], hi = v[1];
            const allowed = new Set();
            for (let h = lo; h < hi; h++) if (h < sp.oLo || h >= sp.oHi) allowed.add(h);
            if (allowed.size > 0) {
              if (!hourRestricted[base]) hourRestricted[base] = [];
              hourRestricted[base].push({ idx: i, allowed });
            }
          } else {
            (singleMap[base] = singleMap[base] || []).push(i);
          }
        }
      });
      // Multi-aula: y picks aula, z linearizes x·y product
      const zSlot = {};
      for (const mn in multiMats) {
        const { aulas, cIdxs, yIdx } = multiMats[mn];
        const yN = aulas.map((_, ai) => 'ya' + yIdx + 'a' + ai);
        binExtra.push(...yN);
        add(yN.join(' + ') + ' = 1');
        cIdxs.forEach(ci => { aulas.forEach((aid, ai) => {
          for (const d of DIAS) for (let h = 7; h < 21; h++) {
            if (!has(ci, d, h)) continue;
            const zn = 'z' + ci + 'a' + ai + 'd' + d + 'h' + h;
            binExtra.push(zn);
            add(zn + ' - ' + xn(ci, d, h) + ' <= 0');
            add(zn + ' - ' + yN[ai] + ' <= 0');
            add(zn + ' - ' + xn(ci, d, h) + ' - ' + yN[ai] + ' >= -1');
            const key = aid + '|' + d + '|' + h;
            (zSlot[key] = zSlot[key] || []).push(zn);
          }
        }); });
      }
      // No-overlap per (aula, day, hour): SOFT — penalizar pero no sacrificar horas
      const allAids = new Set(Object.keys(singleMap));
      for (const key in zSlot) allAids.add(key.split('|')[0]);
      for (const key in hourRestricted) allAids.add(key);
      for (const aid of allAids) {
        const sIdxs = singleMap[aid] || [];
        const rList = hourRestricted[aid] || [];
        for (const d of DIAS) for (let h = 7; h < 21; h++) {
          const t = [];
          for (const i of sIdxs) if (has(i, d, h)) t.push(xn(i, d, h));
          for (const r of rList) if (r.allowed.has(h) && has(r.idx, d, h)) t.push(xn(r.idx, d, h));
          const zs = zSlot[aid + '|' + d + '|' + h] || [];
          t.push(...zs);
          if (t.length > 1) { const sn = 'ac' + acN++; acSlacks.push(sn); add(t.join(' + ') + ' - ' + sn + ' <= 1'); }
        }
      }
    }
    // Pool capacity: "Normal" = any aula of that type → sum of sessions ≤ pool size.
    if (datos.aulas && datos.aulas.pools) {
      const poolSes = {};
      cargas.forEach((c, i) => {
        let pool = datos.aulas.pools[c.materia];
        if (!pool) { for (const k in datos.aulas.pools) if (norm(k) === norm(c.materia)) { pool = datos.aulas.pools[k]; break; } }
        if (pool) pool.tipos.forEach(t => { (poolSes[t] = poolSes[t] || []).push(i); });
      });
      for (const tipo in poolSes) {
        const cap = (datos.aulas.poolCapacidad || {})[tipo] || 1;
        if (cap < 2) continue;
        const idxs = poolSes[tipo];
        for (const d of DIAS) for (let h = 7; h < 21; h++) {
          const t = [];
          for (const i of idxs) if (has(i, d, h)) t.push(xn(i, d, h));
          if (t.length > cap) add(t.join(' + ') + ' <= ' + cap);
        }
      }
    }

    // ── Reglas duras adicionales (paridad con CP-SAT) ─────────────────────
    let bn = 0; const bn_ = () => 'b' + (bn++);

    // Piso duro: DEBE colocar todas las horas o INFEASIBLE.
    const totalH = cargas.reduce((s, c) => s + c.horas, 0);
    add(vars.map((_, v) => 'x' + v).join(' + ') + ' >= ' + totalH);

    // Bloques ≤ 2h (duro, materias normales): no 3+ horas consecutivas de la misma materia.
    cargas.forEach((c, i) => {
      const u = norm(c.materia); if (u.includes('TUTORIA')) return;
      const v = ventanas[c.turno], lo = v[0], hi = v[1];
      for (const d of DIAS) for (let h = lo + 2; h < hi; h++)
        if (has(i, d, h) && has(i, d, h - 1) && has(i, d, h - 2))
          add(xn(i, d, h) + ' + ' + xn(i, d, h - 1) + ' + ' + xn(i, d, h - 2) + ' <= 2');
    });

    // maxDias PA (duro): cada PA trabaja a lo sumo maxDias días.
    for (const doc in docs) {
      const di = docentes[doc]; if (!di || di.tipo !== 2 || !di.maxDias) continue;
      const actV = [];
      for (const d of DIAS) {
        const sl = []; for (const i of docs[doc]) for (let h = 7; h < 21; h++) if (has(i, d, h)) sl.push(xn(i, d, h));
        if (!sl.length) continue;
        const a = bn_(); binExtra.push(a); actV.push(a);
        for (const s of sl) add(a + ' - ' + s + ' >= 0');
        add(a + ' - ' + sl.join(' - ') + ' <= 0');
      }
      if (actV.length > di.maxDias) add(actV.join(' + ') + ' <= ' + di.maxDias);
    }

    // Cero huecos de grupo (duro): clases del grupo en cada día forman bloque contiguo.
    for (const g in grupos) {
      const gI = grupos[g], turno = cargas[gI[0]].turno, lo = ventanas[turno][0], hi = ventanas[turno][1];
      for (const d of DIAS) {
        const occ = {};
        for (let h = lo; h < hi; h++) {
          const xs = []; for (const i of gI) if (has(i, d, h)) xs.push(xn(i, d, h));
          if (!xs.length) continue;
          const o = bn_(); binExtra.push(o); occ[h] = o;
          for (const x of xs) add(o + ' - ' + x + ' >= 0');
          add(o + ' - ' + xs.join(' - ') + ' <= 0');
        }
        const hrs = Object.keys(occ).map(Number).sort((a, b) => a - b);
        if (hrs.length <= 1) continue;
        const rises = [];
        for (let j = 0; j < hrs.length; j++) {
          const h = hrs[j], ri = bn_(); binExtra.push(ri); rises.push(ri);
          if (j === 0 || hrs[j - 1] !== h - 1) { add(ri + ' - ' + occ[h] + ' = 0'); }
          else { add(ri + ' - ' + occ[h] + ' <= 0'); add(ri + ' + ' + occ[hrs[j - 1]] + ' <= 1'); add(ri + ' - ' + occ[h] + ' + ' + occ[hrs[j - 1]] + ' >= 0'); }
        }
        if (rises.length > 1) add(rises.join(' + ') + ' <= 1');
      }
    }

    const xterms = vars.map((_, v) => 'x' + v);
    const acPen = acSlacks.length ? acSlacks.map(s => ' - 0.0001 ' + s).join('') : '';
    const L = ['Maximize', ' obj: ' + xterms.join(' + ') + acPen, 'Subject To'].concat(R, ['Binary']);
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
