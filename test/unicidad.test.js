/**
 * Pruebas de unicidad / determinismo del engine — node --test
 *
 * Cubre UNI-1..5 de docs/estrategia-pruebas-qa.md:
 *   UNI-1 reproducibilidad · UNI-2 unicidad demostrada (no-good cut) · UNI-3 días ascendentes ·
 *   UNI-4 ruptura de simetría de grupos · UNI-5 canonicidad (lex-mínimo).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine.js');

// Instancia ÚNICA: Mate 4h → [2,2]; Ana solo tiene un slot de 2h cada día (lun y mar).
function instanciaUnica() {
  return {
    grupos: { '1A': { turno: 'matutino' } },
    docentes: { Ana: { disponibilidad: { 0: [7, 8], 1: [7, 8] } } },
    cargas: [{ grupo: '1A', materia: 'Mate', docente: 'Ana', turno: 'matutino', horas: 4 }],
  };
}

// Instancia MÚLTIPLE: Mate 2h → [1,1]; Ana tiene 2 horas libres cada día → varias soluciones.
function instanciaMultiple() {
  return {
    grupos: { '1A': { turno: 'matutino' } },
    docentes: { Ana: { disponibilidad: { 0: [7, 8], 1: [7, 8] } } },
    cargas: [{ grupo: '1A', materia: 'Mate', docente: 'Ana', turno: 'matutino', horas: 2 }],
  };
}

// Instancia con SIMETRÍA DE GRUPOS: 1A y 1B (mismas materias/horas) los da el mismo docente,
// que tiene exactamente 2 slots → solo difieren por el intercambio (swap) de grupos.
function instanciaSimetriaGrupos() {
  return {
    grupos: { '1A': { turno: 'matutino' }, '1B': { turno: 'matutino' } },
    docentes: { Uni: { disponibilidad: { 0: [7, 8] } } },
    cargas: [
      { grupo: '1A', materia: 'Mate', docente: 'Uni', turno: 'matutino', horas: 1 },
      { grupo: '1B', materia: 'Mate', docente: 'Uni', turno: 'matutino', horas: 1 },
    ],
  };
}

test('UNI-1 · reproducibilidad: misma entrada → horario idéntico', () => {
  const datos = instanciaMultiple();
  const a = E.resolver(datos).horario;
  const b = E.resolver(datos).horario;
  assert.deepEqual(a, b);
});

test('UNI-2 · unicidad demostrada (equivale a no-good cut → INFEASIBLE)', () => {
  assert.equal(E.verificarUnicidad(instanciaUnica()).unica, true);
  // Control: la instancia múltiple NO es única.
  assert.equal(E.verificarUnicidad(instanciaMultiple()).unica, false);
});

test('UNI-3 · los bloques de una carga salen en días estrictamente ascendentes', () => {
  const soluciones = E.enumerar(instanciaMultiple(), {}, 1000);
  assert.ok(soluciones.length > 1);
  for (const h of soluciones) {
    const dias = h.bloques.map((b) => b.dia);
    for (let i = 1; i < dias.length; i++) assert.ok(dias[i] > dias[i - 1], 'días deben ser ascendentes');
  }
});

test('UNI-4 · ruptura de simetría de grupos idénticos → unicidad', () => {
  const datos = instanciaSimetriaGrupos();
  // Se detecta el bucket de grupos idénticos.
  assert.deepEqual(E.bucketsIdenticos(datos), [['1A', '1B']]);
  // Sin filtrar hay 2 soluciones crudas (el swap); al romper la simetría queda 1.
  assert.equal(E.enumerar(datos, {}, 10).length, 2);
  assert.equal(E.verificarUnicidad(datos).unica, true);
  // La canónica asigna al grupo que ordena primero (1A) el slot más temprano.
  const r = E.resolver(datos).horario;
  const inicio = (g) => r.bloques.find((b) => b.grupo === g).inicio;
  assert.ok(inicio('1A') < inicio('1B'));
});

test('UNI-5 · canonicidad: la solución devuelta es la de clave lexicográfica mínima', () => {
  const datos = instanciaMultiple();
  const elegida = E.claveGlobal(E.resolver(datos).horario);
  const todas = E.enumerar(datos, {}, 1000);
  for (const h of todas) {
    assert.ok(E.lexCmp(elegida, E.claveGlobal(h)) <= 0, 'ninguna solución debe ser lexicográficamente menor');
  }
});
