/**
 * Corre el engine CP sobre los datos reales y reporta. Uso:
 *   node tools/solveReal.js "<carga.xlsx>" "<disponibilidades.xlsx>"
 */
'use strict';
const { cargarDatos } = require('./cargarReales.js');
const E = require('../src/engine.js');
const I = require('../src/invariantes.js');
const Cal = require('../src/calidad.js');

const d = cargarDatos(process.argv[2], process.argv[3]);
const ven = { matutino: [7, 16], vespertino: [12, 21] };

const t0 = Date.now();
const r = E.resolverFactible(d, { ventanas: ven });
const ms = Date.now() - t0;
console.log(`resolverFactible: ok=${r.ok} · sesiones=${r.sesiones.length} · ${ms} ms`);

if (!r.ok) {
  console.log('⛔ INFEASIBLE bajo las restricciones duras (con inglés sincronizado).');
  process.exit(0);
}

const disponibilidad = {};
for (const k in d.docentes) disponibilidad[k] = d.docentes[k].disponibilidad;
const requeridas = {};
for (const c of d.cargas) { const k = `${c.grupo}|${c.materia}|${c.docente}`; requeridas[k] = (requeridas[k] || 0) + c.horas; }
const h = { bloques: r.horario.bloques, disponibilidad, requeridas };

// Invariantes núcleo (los que aplican a TODO; INV-3/INV-8 no aplican al inglés multi-hora/día).
const core = [].concat(I.noSolapeGrupo(h), I.noSolapeDocente(h), I.disponibilidad(h), I.ventanaTurno(h), I.conservacionHoras(h));
console.log('Invariantes núcleo:', core.length ? core.slice(0, 5).map((x) => `${x.id} ${x.mensaje}`) : '✅ 0 violaciones (sin solapes, dentro de disponibilidad/ventana, horas completas)');
console.log('Calidad:', JSON.stringify(Cal.evaluarCalidad(r.horario)));

const eng = (g) => r.horario.bloques.filter((b) => b.grupo === g && /Ingles/i.test(b.materia)).map((b) => b.dia + '@' + b.inicio).sort().join(' ');
const dias = ['L', 'M', 'X', 'J', 'V', 'S'];
const fmt = (s) => s.split(' ').map((x) => { const [d2, h2] = x.split('@'); return dias[+d2] + h2; }).join(' ');
console.log('\nInglés 2°:', '\n  2a:', fmt(eng('2a')), '\n  2b:', fmt(eng('2b')), '\n  2c:', fmt(eng('2c')));
console.log('Inglés 5°:', '\n  5a GCH :', fmt(eng('5a GCH')), '\n  5a EFEP:', fmt(eng('5a EFEP')), '\n  5b EFEP:', fmt(eng('5b EFEP')));
