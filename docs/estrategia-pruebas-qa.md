# Estrategia de Pruebas y Validación de Reglas de Negocio (@qa)

> **Proyecto:** *From Schedule FI* — generador de horarios escolares.
> **Documento:** plan de verificación para el motor CSP/CP-SAT descrito en
> [`arquitectura-csp.md`](arquitectura-csp.md).
> **Misión QA:** destruir el código probando casos límite y asegurar que las reglas
> institucionales se cumplen **sin excepciones**, con énfasis en (a) la **prioridad máxima de
> docentes con ambos turnos** y (b) la **unicidad** de la solución.

---

## 0. Estado y honestidad de alcance

> **Pila de pruebas: 100% JavaScript** — runner nativo `node --test` (`node:test` + `node:assert`),
> sin Jest ni pytest ni `npm install`. Coherente con el proyecto vanilla JS.
>
> **Estado actual (suite total: 70/70 verde con `node --test`):**
> - ✅ **Preproceso implementado y probado.** `src/preproceso.js` (`balanced`, `diasObjetivo`,
>   `bandaN`, `elegirN`, `generarSplit`) + `test/preproceso.test.js` — **9/9**. Cubre `SPL-1..6`,
>   `DIA-1..5`.
> - ✅ **Oráculo de invariantes implementado y probado.** `src/invariantes.js` (`verificarTodo` y
>   los 8 chequeos) + `test/invariantes.test.js` — **10/10**. Cubre `INV-1..8`. **Agnóstico al
>   motor**: opera sobre el horario de salida, por lo que ya es usable contra el motor
>   metaheurístico actual.
> - ✅ **Regla institucional de ambos turnos probada.** `src/motor-min.js` (colocador greedy con
>   estrategia conmutable `naive`/`prioridad`, semilla del futuro engine) + `test/ambos-turnos.test.js`
>   — **6/6**. Cubre `BT-1..6`, incluido el *failing test* dirigido `BT-3`: el motor `naive`
>   sacrifica al docente de ambos turnos y el de `prioridad` lo protege (demuestra que la regla
>   está activa, no solo que "no estorba").
> - ✅ **Pre-checks de inviabilidad (Nivel 1) probados.** `src/prechecks.js` (`verificarCapacidad`,
>   reusa `preproceso.js`) + `test/inviabilidad.test.js` — **6/6**. Cubre `INF-1..6`, detectando y
>   **nombrando** el dato culpable; `INF-5` documenta el límite honesto del Nivel 1 (la
>   infactibilidad por interacción es del solver / Nivel 2).
> - ✅ **Engine CP implementado, escalado y probado.** `src/engine.js` con **forward-checking** y
>   selección de variable conmutable: `resolver` (orden canónico → solución **lex-mínima**) y
>   `resolverFactible` (**MRV**, modo rápido que escala). Suites: `test/engine.test.js` (**4/4**),
>   `test/unicidad.test.js` (**5/5**, `UNI-1..5`) y `test/engine-escala.test.js` (**5/5**:
>   resuelve **>150 sesiones acopladas en < 100 ms**, determinismo, paridad de factibilidad
>   canónico↔MRV, y prueba de infactibilidad por forward-checking).
> - ✅ **Capa de calidad implementada y probada.** `src/calidad.js` (evaluadores puros: huecos de
>   grupos = tier 1, desbalance diario = tier 2, comparador lexicográfico) + `resolverConCalidad`
>   en `engine.js` (mejora por búsqueda local sobre la solución factible) +
>   `test/calidad.test.js` (**7/7**: definición de huecos con sus trampas, desbalance, comparador,
>   y la búsqueda local convirtiendo un hueco en compacto 1→0 sin romper la validez).
> - ✅ **Inglés simultáneo implementado y probado.** Restricción de sincronización en `engine.js`
>   (bloques con el mismo `(sync, índice)` van a la misma hora; cargas `sync` se parten en bloques
>   de 1h) + adaptador en `index.html` (marca `sync` para inglés de cada cuatrimestre **salvo 8°/9°**)
>   + `test/ingles-simultaneo.test.js` (**3/3**: cuatri 2 simultáneo, cuatri 8 libre, y la mejora
>   de calidad no rompe la sincronización).
> - ✅ **Perfiles de docente implementados y probados.** Los días de asistencia se calculan por
>   PERFIL (`diasDeDocente` en `engine.js`): PA (tipo 2) → escalón de carga; PTC/Técnico/Inglés
>   (tipo 1/3/4) → **según disponibilidad** (todos sus días libres); default PA por compatibilidad.
>   Adaptador en `index.html` pasa `tipo`. `test/perfiles.test.js` (**5/5**: PER-1..4 + el caso de
>   compatibilidad).
> - ✅ **Casos límite probados.** `test/edge.test.js` (**8/8**: `EDGE-1..8` — mínimo absoluto,
>   todos de ambos turnos, fronteras de escalón, materia indivisible, holgura cero, grupos/docentes
>   vacíos, nombres con unicode, y misma materia con docentes distintos en un grupo).
> - ✅ **Pruebas de propiedad.** `test/property.test.js` (**2 suites, 350 datasets aleatorios** con
>   PRNG de semilla fija): toda salida factible cumple los invariantes, es determinista, y
>   `resolverConCalidad` mantiene validez sin empeorar la calidad. Reproducible (el fallo imprime
>   el dataset exacto).
> - 🎯 **Plan QA completo.** Único trabajo futuro (no de pruebas): hacer la calidad **exacta**
>   (branch-and-bound) en lugar de búsqueda local (óptimo local).

