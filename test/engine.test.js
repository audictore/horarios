/**
 * Pruebas del engine CP — node --test
 *
 * Verifican que el solver: encuentra solución completa y VÁLIDA (cruzada con el oráculo),
 * prueba la infactibilidad cuando no hay solución, integra el preproceso, y satisface la regla
 * de "ambos turnos" por completitud (sin heurística de prioridad).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine.js');
const I = require('../src/invariantes.js');

test('resolver · encuentra solución completa y válida para el oráculo', () => {
  const datos = {
    grupos: { '1A': { turno: 'matutino' } },
    docentes: { Ana: { disponibilidad: { 0: [7, 8, 9, 10], 1: [7, 8, 9, 10] } } },
    cargas: [{ grupo: '1A', materia: 'Mate', docente: 'Ana', turno: 'matutino', horas: 4 }],
  };
  const r = E.resolver(datos);
  assert.ok(r.ok);
  assert.equal(r.horario.bloques.length, r.sesiones.length); // todas las sesiones colocadas
  // Cross-check con el oráculo de invariantes.
  const horario = { bloques: r.horario.bloques, disponibilidad: datos.docentes, requeridas: { '1A|Mate|Ana': 4 } };
  // Adaptar disponibilidad al formato del oráculo (docente → {dia: horas}).
  horario.disponibilidad = { Ana: datos.docentes.Ana.disponibilidad };
  assert.deepEqual(I.verificarTodo(horario), []);
});

test('resolver · PRUEBA la infactibilidad (ok:false) cuando no hay solución', () => {
  // Mate de 2h se parte en [1,1] (dos días), pero AT solo está disponible el lunes → imposible.
  const datos = {
    grupos: { '1A': { turno: 'matutino' } },
    docentes: { AT: { disponibilidad: { 0: [7, 8] } } },
    cargas: [{ grupo: '1A', materia: 'Mate', docente: 'AT', turno: 'matutino', horas: 2 }],
  };
  const r = E.resolver(datos);
  assert.equal(r.ok, false);
  assert.equal(r.horario, null);
});

test('preproceso integrado · una carga de 7h genera el split [4,3]', () => {
  const datos = {
    grupos: { '1A': { turno: 'matutino' } },
    docentes: { Ana: { disponibilidad: {} } },
    cargas: [{ grupo: '1A', materia: 'Mate', docente: 'Ana', turno: 'matutino', horas: 7 }],
  };
  const ses = E.construirSesiones(datos);
  assert.deepEqual(ses.map((s) => s.duracion), [4, 3]); // diasObjetivo(7)=2 → balanced(7,2)
});

test('regla de ambos turnos · automática por completitud (docente AT colocado al 100%)', () => {
  const datos = {
    grupos: { '1A': { turno: 'matutino' }, '8B': { turno: 'vespertino' } },
    docentes: { AT: { disponibilidad: { 0: [7, 8, 16, 17], 1: [7, 8, 16, 17] } } },
    cargas: [
      { grupo: '1A', materia: 'Mate', docente: 'AT', turno: 'matutino', horas: 2 },
      { grupo: '8B', materia: 'Prog', docente: 'AT', turno: 'vespertino', horas: 2 },
    ],
  };
  const r = E.resolver(datos);
  assert.ok(r.ok);
  const colocadasAT = r.horario.bloques.filter((b) => b.docente === 'AT').length;
  const requeridasAT = r.sesiones.filter((s) => s.docente === 'AT').length;
  assert.equal(colocadasAT, requeridasAT); // ninguna sesión de AT sacrificada
});
