/**
 * Escalado del engine — node --test
 *
 * Verifica que el modo rápido (MRV + forward-checking) resuelve instancias acopladas medianas
 * de forma correcta y veloz, que es determinista, y que coincide en factibilidad con el modo
 * canónico en instancias chicas. Cruza cada solución con el oráculo de invariantes.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine.js');
const I = require('../src/invariantes.js');

/**
 * Instancia acoplada y factible: `nGrupos` grupos matutinos, cada uno con `materias` cargas de
 * `horas` h, repartidas entre `nDocentes` docentes (rotación) con disponibilidad amplia (6 días,
 * 7–14h). El acoplamiento docente×grupo es lo que hace no trivial la búsqueda.
 */
function instanciaMediana(nGrupos, nDocentes, materias = 3, horas = 4) {
  const grupos = {}, docentes = {}, cargas = [];
  const dispFull = {};
  for (let d = 0; d < 6; d++) dispFull[d] = [7, 8, 9, 10, 11, 12, 13, 14];
  for (let t = 0; t < nDocentes; t++) docentes['T' + t] = { disponibilidad: dispFull };
  for (let g = 0; g < nGrupos; g++) {
    const gn = 'G' + g;
    grupos[gn] = { turno: 'matutino' };
    for (let m = 0; m < materias; m++) {
      cargas.push({ grupo: gn, materia: 'M' + m, docente: 'T' + ((g + m) % nDocentes), turno: 'matutino', horas });
    }
  }
  return { grupos, docentes, cargas };
}

function oraculo(datos, horario) {
  const disponibilidad = {};
  for (const d in datos.docentes) disponibilidad[d] = datos.docentes[d].disponibilidad;
  const requeridas = {};
  for (const c of datos.cargas) requeridas[`${c.grupo}|${c.materia}|${c.docente}`] = c.horas;
  return I.verificarTodo({ bloques: horario.bloques, disponibilidad, requeridas });
}

test('resolverFactible · instancia mediana acoplada (8 grupos) resuelta y VÁLIDA', () => {
  const datos = instanciaMediana(8, 6, 3, 4); // 24 cargas
  const r = E.resolverFactible(datos);
  assert.ok(r.ok, 'debe encontrar solución completa');
  assert.equal(r.horario.bloques.length, r.sesiones.length); // todas las sesiones colocadas
  assert.deepEqual(oraculo(datos, r.horario), [], 'la solución debe pasar el oráculo de invariantes');
});

test('resolverFactible · escala a una instancia grande (16 grupos, >150 sesiones) en < 3 s', () => {
  const datos = instanciaMediana(16, 8, 3, 4); // 48 cargas → ~192 sesiones
  const t0 = Date.now();
  const r = E.resolverFactible(datos);
  const ms = Date.now() - t0;
  assert.ok(r.ok, 'debe encontrar solución completa');
  assert.ok(r.sesiones.length > 150, `instancia grande (${r.sesiones.length} sesiones)`);
  assert.equal(r.horario.bloques.length, r.sesiones.length);
  assert.deepEqual(oraculo(datos, r.horario), []);
  assert.ok(ms < 3000, `debe escalar (tardó ${ms} ms para ${r.sesiones.length} sesiones)`);
});

test('resolverFactible · determinista (misma entrada → mismo horario)', () => {
  const datos = instanciaMediana(8, 6, 3, 4);
  assert.deepEqual(E.resolverFactible(datos).horario, E.resolverFactible(datos).horario);
});

test('resolverFactible y resolver coinciden en factibilidad (instancia chica)', () => {
  const datos = instanciaMediana(4, 3, 2, 4);
  assert.equal(E.resolverFactible(datos).ok, true);
  assert.equal(E.resolver(datos).ok, true); // el modo canónico (FC) también la resuelve
});

test('forward-checking · prueba la infactibilidad rápido', () => {
  // 5 grupos comparten un único docente con disponibilidad de un solo día → no caben.
  const datos = {
    grupos: {}, docentes: { Uni: { disponibilidad: { 0: [7, 8] } } }, cargas: [],
  };
  for (let g = 0; g < 5; g++) {
    datos.grupos['G' + g] = { turno: 'matutino' };
    datos.cargas.push({ grupo: 'G' + g, materia: 'M', docente: 'Uni', turno: 'matutino', horas: 1 });
  }
  // Uni solo tiene 2 horas el lunes → no puede dar 5 clases de 1h sin solaparse.
  assert.equal(E.resolverFactible(datos).ok, false);
});
