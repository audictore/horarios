/**
 * Oráculo de invariantes del horario — From Schedule FI.
 *
 * Verifica que un horario de SALIDA cumpla las 8 invariantes estructurales y de negocio,
 * SIN importar qué motor lo generó (el metaheurístico actual o el futuro engine CP). Opera
 * sobre el horario como artefacto de datos, por lo que es reutilizable de inmediato.
 *
 * Formato del horario (neutral):
 *   {
 *     bloques: [ { grupo, materia, docente, turno, dia, inicio, duracion, horas? }, ... ],
 *     disponibilidad?: { docente: { dia: number[] | Set } },   // habilita INV-4
 *     requeridas?:     { "grupo|materia|docente": horas }       // habilita INV-6
 *   }
 *   dia ∈ 0..5 (lunes..sábado); inicio y duracion en horas enteras; el bloque ocupa
 *   las horas [inicio, inicio+duracion). `horas` es opcional (lista explícita de celdas).
 *
 * Cada chequeo devuelve un arreglo de violaciones (vacío = OK). Una violación trae { id,
 * mensaje, ... } con contexto suficiente para diagnóstico legible.
 *
 * 100% JavaScript, sin dependencias. Compatible con navegador y Node (UMD-lite).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Invariantes = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Ventanas de turno heredadas del sistema actual: matutino [7,15), vespertino [12,20).
  const VENTANAS = { matutino: [7, 15], vespertino: [12, 20] };

  const cargaKey = (b) => `${b.grupo}|${b.materia}|${b.docente}`;
  const finDe = (b) => b.inicio + b.duracion;
  // Dos bloques chocan si caen el mismo día y sus rangos horarios se intersecan.
  const solapan = (a, b) => a.dia === b.dia && a.inicio < finDe(b) && b.inicio < finDe(a);

  /** Detecta solapes entre bloques que comparten el valor de `campo` (grupo o docente). */
  function _solapePor(bloques, campo, id) {
    const viol = [];
    const grupos = new Map();
    for (const b of bloques) {
      if (!grupos.has(b[campo])) grupos.set(b[campo], []);
      grupos.get(b[campo]).push(b);
    }
    for (const [clave, lista] of grupos) {
      for (let i = 0; i < lista.length; i++) {
        for (let j = i + 1; j < lista.length; j++) {
          if (solapan(lista[i], lista[j])) {
            viol.push({ id, mensaje: `Solape de ${campo} "${clave}" el día ${lista[i].dia}`, a: lista[i], b: lista[j] });
          }
        }
      }
    }
    return viol;
  }

  /** INV-1 · Un grupo no puede estar en dos clases a la vez. */
  const noSolapeGrupo = (h) => _solapePor(h.bloques, 'grupo', 'INV-1');

  /** INV-2 · Un docente no puede estar en dos clases a la vez (cruza turnos). */
  const noSolapeDocente = (h) => _solapePor(h.bloques, 'docente', 'INV-2');

  /** INV-3 · Máximo una clase de la misma materia por día para el mismo grupo y docente. */
  function unicidadMateriaDia(h) {
    const viol = [];
    const cuenta = new Map();
    for (const b of h.bloques) {
      const k = `${cargaKey(b)}|d${b.dia}`;
      cuenta.set(k, (cuenta.get(k) || 0) + 1);
    }
    for (const [k, n] of cuenta) {
      if (n > 1) viol.push({ id: 'INV-3', mensaje: `${n} clases de la misma materia el mismo día (${k})` });
    }
    return viol;
  }

  /** INV-4 · Toda clase cae dentro de la disponibilidad declarada del docente. */
  function disponibilidad(h) {
    if (!h.disponibilidad) return []; // sin contexto → no se evalúa
    const viol = [];
    for (const b of h.bloques) {
      const disp = (h.disponibilidad[b.docente] && h.disponibilidad[b.docente][b.dia]) || [];
      const set = disp instanceof Set ? disp : new Set(disp);
      for (let hh = b.inicio; hh < finDe(b); hh++) {
        if (!set.has(hh)) {
          viol.push({ id: 'INV-4', mensaje: `${b.docente} sin disponibilidad el día ${b.dia} a la hora ${hh}`, bloque: b });
          break; // una violación por bloque basta
        }
      }
    }
    return viol;
  }

  /** INV-5 · Cada bloque respeta la ventana horaria de su turno. */
  function ventanaTurno(h) {
    const viol = [];
    for (const b of h.bloques) {
      const v = VENTANAS[b.turno];
      if (!v) { viol.push({ id: 'INV-5', mensaje: `Turno desconocido "${b.turno}"`, bloque: b }); continue; }
      if (b.inicio < v[0] || finDe(b) > v[1]) {
        viol.push({ id: 'INV-5', mensaje: `Bloque fuera de la ventana ${b.turno} [${v[0]},${v[1]}): inicia ${b.inicio}, termina ${finDe(b)}`, bloque: b });
      }
    }
    return viol;
  }

  /** INV-6 · Las horas colocadas de cada carga igualan las requeridas (conservación). */
  function conservacionHoras(h) {
    if (!h.requeridas) return [];
    const viol = [];
    const suma = new Map();
    for (const b of h.bloques) suma.set(cargaKey(b), (suma.get(cargaKey(b)) || 0) + b.duracion);
    for (const carga of Object.keys(h.requeridas)) {
      const req = h.requeridas[carga];
      const col = suma.get(carga) || 0;
      if (col !== req) viol.push({ id: 'INV-6', mensaje: `Carga "${carga}": ${col}h colocadas ≠ ${req}h requeridas` });
    }
    return viol;
  }

  /** INV-7 · Integridad del bloque: ocupa exactamente sus horas consecutivas. */
  function contiguidad(h) {
    const viol = [];
    for (const b of h.bloques) {
      if (!Number.isInteger(b.inicio) || !Number.isInteger(b.duracion) || b.duracion < 1) {
        viol.push({ id: 'INV-7', mensaje: 'inicio/duración inválidos (deben ser enteros, duración ≥ 1)', bloque: b });
        continue;
      }
      if (Array.isArray(b.horas)) {
        const esperadas = [];
        for (let hh = b.inicio; hh < finDe(b); hh++) esperadas.push(hh);
        const got = [...b.horas].sort((x, y) => x - y);
        if (got.length !== esperadas.length || got.some((v, i) => v !== esperadas[i])) {
          viol.push({ id: 'INV-7', mensaje: 'Las horas no son contiguas o no coinciden con inicio/duración', bloque: b });
        }
      }
    }
    return viol;
  }

  /** INV-8 · Los bloques de una misma carga caen en días distintos. */
  function bloquesDiasDistintos(h) {
    const viol = [];
    const porCarga = new Map();
    for (const b of h.bloques) {
      const k = cargaKey(b);
      if (!porCarga.has(k)) porCarga.set(k, new Set());
      const dias = porCarga.get(k);
      if (dias.has(b.dia)) viol.push({ id: 'INV-8', mensaje: `Carga "${k}" con dos bloques el mismo día ${b.dia}` });
      dias.add(b.dia);
    }
    return viol;
  }

  const ORACULOS = [
    noSolapeGrupo, noSolapeDocente, unicidadMateriaDia, disponibilidad,
    ventanaTurno, conservacionHoras, contiguidad, bloquesDiasDistintos,
  ];

  /** Corre toda la batería; devuelve el arreglo plano de violaciones (vacío = horario válido). */
  function verificarTodo(h) {
    return ORACULOS.flatMap((fn) => fn(h));
  }

  return {
    VENTANAS, noSolapeGrupo, noSolapeDocente, unicidadMateriaDia, disponibilidad,
    ventanaTurno, conservacionHoras, contiguidad, bloquesDiasDistintos, verificarTodo,
  };
});
