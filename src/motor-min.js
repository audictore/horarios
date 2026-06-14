/**
 * Motor mínimo de emplazamiento — From Schedule FI.
 *
 * Colocador greedy que sirve para dos cosas: (1) ser la SEMILLA del futuro engine CP en JS, y
 * (2) demostrar de forma comprobable la regla institucional crítica: los docentes con grupos en
 * AMBOS turnos (matutino y vespertino) reciben la prioridad de colocación más alta, por ser el
 * recurso más restringido.
 *
 * La estrategia de la cola es conmutable a propósito:
 *   - 'naive'     → coloca en el orden de entrada (SIN la regla). Bajo escasez, sacrifica al
 *                   docente de ambos turnos.
 *   - 'prioridad' → coloca primero los bloques de docentes de ambos turnos (CON la regla).
 * Esto permite escribir un failing test (BT-3) que falla sin la regla y pasa con ella —
 * probando que la regla está activa, no solo que "no estorba".
 *
 * 100% JavaScript, sin dependencias. Compatible con navegador y Node (UMD-lite).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MotorMin = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VENTANAS = { matutino: [7, 15], vespertino: [12, 20] };

  /** Mapa docente → conjunto de turnos en que tiene carga (para detectar "ambos turnos"). */
  function turnosPorDocente(sesiones) {
    const m = new Map();
    for (const s of sesiones) {
      if (!m.has(s.docente)) m.set(s.docente, new Set());
      m.get(s.docente).add(s.turno);
    }
    return m;
  }

  const esAmbosTurnos = (docente, mapa) => ((mapa.get(docente) && mapa.get(docente).size) || 0) >= 2;

  /**
   * Cola con la regla institucional: bloques de docentes con ambos turnos primero.
   * Orden estable (preserva el orden original dentro de cada grupo de prioridad).
   */
  function colaPrioridad(sesiones) {
    const turnos = turnosPorDocente(sesiones);
    return sesiones
      .map((s, i) => ({ s, i, at: esAmbosTurnos(s.docente, turnos) ? 0 : 1 }))
      .sort((a, b) => a.at - b.at || a.i - b.i)
      .map((x) => x.s);
  }

  function _disp(disponibilidad, docente, dia) {
    const d = disponibilidad[docente] && disponibilidad[docente][dia];
    return d instanceof Set ? d : new Set(d || []);
  }

  /**
   * Coloca las sesiones de forma greedy en el primer slot factible (día y hora ascendentes).
   * Respeta: ventana de turno, disponibilidad del docente, no-solape de docente y de grupo, y
   * un bloque de la misma carga por día. Devuelve { bloques (colocados), fallidos (sin lugar) }.
   *
   * opciones.estrategia: 'naive' | 'prioridad' (por defecto 'prioridad').
   */
  function colocar(sesiones, disponibilidad, opciones) {
    const estrategia = (opciones && opciones.estrategia) || 'prioridad';
    const ventanas = (opciones && opciones.ventanas) || VENTANAS;
    const cola = estrategia === 'prioridad' ? colaPrioridad(sesiones) : sesiones.slice();

    const bloques = [];
    const fallidos = [];
    const ocupadoDoc = new Map(); // docente → bloques colocados
    const ocupadoGrp = new Map(); // grupo   → bloques colocados
    const diasCarga = new Map();  // "grupo|materia|docente" → Set(días usados)
    const key = (s) => `${s.grupo}|${s.materia}|${s.docente}`;

    const libre = (mapa, clave, dia, inicio, dur) => {
      const lst = mapa.get(clave) || [];
      return !lst.some((x) => x.dia === dia && inicio < x.inicio + x.duracion && x.inicio < inicio + dur);
    };

    for (const s of cola) {
      const ventana = ventanas[s.turno] || [0, 0];
      const v0 = ventana[0];
      const v1 = ventana[1];
      let colocado = null;

      for (let dia = 0; dia < 6 && !colocado; dia++) {
        const usados = diasCarga.get(key(s));
        if (usados && usados.has(dia)) continue; // un bloque de la carga por día
        const disp = _disp(disponibilidad, s.docente, dia);

        for (let inicio = v0; inicio + s.duracion <= v1 && !colocado; inicio++) {
          let dispOK = true;
          for (let hh = inicio; hh < inicio + s.duracion; hh++) {
            if (!disp.has(hh)) { dispOK = false; break; }
          }
          if (!dispOK) continue;
          if (!libre(ocupadoDoc, s.docente, dia, inicio, s.duracion)) continue;
          if (!libre(ocupadoGrp, s.grupo, dia, inicio, s.duracion)) continue;
          colocado = {
            grupo: s.grupo, materia: s.materia, docente: s.docente,
            turno: s.turno, dia, inicio, duracion: s.duracion,
          };
        }
      }

      if (colocado) {
        bloques.push(colocado);
        if (!ocupadoDoc.has(s.docente)) ocupadoDoc.set(s.docente, []);
        ocupadoDoc.get(s.docente).push(colocado);
        if (!ocupadoGrp.has(s.grupo)) ocupadoGrp.set(s.grupo, []);
        ocupadoGrp.get(s.grupo).push(colocado);
        if (!diasCarga.has(key(s))) diasCarga.set(key(s), new Set());
        diasCarga.get(key(s)).add(colocado.dia);
      } else {
        fallidos.push(s);
      }
    }

    return { bloques, fallidos };
  }

  return { VENTANAS, turnosPorDocente, esAmbosTurnos, colaPrioridad, colocar };
});
