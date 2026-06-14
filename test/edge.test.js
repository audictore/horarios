/**
 * Casos límite — node --test
 *
 * EDGE-1..8 de docs/estrategia-pruebas-qa.md: el mínimo absoluto, todos de ambos turnos, fronteras
 * de escalón, materia indivisible, holgura cero, grupos/docentes vacíos, nombres con unicode, y
 * misma materia con docentes distintos en un grupo.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine.js');
const I = require('../src/invariantes.js');

function oraculo(datos, horario) {
  const disponibilidad = {};
  for (const d in datos.docentes) disponibilidad[d] = datos.docentes[d].disponibilidad;
  const requeridas = {};
  for (const c of datos.cargas) requeridas[`${c.grupo}|${c.materia}|${c.docente}`] = c.horas;
  return I.verificarTodo({ bloques: horario.bloques, disponibilidad, requeridas });
}

test('EDGE-1 · mínimo absoluto: un docente, una materia de 1h', () => {
  const datos = {
    grupos: { '1A': { turno: 'matutino' } },
    docentes: { Ana: { disponibilidad: { 0: [7] } } },
    cargas: [{ grupo: '1A', materia: 'Mate', docente: 'Ana', turno: 'matutino', horas: 1 }],
  };
  const r = E.resolver(datos);
  assert.ok(r.ok);
  assert.equal(r.horario.bloques.length, 1);
  assert.deepEqual(oraculo(datos, r.horario), []);
});

test('EDGE-2 · todos los docentes de ambos turnos (estrés de la regla)', () => {
  const disp = { 0: [7, 8, 16, 17], 1: [7, 8, 16, 17] };
  const datos = {
    grupos: { '1A': { turno: 'matutino' }, '8A': { turno: 'vespertino' }, '1B': { turno: 'matutino' }, '8B': { turno: 'vespertino' } },
    docentes: { T1: { disponibilidad: disp }, T2: { disponibilidad: disp } },
    cargas: [
      { grupo: '1A', materia: 'Mate', docente: 'T1', turno: 'matutino', horas: 2 },
      { grupo: '8A', materia: 'Prog', docente: 'T1', turno: 'vespertino', horas: 2 },
      { grupo: '1B', materia: 'Mate', docente: 'T2', turno: 'matutino', horas: 2 },
      { grupo: '8B', materia: 'Prog', docente: 'T2', turno: 'vespertino', horas: 2 },
    ],
  };
  const r = E.resolver(datos);
  assert.ok(r.ok);
  assert.equal(r.horario.bloques.length, r.sesiones.length); // ninguno sacrificado
  assert.deepEqual(oraculo(datos, r.horario), []);
});

test('EDGE-3 · fronteras de escalón del PA (9,10,20,21)', () => {
  const datos = { grupos: {}, docentes: { P: { tipo: 2, disponibilidad: {} } }, cargas: [] };
  assert.equal(E.diasDeDocente(datos, 'P', 9), 2);
  assert.equal(E.diasDeDocente(datos, 'P', 10), 3);
  assert.equal(E.diasDeDocente(datos, 'P', 20), 3);
  assert.equal(E.diasDeDocente(datos, 'P', 21), 4);
});

test('EDGE-4 · materia de 1h (bloque indivisible)', () => {
  const datos = {
    grupos: { '1A': { turno: 'matutino' } },
    docentes: { Ana: { disponibilidad: { 0: [7, 8, 9] } } },
    cargas: [{ grupo: '1A', materia: 'Tutoria', docente: 'Ana', turno: 'matutino', horas: 1 }],
  };
  const ses = E.construirSesiones(datos);
  assert.deepEqual(ses.map((s) => s.duracion), [1]);
  assert.ok(E.resolver(datos).ok);
});

test('EDGE-5 · holgura cero: disponibilidad exactamente igual a lo necesario', () => {
  const base = {
    grupos: { '1A': { turno: 'matutino' } },
    docentes: { Ana: { tipo: 3, disponibilidad: { 0: [7, 8] } } }, // PTC, 1 día → 1 bloque de 2h
    cargas: [{ grupo: '1A', materia: 'Mate', docente: 'Ana', turno: 'matutino', horas: 2 }],
  };
  assert.equal(E.resolver(base).ok, true); // cabe justo en 7–9

  const sinHolgura = JSON.parse(JSON.stringify(base));
  sinHolgura.docentes.Ana.disponibilidad = { 0: [7] }; // una hora menos → ya no cabe el bloque de 2h
  assert.equal(E.resolver(sinHolgura).ok, false);
});

test('EDGE-6 · grupos sin materia y docentes sin carga no rompen nada', () => {
  const datos = {
    grupos: { '1A': { turno: 'matutino' }, '2A': { turno: 'matutino' } }, // 2A sin cargas
    docentes: { Ana: { disponibilidad: { 0: [7] } }, Bob: { disponibilidad: { 0: [7] } } }, // Bob sin carga
    cargas: [{ grupo: '1A', materia: 'Mate', docente: 'Ana', turno: 'matutino', horas: 1 }],
  };
  const r = E.resolver(datos);
  assert.ok(r.ok);
  assert.equal(r.horario.bloques.length, 1);

  // Sin cargas en absoluto → solución trivial vacía (no infactible).
  const vacio = E.resolver({ grupos: {}, docentes: {}, cargas: [] });
  assert.ok(vacio.ok);
  assert.deepEqual(vacio.horario.bloques, []);
});

test('EDGE-7 · nombres con acentos, espacios y mayúsculas', () => {
  const datos = {
    grupos: { '1° A': { turno: 'matutino' } },
    docentes: { 'José Pérez': { disponibilidad: { 0: [7, 8], 1: [7, 8] } } },
    cargas: [{ grupo: '1° A', materia: 'Inglés Técnico', docente: 'José Pérez', turno: 'matutino', horas: 2 }],
  };
  const r = E.resolver(datos);
  assert.ok(r.ok);
  assert.deepEqual(oraculo(datos, r.horario), []);
  assert.equal(r.horario.bloques[0].docente, 'José Pérez'); // nombres preservados tal cual
});

test('EDGE-8 · misma materia con docentes distintos en el mismo grupo', () => {
  const disp = { 0: [7, 8], 1: [7, 8] };
  const datos = {
    grupos: { '1A': { turno: 'matutino' } },
    docentes: { Ana: { disponibilidad: disp }, Beto: { disponibilidad: disp } },
    cargas: [
      { grupo: '1A', materia: 'Mate', docente: 'Ana', turno: 'matutino', horas: 2 },
      { grupo: '1A', materia: 'Mate', docente: 'Beto', turno: 'matutino', horas: 2 }, // misma materia, otro docente
    ],
  };
  const r = E.resolver(datos);
  assert.ok(r.ok);
  // Ambas cargas presentes y sin solape de grupo (el oráculo lo confirma).
  assert.equal(r.horario.bloques.filter((b) => b.docente === 'Ana').length, 2);
  assert.equal(r.horario.bloques.filter((b) => b.docente === 'Beto').length, 2);
  assert.deepEqual(oraculo(datos, r.horario), []);
});