---

## 1. Filosofía de la verificación: pruebas por *oráculo de invariante*

Un horario es correcto si **ninguna invariante se viola**, sin importar cómo se generó. En vez de
comparar contra un horario "esperado" (frágil), se verifican **propiedades** que todo horario
válido debe cumplir. Esto da pruebas robustas frente a la naturaleza no determinista del motor
actual y deterministas del futuro.

```
generar(datos) ─► horario ─► [batería de oráculos] ─► PASS / FAIL (con contraejemplo)
```

---

## 2. Pirámide de pruebas

| Nivel | Qué valida | Ejemplos |
|---|---|---|
| **Unitarias** | funciones puras del preproceso | `balanced(H,N)`, `diasObjetivo(carga)`, `bandaN` ✅ |
| **Invariantes** | propiedades del horario completo | no-solape, unicidad por día, disponibilidad ✅ |
| **Reglas de negocio** | políticas institucionales | **ambos turnos** ✅, partición, días por carga, perfiles |
| **Propiedad (*property-based*)** | invariantes sobre datos aleatorios | PRNG con semilla fija genera cargas y verifica oráculos ✅ |
| **Unicidad / determinismo** | la solución es única y reproducible | no-good cut, doble corrida idéntica ✅ |
| **Inviabilidad** | el sistema detecta datos malos | *failing tests* por dato corrupto ✅ (Nivel 1) |
| **Rendimiento** | escalabilidad | tiempo de solve vs. tamaño ✅ (MRV + forward-checking) |

---

## 3. Oráculos de invariante (la batería base)

Cada oráculo recibe el horario de salida y devuelve `OK` o un **contraejemplo** legible.

| ID | Invariante | Condición de fallo |
|---|---|---|
| `INV-1` | No-solape de grupo | dos clases del mismo grupo se traslapan en el tiempo |
| `INV-2` | No-solape de docente | dos clases del mismo docente se traslapan |
| `INV-3` | Unicidad materia/día | la misma materia aparece ≥2 veces el mismo día para grupo+docente |
| `INV-4` | Disponibilidad | una clase cae fuera de la disponibilidad declarada del docente |
| `INV-5` | Ventana de turno | matutino fuera de `[7,15)` o vespertino fuera de `[12,20)` |
| `INV-6` | Conservación de horas | `Σ dur(bloques de una carga) ≠ horas requeridas` |
| `INV-7` | Contigüidad | un bloque de duración `k` no ocupa `k` horas consecutivas |
| `INV-8` | Bloques en días distintos | dos bloques de la misma carga comparten día (viola §5.1) |

---

## 4. Validación de reglas de negocio

### 4.1 ⭐ REGLA INSTITUCIONAL CRÍTICA — Prioridad de docentes con ambos turnos

**Enunciado:** los docentes con grupos asignados **tanto en matutino como en vespertino** deben
recibir la **prioridad más alta** de colocación, por ser el recurso más restringido.

> Esta es la regla que el comité de QA debe blindar **sin excepción**. Se valida en dos planos:
> resultado (¿quedaron colocados?) y proceso (¿se les dio prioridad real?).

