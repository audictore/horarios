"""Serverless CP-SAT solver para Vercel — From Schedule FI."""
from http.server import BaseHTTPRequestHandler
import json, time, unicodedata, re
from collections import defaultdict
from ortools.sat.python import cp_model

DURMAX = 4
MAX_TIME = 55  # Vercel Hobby = 60s, dejamos 5s de margen

def norm(s): return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn').upper()
def es_tut(mat): return 'TUTORIA' in norm(mat)
def max_ses(mat):
    u = norm(mat)
    if 'INGLES' in u and not re.search(r'INGLES\s*[89]', u): return 3
    return 2 if es_tut(mat) else 1

def resolver(D):
    ventanas, docentes, cargas = D['ventanas'], D['docentes'], D['cargas']
    DIAS = range(6)
    HREQ = sum(c['horas'] for c in cargas)
    mt = min(int(D.get('maxTime') or MAX_TIME), MAX_TIME)
    m = cp_model.CpModel()

    x = {}
    for i, c in enumerate(cargas):
        lo, hi = ventanas[c['turno']]; disp = docentes[c['docente']]['disponibilidad']
        for d in DIAS:
            dd = set(disp.get(str(d), []))
            for h in range(lo, hi):
                if h in dd: x[(i, d, h)] = m.NewBoolVar(f'x_{i}_{d}_{h}')

    colocadas = []
    for i, c in enumerate(cargas):
        s = [x[(i, d, h)] for d in DIAS for h in range(*ventanas[c['turno']]) if (i, d, h) in x]
        m.Add(sum(s) <= c['horas']); colocadas.append(sum(s))
        for d in DIAS:
            sd = [x[(i, d, h)] for h in range(*ventanas[c['turno']]) if (i, d, h) in x]
            if sd: m.Add(sum(sd) <= DURMAX)

    porDoc, porGru = defaultdict(list), defaultdict(list)
    for i, c in enumerate(cargas):
        porDoc[c['docente']].append(i); porGru[c['grupo']].append(i)
    for idxs in list(porDoc.values()) + list(porGru.values()):
        for d in DIAS:
            for h in range(7, 21):
                t = [x[(i, d, h)] for i in idxs if (i, d, h) in x]
                if len(t) > 1: m.AddAtMostOne(t)

    sesion_terms, exceso_terms = [], []
    for i, c in enumerate(cargas):
        lim = max_ses(c['materia']); lo, hi = ventanas[c['turno']]
        normal = not es_tut(c['materia'])
        for d in DIAS:
            inicios = []
            for h in range(lo, hi):
                if (i, d, h) not in x: continue
                ini = m.NewBoolVar(f'ini_{i}_{d}_{h}'); prev = x.get((i, d, h - 1))
                if prev is None: m.Add(ini == x[(i, d, h)])
                else: m.Add(ini <= x[(i, d, h)]); m.Add(ini <= 1 - prev); m.Add(ini >= x[(i, d, h)] - prev)
                inicios.append(ini)
            if inicios: m.Add(sum(inicios) <= lim)
            if normal:
                sesion_terms.extend(inicios)
                for h in range(lo + 2, hi):
                    if (i, d, h) in x and (i, d, h - 1) in x and (i, d, h - 2) in x:
                        e = m.NewBoolVar(f'exc_{i}_{d}_{h}')
                        m.Add(e >= x[(i, d, h)] + x[(i, d, h - 1)] + x[(i, d, h - 2)] - 2)
                        exceso_terms.append(e)
    for e in exceso_terms: m.Add(e == 0)

    sync = defaultdict(list)
    for i, c in enumerate(cargas):
        if c.get('sync'): sync[c['sync']].append(i)
    for idxs in sync.values():
        if len(idxs) < 2: continue
        for d in DIAS:
            for h in range(7, 21):
                vs = [x[(i, d, h)] for i in idxs if (i, d, h) in x]
                if len(vs) == len(idxs):
                    for k in range(1, len(vs)): m.Add(vs[0] == vs[k])
                else:
                    for v in vs: m.Add(v == 0)

    for doc, idxs in porDoc.items():
        md = docentes[doc].get('maxDias')
        if docentes[doc]['tipo'] != 2 or md is None: continue
        dias_doc = []
        for d in DIAS:
            slots = [x[(i, d, h)] for i in idxs for h in range(7, 21) if (i, d, h) in x]
            if not slots: continue
            y = m.NewBoolVar(f'act_{doc}_{d}')
            for v in slots: m.Add(y >= v)
            m.Add(y <= sum(slots)); dias_doc.append(y)
        if dias_doc: m.Add(sum(dias_doc) <= md)

    hueco_terms = []
    for g, idxs in porGru.items():
        turno = cargas[idxs[0]]['turno']; lo, hi = ventanas[turno]
        for d in DIAS:
            slots = {h: [x[(i, d, h)] for i in idxs if (i, d, h) in x] for h in range(lo, hi)}
            ocup = {h: m.NewBoolVar(f'oc_{g}_{d}_{h}') for h in range(lo, hi) if slots[h]}
            for h, ov in ocup.items(): m.Add(ov == sum(slots[h]))
            if len(ocup) < 2: continue
            prim = m.NewIntVar(lo, hi, f'pri_{g}_{d}'); ult = m.NewIntVar(lo, hi, f'ult_{g}_{d}')
            tiene = m.NewBoolVar(f'tie_{g}_{d}')
            m.Add(sum(ocup.values()) >= 1).OnlyEnforceIf(tiene)
            m.Add(sum(ocup.values()) == 0).OnlyEnforceIf(tiene.Not())
            for h, ov in ocup.items():
                m.Add(prim <= h).OnlyEnforceIf(ov); m.Add(ult >= h + 1).OnlyEnforceIf(ov)
            span = m.NewIntVar(0, hi - lo, f'span_{g}_{d}')
            m.Add(span == ult - prim).OnlyEnforceIf(tiene); m.Add(span == 0).OnlyEnforceIf(tiene.Not())
            hk = m.NewIntVar(0, hi - lo, f'hk_{g}_{d}')
            m.Add(hk == span - sum(ocup.values())); hueco_terms.append(hk)
    for hk in hueco_terms: m.Add(hk == 0)

    MIN_HORAS_DOC = 3
    hueco_doc_terms, corto_doc_terms = [], []
    hueco_por_doc = defaultdict(list)
    for doc, idxs in porDoc.items():
        for d in DIAS:
            slots = {h: [x[(i, d, h)] for i in idxs if (i, d, h) in x] for h in range(7, 21)}
            ocup = {h: m.NewBoolVar(f'od_{doc}_{d}_{h}') for h in range(7, 21) if slots[h]}
            for h, ov in ocup.items(): m.Add(ov == sum(slots[h]))
            if not ocup: continue
            horas_dd = m.NewIntVar(0, 14, f'hdd_{doc}_{d}'); m.Add(horas_dd == sum(ocup.values()))
            tiene = m.NewBoolVar(f'dti_{doc}_{d}')
            m.Add(horas_dd >= 1).OnlyEnforceIf(tiene); m.Add(horas_dd == 0).OnlyEnforceIf(tiene.Not())
            corto_d = m.NewIntVar(0, MIN_HORAS_DOC, f'crd_{doc}_{d}')
            m.Add(corto_d >= MIN_HORAS_DOC - horas_dd - MIN_HORAS_DOC * (1 - tiene))
            corto_doc_terms.append(corto_d)
            if len(ocup) < 2: continue
            prim = m.NewIntVar(7, 21, f'dpr_{doc}_{d}'); ult = m.NewIntVar(7, 21, f'dul_{doc}_{d}')
            for h, ov in ocup.items():
                m.Add(prim <= h).OnlyEnforceIf(ov); m.Add(ult >= h + 1).OnlyEnforceIf(ov)
            span = m.NewIntVar(0, 14, f'dsp_{doc}_{d}')
            m.Add(span == ult - prim).OnlyEnforceIf(tiene); m.Add(span == 0).OnlyEnforceIf(tiene.Not())
            hk = m.NewIntVar(0, 14, f'dhk_{doc}_{d}')
            m.Add(hk == span - horas_dd); hueco_doc_terms.append(hk)
            hueco_por_doc[doc].append(hk)
    for doc, hks in hueco_por_doc.items():
        if docentes[doc]['tipo'] != 2 or not hks: continue
        m.Add(sum(hks) <= 3)

    abierto_gd, horas_gd = {}, {}
    for g, idxs in porGru.items():
        turno = cargas[idxs[0]]['turno']; lo, hi = ventanas[turno]
        for d in DIAS:
            slots = [x[(i, d, h)] for i in idxs for h in range(lo, hi) if (i, d, h) in x]
            if not slots: continue
            hgd = m.NewIntVar(0, hi - lo, f'hgd_{g}_{d}'); m.Add(hgd == sum(slots))
            abr = m.NewBoolVar(f'abr_{g}_{d}')
            m.Add(hgd >= 1).OnlyEnforceIf(abr); m.Add(hgd == 0).OnlyEnforceIf(abr.Not())
            horas_gd[(g, d)] = hgd; abierto_gd[(g, d)] = abr

    desnivel_terms = []
    for g, idxs in porGru.items():
        turno = cargas[idxs[0]]['turno']; lo, hi = ventanas[turno]
        dias_g = [d for d in DIAS if (g, d) in abierto_gd]
        if len(dias_g) < 2: continue
        max_g = m.NewIntVar(0, hi - lo, f'maxg_{g}'); min_g = m.NewIntVar(0, hi - lo, f'ming_{g}')
        for d in dias_g:
            m.Add(max_g >= horas_gd[(g, d)])
            m.Add(min_g <= horas_gd[(g, d)]).OnlyEnforceIf(abierto_gd[(g, d)])
        spread = m.NewIntVar(0, hi - lo, f'spr_{g}'); m.Add(spread == max_g - min_g)
        desnivel_terms.append(spread)

    margen_terms = []
    for g, idxs in porGru.items():
        turno = cargas[idxs[0]]['turno']; h_critico = 7 if turno == 'matutino' else 20
        for d in DIAS:
            if (g, d) not in abierto_gd: continue
            slot = [x[(i, d, h_critico)] for i in idxs if (i, d, h_critico) in x]
            if not slot: continue
            ocup = m.NewBoolVar(f'mc_{g}_{d}'); m.Add(ocup == sum(slot))
            pen = m.NewBoolVar(f'mrg_{g}_{d}'); m.Add(pen >= abierto_gd[(g, d)] - ocup)
            margen_terms.append(pen)

    aulas_cfg = D.get('aulas') or {}
    aula_clash_terms = []
    if aulas_cfg.get('aulas'):
        norm_grp = lambda s: re.sub(r'[^A-Z0-9 ]', '', norm(s)).strip()
        gr_base = aulas_cfg.get('grupoAulas') or {}
        gr_base_norm = {norm_grp(g): v for g, v in gr_base.items()}
        grupo_turno = {}
        for c in cargas:
            ng = norm_grp(c['grupo'])
            if ng not in grupo_turno: grupo_turno[ng] = c['turno']
        base_aula_gs = defaultdict(list)
        for g in gr_base: base_aula_gs[gr_base[g]].append(norm_grp(g))
        shared_prio = {}
        for aid, gs in base_aula_gs.items():
            by_t = defaultdict(list)
            for g in gs:
                t = grupo_turno.get(g)
                if t: by_t[t].append(g)
            if len(by_t) > 1:
                vs = sorted([(t, ventanas[t][0], ventanas[t][1], ggs) for t, ggs in by_t.items()], key=lambda v: v[1])
                o_lo, o_hi = max(v[1] for v in vs), min(v[2] for v in vs)
                if o_lo < o_hi:
                    non_p = set()
                    for v in vs[1:]: non_p.update(v[3])
                    shared_prio[aid] = (non_p, o_lo, o_hi)
        single_map, hour_restricted = defaultdict(list), defaultdict(list)
        for i, c in enumerate(cargas):
            asig = aulas_cfg.get('asignaciones', {}).get(c['materia'])
            if not asig:
                nm = norm(c['materia'])
                for k, v in aulas_cfg.get('asignaciones', {}).items():
                    if norm(k) == nm: asig = v; break
            if asig and asig.get('aulas'):
                for aid in asig['aulas']: single_map[aid].append(i)
                continue
            base = gr_base_norm.get(norm_grp(c['grupo']))
            if base:
                sp = shared_prio.get(base)
                if sp and norm_grp(c['grupo']) in sp[0]:
                    hour_restricted[base].append((i, sp[1], sp[2]))
                else:
                    single_map[base].append(i)
        all_aids = set(single_map) | set(hour_restricted)
        for aid in all_aids:
            idxs = single_map.get(aid, [])
            rest = hour_restricted.get(aid, [])
            for d in DIAS:
                for h in range(7, 21):
                    t = [x[(i, d, h)] for i in idxs if (i, d, h) in x]
                    for ri, o_lo, o_hi in rest:
                        if (h < o_lo or h >= o_hi) and (ri, d, h) in x: t.append(x[(ri, d, h)])
                    if len(t) > 1:
                        clash = m.NewIntVar(0, len(t), f'ac_{aid}_{d}_{h}')
                        m.Add(clash >= sum(t) - 1); aula_clash_terms.append(clash)
        pool_ses = defaultdict(list)
        for i, c in enumerate(cargas):
            pool = aulas_cfg.get('pools', {}).get(c['materia'])
            if not pool:
                nm = norm(c['materia'])
                for k, v in aulas_cfg.get('pools', {}).items():
                    if norm(k) == nm: pool = v; break
            if pool:
                for t in pool.get('tipos', []): pool_ses[t].append(i)
        pool_cap = aulas_cfg.get('poolCapacidad', {})
        for tipo, idxs in pool_ses.items():
            cap = pool_cap.get(tipo, 1)
            if cap < 2: continue
            for d in DIAS:
                for h in range(7, 21):
                    t = [x[(i, d, h)] for i in idxs if (i, d, h) in x]
                    if len(t) > cap: m.Add(sum(t) <= cap)

    patron = 2 * sum(sesion_terms) + 3 * sum(exceso_terms)
    aula_pen = sum(aula_clash_terms) if aula_clash_terms else 0
    m.Add(sum(colocadas) >= HREQ)
    m.Maximize(-1000 * patron - 100 * sum(hueco_doc_terms) - 500 * sum(desnivel_terms)
               - 200 * sum(corto_doc_terms) - sum(margen_terms) - 50 * aula_pen)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = mt
    solver.parameters.num_search_workers = 8
    solver.parameters.random_seed = 42
    t0 = time.time(); st = solver.Solve(m); dt = time.time() - t0
    ok = st in (cp_model.OPTIMAL, cp_model.FEASIBLE)
    col = sum(solver.Value(v) for v in x.values()) if ok else 0

    if ok:
        horario = [{'grupo': cargas[i]['grupo'], 'materia': cargas[i]['materia'],
                     'docente': cargas[i]['docente'], 'dia': d, 'hora': h}
                    for (i, d, h), v in x.items() if solver.Value(v)]
        return {'ok': True, 'colocadas': col, 'total': HREQ, 'horario': horario,
                'optimo': st == cp_model.OPTIMAL,
                'patron': solver.Value(patron),
                'huecos': sum(solver.Value(t) for t in hueco_terms),
                'status': solver.StatusName(st), 'segundos': round(dt, 1)}
    return {'ok': False, 'colocadas': 0, 'total': HREQ, 'horario': [],
            'status': solver.StatusName(st), 'segundos': round(dt, 1),
            'error': f'No se encontró solución ({solver.StatusName(st)})'}


class handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        try:
            body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
            datos = json.loads(body)
            result = resolver(datos)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self._cors()
            self.end_headers()
            self.wfile.write(json.dumps(result, ensure_ascii=False).encode('utf-8'))
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self._cors()
            self.end_headers()
            self.wfile.write(json.dumps({'ok': False, 'error': str(e)}).encode('utf-8'))
