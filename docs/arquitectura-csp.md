# Diseño de un Generador de Horarios Escolares como Problema de Satisfacción de Restricciones (CSP) con CP-SAT

> **Proyecto:** *From Schedule FI* — generador institucional de horarios.
> **Documento:** Análisis lógico y estructural para la migración del motor de generación
> desde metaheurística (recocido simulado + genético) hacia programación con restricciones
> (modelo **CP-SAT** como referencia conceptual).
> **Pila objetivo:** **100% JavaScript**, sin dependencias. No existe binding JS oficial de
> OR-Tools/CP-SAT; por tanto CP-SAT se emplea como *vocabulario conceptual* del modelo y el motor
> se implementa como un *engine* CP propio en JS (ver §2.1).
> **Tipo:** Análisis conceptual de arquitectura. No contiene código fuente de implementación.
> **Audiencia:** desarrollo, comité de TI y documentación metodológica de tesis.

---

## 1. Resumen ejecutivo

El sistema actual resuelve el problema de horarios por **metaheurística**: produce buenas
soluciones, pero nunca **certeza**. No puede demostrar que un horario es imposible ni que es
único. Este documento diseña la migración a **programación con restricciones (CSP)** bajo el
solver **CP-SAT**, que cambia el paradigma de *optimizar-y-rezar* a **completitud**: el motor o
entrega una solución factible, o **prueba** formalmente la inviabilidad.

El precio de la completitud es la **explosión combinatoria**. El diseño la controla con una
**arquitectura por capas** donde el solver hace lo mínimo indispensable (puro emplazamiento), y
toda decisión estructural (partición de horas, días de asistencia, validación de capacidad) vive
en **preprocesamiento determinista**, fuera del modelo.

La propiedad central que persigue el diseño —**solución única**— se logra no por azar sino por
construcción: una combinación de preprocesamiento determinista, ruptura de simetría, una cascada
de objetivos lexicográficos y una verificación formal por *no-good cut*.

---

## 2. Contexto y motivación

| Dimensión | Motor actual (SA + GA) | Motor propuesto (CP-SAT) |
|---|---|---|
| Naturaleza | Estocástico, aproximado | Determinista, completo |
| Inviabilidad | No la detecta (sigue buscando) | La **prueba** (INFEASIBLE) |
| Unicidad | No garantizable | **Construible y verificable** |
| Reproducibilidad | Variable entre corridas | Idéntica entre corridas/máquinas |
| Riesgo principal | Calidad de la solución | Escalabilidad del solver |
| Mitigación | — | Preproceso + pre-asignación (cap. 6) |

**Decisión de arquitectura:** no se descarta el motor metaheurístico; se **reutiliza como
generador de *hints*** (arranque en caliente, ver §6.3). Lo mejor de ambos mundos: la
metaheurística produce un horario casi-válido en milisegundos, y el *engine* CP lo certifica,
repara y canoniza.

### 2.1 Nota de implementación: pila 100% JavaScript

Todo el código se mantiene en **JavaScript**, sin dependencias externas ni *build*, coherente con
el resto del proyecto (`index.html` vanilla + `server.js` de Node). Esto tiene una consecuencia de
diseño:

- **CP-SAT no se usa como dependencia, sino como referencia conceptual.** OR-Tools no ofrece
  binding JS oficial. Los nombres de API que aparecen en este documento (`AddNoOverlap`,
  `AddAllowedAssignments`, `AddDecisionStrategy`, `AddAssumption`, `AddHint`,
  `SufficientAssumptionsForInfeasibility`) son **vocabulario** para nombrar con precisión cada
  mecanismo; la **formulación lógica es solver-agnóstica** y se implementa con equivalentes JS:

  | Concepto CP-SAT | Equivalente en el *engine* JS |
  |---|---|
  | Variables de dominio + propagación | *backtracking* con *forward checking* sobre dominios (`Set`/bitmask) |
  | `NoOverlap` (recurso) | comprobación de solape por grupo/docente al colocar un bloque |
  | `AddAllowedAssignments` | dominio precalculado de arranques legales (bitmask de disponibilidad) |
  | `AddDecisionStrategy` (MRV/LCV) | orden de la cola de colocación + selección de slot |
  | `AddHint` (warm start) | sembrar la colocación con la salida del motor SA/GA actual |
  | objetivo lexicográfico | post-paso de mejora por *tiers* con congelamiento incremental |
  | `AddAssumption` / IIS | aislamiento del subconjunto en conflicto por relajación dirigida |
  | *no-good cut* | re-búsqueda prohibiendo la solución hallada |

