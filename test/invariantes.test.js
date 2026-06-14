/**
 * Pruebas del oráculo de invariantes — runner nativo de Node:
 *   node --test
 *
 * Cubre INV-1..8 de docs/estrategia-pruebas-qa.md. Estrategia: un horario base válido que debe
 * pasar limpio, y luego un horario por invariante diseñado para violar EXACTAMENTE esa regla,
 * comprobando que el oráculo la caza. Es agnóstico al motor (opera sobre el horario de salida).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../src/invariantes.js');

// Helper para construir bloques de forma compacta.
function b(grupo, materia, docente, turno, dia, inicio, duracion, horas) {
  const bl = { grupo, materia, docente, turno, dia, inicio, duracion };
  if (horas) bl.horas = horas;
  return bl;
}
const ids = (viols) => new Set(viols.map((v) => v.id));

test('Horario válido completo → cero violaciones', () => {
  const h = {
    bloques: [
      b('1A', 'Mate', 'Ana', 'matutino', 0, 7, 3, [7, 8, 9]),
      b('1A', 'Mate', 'Ana', 'matutino', 1, 7, 2, [7, 8]),
    ],
    disponibilidad: { Ana: { 0: [7, 8, 9, 10], 1: [7, 8, 9] } },
    requeridas: { '1A|Mate|Ana': 5 },
  };
  assert.deepEqual(I.verificarTodo(h), []);
});

test('INV-1 · solape de grupo', () => {
  const h = { bloques: [
    b('1A', 'Mate', 'Ana', 'matutino', 0, 7, 3),
    b('1A', 'Hist', 'Beto', 'matutino', 0, 8, 2), // mismo grupo, día y franja solapada
  ] };
  assert.ok(ids(I.verificarTodo(h)).has('INV-1'));
  assert.equal(I.noSolapeGrupo(h).length, 1);
});

test('INV-2 · solape de docente (cruza grupos)', () => {
  const h = { bloques: [
    b('1A', 'Mate', 'Ana', 'matutino', 0, 7, 3),
    b('2B', 'Mate', 'Ana', 'matutino', 0, 9, 2), // misma docente, mismo día, solapa
  ] };
  assert.ok(ids(I.verificarTodo(h)).has('INV-2'));
});

test('INV-3 · misma materia dos veces el mismo día (grupo+docente)', () => {
  const h = { bloques: [
    b('1A', 'Mate', 'Ana', 'matutino', 0, 7, 2),
    b('1A', 'Mate', 'Ana', 'matutino', 0, 10, 2), // mismo día, sin solape de horas
  ] };
  assert.ok(ids(I.verificarTodo(h)).has('INV-3'));
});

test('INV-4 · clase fuera de la disponibilidad del docente', () => {
  const h = {
    bloques: [b('1A', 'Mate', 'Ana', 'matutino', 0, 7, 3)], // usa hora 9
    disponibilidad: { Ana: { 0: [7, 8] } },                 // pero solo hay 7 y 8
  };
  assert.ok(ids(I.verificarTodo(h)).has('INV-4'));
});

test('INV-5 · fuera de la ventana de turno', () => {
  const h = { bloques: [b('1A', 'Mate', 'Ana', 'matutino', 0, 6, 2)] }; // inicia a las 6 (< 7)
  assert.ok(ids(I.verificarTodo(h)).has('INV-5'));
  // y un vespertino que se pasa de las 20
  const h2 = { bloques: [b('8C', 'Redes', 'Eli', 'vespertino', 0, 19, 2)] }; // termina 21 (> 20)
  assert.ok(ids(I.verificarTodo(h2)).has('INV-5'));
});

test('INV-6 · horas colocadas ≠ requeridas', () => {
  const h = {
    bloques: [b('1A', 'Mate', 'Ana', 'matutino', 0, 7, 3)], // 3h colocadas
    requeridas: { '1A|Mate|Ana': 5 },                       // 5h requeridas
  };
  assert.ok(ids(I.verificarTodo(h)).has('INV-6'));
});

test('INV-7 · bloque no contiguo o inválido', () => {
  const noContiguo = { bloques: [b('1A', 'Mate', 'Ana', 'matutino', 0, 7, 3, [7, 8, 10])] };
  assert.ok(ids(I.verificarTodo(noContiguo)).has('INV-7'));
  const duracionCero = { bloques: [b('1A', 'Mate', 'Ana', 'matutino', 0, 7, 0)] };
  assert.ok(ids(I.verificarTodo(duracionCero)).has('INV-7'));
});

test('INV-8 · dos bloques de la misma carga el mismo día', () => {
  const h = { bloques: [
    b('1A', 'Mate', 'Ana', 'matutino', 0, 7, 2),
    b('1A', 'Mate', 'Ana', 'matutino', 0, 10, 2),
  ] };
  assert.ok(ids(I.verificarTodo(h)).has('INV-8'));
});

test('Aislamiento · cada horario de fallo dispara su invariante objetivo', () => {
  // El horario válido no debe disparar ninguna; sirve de control negativo.
  const valido = {
    bloques: [b('1A', 'Mate', 'Ana', 'matutino', 0, 7, 2), b('1A', 'Mate', 'Ana', 'matutino', 1, 7, 3)],
    disponibilidad: { Ana: { 0: [7, 8], 1: [7, 8, 9] } },
    requeridas: { '1A|Mate|Ana': 5 },
  };
  assert.equal(I.verificarTodo(valido).length, 0);
});
