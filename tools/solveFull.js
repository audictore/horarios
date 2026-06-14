/**
 * Resuelve el horario COMPLETO con el motor CP (reinicios aleatorizados) y escribe el resultado a
 * tools/horario.json para exportarlo. Uso:
 *   node tools/solveFull.js "<carga.xlsx>" "<disp.xlsx>"
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { cargarDatos } = require('./cargarReales.js');
const E = require('../src/engine.js');
const I = require('../src/invariantes.js');

const d = cargarDatos(process.argv[2], process.argv[3]);
const ven = { matutino: [7, 16], vespertino: [12, 21] };

console.log(`Resolviendo COMPLETO: ${Object.keys(d.grupos).length} grupos, ${d.cargas.length} cargas, ${d.cargas.reduce((s, c) => s + c.horas, 0)}h…`);
const t0 = Date.now();
const r = E.resolverFactible(d, { ventanas: ven, maxNodos: 15000000, maxIntentos: 120 });
const ms = Date.now() - t0;
console.log(`→ ok=${r.ok} · intentos=${r.intentos} · nodos=${r.nodos} · sesiones=${r.sesiones.length} · ${(ms / 1000).toFixed(1)}s`);

if (!r.ok) { console.log(r.agotado ? '⛔ no halló solución dentro del presupuesto' : '⛔ INFACTIBLE (probado)'); process.exit(1); }

// Validación núcleo.
const disponibilidad = {}; for (const k in d.docentes) disponibilidad[k] = d.docentes[k].disponibilidad;
const requeridas = {}; for (const c of d.cargas) { const k = `${c.grupo}|${c.materia}|${c.docente}`; requeridas[k] = (requeridas[k] || 0) + c.horas; }
const h = { bloques: r.horario.bloques, disponibilidad, requeridas };
const core = [].concat(I.noSolapeGrupo(h), I.noSolapeDocente(h), I.disponibilidad(h), I.ventanaTurno(h), I.conservacionHoras(h));
console.log('Validez núcleo:', core.length ? core.slice(0, 5).map((x) => `${x.id} ${x.mensaje}`) : '✅ 0 violaciones · horas completas');

const totalH = r.horario.bloques.reduce((s, b) => s + b.duracion, 0);
console.log(`Horas colocadas: ${totalH} / ${d.cargas.reduce((s, c) => s + c.horas, 0)}`);

fs.writeFileSync(path.join(__dirname, 'horario.json'), JSON.stringify({ grupos: d.grupos, bloques: r.horario.bloques, ventanas: ven }, null, 0));
console.log('✓ escrito tools/horario.json');