- **Ejecución en el cliente.** El *engine* corre en el navegador (con *Web Workers* y
  `SharedArrayBuffer`, ya presentes) o en Node, sin servicios externos.
- **Pruebas en JS nativo.** La verificación usa el runner integrado `node --test`
  (`node:test` + `node:assert`), sin Jest ni instalación. Ver
  [`estrategia-pruebas-qa.md`](estrategia-pruebas-qa.md).

> **Estado de implementación (JS):** ya están implementados y probados (`node --test`, 45/45):
> `src/preproceso.js` (§6.1), `src/invariantes.js` (oráculo INV-1..8), `src/prechecks.js`
> (inviabilidad Nivel 1, cap. 9), `src/motor-min.js` (colocador greedy, regla de ambos turnos) y
> `src/engine.js` (solver CP con **forward-checking** y selección de variable conmutable:
> `resolver` en orden canónico → solución **lex-mínima/única**, y `resolverFactible` con **MRV**
> para escalar — resuelve **>150 sesiones acopladas en < 100 ms**). La completitud del engine hace
> que la regla de ambos turnos sea **automática**: nunca sacrifica a un docente de ambos turnos si
> existe solución. La **calidad** está en `src/calidad.js` + `resolverConCalidad` (engine): mejora
> por búsqueda local que minimiza **huecos de grupos** (tier 1) y, a igualdad, el **desbalance
> diario** (tier 2) — los dos objetivos elegidos por la institución. Pendiente: hacer la cascada de
> calidad **exacta** (branch-and-bound) en lugar de búsqueda local (óptimo local).

---

## 3. Arquitectura por capas

El sistema es un *pipeline* determinista. Cada etapa tiene una **invariante de salida** que la
siguiente da por garantizada. Principio rector: **cuando el dato cruza hacia el solver, ya no
queda ninguna decisión estructural pendiente, solo emplazamiento.**

```
 INGESTA ─► VALIDACIÓN ─► PREPROCESO ─► CONSTRUCTOR ─► PRE-ASIG ─► SOLVE ─► VERIFIC. ─► EXPORT
 (.xlsx)    (pre-checks)  (días,N,split) DE MODELO    (inglés+    CASCADA   (no-good
                                                       hints)    (lexicog.)  cut)
    │           │                                                    │
    │           ▼ (fallo)                                            ▼ (fallo)
    │   Dato mal capturado                                    INFEASIBLE
    │   → diagnóstico por nombre                              → IIS · soft-constraints
    └─────────────────────────────────────────────────────────────────────────────────►
```

**Las dos únicas salidas de error del sistema son de *dato*, no de algoritmo** (cap. 9). Las dos
invariantes que el diseño garantiza al cruzar las fronteras críticas son:

1. Tras **Preproceso**: *sesiones de duración fija* (el solver no decide tamaños de bloque).
2. Tras **Verificación**: *unicidad demostrable* (el horario es el único óptimo canónico).

---

## 4. Modelado: variables de decisión y dominios

### 4.1 Decisión de granularidad

Se descarta el modelado **binario indexado por tiempo** `x[grupo,materia,docente,día,hora] ∈ {0,1}`:
genera cientos de miles de booleanos y vuelve dolorosa la contigüidad de bloques.

Se adopta el **modelado por intervalos** (*interval / block scheduling*), lenguaje nativo de
CP-SAT, que además encaja exactamente con la regla de partición de horas (cap. 6.1).

### 4.2 Unidad atómica: la *sesión* (bloque)

No se modela "materia"; se modela cada **bloque contiguo** que la materia ocupa. La cantidad y
duración de los bloques se **precalcula** (cap. 6.1), porque las reglas son funciones
deterministas de la carga. El solver recibe una **lista plana de sesiones** `S`, cada una con
duración fija `dur(s)`.

### 4.3 Linealización del tiempo

La semana se codifica en un eje único:

```
t = día · 24 + hora        con  día ∈ {0..5}  (Lunes=0 … Sábado=5)
```

Un bloque jamás cruza la medianoche porque su dominio lo impide, lo que permite usar
`AddNoOverlap` global sobre toda la semana con una sola estructura.

Ventanas de turno (heredadas del sistema actual):

