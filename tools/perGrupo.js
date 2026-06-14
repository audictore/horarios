/**
 * Prueba de factibilidad POR GRUPO en aislamiento (con disponibilidad de docente completa =
 * optimista, e inglés restringido a sus slots forzados). Si un grupo falla aquí, es PRUEBA de que
 * el horario completo es infactible y nombra al grupo culpable.
 *   node tools/perGrupo.js "<carga.xlsx>" "<disp.xlsx>"
 */
'use strict';
const { cargarDatos } = require('./cargarReales.js');
const E = require('../src/engine.js');

const d = cargarDatos(process.argv[2], process.argv[3]);
const ven = { matutino: [7, 16], vespertino: [12, 21] };

const setDe = (p) => { const s = new Set(); const dd = d.docentes[p].disponibilidad; for (const k in dd) for (const h of dd[k]) s.add(k + ':' + h); return s; };
const inter = (profs) => { const sets = profs.map(setDe); return [...sets[0]].filter((x) => sets.every((s) => s.has(x))); };
const forced = {
  2: inter(['Profe ingles 1', 'Profe ingles 2', 'Profe ingles 3']),
  5: inter(['Profe ingles 4', 'Daniela Placido Soriano', 'Profe ingles 5']),
};
const aDisp = (slots) => { const disp = {}; for (const x of slots) { const [k, h] = x.split(':').map(Number); (disp[k] || (disp[k] = [])).push(h); } return disp; };

for (const g of Object.keys(d.grupos).sort()) {
  const cargas = d.cargas.filter((c) => c.grupo === g);
  const grupos = { [g]: d.grupos[g] };
  const docentes = {};
  for (const c of cargas) {
    const base = d.docentes[c.docente];
    let disp = base.disponibilidad;
    if (c.sync) disp = aDisp(forced[+c.sync.split('|')[1]] || []); // inglés en sus slots forzados
    docentes[c.docente] = { tipo: base.tipo, disponibilidad: disp };
  }
  const horas = cargas.reduce((s, c) => s + c.horas, 0);
  const t0 = Date.now();
  let r;
  try { r = E.resolverFactible({ grupos, docentes, cargas }, { ventanas: ven }); }
  catch (e) { console.log('⛔ ' + g.padEnd(9) + ' ERROR preproceso: ' + e.message); continue; }
  console.log(`${r.ok ? '✅' : '⛔'} ${g.padEnd(9)} ${horas}h · ${r.sesiones.length} sesiones · ${Date.now() - t0}ms${r.ok ? '' : '  ← INFACTIBLE EN AISLAMIENTO (prueba de cuello de botella)'}`);
}