| ID | Caso de prueba | Given / When / Then |
|---|---|---|
| `BT-1` | Identificación correcta | **Given** un docente con grupos en ambos turnos **When** se clasifica **Then** `turnosAsignados.size ≥ 2` ⇒ marca *ambos-turnos* |
| `BT-2` | Colocación garantizada | **Given** un escenario factible con ≥1 docente de ambos turnos **When** se genera **Then** el 100% de sus bloques quedan colocados (cero fallidos) |
| `BT-3` | Prioridad bajo escasez | **Given** un escenario donde *no caben todos* y compiten un docente de ambos turnos y uno de un solo turno por la misma franja **When** se genera **Then** se coloca primero el de ambos turnos; el sacrificable es el de un solo turno |
| `BT-4` | Orden de la cola | **Given** la cola de colocación **Then** los bloques de ambos-turnos preceden a los de un solo turno (tras inglés) |
| `BT-5` | Hueco de mediodía legítimo | **Given** un docente de ambos turnos **When** se evalúan huecos (tier 1/2) **Then** el vacío entre el fin de matutino y el inicio de vespertino **no se penaliza** |
| `BT-6` | Regresión de no-solape inter-turno | **Given** un docente de ambos turnos **Then** `INV-2` se cumple cruzando la frontera de turno |

**Prueba demostrativa obligatoria (*failing test* dirigido).** Antes de confiar en el motor, se
construye `BT-3` como un escenario *casi imposible* diseñado para que un motor ingenuo (sin la
regla) **sacrifique** al docente de ambos turnos. El test debe **fallar con el motor sin la regla**
y **pasar con ella** — así se prueba que la regla está activa, no solo que "no estorba".

```
# Especificación de BT-3 (pseudoespecificación, no implementación)
escenario:
  docente_AT  : grupos en matutino Y vespertino, disponibilidad muy estrecha (solo 1 franja viable)
  docente_M   : un solo turno, disponibilidad amplia, compite por esa misma franja
afirmar:
  horario.bloques(docente_AT).todos_colocados == True
  # Si el motor coloca a docente_M en la franja y deja a docente_AT sin lugar → FAIL (regla violada)
```

### 4.2 Unicidad / determinismo

| ID | Caso | Given / When / Then |
|---|---|---|
| `UNI-1` | Reproducibilidad | **Given** los mismos datos **When** se genera 2 veces (incluso con *workers* paralelos) **Then** ambos horarios son **idénticos** |
| `UNI-2` | No-good cut | **Given** la solución `S*` y los tiers congelados **When** se prohíbe `S*` y se re-resuelve **Then** el resultado es **INFEASIBLE** (unicidad demostrada) |
| `UNI-3` | Simetría de bloques rota | **Given** una carga con `N` bloques **Then** sus días salen en orden ascendente (no hay permutaciones alternativas) |
| `UNI-4` | Simetría de grupos rota | **Given** dos grupos idénticos del mismo grado **Then** se cumple el desempate lexicográfico `inicio(g_i) ≤ inicio(g_j)` |
| `UNI-5` | Canonicidad | **Given** la solución **Then** minimiza la clave `K` (ninguna reasignación lexicográficamente menor es factible bajo los tiers congelados) |

### 4.3 Partición dinámica de horas

| ID | Entrada `(H, N)` | Salida esperada `balanced(H,N)` |
|---|---|---|
| `SPL-1` | `(7, 2)` | `{4, 3}` |
| `SPL-2` | `(7, 3)` | `{3, 2, 2}` |
| `SPL-3` | `(7, 4)` | `{2, 2, 2, 1}` |
| `SPL-4` | `(6, 3)` | `{2, 2, 2}` |
| `SPL-5` | `(H, N)` *(propiedad)* | `Σ = H`, `len = N`, `max − min ≤ 1`, orden descendente |
| `SPL-6` | banda de `N` | `⌈H/dur_max⌉ ≤ N ≤ min(días_docente, H)` |

### 4.4 Días de asistencia por carga (Tipo 2 — PAs)

| ID | Carga total | Días esperados |
|---|---|---|
| `DIA-1` | `2 .. 9` | `2` |
| `DIA-2` | `10 .. 20` | `3` |
| `DIA-3` | `21 +` | `4` |
| `DIA-4` | fronteras `9/10` y `20/21` | `2→3` en 10; `3→4` en 21 (prueba de *off-by-one*) |
| `DIA-5` | reparto real | el docente trabaja **exactamente** ese número de días distintos (`Σ_día b[d,día] = días`) |