```
matutino   : horas [7 .. 15)
vespertino : horas [12 .. 20)
```

### 4.4 Variables por sesión `s`, con carga `c(s) = (grupo, materia, docente)`

| Variable | Tipo | Dominio |
|---|---|---|
| `dia_s` | entero | días en que el docente asiste / está disponible ⊆ {0..5} |
| `inicio_s` | entero (eje `t`) | arranques legales: `ventana_turno(grupo) ∩ disponibilidad(docente)`, recortado para que `inicio_s + dur(s)` no rebase el fin de la ventana |
| `intervalo_s` | IntervalVar | `[inicio_s, inicio_s + dur(s))`; alimenta los `NoOverlap` |
| `y[s,d]` | booleano | `(dia_s == d)`; indicador "la sesión cae el día d" |
| `b[d,día]` | booleano aux. | 1 si el docente `d` trabaja algún bloque ese día (soporta la regla de días) |

> **El dominio es el primer punto de inyección de conocimiento.** Precargar `inicio_s` solo con
> posiciones legales (vía `AddAllowedAssignments`, alimentado por las *bitmasks* de disponibilidad
> que el sistema ya mantiene en `SharedArrayBuffer`) poda el árbol de búsqueda **antes** de que el
> solver razone una sola restricción.

---

## 5. Formulación de las restricciones duras

Notación: `S` = sesiones; `G(s), M(s), D(s)` = grupo/materia/docente de la sesión `s`;
`dur(s)` = duración; `inicio_local(s) = inicio_s − 24·dia_s`.

### 5.1 Unicidad de materia por día
*Máximo una clase de la misma materia por día, para el mismo grupo y docente.*
Cada carga se descompone en bloques en **días distintos**:

```
AllDifferent( { dia_s : c(s) = c } )      ∀ carga c
```

Como cada carga es un triple `(grupo, materia, docente)` único, esto garantiza simultáneamente la
regla: a lo sumo un bloque de esa materia por día para ese grupo con ese docente.

### 5.2 No-solapamiento de grupo
Un grupo no puede estar en dos clases a la vez. El grupo es un **recurso**:

```
NoOverlap( { intervalo_s : G(s) = g } )   ∀ grupo g
```

### 5.3 No-solapamiento de docente
El docente es un **recurso**:

```
NoOverlap( { intervalo_s : D(s) = d } )   ∀ docente d
```

Esto absorbe naturalmente a los **docentes de ambos turnos**: como su disponibilidad cruza
matutino y vespertino, su `NoOverlap` impide colisiones aunque sus bloques caigan en franjas
distintas. No requiere lógica especial, solo **prioridad de búsqueda** (§6.3) y trato del hueco
de mediodía como legítimo (§7.1).

### 5.4 Ventana de turno y disponibilidad
Embebido en el dominio de `inicio_s`. Para disponibilidades irregulares (con huecos), se usa una
tabla de posiciones permitidas:

```
AddAllowedAssignments( inicio_s , posiciones_legales(s) )    ∀ s
posiciones_legales(s) = ventana_turno(G(s)) ∩ disponibilidad(D(s))
                        ∩ { inicio : inicio + dur(s) cabe en la ventana }
```

### 5.5 Días de asistencia por carga (Docentes Tipo 2 — PAs)
Regla institucional: `carga 2–9h → 2 días`, `10–20h → 3 días`, `21+ → 4 días`. Es una función
escalón de la carga total, computable en preproceso. Como restricción dura (si se delega al solver):

```
b[d,día] = OR( presencia de bloques de d ese día )
Σ_día b[d,día] = dias_objetivo( carga_total(d) )            ∀ docente d Tipo 2
```

El `=` (no `≤`) fuerza a **repartir** la carga en exactamente esos días, evitando amontonarla.

### 5.6 Disponibilidad por perfil
No son restricciones nuevas, sino **parametrización** de dominios y del conteo de días:

| Tipo | Perfil | Efecto en el modelo |
|---|---|---|
| 1 | Inglés (completo) | Disponibilidad total; entra como **pre-asignación** (§6.2), no como variable libre |
| 2 | PAs | Días según escalón de carga (§5.5); dominio = disponibilidad declarada |
| 3 | PTCs (40–50h, 5 días) | `Σ_día b[d,día] = 5`; carga alta concentrada de lunes a viernes |
| 4 | Técnicos/Directores | Dominio = semana completa, carga baja → sesiones de "relleno" muy flexibles, se resuelven al final |

