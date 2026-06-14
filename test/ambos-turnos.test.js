/**
 * ⭐ Regla institucional CRÍTICA — prioridad de docentes con AMBOS turnos.
 *   node --test
 *
 * Cubre BT-1..6 de docs/estrategia-pruebas-qa.md. La prueba clave es BT-3: un escenario de
 * escasez donde un motor SIN la regla ('naive') sacrifica al docente de ambos turnos, y el motor
 * CON la regla ('prioridad') lo protege. Así se demuestra que la regla está activa.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/motor-min.js');
const I = require('../src/invariantes.js');

const ses = (grupo, materia, docente, turno, duracion) => ({ grupo, materia, docente, turno, duracion });

// Escenario de ESCASEZ: el docente "AT" da clase en ambos turnos pero su única franja matutina
// viable (1A, lunes 7–9) la disputa "Mart", de un solo turno y con disponibilidad amplia.
function escenarioEscasez() {
  return {
    sesiones: [
      ses('1A', 'Hist', 'Mart', 'matutino', 2),   // primero en el orden de entrada
      ses('1A', 'Mate', 'AT', 'matutino', 2),      // AT: su único hueco matutino es 1A lunes 7–9
      ses('8B', 'Prog', 'AT', 'vespertino', 2),    // AT también da vespertino → ambos turnos
    ],
    // AT solo dispone lunes: matutino {7,8}, vespertino {16,17}. Mart: lunes amplio.
    disponibilidad: {
      AT: { 0: [7, 8, 16, 17] },
      Mart: { 0: [7, 8, 9, 10, 11, 12, 13, 14] },
    },
  };
}

function escenarioFactible() {
  return {
    sesiones: [
      ses('1A', 'Mate', 'AT', 'matutino', 2),
      ses('8B', 'Prog', 'AT', 'vespertino', 2),
    ],
    disponibilidad: { AT: { 0: [7, 8, 16, 17] } },
  };
}

test('BT-1 · identificación de docente con ambos turnos', () => {
  const { sesiones } = escenarioEscasez();
  const turnos = M.turnosPorDocente(sesiones);
  assert.equal(turnos.get('AT').size, 2);
  assert.equal(turnos.get('Mart').size, 1);
  assert.ok(M.esAmbosTurnos('AT', turnos));
  assert.ok(!M.esAmbosTurnos('Mart', turnos));
});

test('BT-2 · colocación garantizada en escenario factible (con la regla)', () => {
  const { sesiones, disponibilidad } = escenarioFactible();
  const r = M.colocar(sesiones, disponibilidad, { estrategia: 'prioridad' });
  assert.equal(r.fallidos.length, 0);
  // Cross-check: el horario producido es válido para el oráculo de invariantes.
  const horario = {
    bloques: r.bloques,
    disponibilidad,
    requeridas: { '1A|Mate|AT': 2, '8B|Prog|AT': 2 },
  };
  assert.deepEqual(I.verificarTodo(horario), []);
});

test('BT-3 ⭐ · failing test dirigido: sin la regla se sacrifica al docente de ambos turnos', () => {
  const { sesiones, disponibilidad } = escenarioEscasez();

  const naive = M.colocar(sesiones, disponibilidad, { estrategia: 'naive' });
  const prioridad = M.colocar(sesiones, disponibilidad, { estrategia: 'prioridad' });

  // SIN la regla: el docente de ambos turnos queda sin lugar (regla violada).
  assert.ok(
    naive.fallidos.some((f) => f.docente === 'AT'),
    'El motor naive DEBE sacrificar al docente de ambos turnos (demuestra que el escenario es discriminante)'
  );

  // CON la regla: el docente de ambos turnos queda 100% colocado y nada falla.
  assert.equal(prioridad.fallidos.filter((f) => f.docente === 'AT').length, 0);
  assert.equal(prioridad.fallidos.length, 0);
});

test('BT-4 · orden de la cola: ambos turnos preceden a un solo turno', () => {
  const { sesiones } = escenarioEscasez();
  const turnos = M.turnosPorDocente(sesiones);
  const cola = M.colaPrioridad(sesiones);

  assert.ok(M.esAmbosTurnos(cola[0].docente, turnos), 'el primero debe ser de ambos turnos');
  let vistoUnSoloTurno = false;
  for (const s of cola) {
    if (M.esAmbosTurnos(s.docente, turnos)) {
      assert.ok(!vistoUnSoloTurno, 'ningún bloque de ambos turnos debe ir tras uno de un solo turno');
    } else {
      vistoUnSoloTurno = true;
    }
  }
});

test('BT-5 · el hueco de mediodía de un docente de ambos turnos es legítimo (no es violación)', () => {
  // Matutino 9–11 y vespertino 16–18: hay un vacío 11–16 que NO debe marcarse como inválido.
  const horario = {
    bloques: [
      { grupo: '1A', materia: 'Mate', docente: 'AT', turno: 'matutino', dia: 0, inicio: 9, duracion: 2 },
      { grupo: '8B', materia: 'Prog', docente: 'AT', turno: 'vespertino', dia: 0, inicio: 16, duracion: 2 },
    ],
    disponibilidad: { AT: { 0: [9, 10, 16, 17] } },
    requeridas: { '1A|Mate|AT': 2, '8B|Prog|AT': 2 },
  };
  assert.deepEqual(I.verificarTodo(horario), []);
  assert.equal(I.noSolapeDocente(horario).length, 0, 'el hueco inter-turno no es un solape');
  // Nota: penalizar (o no) este hueco es asunto del objetivo tier 1, pendiente de implementar.
});

test('BT-6 · regresión: no-solape de docente se cumple cruzando la frontera de turno', () => {
  const solapado = {
    bloques: [
      { grupo: '1A', materia: 'Mate', docente: 'AT', turno: 'matutino', dia: 0, inicio: 13, duracion: 2 },   // 13–15
      { grupo: '8B', materia: 'Prog', docente: 'AT', turno: 'vespertino', dia: 0, inicio: 14, duracion: 2 },  // 14–16 (solapa 14–15)
    ],
  };
  assert.ok(new Set(I.verificarTodo(solapado).map((v) => v.id)).has('INV-2'), 'debe detectar el solape inter-turno');

  const valido = {
    bloques: [
      { grupo: '1A', materia: 'Mate', docente: 'AT', turno: 'matutino', dia: 0, inicio: 13, duracion: 2 },   // 13–15
      { grupo: '8B', materia: 'Prog', docente: 'AT', turno: 'vespertino', dia: 0, inicio: 16, duracion: 2 },  // 16–18 (sin solape)
    ],
  };
  assert.equal(I.noSolapeDocente(valido).length, 0);
});