### 4.5 Disponibilidad por perfil

| ID | Perfil | Afirmación |
|---|---|---|
| `PER-1` | Tipo 1 (Inglés) | inglés 1°–7° pre-asignado y simultáneo entre grupos del grado (`inicio` iguales) |
| `PER-2` | Tipo 3 (PTC) | trabaja 5 días; carga 40–50h respetada; clases solo lun–vie |
| `PER-3` | Tipo 4 (Técnico/Director) | dominio = semana completa; carga baja; sin sobreasignación |
| `PER-4` | Tipo 2 (PA) | días según escalón (§4.4) + disponibilidad declarada |

---

## 5. Pruebas de propiedad (*property-based*, p. ej. Hypothesis)

Generar datos de entrada aleatorios **pero factibles** y verificar que **todo** horario producido
satisface la batería de oráculos. Captura bugs que los casos puntuales no ven.

```
∀ dataset factible generado:
    h = generar(dataset)
    assert INV-1 .. INV-8 (h)
    assert BT-2(h), BT-5(h), BT-6(h)
    assert UNI-1: generar(dataset) == h        # determinismo
    # Reducción automática (shrinking) → contraejemplo mínimo si falla
```

**Estrategia de generación:** *fuzzing* dirigido sobre cargas (2–50h), número de docentes de ambos
turnos (0–N), densidad de disponibilidad (holgada → justa). El caso más valioso es el de
**disponibilidad apretada**, donde la regla de ambos turnos se vuelve decisiva.

---

## 6. Pruebas de inviabilidad (*failing tests* por dato malo)

Cada una corrompe **un** dato y exige que el sistema lo **detecte y lo nombre** (no que falle en
silencio ni que entregue un horario inválido).

| ID | Corrupción inyectada | Diagnóstico esperado |
|---|---|---|
| `INF-1` | docente con `carga > disponibilidad` | Nivel 1 rechaza, nombrando al docente |
| `INF-2` | grupo con `Σ horas > capacidad de ventana` | Nivel 1 rechaza, nombrando al grupo |
| `INF-3` | inglés del grado sin franja común | Nivel 1 rechaza la simultaneidad |
| `INF-4` | bloque contiguo mayor que cualquier hueco | Nivel 1 rechaza el bloque |
| `INF-5` | sobre-restricción sutil (pasa Nivel 1) | Nivel 2 (IIS) devuelve el subconjunto mínimo en conflicto |
| `INF-6` | falso positivo | dataset **factible** ⇒ **no** se reporta inviabilidad |

> **Regla de oro QA:** un INFEASIBLE jamás debe presentarse al usuario como "no se pudo".
> Siempre debe acompañarse del **dato culpable** (Nivel 1) o del **conflicto mínimo** (Nivel 2).

---

## 7. Casos límite y adversariales

| ID | Escenario |
|---|---|
| `EDGE-1` | un solo docente, una sola materia (mínimo absoluto) |
| `EDGE-2` | todos los docentes son de ambos turnos (estrés de la regla crítica) |
| `EDGE-3` | carga total exactamente en cada frontera de escalón (9,10,20,21) |
| `EDGE-4` | materia de 1h (bloque indivisible) |
| `EDGE-5` | disponibilidad de exactamente las horas necesarias (holgura cero) |
| `EDGE-6` | grupo sin ninguna materia / docente sin ninguna carga |
| `EDGE-7` | nombres con acentos, espacios y mayúsculas (normalización) |
| `EDGE-8` | dos materias del mismo nombre con docentes distintos en el mismo grupo |

---

## 8. Pruebas de rendimiento

| ID | Métrica | Criterio de aceptación (a definir con datos reales) |
|---|---|---|
| `PERF-1` | tiempo de solve vs. nº de sesiones | crecimiento sub-exponencial; objetivo < X s para el dataset real |
| `PERF-2` | efecto del *warm start* | con *hints* ≥ N× más rápido que sin ellos |
| `PERF-3` | efecto de la pre-asignación de inglés | reducción medible del árbol de búsqueda |
| `PERF-4` | costo de la cola lexicográfica (tier ω) | despreciable frente a los tiers de calidad |