### 5.7 Inglés simultáneo
Los grupos del mismo grado tienen inglés en la **misma franja**. Se acoplan los arranques:

```
inicio_{s1} = inicio_{s2}     ∀ par de sesiones de inglés del mismo grado/franja
```

o, preferentemente, se modela un **único intervalo compartido** proyectado sobre todos los grupos
implicados.

> **Implementado:** cada carga de inglés simultáneo lleva `sync = 'INGLES|<cuatrimestre>'`; el
> engine la parte en bloques de 1h y exige (en `compatible`) que los bloques con el mismo
> `(sync, índice)` —en grupos distintos del mismo cuatrimestre— coincidan en día y hora. Aplica a
> los cuatrimestres 1–7; **8° y 9° NO se sincronizan** (van por su cuenta). El forward-checking
> propaga la igualdad: al fijar el primer grupo, los demás quedan podados a esa misma hora.

---

## 6. Estrategia anti-combinatoria

El enemigo es la explosión combinatoria. Dos capas la doman: **preproceso** (elimina la
ambigüedad estructural) y **pre-asignación** (carva el esqueleto del horario).

### 6.1 Preproceso: derivar `N` y los bloques

Cadena determinista por cada carga. **Ninguna de estas flechas es una decisión del solver.**

```
Carga total (Σh)  ──►  Días de asistencia  ──►  N por materia  ──►  Split  ──►  Sesiones fijas
   16 h                  escalón → 3 días        min(3,7)=3      balanced     { 3, 2, 2 }
```

**Paso 1 — Carga total → días de asistencia.** Se agrega la carga del docente y se aplica el
escalón de su perfil (§5.5/§5.6). Invariante: cada docente tiene un `días_docente` cerrado.

**Paso 2 — Derivación de `N` por carga.** `N_c` = número de bloques (= días distintos) en que se
reparte una materia de `H` horas. El techo natural es `días_docente`, acotado por una **banda
factible**:

```
límite inferior:  N ≥ ⌈H / dur_max⌉           (ningún bloque excede el tope)
límite superior:  N ≤ min( días_docente , H )  (no más días que asistencia; ni bloques < 1h)
```

Dentro de la banda se elige el `N_c` que **maximiza el balance** (minimiza la diferencia entre el
bloque mayor y el menor, y la cantidad de bloques de 1h). En la práctica, por la regla,
`N_c = min(días_docente, H)` y el split se adapta — lo que muestran los ejemplos: una misma
materia de 7h da `{4,3}`, `{3,2,2}` o `{2,2,2,1}` según los días.

> **Perilla de política (decisión de arquitecto, única variable libre de toda la capa):**
> - `dur_min` — ¿se permiten bloques de 1h? El ejemplo `{2,2,2,1}` indica que **sí**. Recomendado: `dur_min = 1`.
> - `dur_max` — tope de horas por bloque. Recomendado: `dur_max = 4`.
>
> Fijar estas dos constantes vuelve **todo** el preproceso determinista.

**Paso 3 — Split balanceado (determinista).** Dada `(H, N_c)`, la partición es única:

```
balanced(H, N):  exactamente (H mod N) bloques de ⌈H/N⌉  y  el resto de ⌊H/N⌋,
                 emitidos en orden descendente.
   H=7, N=2 → {4,3}      H=7, N=3 → {3,2,2}      H=7, N=4 → {2,2,2,1}
```

**Paso 4 — Materialización.** Cada carga se aplana en su lista de sesiones de duración fija; el
conjunto global `S` es la entrada del modelo.

**Paso 5 — Recorte de dominios.** Se precalcula `posiciones_legales(s)` (§5.4) como tabla/bitmask.

**Invariante de salida (cap. 6.1):** lista de sesiones de duración fija, dominios recortados,
capacidad pre-validada. **Cero decisiones estructurales pendientes.**

#### Traza de ejemplo
```
Docente PA, carga total 16h → días_docente = 3   (escalón 10–20)
 Materia X = 7h:  N = min(3,7) = 3 → balanced(7,3) = {3,2,2}
 Materia Y = 6h:  N = min(3,6) = 3 → balanced(6,3) = {2,2,2}
 Materia Z = 3h:  N = min(3,3) = 3 → balanced(3,3) = {1,1,1}   (o {2,1} si dur_min=2 ⇒ N=2)
```

