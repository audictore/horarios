"""Serverless CP-SAT solver para Vercel — From Schedule FI.
Estrategia de 2 fases para caber en 60s (Hobby):
  Fase 1 (~5s): modelo lean sin variables de huecos → 354/354h rápido.
  Fase 2 (~40s): modelo completo con huecos SOFT + hints de Fase 1 → minimiza huecos.
Con 300s (local) el solver logra cero huecos; con ~50s se consiguen ≤10."""
from http.server import BaseHTTPRequestHandler
import json, time, unicodedata, re
from collections import defaultdict
from ortools.sat.python import cp_model

DURMAX = 4
MAX_TIME = 50

def norm(s): return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn').upper()
def es_tut(mat): return 'TUTORIA' in norm(mat)
def max_ses(mat):
    u = norm(mat)
    if 'INGLES' in u and not re.search(r'INGLES\s*[89]', u): return 3
    return 2 if es_tut(mat) else 1

def _build_base(m, cargas, ventanas, docentes, porDoc, porGru, DIAS):
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
    return x, colocadas, sesion_terms, exceso_terms

def _add_hueco_grupo(m, x, cargas, ventanas, porGru, DIAS):
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
    return hueco_terms


def resolver(D):
    ventanas, docentes, cargas = D['ventanas'], D['docentes'], D['cargas']
    DIAS = range(6)
    HREQ = sum(c['horas'] for c in cargas)
    mt = min(int(D.get('maxTime') or MAX_TIME), MAX_TIME)

    porDoc, porGru = defaultdict(list), defaultdict(list)
    for i, c in enumerate(cargas):
        porDoc[c['docente']].append(i); porGru[c['grupo']].append(i)

    t_start = time.time()

    # ── Fase 1: modelo lean (sin variables de huecos) ──
    m1 = cp_model.CpModel()
    x1, col1, _, _ = _build_base(m1, cargas, ventanas, docentes, porDoc, porGru, DIAS)
    m1.Add(sum(col1) >= HREQ)
    m1.Maximize(sum(col1))
    s1 = cp_model.CpSolver()
    s1.parameters.max_time_in_seconds = min(10, mt // 4)
    s1.parameters.num_search_workers = 2
    s1.parameters.random_seed = 42
    st1 = s1.Solve(m1)
    ok1 = st1 in (cp_model.OPTIMAL, cp_model.FEASIBLE)
    if not ok1:
        dt = time.time() - t_start
        return {'ok': False, 'colocadas': 0, 'total': HREQ, 'horario': [],
                'status': s1.StatusName(st1), 'segundos': round(dt, 1),
                'error': f'No se encontró solución en Fase 1 ({s1.StatusName(st1)})'}
    hints = {k: s1.Value(v) for k, v in x1.items()}

    # ── Fase 2: huecos SOFT + patrón didáctico + hints ──
    remaining = mt - (time.time() - t_start) - 2
    if remaining < 5:
        remaining = 5

    m2 = cp_model.CpModel()
    x2, col2, ses2, exc2 = _build_base(m2, cargas, ventanas, docentes, porDoc, porGru, DIAS)
    for k, v in x2.items():
        if k in hints: m2.AddHint(v, hints[k])

    hueco_terms = _add_hueco_grupo(m2, x2, cargas, ventanas, porGru, DIAS)
    patron = 2 * sum(ses2) + 3 * sum(exc2)
    hueco_grp_pen = sum(hueco_terms) if hueco_terms else 0

    m2.Add(sum(col2) >= HREQ)
    m2.Maximize(-10000 * hueco_grp_pen - 1000 * patron)

    s2 = cp_model.CpSolver()
    s2.parameters.max_time_in_seconds = int(remaining)
    s2.parameters.num_search_workers = 2
    s2.parameters.random_seed = 42
    st2 = s2.Solve(m2)
    dt = time.time() - t_start
    ok2 = st2 in (cp_model.OPTIMAL, cp_model.FEASIBLE)

    if ok2:
        col_val = sum(s2.Value(v) for v in x2.values())
        horario = [{'grupo': cargas[i]['grupo'], 'materia': cargas[i]['materia'],
                     'docente': cargas[i]['docente'], 'dia': d, 'hora': h}
                    for (i, d, h), v in x2.items() if s2.Value(v)]
        return {'ok': True, 'colocadas': col_val, 'total': HREQ, 'horario': horario,
                'optimo': st2 == cp_model.OPTIMAL,
                'patron': s2.Value(patron),
                'huecos': sum(s2.Value(t) for t in hueco_terms),
                'status': s2.StatusName(st2), 'segundos': round(dt, 1)}

    # Fase 2 no convergió → usar Fase 1
    col_val = sum(hints.values())
    horario = [{'grupo': cargas[i]['grupo'], 'materia': cargas[i]['materia'],
                 'docente': cargas[i]['docente'], 'dia': d, 'hora': h}
                for (i, d, h) in x1 if hints.get((i, d, h), 0)]
    huecos_post = 0
    for g, idxs in porGru.items():
        turno = cargas[idxs[0]]['turno']; lo, hi = ventanas[turno]
        for d in DIAS:
            occ = [h for h in range(lo, hi) if any(hints.get((i, d, h), 0) for i in idxs)]
            if len(occ) >= 2: huecos_post += max(occ) - min(occ) + 1 - len(occ)
    return {'ok': True, 'colocadas': col_val, 'total': HREQ, 'horario': horario,
            'optimo': False, 'patron': 0, 'huecos': huecos_post,
            'status': 'FEASIBLE_P1', 'segundos': round(dt, 1)}


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