---

## 9. Organización de la suite (JS nativo, `node --test`)

```
src/
├── preproceso.js                 # ✅ implementado (módulo browser + node)
├── invariantes.js                # ✅ implementado (oráculo agnóstico al motor)
├── motor-min.js                  # ✅ implementado (colocador greedy, semilla del engine)
├── prechecks.js                  # ✅ implementado (pre-checks de capacidad Nivel 1)
├── engine.js                     # ✅ implementado (solver CP backtracking + unicidad + calidad)
└── calidad.js                    # ✅ implementado (huecos tier 1 + desbalance tier 2)
test/
├── preproceso.test.js            # ✅ SPL-*, DIA-*  (9/9 verde)
├── invariantes.test.js           # ✅ INV-1 .. INV-8 (10/10 verde)
├── ambos-turnos.test.js          # ✅ ⭐ BT-1 .. BT-6 (6/6 verde, incl. failing test BT-3)
├── inviabilidad.test.js          # ✅ INF-1 .. INF-6 (6/6 verde)
├── engine.test.js                # ✅ solver CP: factibilidad/infactibilidad (4/4 verde)
├── unicidad.test.js              # ✅ UNI-1 .. UNI-5 (5/5 verde)
├── engine-escala.test.js         # ✅ MRV + forward-checking: escala >150 sesiones (5/5 verde)
├── calidad.test.js               # ✅ huecos/desbalance + búsqueda local (7/7 verde)
├── ingles-simultaneo.test.js     # ✅ sincronización por cuatrimestre (3/3 verde)
├── perfiles.test.js              # ✅ PER-1 .. PER-4 (5/5 verde, días por perfil)
├── edge.test.js                  # ✅ EDGE-1 .. EDGE-8 (8/8 verde)
├── property.test.js              # ✅ 350 datasets aleatorios (2/2 suites verde)
└── perf.test.js                  # PERF-*  (pendiente, saltadas por defecto)
```

Ejecución: `node --test` (toda la suite). Para rendimiento, `node --test test/perf.test.js`.
En CI, el *gate* de *merge* exige verde en todo salvo `perf`. No se requiere `npm install`:
el runner es parte de Node (≥ 18). El módulo `src/preproceso.js` usa patrón UMD-lite, por lo que
es `require`-able en las pruebas y, a la vez, cargable como `<script>` en `index.html`.

---

## 10. Definición de Hecho (Definition of Done)

Una corrida del generador se considera **correcta** solo si:

1. ✅ Los 8 oráculos de invariante pasan (`INV-1..8`).
2. ✅ La regla crítica de ambos turnos pasa **sin excepción** (`BT-1..6`), incluido el
   *failing test* dirigido `BT-3`.
3. ✅ La unicidad está construida y **verificada por no-good cut** (`UNI-1..5`).
4. ✅ Todo dato inviable se detecta y se **nombra** (`INF-1..6`), sin falsos positivos.
5. ✅ Las pruebas de propiedad no encuentran contraejemplo en N≥1000 datasets.

---

## 11. Bugs potenciales priorizados (revisión de diseño)

| Severidad | Riesgo | Mitigación / prueba que lo caza |
|---|---|---|
| 🔴 Alta | Penalizar el hueco de mediodía de docentes de ambos turnos | `BT-5`; cálculo de huecos por turno (§7.1 del diseño) |
| 🔴 Alta | *Off-by-one* en fronteras de escalón (9/10, 20/21) | `DIA-4` |
| 🔴 Alta | Unicidad falsa por simetría sin romper | `UNI-2` (no-good cut debe dar INFEASIBLE) |
| 🟠 Media | Bloque que no respeta contigüidad al linealizar `t` | `INV-7` |
| 🟠 Media | `min/max` de huecos contaminado por intervalos de otros días | `INV` + revisión de intervalos opcionales (§7.1) |
| 🟠 Media | Inglés 8°/9° congelado de más → inviabilidad artificial | `PER-1` + `INF-6` (no falso positivo) |
| 🟡 Baja | Normalización de nombres con acentos | `EDGE-7` |

---

*Estrategia de pruebas conceptual. Se vuelve ejecutable al conectar el motor CP-SAT descrito en
[`arquitectura-csp.md`](arquitectura-csp.md). El oráculo de invariantes es reutilizable de
inmediato contra el motor metaheurístico actual.*