### 6.2 Pre-asignación de inglés

**Inglés 1°–7° → fijar como esqueleto.** El inglés de estos cuatrimestres es simultáneo y **toca
a todos los grupos del grado a la vez**. Dejado libre, cada decisión invalida ramas enteras en
docenas de grupos → *backtracking* masivo. Fijarlo primero (pre-solve o constantes) **reserva su
franja y factoriza el problema restante**: cada grupo queda con su rejilla ya recortada.

**Inglés 8°–9° → prioridad alta, no congelado.** Aquí el espacio remanente es escaso (vespertino,
ventanas ya mordidas). Congelarlo mal provoca inviabilidad artificial. Tratamiento: **no fijarlo**,
pero darle prioridad de rama inmediatamente después del esqueleto, explotando que su dominio ya
es pequeño (MRV lo elige solo).

### 6.3 Heurísticas de búsqueda

- **MRV** (`CHOOSE_MIN_DOMAIN_SIZE`): ramificar primero sobre la sesión con menos valores
  posibles → docentes de ambos turnos, inglés 8°/9°, PTCs de 5 días. *Fail-first*: detecta el
  callejón sin salida temprano.
- **LCV** (`SELECT_MIN_VALUE`): elegir la franja que menos restringe a los vecinos.
- ***Warm start* (hints):** alimentar la solución de la metaheurística (SA/GA) como `AddHint`. El
  solver arranca desde un horario casi-válido y solo repara — acelera la convergencia órdenes de
  magnitud.
- **Ruptura de simetría:** ordenar los bloques de una misma carga por día ascendente
  (`dia_{s1} < dia_{s2} < …`) elimina las `N!` permutaciones equivalentes de un mismo reparto.
  Imprescindible (ver §8).

---

## 7. Función objetivo: cascada lexicográfica

El objetivo **lexicográfico** impone prioridad estricta entre criterios: optimiza `f1` por
completo; solo entre empates de `f1` optimiza `f2`; etc. Esto es lo que, con un último criterio de
orden total, **fuerza un óptimo único**.

**Por qué lexicográfico y no suma ponderada:** una suma `w1·f1 + w2·f2 + …` exige calibrar pesos
y permite que el solver sacrifique mucho de un criterio alto por poco de uno bajo (sin dominancia
estricta). El lexicográfico no.

**Implementación: solve secuencial con congelamiento.**

```
1. minimizar f1            → v1* ;  fijar  f1 == v1*  (restricción dura)
2. minimizar f2            → v2* ;  fijar  f2 == v2*
   …
k. minimizar la CLAVE CANÓNICA (desempate total, §7.3)
```

### 7.1 Tier 1 — Minimización de huecos (formulación completa)

**Definición precisa de "hueco":** para un grupo `g` en un día `d`, una hora vacía **intercalada
entre dos clases** del mismo día. Las horas vacías *antes* de la primera clase o *después* de la
última **no cuentan**.

Variables auxiliares por `(g, d)`:

```
ocupadas[g,d] = Σ_{s: G(s)=g}  dur(s) · y[s,d]                        (entero)
primera[g,d]  = min  { inicio_local(s) : G(s)=g , y[s,d]=1 }
ultima[g,d]   = max  { inicio_local(s)+dur(s) : G(s)=g , y[s,d]=1 }
span[g,d]     = ultima[g,d] − primera[g,d]
```

**Formulación recomendada — *span − carga*:**

```
huecos[g,d] = span[g,d] − ocupadas[g,d]
OBJETIVO tier 1:   minimizar   Σ_{g,d} huecos[g,d]
```

`span` es cuánto se estira el día de punta a punta; `ocupadas` cuánto está realmente lleno; su
diferencia es **exactamente el tiempo muerto intercalado**, ignorando lo previo a `primera` y
posterior a `ultima` — respetando la definición correcta.

**Las tres trampas:**

1. **Días vacíos.** Si el grupo no tiene clase ese día, `primera`/`ultima` quedan indefinidos.
   Blindaje con indicador de día activo:
   ```
   activo[g,d] = (ocupadas[g,d] > 0)
   si activo[g,d] = 0  ⇒  huecos[g,d] = 0
   ```
