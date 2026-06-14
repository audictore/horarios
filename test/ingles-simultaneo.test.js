/**
 * Inglés simultáneo — node --test
 *
 * Regla institucional: el inglés de un mismo cuatrimestre va a la MISMA hora en todos sus grupos
 * (vía `sync` en la carga), salvo 8°/9° (sin `sync`). Se modela como restricción de igualdad:
 * bloques con el mismo (sync, índice de bloque) deben coincidir en día y hora.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine.js');
const I = require('../src/invariantes.js');

const ingles = (horario, grupo) => horario.bloques
  .filter((b) => b.grupo === grupo && b.materia === 'Ingles')
  .sort((a, b) => a.dia - b.dia || a.inicio - b.inicio);

test('cuatrimestre 2 · el inglés cae a la misma hora en todos los grupos', () => {
  const disp = { 0: [7, 8], 1: [7, 8] };
  const datos = {
    grupos: { '2A': { turno: 'matutino' }, '2B': { turno: 'matutino' } },
    docentes: { T1: { disponibilidad: disp }, T2: { disponibilidad: disp } }, // docentes distintos
    cargas: [
      { grupo: '2A', materia: 'Ingles', docente: 'T1', turno: 'matutino', horas: 2, sync: 'INGLES|2' },
      { grupo: '2B', materia: 'Ingles', docente: 'T2', turno: 'matutino', horas: 2, sync: 'INGLES|2' },
    ],
  };
  const r = E.resolver(datos);
  assert.ok(r.ok);
  const a = ingles(r.horario, '2A'), b = ingles(r.horario, '2B');
  assert.equal(a.length, 2);
  assert.equal(b.length, 2);
  for (let k = 0; k < a.length; k++) {
    assert.equal(a[k].dia, b[k].dia, `bloque ${k}: mismo día`);
    assert.equal(a[k].inicio, b[k].inicio, `bloque ${k}: misma hora`);
  }
});

test('cuatrimestre 8 · sin sync, cada grupo puede ir a su propia hora', () => {
  // T1 solo libre lunes a las 7; T2 solo libre lunes a las 8 → NO hay franja común.
  const datos = {
    grupos: { '8A': { turno: 'vespertino' }, '8B': { turno: 'vespertino' } },
    docentes: { T1: { disponibilidad: { 0: [12] } }, T2: { disponibilidad: { 0: [13] } } },
    cargas: [
      { grupo: '8A', materia: 'Ingles', docente: 'T1', turno: 'vespertino', horas: 1 },
      { grupo: '8B', materia: 'Ingles', docente: 'T2', turno: 'vespertino', horas: 1 },
    ],
  };
  // Sin sync (8°): factible, cada uno a su hora.
  assert.equal(E.resolver(datos).ok, true);

  // Con sync (hipotético): exigiría franja común que no existe → INFEASIBLE. Demuestra que el
  // mecanismo realmente fuerza la simultaneidad.
  const conSync = JSON.parse(JSON.stringify(datos));
  conSync.cargas.forEach((c) => { c.sync = 'INGLES|8'; });
  assert.equal(E.resolver(conSync).ok, false);
});

test('la mejora de calidad NO rompe la simultaneidad del inglés', () => {
  const disp = { 0: [7, 8, 9, 10], 1: [7, 8, 9, 10] };
  const datos = {
    grupos: { '2A': { turno: 'matutino' }, '2B': { turno: 'matutino' } },
    docentes: {
      T1: { disponibilidad: disp }, T2: { disponibilidad: disp },
      T3: { disponibilidad: disp }, T4: { disponibilidad: disp },
    },
    cargas: [
      { grupo: '2A', materia: 'Ingles', docente: 'T1', turno: 'matutino', horas: 2, sync: 'INGLES|2' },
      { grupo: '2B', materia: 'Ingles', docente: 'T2', turno: 'matutino', horas: 2, sync: 'INGLES|2' },
      { grupo: '2A', materia: 'Mate', docente: 'T3', turno: 'matutino', horas: 2 }, // materia normal
      { grupo: '2B', materia: 'Mate', docente: 'T4', turno: 'matutino', horas: 2 },
    ],
  };
  const r = E.resolverConCalidad(datos);
  assert.ok(r.ok);
  const a = ingles(r.horario, '2A'), b = ingles(r.horario, '2B');
  for (let k = 0; k < a.length; k++) {
    assert.equal(a[k].dia, b[k].dia);
    assert.equal(a[k].inicio, b[k].inicio); // sigue sincronizado tras optimizar
  }
});
