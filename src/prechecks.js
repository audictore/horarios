/**
 * Pre-checks de capacidad (Nivel 1) — From Schedule FI.
 *
 * Condiciones NECESARIAS que se evalúan ANTES de generar el horario. Atrapan la gran mayoría de
 * los errores de captura de datos con costo nulo y, sobre todo, **nombrando al culpable** (docente,
 * grupo o materia). Un INFEASIBLE jamás debe llegar al usuario como "no se pudo": o se señala el
 * dato (Nivel 1, aquí) o se aísla el conflicto mínimo (Nivel 2 / IIS, que requiere el solver).
 *
 * Importante: son condiciones NECESARIAS, no suficientes. Que un dataset pase el Nivel 1 no
 * garantiza factibilidad; las infactibilidades por interacción (varias clases compitiendo por el
 * único slot común) son del solver. Eso es deliberado y se prueba en INF-5.
 *
 * 100% JavaScript, sin dependencias externas. Reusa src/preproceso.js. Compatible navegador + Node.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Prechecks = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Reusa el preproceso (días, split balanceado, banda de N).
  const P = (typeof module !== 'undefined' && module.exports)
    ? require('./preproceso.js')
    : (typeof globalThis !== 'undefined' ? globalThis.Preproceso : undefined);

  const VENTANAS = { matutino: [7, 15], vespertino: [12, 20] };

  const enVentanas = (h, ventanas) => ventanas.some((v) => h >= v[0] && h < v[1]);

  /** Cuenta las horas disponibles que caen dentro de alguna ventana de turno. */
  function contarDisp(disp, ventanas) {
    let n = 0;
    for (const dia in disp) for (const h of disp[dia]) if (enVentanas(h, ventanas)) n++;
    return n;
  }

  /** Mayor racha de horas contiguas disponibles (dentro de ventana) en cualquier día. */
  function maxRacha(disp, ventanas) {
    let best = 0;
    for (const dia in disp) {
      const hrs = [...disp[dia]].filter((h) => enVentanas(h, ventanas)).sort((a, b) => a - b);
      let run = 0, prev = null;
      for (const h of hrs) {
        run = (prev !== null && h === prev + 1) ? run + 1 : 1;
        prev = h;
        if (run > best) best = run;
      }
    }
    return best;
  }

  /**
   * Evalúa todas las condiciones necesarias. Devuelve un arreglo de problemas (vacío = pasa
   * el Nivel 1). Cada problema trae { id, mensaje, ...quién }.
   *
   * datos = {
   *   grupos:    { nombre: { turno } },
   *   docentes:  { nombre: { disponibilidad: { dia: horas[] } } },
   *   cargas:    [ { grupo, materia, docente, turno, horas } ],
   *   ingles?:   [ { grado, grupos:[], docente, turno, horas } ]
   * }
   */
  function verificarCapacidad(datos, opciones) {
    const op = opciones || {};
    const ventanas = op.ventanas || VENTANAS;
    const diasHabiles = op.diasHabiles || 6;
    const durMax = op.durMax || 4;
    const durMin = op.durMin || 1;

    const problemas = [];
    const cargas = datos.cargas || [];
    const docentes = datos.docentes || {};
    const grupos = datos.grupos || {};

    // Agregados.
    const porDoc = new Map();   // docente → { total, turnos:Set, cargas:[] }
    const porGrupo = new Map(); // grupo   → horas totales
    for (const c of cargas) {
      if (!porDoc.has(c.docente)) porDoc.set(c.docente, { total: 0, turnos: new Set(), cargas: [] });
      const e = porDoc.get(c.docente);
      e.total += c.horas; e.turnos.add(c.turno); e.cargas.push(c);
      porGrupo.set(c.grupo, (porGrupo.get(c.grupo) || 0) + c.horas);
    }

    // INF-1 (carga vs disponibilidad) e INF-4 (bloque vs franja contigua), por docente.
    for (const [doc, e] of porDoc) {
      const disp = (docentes[doc] && docentes[doc].disponibilidad) || {};
      const ventanasUsadas = [...e.turnos].map((t) => ventanas[t]).filter(Boolean);

      const dispHoras = contarDisp(disp, ventanasUsadas);
      if (e.total > dispHoras) {
        problemas.push({ id: 'INF-1', docente: doc, mensaje: `Docente "${doc}": ${e.total}h de carga > ${dispHoras}h disponibles en su turno` });
      }

      const racha = maxRacha(disp, ventanasUsadas);
      // Días de asistencia por PERFIL: PA (tipo 2) → escalón; resto → según disponibilidad.
      const tipo = ((datos.docentes[doc] || {}).tipo) || 2;
      let nDiasDisp = 0; for (const k in disp) if ((disp[k] || []).length) nDiasDisp++;
      const dias = tipo === 2 ? P.diasObjetivo(e.total) : Math.max(1, Math.min(6, nDiasDisp));
      for (const c of e.cargas) {
        if (c.sync) continue; // inglés simultáneo: bloques de 1h (siempre caben); lo valida el engine
        let split;
        try {
          split = P.generarSplit(c.horas, dias, { durMax, durMin });
        } catch (err) {
          // elegirN lanza cuando la materia no cabe en los días con el tope de horas → INF-4.
          problemas.push({ id: 'INF-4', docente: doc, carga: `${c.grupo}|${c.materia}|${c.docente}`, mensaje: `Materia "${c.materia}" (${c.horas}h) no cabe en ${dias} días con bloques ≤ ${durMax}h` });
          continue;
        }
        const maxBloque = Math.max(...split);
        if (maxBloque > racha) {
          problemas.push({ id: 'INF-4', docente: doc, carga: `${c.grupo}|${c.materia}|${c.docente}`, mensaje: `Bloque de ${maxBloque}h de "${c.materia}" > mayor franja contigua (${racha}h) de "${doc}"` });
        }
      }
    }

    // INF-2 (grupo vs capacidad de su ventana).
    for (const [g, total] of porGrupo) {
      const turno = (grupos[g] && grupos[g].turno) || 'matutino';
      const v = ventanas[turno] || [0, 0];
      const cap = (v[1] - v[0]) * diasHabiles;
      if (total > cap) {
        problemas.push({ id: 'INF-2', grupo: g, mensaje: `Grupo "${g}": ${total}h > capacidad ${cap}h (${v[1] - v[0]}h × ${diasHabiles} días) del turno ${turno}` });
      }
    }

    // INF-3 (inglés simultáneo: el docente debe tener al menos las horas requeridas en la ventana).
    for (const ing of (datos.ingles || [])) {
      const disp = (docentes[ing.docente] && docentes[ing.docente].disponibilidad) || {};
      const v = ventanas[ing.turno] || [0, 0];
      const dispHoras = contarDisp(disp, [v]);
      if (dispHoras < ing.horas) {
        problemas.push({ id: 'INF-3', grado: ing.grado, mensaje: `Inglés grado ${ing.grado}: docente "${ing.docente}" con ${dispHoras}h en ventana ${ing.turno} < ${ing.horas}h requeridas (sin franja común)` });
      }
    }

    return problemas;
  }

  return { VENTANAS, contarDisp, maxRacha, verificarCapacidad };
});