2. **Intervalos opcionales en el min/max.** `primera`/`ultima` se calculan solo sobre las sesiones
   **presentes ese día** (`y[s,d]=1`). En CP-SAT es un `min`/`max` sobre **intervalos opcionales**:
   cada sesión aporta a la cota solo si su literal de presencia está activo. Sin ese acoplamiento,
   una sesión de otro día contamina el `primera` de este. Es el punto donde más implementaciones
   fallan.
3. **Docentes de ambos turnos — el hueco legítimo.** Aplicar la fórmula a un docente que da clase
   en matutino *y* vespertino haría que el sistema viera el **vacío de mediodía** como un hueco y
   tratara de cerrarlo, lo cual es absurdo. Corrección: para perfiles de ambos turnos, **calcular
   huecos por turno por separado**, nunca a través de la frontera.

**Alternativa literal** (booleanos de ocupación `o[g,d,h]` con prefijos/sufijos OR): más explícita
y didáctica, pero un orden de magnitud más de variables y más lenta. Reservar solo para huecos
*ponderados por posición*.

### 7.2 Tiers intermedios (calidad pedagógica)

| Tier | Criterio | Objetivo |
|---|---|---|
| 1 | Huecos del grupo | minimizar tiempo muerto intercalado del alumno |
| 2 | Huecos del docente | minimizar tiempo muerto del docente (por turno) |
| 3 | Distribución diaria | preferir mañana / evitar días con carga extrema seguida |
| 4 | Preferencia institucional | mejores franjas para docentes de ambos turnos |
| ω | **Clave canónica** | romper toda simetría restante → unicidad (§7.3) |

### 7.3 Tier ω — Clave canónica de desempate

Los tiers 1–k dan **calidad** pero son **simétricos**: muchos horarios empatan en el óptimo. El
tier ω no busca calidad sino **determinismo**: seleccionar uno solo, siempre el mismo, de forma
demostrable.

**Principio:** *Unicidad = un orden total sobre el espacio de soluciones + la prueba de que su
óptimo es único.* Dos soluciones distintas difieren en ≥1 variable; un orden total les da rangos
distintos; el mínimo de un orden total es único por definición.

**Tres ingredientes:**

- **A · Orden canónico de sesiones** (determinista, ajeno al solver): ordenar `S` por
  `(id_grupo, nombre_materia, índice_bloque)`.
- **B · Ruptura de simetría estructural** (restricciones duras, ~95% de la simetría):
  - bloques de una carga → días ascendentes (§6.3);
  - grupos idénticos → desempate lexicográfico `inicio(g_i) ≤ inicio(g_j)` para `i<j`.
- **C · Cola lexicográfica compacta** sobre el vector canónico
  `K = (inicio_{s1}, inicio_{s2}, …)` en el orden A.

**Implementación sin desbordamiento:**

- *Escalarización posicional* con base `B > rango(inicio)` (aquí `inicio ∈ [0,144]`, `B=145`):
  ```
  K_escalar = Σ_i  inicio_{s_i} · B^(posición_i)
  ```
  Minimizar `K_escalar` ≡ minimizar `K` lexicográficamente, mientras `B^n` quepa en el entero.
- *Cascada por bloques* cuando `n` es grande: partir `S` en grupos cuyo entero posicional quepa en
  63 bits; minimizar el bloque 1 a optimalidad, congelarlo, minimizar el bloque 2, etc. Pocas
  etapas, cada una exacta.

**Por qué termina en exactamente una:** tras **B** no queda simetría residual; **C** impone un
orden total estricto sobre lo que reste. El óptimo probado de un orden total estricto es único.
El horario resultante es idéntico entre corridas, *workers* paralelos y máquinas.

**Costo:** la cola lexicográfica es barata porque, cuando se ejecuta, los tiers 1–k ya
encogieron la región factible a un puñado de soluciones.

---

## 8. Unicidad: construcción y verificación

El tier ω **construye** la unicidad; el *no-good cut* la **certifica** (etapa 7 del pipeline).

```
1. Resolver la cascada → obtener S*.
2. Añadir corte: "≥1 variable difiere de S*", con los tiers 1..k congelados.
3. Re-resolver:
     INFEASIBLE  → S* es demostrablemente único.  ✔
     SAT         → existe S'; hay simetría sin romper en B → corregir (red de seguridad).
```

**Mapa completo de la unicidad:**

