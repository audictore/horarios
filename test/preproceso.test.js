/**
 * Pruebas del preproceso — runner nativo de Node (sin dependencias):
 *   node --test
 *
 * Cubre los casos SPL-* y DIA-* de docs/estrategia-pruebas-qa.md, más la propiedad
 * SPL-5 y la detección de inviabilidad estructural. Verifican el contrato determinista
 * del que depende la unicidad canónica.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/preproceso.js');

test('SPL-1..4 · balanced contra los ejemplos institucionales', () => {
  assert.deepEqual(P.balanced(7, 2), [4, 3]);     // SPL-1
  assert.deepEqual(P.balanced(7, 3), [3, 2, 2]);  // SPL-2
  assert.deepEqual(P.balanced(7, 4), [2, 2, 2, 1]); // SPL-3
  assert.deepEqual(P.balanced(6, 3), [2, 2, 2]);  // SPL-4
});

test('SPL-5 · propiedad: suma=H, longitud=N, max−min≤1, descendente', () => {
  for (let H = 1; H <= 50; H++) {
    for (let N = 1; N <= H; N++) {
      const split = P.balanced(H, N);
      assert.equal(split.reduce((a, b) => a + b, 0), H, `suma ${H},${N}`);
      assert.equal(split.length, N, `longitud ${H},${N}`);
      assert.ok(Math.max(...split) - Math.min(...split) <= 1, `balance ${H},${N}`);
      for (let i = 1; i < split.length; i++) {
        assert.ok(split[i - 1] >= split[i], `descendente ${H},${N}`);
      }
    }
  }
});

test('SPL-6 · banda de N: ⌈H/durMax⌉ ≤ N ≤ min(días, ⌊H/durMin⌋)', () => {
  // 7h, docente de 3 días, bloques 1..4h
  assert.deepEqual(P.bandaN(7, 3, { durMax: 4, durMin: 1 }), { nMin: 2, nMax: 3 });
  // 7h, docente de 2 días → nMax limitado por los días
  assert.deepEqual(P.bandaN(7, 2, { durMax: 4, durMin: 1 }), { nMin: 2, nMax: 2 });
});

test('balanced · entradas inválidas lanzan PreprocesoError', () => {
  assert.throws(() => P.balanced(3, 4), P.PreprocesoError); // N > H
  assert.throws(() => P.balanced(0, 1), P.PreprocesoError); // H < 1
  assert.throws(() => P.balanced(5, 0), P.PreprocesoError); // N < 1
});

test('DIA-1..3 · escalón de carga → días de asistencia', () => {
  assert.equal(P.diasObjetivo(2), 2);   // DIA-1
  assert.equal(P.diasObjetivo(9), 2);
  assert.equal(P.diasObjetivo(10), 3);  // DIA-2
  assert.equal(P.diasObjetivo(20), 3);
  assert.equal(P.diasObjetivo(21), 4);  // DIA-3
  assert.equal(P.diasObjetivo(50), 4);
});

test('DIA-4 · fronteras off-by-one 9/10 y 20/21', () => {
  assert.notEqual(P.diasObjetivo(9), P.diasObjetivo(10)); // 2 vs 3
  assert.notEqual(P.diasObjetivo(20), P.diasObjetivo(21)); // 3 vs 4
});

test('elegirN · reparte en tantos días como asista el docente (N = nMax)', () => {
  assert.equal(P.elegirN(7, 3), 3); // min(3,7)=3, ≥ ⌈7/4⌉=2
  assert.equal(P.elegirN(7, 2), 2); // limitado por los días
  assert.equal(P.elegirN(3, 5), 3); // limitado por las horas
});

test('elegirN · materia que no cabe → PreprocesoError con detalle', () => {
  // 10h en 2 días con tope 4h/bloque: 4+4=8 < 10 → inviable, debe avisar
  assert.throws(
    () => P.elegirN(10, 2, { durMax: 4 }),
    (e) => e instanceof P.PreprocesoError && e.detalle && e.detalle.nMin > e.detalle.nMax
  );
});

test('generarSplit · cadena completa elegirN + balanced', () => {
  assert.deepEqual(P.generarSplit(7, 3), [3, 2, 2]);
  assert.deepEqual(P.generarSplit(7, 2), [4, 3]);
  assert.deepEqual(P.generarSplit(16, 4), [4, 4, 4, 4]);
});
