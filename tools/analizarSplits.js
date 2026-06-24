/**
 * Analiza un horario exportado (.xlsx) y reporta el "split" de cada materia:
 * cómo se reparten sus horas en sesiones (tramos contiguos) por día.
 *
 * Regla didáctica objetivo: bloques de 2 h y, si la carga es impar, una sesión de 1 h.
 *   1→[1] · 2→[2] · 3→[2,1] · 4→[2,2] · 5→[2,2,1] · 6→[2,2,2] · 7→[2,2,2,1] · 8→[2,2,2,2]
 *
 * Uso: node tools/analizarSplits.js "<ruta.xlsx>"
 */
'use strict';
const { leerXlsx } = require('./leerXlsx.js');

const DIAS = ['LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO'];

/** Split didáctico esperado para una carga de `h` horas (multiset de duraciones, ordenado desc). */
function esperado(h) {
  const out = [];
  let r = h;
  while (r >= 2) { out.push(2); r -= 2; }
  if (r === 1) out.push(1);
  return out;
}

/** Extrae el nombre de materia de una celda "Materia (Docente) [marca]". */
function materiaDeCelda(txt) {
  if (!txt) return null;
  const s = String(txt).trim();
  if (!s) return null;
  const m = s.match(/^(.*?)\s*\(([^()]*)\)\s*(\[[^\]]*\])?\s*$/);
  return (m ? m[1] : s).trim();
}

function analizarHoja(rows) {
  // Localizar la fila de cabecera del grid (la que tiene 'HORA' en col 0).
  let head = -1;
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim().toUpperCase() === 'HORA') { head = i; break; }
  }
  if (head < 0) return null;

  // Mapear columnas a días según la cabecera.
  const colDia = {};
  for (let c = 1; c < rows[head].length; c++) {
    const d = String(rows[head][c]).trim().toUpperCase();
    if (DIAS.includes(d)) colDia[c] = d;
  }

  // Leer las filas del grid hasta una fila sin hora numérica al inicio.
  const grid = []; // grid[fila] = { hora, celdas: {dia: materia} }
  for (let i = head + 1; i < rows.length; i++) {
    const h0 = String(rows[i][0]).trim();
    const hora = parseInt(h0);
    if (!/^\d+/.test(h0) || isNaN(hora)) break; // fin del grid (fila vacía / TOTAL / desglose)
    const celdas = {};
    for (const c in colDia) celdas[colDia[c]] = materiaDeCelda(rows[i][c]);
    grid.push({ hora, celdas });
  }

  // Por materia y día: detectar tramos contiguos (sesiones).
  // sesiones[materia] = [dur, dur, ...]
  const sesiones = {};
  for (const dia of DIAS) {
    let prevMat = null;
    for (let k = 0; k < grid.length; k++) {
      const mat = grid[k].celdas[dia] || null;
      const contiguo = mat && prevMat === mat && grid[k].hora === grid[k - 1].hora + 1;
      if (mat) {
        if (!sesiones[mat]) sesiones[mat] = [];
        if (contiguo) sesiones[mat][sesiones[mat].length - 1]++;
        else sesiones[mat].push(1);
      }
      prevMat = mat;
    }
  }
  return sesiones;
}

function multisetIgual(a, b) {
  if (a.length !== b.length) return false;
  const sa = [...a].sort((x, y) => y - x), sb = [...b].sort((x, y) => y - x);
  return sa.every((v, i) => v === sb[i]);
}

function main() {
  const ruta = process.argv[2];
  if (!ruta) { console.error('Uso: node tools/analizarSplits.js "<ruta.xlsx>"'); process.exit(1); }
  const wb = leerXlsx(ruta);

  const esTut = (m) => String(m).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().includes('TUTORIA');
  let totalMaterias = 0, violaciones = 0, exentas = 0;
  const detalle = [];
  for (const hoja of wb.sheetNames) {
    const ses = analizarHoja(wb.sheets[hoja]);
    if (!ses) continue;
    for (const mat of Object.keys(ses)) {
      if (esTut(mat)) { exentas++; continue; }   // tutorías: exentas del patrón
      const dur = ses[mat].sort((a, b) => b - a);
      const horas = dur.reduce((s, x) => s + x, 0);
      const exp = esperado(horas);
      const ok = multisetIgual(dur, exp);
      totalMaterias++;
      if (!ok) {
        violaciones++;
        detalle.push({ hoja, mat, horas, actual: dur.join(','), esperado: exp.join(',') });
      }
    }
  }

  console.log(`\nArchivo: ${ruta}`);
  console.log(`Materias normales: ${totalMaterias} · En patrón: ${totalMaterias - violaciones} · Violan: ${violaciones} · Tutorías exentas: ${exentas}\n`);
  if (detalle.length) {
    console.log('GRUPO'.padEnd(10), 'MATERIA'.padEnd(28), 'HORAS', 'ACTUAL'.padEnd(14), 'ESPERADO');
    console.log('-'.repeat(80));
    detalle.sort((a, b) => a.hoja.localeCompare(b.hoja) || a.mat.localeCompare(b.mat));
    for (const d of detalle) {
      console.log(
        String(d.hoja).padEnd(10),
        d.mat.slice(0, 27).padEnd(28),
        String(d.horas).padEnd(5),
        d.actual.padEnd(14),
        d.esperado
      );
    }
  } else {
    console.log('✅ Todas las materias respetan el patrón didáctico.');
  }
}

main();
