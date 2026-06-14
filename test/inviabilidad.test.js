/**
 * Pruebas de inviabilidad — pre-checks de capacidad (Nivel 1):
 *   node --test
 *
 * Cubre INF-1..6 de docs/estrategia-pruebas-qa.md. Cada caso corrompe UN dato y exige que el
 * sistema lo detecte y lo NOMBRE; los controles negativos (INF-5, INF-6) exigen que NO haya
 * falso positivo. INF-5 documenta el límite honesto del Nivel 1: una infactibilidad por
 * interacción que solo el solver (Nivel 2) puede declarar.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const PC = require('../src/prechecks.js');

const ids = (probs) => new Set(probs.map((p) => p.id));

test('INF-1 · docente con carga mayor que su disponibilidad', () => {
  const datos = {
    grupos: { '1A': { turno: 'matutino' } },
    docentes: { Ana: { disponibilidad: { 0: [7, 8, 9, 10], 1: [7, 8, 9, 10] } } }, // 8h
    cargas: [{ grupo: '1A', materia: 'Mate', docente: 'Ana', turno: 'matutino', horas: 10 }], // 10h
  };
  const probs = PC.verificarCapacidad(datos);
  assert.ok(ids(probs).has('INF-1'));
  assert.ok(!ids(probs).has('INF-4'));
  assert.ok(probs.find((p) => p.id === 'INF-1').docente === 'Ana'); // nombra al culpable
});

test('INF-2 · grupo con más horas que la capacidad de su ventana', () => {
  const dispAmplia = { 0: [7, 8, 9, 10], 1: [7, 8, 9, 10] };
  const datos = {
    grupos: { '1A': { turno: 'matutino' } },
    docentes: { Da: { disponibilidad: dispAmplia }, Db: { disponibilidad: dispAmplia }, Dc: { disponibilidad: dispAmplia } },
    cargas: [
      { grupo: '1A', materia: 'Mate', docente: 'Da', turno: 'matutino', horas: 6 },
      { grupo: '1A', materia: 'Hist', docente: 'Db', turno: 'matutino', horas: 6 },
      { grupo: '1A', materia: 'Bio', docente: 'Dc', turno: 'matutino', horas: 6 },
    ], // 18h en el grupo
  };
  const probs = PC.verificarCapacidad(datos, { diasHabiles: 2 }); // cap = 8h × 2 = 16h
  assert.ok(ids(probs).has('INF-2'));
  assert.equal(probs.find((p) => p.id === 'INF-2').grupo, '1A');
});

test('INF-3 · inglés del grado sin franja común suficiente', () => {
  const datos = {
    grupos: {},
    docentes: { Ing: { disponibilidad: { 0: [7, 8] } } }, // solo 2h en ventana
    cargas: [],
    ingles: [{ grado: '1', grupos: ['1A', '1B'], docente: 'Ing', turno: 'matutino', horas: 3 }],
  };
  const probs = PC.verificarCapacidad(datos);
  assert.ok(ids(probs).has('INF-3'));
});

test('INF-4 · materia cuyo bloque no cabe en la disponibilidad', () => {
  // (a) error estructural: 20h en diasObjetivo(20)=3 días con bloques ≤ 4h → imposible.
  const ampla = { 0: [7, 8, 9, 10, 11, 12, 13, 14], 1: [7, 8, 9, 10, 11, 12, 13, 14], 2: [7, 8, 9, 10, 11, 12, 13, 14], 3: [7, 8, 9, 10, 11, 12, 13, 14] };
  const dA = {
    grupos: { '1A': { turno: 'matutino' } },
    docentes: { Sobre: { disponibilidad: ampla } },
    cargas: [{ grupo: '1A', materia: 'Mega', docente: 'Sobre', turno: 'matutino', horas: 20 }],
  };
  assert.ok(ids(PC.verificarCapacidad(dA)).has('INF-4'));

  // (b) disponibilidad fragmentada: bloque de 4h pero la mayor franja contigua es de 2h.
  const dB = {
    grupos: { '1A': { turno: 'matutino' } },
    docentes: { Frag: { disponibilidad: { 0: [7, 8, 10, 11], 1: [7, 8, 10, 11] } } }, // rachas de 2h, total 8h
    cargas: [{ grupo: '1A', materia: 'X', docente: 'Frag', turno: 'matutino', horas: 8 }], // split [4,4]
  };
  const probsB = PC.verificarCapacidad(dB);
  assert.ok(ids(probsB).has('INF-4'));
  assert.ok(!ids(probsB).has('INF-1')); // 8h carga ≤ 8h disp → no es problema de total
});

test('INF-5 · infactibilidad por interacción que el Nivel 1 NO puede declarar', () => {
  // Tres clases de 1h en el mismo grupo, cuyos docentes solo están libres el lunes a las 7.
  // El grupo no puede estar en 3 clases a la vez → infactible, pero cada chequeo agregado pasa.
  const soloLun7 = { 0: [7] };
  const datos = {
    grupos: { '1A': { turno: 'matutino' } },
    docentes: { Ana: { disponibilidad: soloLun7 }, Beto: { disponibilidad: soloLun7 }, Caro: { disponibilidad: soloLun7 } },
    cargas: [
      { grupo: '1A', materia: 'Mate', docente: 'Ana', turno: 'matutino', horas: 1 },
      { grupo: '1A', materia: 'Hist', docente: 'Beto', turno: 'matutino', horas: 1 },
      { grupo: '1A', materia: 'Bio', docente: 'Caro', turno: 'matutino', horas: 1 },
    ],
  };
  // El Nivel 1 (correctamente) NO reporta nada: es trabajo del solver (Nivel 2 / IIS).
  assert.deepEqual(PC.verificarCapacidad(datos), []);
});

test('INF-6 · dataset factible → sin falsos positivos', () => {
  const datos = {
    grupos: { '1A': { turno: 'matutino' } },
    docentes: { Ana: { disponibilidad: { 0: [7, 8, 9, 10], 1: [7, 8, 9, 10] } } },
    cargas: [{ grupo: '1A', materia: 'Mate', docente: 'Ana', turno: 'matutino', horas: 4 }],
  };
  assert.deepEqual(PC.verificarCapacidad(datos), []);
});
