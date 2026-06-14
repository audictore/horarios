/**
 * Adaptador de datos reales → modelo del engine CP — From Schedule FI / tooling.
 *
 * Lee la Carga Académica y las Disponibilidades reales (con tools/leerXlsx.js) y produce
 * { grupos, docentes, cargas } para src/engine.js. Replica el parseo de la app (index.html):
 * parsearLineaAsignatura, detección de especialidad GCH/EFEP, turno por grado, e inglés simultáneo.
 */
'use strict';
const { leerXlsx } = require('./leerXlsx.js');

const norm = (s) => String(s).trim().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Igual que en index.html: "Materia G° grupos (N hrs)" → {nombreMateria, grado, grupos, especialidad, horas}. */
function parsearLineaAsignatura(line) {
  const m = line.match(/^(.+?)\s+(\d+)[°º]\s*(.+?)\s*\((\d+)\s*hrs?\)\s*$/i);
  if (!m) return null;
  let nombreMateria = m[1].trim();
  let grado = parseInt(m[2]);
  let middle = m[3].trim();
  const horas = parseInt(m[4]);
  let especialidad = null;
  if (/\bGCH\b/i.test(middle)) { especialidad = 'GCH'; middle = middle.replace(/\bGCH\b/i, '').trim(); }
  else if (/\bEFEP\b/i.test(middle)) { especialidad = 'EFEP'; middle = middle.replace(/\bEFEP\b/i, '').trim(); }
  if (especialidad) { const mn = nombreMateria.match(/(\d+)\s*$/); if (mn) grado = parseInt(mn[1]); }
  let grupos = middle.match(/[a-c]/gi);
  if (!grupos || !grupos.length) return null;
  grupos = grupos.map((g) => g.toLowerCase());
  return { nombreMateria, grado, grupos, especialidad, horas };
}

function cargarDatos(rutaCarga, rutaDisp) {
  // ── 1) Carga académica ───────────────────────────────────────────────────
  const wbC = leerXlsx(rutaCarga);
  const rows = wbC.sheets[wbC.sheetNames[0]];
  const headerIdx = rows.findIndex((r) => r.some((c) => String(c).trim() === 'Profesor'));
  const header = rows[headerIdx].map((c) => String(c).trim());
  const cProf = header.indexOf('Profesor');
  const cCat = header.findIndex((h) => /CATEGOR/i.test(h));
  const cAsig = header.indexOf('Asignatura');

  const grupos = {}, cargasMap = new Map(), tipoDoc = {};
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const prof = String(rows[r][cProf] || '').trim();
    if (!prof) continue;
    const cat = String(rows[r][cCat] || '').trim().toUpperCase();
    tipoDoc[prof] = (cat === 'PA') ? 2 : 1; // PA → escalón; resto (PTC/Inglés/Técnico) → disponibilidad
    String(rows[r][cAsig] || '').split('\n').map((l) => l.trim()).filter(Boolean).forEach((line) => {
      const p = parsearLineaAsignatura(line);
      if (!p) return;
      const horasPer = Math.round(p.horas / p.grupos.length);
      p.grupos.forEach((letra) => {
        const gn = p.especialidad ? `${p.grado}${letra} ${p.especialidad}` : `${p.grado}${letra}`;
        const turno = p.grado <= 4 ? 'matutino' : 'vespertino';
        grupos[gn] = { turno };
        const key = `${gn}|${p.nombreMateria}|${prof}`;
        const cur = cargasMap.get(key);
        if (cur) { cur.horas += horasPer; return; }
        const c = { grupo: gn, materia: p.nombreMateria, docente: prof, turno, horas: horasPer };
        if (norm(p.nombreMateria).includes('ingles') && p.grado !== 8 && p.grado !== 9) c.sync = `INGLES|${p.grado}`;
        cargasMap.set(key, c);
      });
    });
  }

  // ── 2) Disponibilidades (una hoja por docente; cols 1..6 = LUN..SAB) ──────
  const wbD = leerXlsx(rutaDisp);
  const dispPorHoja = {};
  for (const sheet of wbD.sheetNames) {
    const dr = wbD.sheets[sheet];
    const disp = {};
    for (let r = 1; r < dr.length; r++) {
      const hm = String(dr[r][0] || '').match(/(\d+)\s*:/);
      if (!hm) continue;
      const hora = parseInt(hm[1]);
      for (let c = 1; c <= 6; c++) if (String(dr[r][c] || '').trim()) (disp[c - 1] || (disp[c - 1] = [])).push(hora);
    }
    dispPorHoja[sheet] = disp;
  }

  // ── 3) Emparejar docente↔hoja (los nombres de hoja se truncan a 31 chars) ─
  const docentes = {}, sinDisp = [];
  for (const prof of new Set([...cargasMap.values()].map((c) => c.docente))) {
    const np = norm(prof);
    let disp = null, hoja = null;
    for (const sheet of wbD.sheetNames) {
      const ns = norm(sheet);
      if (ns === np || ns.startsWith(np) || np.startsWith(ns)) { disp = dispPorHoja[sheet]; hoja = sheet; break; }
    }
    if (!disp) sinDisp.push(prof);
    docentes[prof] = { tipo: tipoDoc[prof] || 1, disponibilidad: disp || {} };
  }

  return { grupos, docentes, cargas: [...cargasMap.values()], _sinDisp: sinDisp };
}

module.exports = { cargarDatos, parsearLineaAsignatura };
