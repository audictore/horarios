/**
 * Ejecuta la función REAL preAsignarInglesSimultaneo() extraída de index.html, con los datos
 * reales, para ver si sincroniza el inglés 5°. Aísla si el bug está en la lógica o en otro lado.
 *   node tools/probarSyncReal.js "<carga.xlsx>" "<disp.xlsx>"
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { cargarDatos } = require('./cargarReales.js');

const d = cargarDatos(process.argv[2], process.argv[3]);
const diasSemana = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

// ── Construir MAPA_GRUPOS al estilo de la app, solo con el inglés (1h por bloque) ──
const docentesObj = {};
function docenteDe(nombre) {
  if (docentesObj[nombre]) return docentesObj[nombre];
  const disponibilidad = {}, asignado = {};
  diasSemana.forEach((dn, i) => { disponibilidad[dn] = new Set(d.docentes[nombre].disponibilidad[i] || []); asignado[dn] = {}; });
  return (docentesObj[nombre] = { nombre_docente: nombre, disponibilidad, asignado });
}
function nuevoGrupo(nombre, turno) {
  const baseHoras = turno === 'matutino' ? [7, 8, 9, 10, 11, 12, 13, 14, 15] : [12, 13, 14, 15, 16, 17, 18, 19, 20];
  const horario = {}, sesionesDia = {};
  diasSemana.forEach(dn => { horario[dn] = {}; baseHoras.forEach(h => horario[dn][h] = null); sesionesDia[dn] = {}; });
  return { nombre_grupo: nombre, turno, baseHoras, horario, sesionesDia, bloques: [] };
}
const MAPA_GRUPOS = new Map();
for (const c of d.cargas) {
  if (!/ingles/i.test(c.materia)) continue;            // solo inglés (lo que pre-asigna)
  if (!MAPA_GRUPOS.has(c.grupo)) MAPA_GRUPOS.set(c.grupo, nuevoGrupo(c.grupo, c.turno));
  const g = MAPA_GRUPOS.get(c.grupo);
  for (let k = 0; k < c.horas; k++) g.bloques.push({ materia: { nombre_materia: c.materia }, docente: docenteDe(c.docente), duracion: 1, preAsignado: false });
}

// ── Globals que la función real referencia ──
const ctx = {
  MAPA_GRUPOS, diasSemana,
  bloquesRecurrentesFallidos: new Set(),
  esIngles: (b) => /ingles/i.test(b.materia.nombre_materia),
  aplicarAsignacion: (grupo, b, dia, h) => {
    grupo.horario[dia][h] = b; b.docente.asignado[dia][h] = b;
    grupo.sesionesDia[dia][b.materia.nombre_materia] = (grupo.sesionesDia[dia][b.materia.nombre_materia] || 0) + 1;
  },
  console,
};
vm.createContext(ctx);

// ── Extraer la función real por balanceo de llaves y ejecutarla ──
const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const ini = src.indexOf('function preAsignarInglesSimultaneo()');
let i = src.indexOf('{', ini), depth = 0, fin = -1;
for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (depth === 0) { fin = i + 1; break; } } }
const fnSrc = src.slice(ini, fin);
vm.runInContext(fnSrc + '\npreAsignarInglesSimultaneo();', ctx, { filename: 'preAsignarInglesSimultaneo' });

// ── Reportar sincronización por cuatrimestre ──
const dias = ['L', 'M', 'X', 'J', 'V', 'S'];
const slotsDe = (g) => { const o = []; diasSemana.forEach((dn, di) => g.baseHoras.forEach(h => { if (g.horario[dn][h]) o.push(dias[di] + h); })); return o.sort().join(' '); };
for (const cuatri of ['2', '5']) {
  const gs = [...MAPA_GRUPOS.values()].filter(g => g.nombre_grupo.startsWith(cuatri));
  console.log(`\n=== Inglés ${cuatri}° ===`);
  const ss = gs.map(g => slotsDe(g));
  gs.forEach((g, k) => console.log('  ' + g.nombre_grupo.padEnd(10) + ': ' + ss[k]));
  console.log('  → ' + (ss.every(s => s === ss[0]) ? '✅ SINCRONIZADO' : '⛔ desincronizado'));
}