| Eje de ambigüedad | Capa que lo cierra |
|---|---|
| ¿Cuántos/qué tamaño de bloques? | Preproceso (§6.1) — `N` determinista + `balanced()` |
| ¿Permutación de bloques de una carga? | Ruptura de simetría B — días ascendentes |
| ¿Grupos intercambiables? | Ruptura de simetría B — lex entre grupos idénticos |
| ¿En qué franja cae cada bloque? | Tiers 1–k (calidad) + C (desempate) |
| Certeza formal | Verificación — no-good cut → INFEASIBLE |

> **Nota de honestidad técnica.** La unicidad *literal* (un solo horario factible) casi nunca
> existe en este dominio. Lo que el diseño entrega es **unicidad canónica**: entre las muchas
> soluciones igual de buenas, el orden total selecciona una sola, **reproducible y demostrable**.
> Es lo que el negocio realmente necesita y lo que escala.

---

## 9. Manejo de inviabilidad (INFEASIBLE)

INFEASIBLE en este dominio **casi siempre es dato mal capturado**, no un fallo del solver.
Protocolo de tres niveles, de barato a caro:

**Nivel 1 — Pre-checks de capacidad (antes de invocar al solver).** Condiciones necesarias que
atrapan ~90% de errores de captura con mensaje claro y costo nulo:

```
• Por docente: Σ horas_carga(d) ≤ |slots en disponibilidad(d) ∩ turno|
• Por grupo:   Σ horas_materias(g) ≤ capacidad de la ventana(g)
• Inglés simultáneo: ¿existe franja común libre para todos los grupos del grado?
• Bloque contiguo: ¿algún bloque exige una franja mayor que cualquier hueco disponible?
```

**Nivel 2 — Núcleo mínimo de inconsistencia (IIS) vía supuestos.** Marcar restricciones
candidatas con literales de suposición (`AddAssumption`); ante INFEASIBLE,
`SufficientAssumptionsForInfeasibility()` devuelve el **subconjunto mínimo en conflicto**,
apuntando con precisión quirúrgica a los datos que se contradicen.

**Nivel 3 — Relajación con holguras (*soft constraints*).** Convertir restricciones no esenciales
en blandas con variable de holgura penalizada y minimizar la violación total. Las restricciones
violadas **revelan dónde aprieta el modelo** (p. ej. "el docente X está sobrecargado en 3h"),
convirtiendo un "inviable" opaco en un diagnóstico accionable.

---

## 10. Recomendaciones de arquitecto

1. **Mantener partición, cálculo de días y pre-checks como capa de preproceso**, fuera del solver.
2. **CP-SAT para correctitud; conservar la metaheurística como generador de *hints*.**
3. **Optar por unicidad canónica (objetivo lexicográfico)**, no por unicidad literal.
4. El cuello de botella real no será el solver sino la **calidad del dato**; invertir en la capa
   de validación (Nivel 1) rinde más que cualquier ajuste del modelo.

---

## 11. Glosario y notación

| Símbolo / término | Significado |
|---|---|
| `S` | conjunto global de sesiones (bloques) |
| `c(s) = (g,m,d)` | carga: triple grupo–materia–docente de la sesión `s` |
| `dur(s)` | duración fija del bloque (horas) |
| `dia_s`, `inicio_s` | variables de decisión: día y hora de inicio |
| `t = día·24 + hora` | tiempo linealizado de la semana |
| `y[s,d]` | indicador booleano `(dia_s == d)` |
| `N_c` | número de bloques/días de la carga `c` |
| `balanced(H,N)` | partición balanceada determinista de `H` horas en `N` bloques |
| MRV / LCV | *Minimum Remaining Values* / *Least Constraining Value* |
| IIS | *Irreducible Infeasible Subset* (núcleo mínimo de inconsistencia) |
| *no-good cut* | restricción que prohíbe una solución concreta para forzar otra |
| CP-SAT | solver de programación con restricciones de Google OR-Tools |

---

## 12. Referencias conceptuales

- Google OR-Tools — CP-SAT Solver (modelo de intervalos, `NoOverlap`, `AddDecisionStrategy`,
  `AddAssumption`, optimización lexicográfica por congelamiento).
- Russell & Norvig — *Artificial Intelligence: A Modern Approach* (CSP, MRV, LCV,
  *constraint propagation*, ruptura de simetría).
- Teoría de *job-shop / interval scheduling* aplicada a *timetabling* educativo.

---

*Documento de diseño conceptual. La implementación se valida contra la estrategia de pruebas
descrita en [`estrategia-pruebas-qa.md`](estrategia-pruebas-qa.md).*
