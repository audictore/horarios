/**
 * Engine CP (programación con restricciones) en JS puro — From Schedule FI.
 *
 * Solver de horarios por backtracking completo. A diferencia del motor metaheurístico actual,
 * es COMPLETO: encuentra una solución si existe, o prueba que no existe. Tres propiedades de
 * diseño (ver docs/arquitectura-csp.md):
 *
 *   1. Canónico / lex-mínimo. Ramifica las sesiones en orden canónico
 *      (grupo, materia, docente, bloque) y prueba los slots en orden ascendente (día, hora).
 *      Un DFS así devuelve SIEMPRE la solución lexicográficamente mínima como primera — es la
 *      solución canónica, reproducible entre corridas y máquinas (UNI-1, UNI-5).
 *   2. Ruptura de simetría. Los bloques de una misma carga se fuerzan en días estrictamente
 *      ascendentes (mata las N! permutaciones equivalentes) (UNI-3).
 *   3. La regla de "ambos turnos" es AUTOMÁTICA. Al ser completo, el engine nunca sacrifica a un
 *      docente de ambos turnos si existe solución: lo coloca por construcción. No necesita la
 *      heurística de prioridad que sí requería el colocador greedy.
 *
 * La unicidad se verifica enumerando soluciones (no-good cut) y filtrando la simetría de grupos
 * idénticos (UNI-2, UNI-4).
 *
 * 100% JavaScript, sin dependencias externas. Reusa src/preproceso.js. Navegador + Node (UMD-lite).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Engine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const P = (typeof module !== 'undefined' && module.exports)
    ? require('./preproceso.js')
    : (typeof globalThis !== 'undefined' ? globalThis.Preproceso : undefined);
  const C = (typeof module !== 'undefined' && module.exports)
    ? require('./calidad.js')
    : (typeof globalThis !== 'undefined' ? globalThis.Calidad : undefined);

  const VENTANAS = { matutino: [7, 15], vespertino: [12, 20] };
  const CAP_ENUM = 100000; // tope de seguridad para la enumeración exhaustiva

  /**
   * Días de asistencia de un docente según su PERFIL (no se aplica el escalón del PA a todos):
   *   tipo 2 (PA)                       → escalón de carga (diasObjetivo).
   *   tipo 1/3/4 (Inglés/PTC/Técnico)   → "según disponibilidad": usa todos sus días disponibles.
   * Default tipo = 2 (PA) por compatibilidad con datos que no declaran perfil.
   */
  function diasDeDocente(datos, docente, total) {
    const info = (datos.docentes && datos.docentes[docente]) || {};
    if ((info.tipo || 2) === 2) return P.diasObjetivo(total);
    const disp = info.disponibilidad || {};
    let n = 0;
    for (const k in disp) {
      const h = disp[k];
      if ((h instanceof Set ? h.size : (h ? h.length : 0)) > 0) n++;
    }
    return Math.max(1, Math.min(6, n));
  }

  // --- Preproceso: cargas → sesiones de duración fija ---
  function construirSesiones(datos, opciones) {
    const op = opciones || {};
    const durMax = op.durMax || 4, durMin = op.durMin || 1;
    const cargas = datos.cargas || [];
    const totalDoc = new Map();
    for (const c of cargas) totalDoc.set(c.docente, (totalDoc.get(c.docente) || 0) + c.horas);

    const sesiones = [];
    for (const c of cargas) {
      // Una carga con `sync` (p. ej. inglés simultáneo de un cuatrimestre) se parte en bloques de
      // 1h para poder sincronizar hora a hora entre grupos; el resto usa el split balanceado.
      const split = c.sync
        ? Array.from({ length: c.horas }, () => 1)
        : P.generarSplit(c.horas, diasDeDocente(datos, c.docente, totalDoc.get(c.docente)), { durMax, durMin });
      split.forEach((dur, k) => {
        sesiones.push({
          grupo: c.grupo, materia: c.materia, docente: c.docente, turno: c.turno,
          duracion: dur, carga: `${c.grupo}|${c.materia}|${c.docente}`, bloque: k,
          sync: c.sync || null, // bloques con el mismo (sync, bloque) deben ir a la misma hora
        });
      });
    }
    return sesiones;
  }

  /** Orden canónico de ramificación: garantiza determinismo y lex-minimalidad. */
  function ordenarCanonico(sesiones) {
    return sesiones.slice().sort((a, b) =>
      a.grupo.localeCompare(b.grupo) || a.materia.localeCompare(b.materia) ||
      a.docente.localeCompare(b.docente) || a.bloque - b.bloque);
  }

  /** Dominio estático de una sesión: slots (día, inicio) que respetan ventana + disponibilidad. */
  function dominio(sesion, datos, opciones) {
    const ventanas = (opciones && opciones.ventanas) || VENTANAS;
    const v = ventanas[sesion.turno] || [0, 0];
    const disp = (datos.docentes[sesion.docente] && datos.docentes[sesion.docente].disponibilidad) || {};
    const slots = [];
    for (let dia = 0; dia < 6; dia++) {
      const horas = disp[dia];
      if (!horas) continue;
      const set = horas instanceof Set ? horas : new Set(horas);
      for (let inicio = v[0]; inicio + sesion.duracion <= v[1]; inicio++) {
        let ok = true;
        for (let h = inicio; h < inicio + sesion.duracion; h++) if (!set.has(h)) { ok = false; break; }
        if (ok) slots.push({ dia, inicio });
      }
    }
    slots.sort((a, b) => a.dia - b.dia || a.inicio - b.inicio);
    return slots;
  }

  // --- Solver DFS con forward-checking ---
  // El forward-checking poda los dominios de las sesiones no asignadas en cuanto se fija una
  // sesión; si un dominio queda vacío, retrocede de inmediato (en vez de descubrirlo al fondo del
  // árbol). Es la diferencia entre un solver de juguete y uno que escala.
  //
  // Selección de variable (conmutable, resuelve la tensión velocidad↔canonicidad):
  //   'canonico' — orden fijo (grupo, materia, docente, bloque) + valor ascendente ⇒ la 1ª
  //                solución es la lex-mínima. El forward-checking NO altera el orden de
  //                exploración, solo poda ramas muertas, así que la lex-minimalidad se conserva.
  //   'mrv'      — Minimum Remaining Values (fail-first): ramifica sobre la sesión con menos
  //                slots vivos. Mucho más rápido, pero la 1ª solución ya no es lex-mínima.
  function crearSolver(datos, opciones) {
    const sesiones = ordenarCanonico(construirSesiones(datos, opciones));
    const dominios = sesiones.map((s) => dominio(s, datos, opciones));
    const n = sesiones.length;

    const solapan = (sa, ra, sb, rb) =>
      ra.dia === rb.dia && ra.inicio < rb.inicio + sb.duracion && rb.inicio < ra.inicio + sa.duracion;

    /** ¿El slot `sj` de la sesión `j` es compatible con la sesión `i` ya fijada en `si`? */
    function compatible(i, si, j, sj) {
      const a = sesiones[i], b = sesiones[j];
      if (a.docente === b.docente && solapan(a, si, b, sj)) return false; // no-solape docente
      if (a.grupo === b.grupo && solapan(a, si, b, sj)) return false;     // no-solape grupo
      if (a.carga === b.carga) {                                          // misma carga:
        if (a.sync) {
          // Inglés: orden ascendente por (día, hora). Puede tener VARIOS bloques el mismo día
          // (p. ej. 2h seguidas), por eso se ordena por tiempo, no se exige día distinto.
          const ta = si.dia * 100 + si.inicio, tb = sj.dia * 100 + sj.inicio;
          if (b.bloque > a.bloque && tb <= ta) return false;
          if (b.bloque < a.bloque && tb >= ta) return false;
        } else {
          if (b.bloque > a.bloque && sj.dia <= si.dia) return false;      //   días ascendentes
          if (b.bloque < a.bloque && sj.dia >= si.dia) return false;      //   (⇒ distintos)
        }
      }
      // Sincronización (inglés simultáneo): bloques con el mismo (sync, índice de bloque) — en
      // grupos distintos del mismo cuatrimestre — deben ir EXACTAMENTE a la misma hora.
      if (a.sync && a.sync === b.sync && a.bloque === b.bloque) {
        if (si.dia !== sj.dia || si.inicio !== sj.inicio) return false;
      }
      return true;
    }

    const selCanonico = (asignado) => { for (let i = 0; i < n; i++) if (!asignado[i]) return i; return -1; };
    // MRV con PRIORIDAD de inglés: el inglés (sync) es el esqueleto más restringido (profes con
    // holgura casi nula + simultaneidad), así que se coloca PRIMERO; entre iguales, menor dominio
    // (fail-first). Esto implementa la regla institucional "el inglés tiene prioridad" y evita que
    // el solver llene los slots forzados del inglés con otras materias y luego retroceda en masa.
    const selMRV = (asignado, dom) => {
      let best = -1, size = Infinity, bestSync = false;
      for (let i = 0; i < n; i++) {
        if (asignado[i]) continue;
        const isSync = !!sesiones[i].sync;
        const mejor = best === -1
          || (isSync && !bestSync)                          // inglés supera a no-inglés
          || (isSync === bestSync && dom[i].length < size); // misma clase → menor dominio
        if (mejor) { best = i; size = dom[i].length; bestSync = isSync; }
      }
      return best;
    };

    /** Enumera hasta `limite` soluciones con forward-checking. `modo`: 'canonico' | 'mrv'.
     *  `maxNodos` (opcional) corta la búsqueda tras N nodos y marca `soluciones.agotado = true`,
     *  para no colgarse en instancias muy duras (devuelve lo hallado, sin probar infactibilidad). */
    function buscar(limite, modo, maxNodos) {
      const soluciones = [];
      soluciones.agotado = false;
      const asign = new Array(n).fill(null);
      const asignado = new Array(n).fill(false);
      const dom = dominios.map((d) => d.slice()); // dominios vivos (mutables, se podan/restauran)
      let nAsig = 0, nodos = 0;

      function dfs() {
        if (maxNodos && ++nodos > maxNodos) { soluciones.agotado = true; return true; } // presupuesto agotado
        if (nAsig === n) {
          soluciones.push({
            bloques: sesiones.map((s, i) => ({
              grupo: s.grupo, materia: s.materia, docente: s.docente, turno: s.turno,
              dia: asign[i].dia, inicio: asign[i].inicio, duracion: s.duracion,
            })),
          });
          return soluciones.length >= limite;
        }
        const i = modo === 'mrv' ? selMRV(asignado, dom) : selCanonico(asignado);

        for (const slot of dom[i]) {
          asign[i] = slot; asignado[i] = true; nAsig++;

          // Forward-checking: podar dominios de las no asignadas; registrar para deshacer.
          const undo = [];
          let wipeout = false;
          for (let j = 0; j < n; j++) {
            if (asignado[j]) continue;
            const old = dom[j];
            let filt = null;
            for (let k = 0; k < old.length; k++) {
              if (compatible(i, slot, j, old[k])) { if (filt) filt.push(old[k]); }
              else if (!filt) filt = old.slice(0, k); // primer incompatible → copiar prefijo vivo
            }
            if (filt) { dom[j] = filt; undo.push([j, old]); if (filt.length === 0) { wipeout = true; break; } }
          }

          let stop = false;
          if (!wipeout) stop = dfs();

          for (const u of undo) dom[u[0]] = u[1]; // restaurar dominios
          asign[i] = null; asignado[i] = false; nAsig--;
          if (stop) return true;
        }
        return false;
      }

      dfs();
      return soluciones;
    }

    return { sesiones, dominios, buscar };
  }

  /** Solución CANÓNICA (lex-mínima, reproducible) o ok:false si es infactible. */
  function resolver(datos, opciones) {
    const solver = crearSolver(datos, opciones);
    const sol = solver.buscar(1, 'canonico');
    return sol.length === 0
      ? { ok: false, horario: null, sesiones: solver.sesiones }
      : { ok: true, horario: sol[0], sesiones: solver.sesiones };
  }

  /** Solución FACTIBLE rápida (MRV + forward-checking) — escala a datasets grandes. No lex-mínima.
   *  `opciones.maxNodos` acota la búsqueda; si se agota, devuelve ok:false con agotado:true. */
  function resolverFactible(datos, opciones) {
    const solver = crearSolver(datos, opciones);
    const sol = solver.buscar(1, 'mrv', (opciones || {}).maxNodos);
    return sol.length === 0
      ? { ok: false, horario: null, sesiones: solver.sesiones, agotado: !!sol.agotado }
      : { ok: true, horario: sol[0], sesiones: solver.sesiones, agotado: false };
  }

  /** Enumera hasta `limite` soluciones canónicas (para verificación de unicidad). */
  function enumerar(datos, opciones, limite) {
    return crearSolver(datos, opciones).buscar(limite || 2, 'canonico');
  }

  // --- Calidad: mejora por búsqueda local sobre una solución válida ---
  // Hill-climbing de primera mejora: reubica un bloque a otro slot de su dominio SOLO si el
  // movimiento es válido (sin solapes, días distintos por carga) y mejora la calidad del grupo
  // afectado (menos huecos; a igualdad, menos desbalance). Parte de una solución factible, así que
  // la validez se conserva siempre. Es heurístico: converge a un óptimo local, no global.
  function optimizarCalidad(sesiones, dominios, asign, opciones) {
    const n = sesiones.length;
    const maxPasadas = (opciones && opciones.maxPasadas) || 50;

    const idxPorGrupo = new Map();
    sesiones.forEach((s, i) => { if (!idxPorGrupo.has(s.grupo)) idxPorGrupo.set(s.grupo, []); idxPorGrupo.get(s.grupo).push(i); });

    const bloqueDe = (i, slot) => ({
      grupo: sesiones[i].grupo, materia: sesiones[i].materia, docente: sesiones[i].docente,
      turno: sesiones[i].turno, dia: slot.dia, inicio: slot.inicio, duracion: sesiones[i].duracion,
    });
    // Métricas del grupo de la sesión `i`, opcionalmente con `i` reubicada en `slot`.
    const metricasGrupoDe = (i, slot) =>
      C.metricasGrupo(idxPorGrupo.get(sesiones[i].grupo).map((k) => bloqueDe(k, (k === i && slot) ? slot : asign[k])));

    const solapan2 = (du1, r1, du2, r2) => r1.dia === r2.dia && r1.inicio < r2.inicio + du2 && r2.inicio < r1.inicio + du1;
    function moverValido(i, slot) {
      const si = sesiones[i];
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const sj = sesiones[j], rj = asign[j];
        if (si.docente === sj.docente && solapan2(si.duracion, slot, sj.duracion, rj)) return false;
        if (si.grupo === sj.grupo && solapan2(si.duracion, slot, sj.duracion, rj)) return false;
        if (si.carga === sj.carga && slot.dia === rj.dia) return false; // un bloque por carga por día
      }
      return true;
    }

    for (let pasada = 0; pasada < maxPasadas; pasada++) {
      let mejoro = false;
      for (let i = 0; i < n; i++) {
        if (sesiones[i].sync) continue; // los bloques sincronizados (inglés simultáneo) no se mueven
        const actual = metricasGrupoDe(i, null);
        for (const slot of dominios[i]) {
          if (slot.dia === asign[i].dia && slot.inicio === asign[i].inicio) continue;
          if (!moverValido(i, slot)) continue;
          if (C.compararCalidad(metricasGrupoDe(i, slot), actual) < 0) { asign[i] = slot; mejoro = true; break; }
        }
      }
      if (!mejoro) break;
    }
    return asign;
  }

  /**
   * Resuelve y MEJORA la calidad: solución factible rápida (MRV+FC) + búsqueda local que reduce
   * huecos de los grupos (y, a igualdad, el desbalance diario). Devuelve además la calidad inicial
   * y final para poder mostrar la mejora.
   */
  function resolverConCalidad(datos, opciones) {
    const solver = crearSolver(datos, opciones);
    const sol = solver.buscar(1, 'mrv');
    if (!sol.length) return { ok: false, horario: null, sesiones: solver.sesiones, calidad: null };

    const calidadInicial = C.evaluarCalidad(sol[0]);
    const asign = sol[0].bloques.map((b) => ({ dia: b.dia, inicio: b.inicio }));
    optimizarCalidad(solver.sesiones, solver.dominios, asign, opciones);

    const horario = {
      bloques: solver.sesiones.map((s, i) => ({
        grupo: s.grupo, materia: s.materia, docente: s.docente, turno: s.turno,
        dia: asign[i].dia, inicio: asign[i].inicio, duracion: s.duracion,
      })),
    };
    return { ok: true, horario, sesiones: solver.sesiones, calidad: C.evaluarCalidad(horario), calidadInicial };
  }

  // --- Simetría de grupos idénticos (mismas materias y horas) ---
  function firmaGrupo(datos, grupo) {
    return (datos.cargas || []).filter((c) => c.grupo === grupo)
      .map((c) => `${c.materia}|${c.horas}`).sort().join(';');
  }

  /** Grupos agrupados por firma idéntica (solo buckets con ≥2 → candidatos a simetría). */
  function bucketsIdenticos(datos) {
    const grupos = [...new Set((datos.cargas || []).map((c) => c.grupo))];
    const m = new Map();
    for (const g of grupos) {
      const f = firmaGrupo(datos, g);
      if (!m.has(f)) m.set(f, []);
      m.get(f).push(g);
    }
    return [...m.values()].filter((arr) => arr.length > 1).map((arr) => arr.slice().sort());
  }

  const lexCmp = (a, b) => {
    const min = Math.min(a.length, b.length);
    for (let i = 0; i < min; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return a.length - b.length;
  };

  /** Clave de un grupo: sus horas-de-inicio linealizadas, ordenadas. */
  const claveGrupo = (horario, grupo) => horario.bloques
    .filter((b) => b.grupo === grupo).map((b) => b.dia * 24 + b.inicio).sort((x, y) => x - y);

  /** Clave global canónica: vector de inicios en orden canónico de sesiones (para UNI-5). */
  const claveGlobal = (horario) => horario.bloques.slice().sort((a, b) =>
    a.grupo.localeCompare(b.grupo) || a.materia.localeCompare(b.materia) ||
    a.docente.localeCompare(b.docente) || a.dia - b.dia).map((b) => b.dia * 24 + b.inicio);

  /** Una solución es canónica si los grupos idénticos respetan el orden lexicográfico por nombre. */
  function esCanonicoGrupos(horario, buckets) {
    for (const grupos of buckets) {
      for (let i = 1; i < grupos.length; i++) {
        if (lexCmp(claveGrupo(horario, grupos[i - 1]), claveGrupo(horario, grupos[i])) > 0) return false;
      }
    }
    return true;
  }

  /**
   * Verifica la unicidad: enumera todas las soluciones y descarta las que solo difieren por una
   * permutación de grupos idénticos. unica === true equivale a que el no-good cut da INFEASIBLE.
   */
  function verificarUnicidad(datos, opciones) {
    const buckets = bucketsIdenticos(datos);
    const todas = crearSolver(datos, opciones).buscar(CAP_ENUM, 'canonico');
    const canonicas = buckets.length ? todas.filter((h) => esCanonicoGrupos(h, buckets)) : todas;
    return { unica: canonicas.length === 1, total: canonicas.length, soluciones: canonicas.slice(0, 3) };
  }

  return {
    VENTANAS, construirSesiones, diasDeDocente, resolver, resolverFactible, resolverConCalidad,
    optimizarCalidad, enumerar, verificarUnicidad,
    bucketsIdenticos, firmaGrupo, claveGrupo, claveGlobal, lexCmp,
  };
});
