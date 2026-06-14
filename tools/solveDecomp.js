/**
 * Plan B: resuelve el horario por CLÚSTERES (cuatrimestres) en secuencia, arrastrando la ocupación
 * de docentes compartidos. Cada clúster es chico → rápido y robusto. Escribe tools/horario.json.
 *   node tools/solveDecomp.js "<carga.xlsx>" "<disp.xlsx>"
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { cargarDatos } = require('./cargarReales.js');
const E = require('../src/engine.js');
const I = require('../src/invariantes.js');

const d = cargarDatos(process.argv[2], process.argv[3]);
const ven = { matutino: [7, 16], vespertino: [12, 21] };

// Clústeres por cuatrimestre (matutino primero, luego vespertino; dentro, por cuatri ascendente).
const cuatriDe = (g) => parseInt(String(g).match(/^(\d+)/)[1]);
const turnoDe = (cuatri) => d.grupos[Object.keys(d.grupos).find((g) => cuatriDe(g) === cuatri)].turno;
const clusters = [...new Set(Object.keys(d.grupos).map(cuatriDe))]
  .sort((a, b) => (turnoDe(a) === 'matutino' ? 0 : 1) - (turnoDe(b) === 'matutino' ? 0 : 1) || a - b);

// Copia mutable de disponibilidades (se van recortando los slots ya usados por docentes compartidos).
const dispActual = {};
for (const k in d.docentes) { dispActual[k] = {}; for (const dia in d.docentes[k].disponibilidad) dispActual[k][dia] = new Set(d.docentes[k].disponibilidad[dia]); }

const todos = [];
for (const cuatri of clusters) {
  const cargas = d.cargas.filter((c) => cuatriDe(c.grupo) === cuatri);
  const grupos = {}, docentes = {};
  for (const c of cargas) {
    grupos[c.grupo] = d.grupos[c.grupo];
    if (!docentes[c.docente]) {
      const disp = {}; for (const dia in dispActual[c.docente]) { const a = [...dispActual[c.docente][dia]]; if (a.length) disp[dia] = a; }
      docentes[c.docente] = { tipo: d.docentes[c.docente].tipo, disponibilidad: disp };
    }
  }
  const t0 = Date.now();
  const r = E.resolverFactible({ grupos, docentes, cargas }, { ventanas: ven, maxNodos: 600000, maxNodosTope: 4000000, maxIntentos: 120 });
  console.log(`Cuatri ${cuatri}° (${Object.keys(grupos).length} grupos, ${r.sesiones.length} ses): ok=${r.ok} intentos=${r.intentos} ${(Date.now() - t0) / 1000}s`);
  if (!r.ok) { console.log('⛔ falló el clúster ' + cuatri); process.exit(1); }
  // Marcar ocupación de docentes para los siguientes clústeres.
  for (const b of r.horario.bloques) {
    todos.push(b);
    for (let h = b.inicio; h < b.inicio + b.duracion; h++) if (dispActual[b.docente] && dispActual[b.docente][b.dia]) dispActual[b.docente][b.dia].delete(h);
  }
}

// Validación núcleo global.
const disponibilidad = {}; for (const k in d.docentes) disponibilidad[k] = d.docentes[k].disponibilidad;
const requeridas = {}; for (const c of d.cargas) { const k = `${c.grupo}|${c.materia}|${c.docente}`; requeridas[k] = (requeridas[k] || 0) + c.horas; }
const h = { bloques: todos, disponibilidad, requeridas };
const core = [].concat(I.noSolapeGrupo(h), I.noSolapeDocente(h), I.disponibilidad(h), I.ventanaTurno(h), I.conservacionHoras(h));
console.log('Validez núcleo GLOBAL:', core.length ? core.slice(0, 5).map((x) => `${x.id} ${x.mensaje}`) : '✅ 0 violaciones · horas completas');
console.log(`Horas colocadas: ${todos.reduce((s, b) => s + b.duracion, 0)} / ${d.cargas.reduce((s, c) => s + c.horas, 0)}`);

fs.writeFileSync(path.join(__dirname, 'horario.json'), JSON.stringify({ grupos: d.grupos, bloques: todos, ventanas: ven }, null, 0));
console.log('✓ escrito tools/horario.json');
