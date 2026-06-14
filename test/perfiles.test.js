/**
 * Perfiles de docente — node --test
 *
 * Verifica que los días de asistencia (y por tanto el split de cada materia) se calculan según el
 * PERFIL del docente, no aplicando el escalón del PA a todos:
 *   PER-1 Inglés (tipo 1) · PER-2 PTC (tipo 3) · PER-3 Técnico/Director (tipo 4) · PER-4 PA (tipo 2)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine.js');

const dur = (ses, materia) => ses.filter((s) => s.materia === materia).map((s) => s.duracion);
const dispDias = (...dias) => { const d = {}; for (const k of dias) d[k] = [7, 8, 9, 10]; return d; };

test('PER-4 · PA: días por escalón de carga (carga 12 → 3 días → split de 6h = [2,2,2])', () => {
  const datos = {
    grupos: { '1A': { turno: 'matutino' } },
    docentes: { Pa: { tipo: 2, disponibilidad: dispDias(0, 1, 2, 3, 4) } },
    cargas: [
      { grupo: '1A', materia: 'Mate', docente: 'Pa', turno: 'matutino', horas: 6 },
      { grupo: '1A', materia: 'Hist', docente: 'Pa', turno: 'matutino', horas: 6 }, // total 12 → escalón 3
    ],
  };
  assert.equal(E.diasDeDocente(datos, 'Pa', 12), 3);
  assert.deepEqual(dur(E.construirSesiones(datos), 'Mate'), [2, 2, 2]); // 3 bloques, no importa la disponibilidad
});

test('PER-2 · PTC: según disponibilidad (5 días → split de 6h = [2,1,1,1,1])', () => {
  const datos = {
    grupos: { '1A': { turno: 'matutino' } },
    docentes: { Ptc: { tipo: 3, disponibilidad: dispDias(0, 1, 2, 3, 4) } }, // 5 días disponibles
    cargas: [{ grupo: '1A', materia: 'Mate', docente: 'Ptc', turno: 'matutino', horas: 6 }],
  };
  assert.equal(E.diasDeDocente(datos, 'Ptc', 6), 5);
  assert.deepEqual(dur(E.construirSesiones(datos), 'Mate'), [2, 1, 1, 1, 1]); // se reparte en sus 5 días

  // El MISMO PTC, pero disponible solo 2 días → la materia se concentra en [3,3].
  const datos2 = { ...datos, docentes: { Ptc: { tipo: 3, disponibilidad: dispDias(0, 1) } } };
  assert.equal(E.diasDeDocente(datos2, 'Ptc', 6), 2);
  assert.deepEqual(dur(E.construirSesiones(datos2), 'Mate'), [3, 3]);
});

test('PER-3 · Técnico/Director: toda la semana disponible, carga baja → reparto amplio', () => {
  const datos = {
    grupos: { '1A': { turno: 'matutino' } },
    docentes: { Tec: { tipo: 4, disponibilidad: dispDias(0, 1, 2, 3, 4, 5) } }, // 6 días
    cargas: [{ grupo: '1A', materia: 'Taller', docente: 'Tec', turno: 'matutino', horas: 4 }],
  };
  assert.equal(E.diasDeDocente(datos, 'Tec', 4), 6);
  assert.deepEqual(dur(E.construirSesiones(datos), 'Taller'), [1, 1, 1, 1]); // 4h en 4 días de 1h
});

test('PER-1 · Inglés: cargas con sync se parten en bloques de 1h (independiente del perfil)', () => {
  const datos = {
    grupos: { '2A': { turno: 'matutino' } },
    docentes: { Ing: { tipo: 1, disponibilidad: dispDias(0, 1, 2) } },
    cargas: [{ grupo: '2A', materia: 'Ingles', docente: 'Ing', turno: 'matutino', horas: 3, sync: 'INGLES|2' }],
  };
  assert.deepEqual(dur(E.construirSesiones(datos), 'Ingles'), [1, 1, 1]);
});

test('compatibilidad · docente sin `tipo` declarado se trata como PA (escalón)', () => {
  const datos = {
    grupos: { '1A': { turno: 'matutino' } },
    docentes: { X: { disponibilidad: dispDias(0, 1, 2, 3, 4) } }, // sin tipo
    cargas: [{ grupo: '1A', materia: 'Mate', docente: 'X', turno: 'matutino', horas: 6 }],
  };
  assert.equal(E.diasDeDocente(datos, 'X', 6), 2); // diasObjetivo(6) = 2 (escalón PA), no 5
  assert.deepEqual(dur(E.construirSesiones(datos), 'Mate'), [3, 3]);
});
