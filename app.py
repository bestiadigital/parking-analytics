import os
from flask import Flask, render_template, request, jsonify, send_file
import pandas as pd
import uuid
import json
from datetime import datetime
from io import BytesIO
from collections import OrderedDict

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50 MB

# In-memory file cache — limitado a 100 entradas para evitar uso excesivo de RAM
file_cache = OrderedDict()
MAX_CACHE   = 100

BRANCHES = {
    'ORO': {
        'label': 'Sucursal Oro',
        'address': 'Fray Justo Santa María de Oro 2150, C1425AAQ',
        'ranges': [
            {'name': 'Turno Mañana', 'start': '06:00', 'end': '13:59'},
            {'name': 'Turno Tarde',  'start': '14:00', 'end': '19:59'},
            {'name': 'Turno Noche',  'start': '20:00', 'end': '05:59'},
        ],
    },
    'RODRIGUEZ_PENA': {
        'label': 'Sucursal Rodríguez Peña',
        'address': 'Rodríguez Peña 835',
        'ranges': [
            {'name': 'Turno Mañana', 'start': '05:00', 'end': '13:59'},
            {'name': 'Turno Tarde',  'start': '14:00', 'end': '02:00'},
        ],
    },
    'CORRIENTES': {
        'label': 'Sucursal Corrientes',
        'address': 'Av. Corrientes 1237',
        'ranges': [
            {'name': 'Turno Mañana', 'start': '05:00', 'end': '14:59'},
            {'name': 'Turno Tarde',  'start': '15:00', 'end': '03:00'},
        ],
    },
    'BERUTI': {
        'label': 'Sucursal Beruti',
        'address': 'Beruti 3359',
        'ranges': [
            {'name': 'Turno Mañana', 'start': '06:00', 'end': '13:59'},
            {'name': 'Turno Tarde',  'start': '14:00', 'end': '19:59'},
            {'name': 'Turno Noche',  'start': '20:00', 'end': '05:59'},
        ],
    },
    'RIVADAVIA': {
        'label': 'Sucursal Rivadavia',
        'address': 'Av. Rivadavia 413',
        'ranges': [
            {'name': 'Turno Mañana', 'start': '05:00', 'end': '13:59'},
            {'name': 'Turno Tarde',  'start': '14:00', 'end': '02:00'},
        ],
    },
    'YRIGOYEN': {
        'label': 'Sucursal Yrigoyen',
        'address': 'Av. Hipólito Yrigoyen 672, C1086 AAJ',
        'ranges': [
            {'name': 'Turno Mañana', 'start': '05:00', 'end': '13:59'},
            {'name': 'Turno Tarde',  'start': '14:00', 'end': '02:00'},
        ],
    },
    'HOTEL_MADERO': {
        'label': 'Sucursal Hotel Madero',
        'address': 'Rosario Peñaloza 360',
        'ranges': [],
    },
    'MONROE': {
        'label': 'Sucursal Monroe',
        'address': 'Av. Monroe 1655, C1428',
        'ranges': [
            {'name': 'Turno Mañana', 'start': '06:00', 'end': '13:59'},
            {'name': 'Turno Tarde',  'start': '14:00', 'end': '19:59'},
            {'name': 'Turno Noche',  'start': '20:00', 'end': '05:59'},
        ],
    },
}

DEFAULT_DUR_RANGES = [
    {'name': '0 – 60 min',  'from_min': 0,   'to_min': 60},
    {'name': '1 – 2 hs',    'from_min': 61,  'to_min': 120},
    {'name': '2 – 3 hs',    'from_min': 121, 'to_min': 180},
    {'name': '+3 hs',        'from_min': 181, 'to_min': None},
]


# ── helpers ──────────────────────────────────────────────────────────────────

def cache_put(file_id, df):
    if len(file_cache) >= MAX_CACHE:
        file_cache.popitem(last=False)   # eliminar el más viejo
    file_cache[file_id] = df


def parse_duration_minutes(valor):
    if valor is None:
        return None
    s = str(valor).strip()
    try:
        days = 0
        if 'd' in s:
            parts = s.split('d', 1)
            days = int(parts[0].strip())
            time_part = parts[1].strip()
        else:
            time_part = s
        if ':' in time_part:
            h, m = time_part.split(':', 1)
            return days * 1440 + int(h) * 60 + int(m)
    except Exception:
        pass
    return None


def hhmm_to_min(hhmm: str) -> int:
    h, m = hhmm.split(':')
    return int(h) * 60 + int(m)


def get_shift(entry_dt, ranges):
    if not ranges:
        return 'Sin turno'
    emin = entry_dt.hour * 60 + entry_dt.minute
    for r in ranges:
        if not r.get('start') or not r.get('end'):
            continue
        s = hhmm_to_min(r['start'])
        e = hhmm_to_min(r['end'])
        if s <= e:
            if s <= emin <= e:
                return r['name']
        else:
            if emin >= s or emin <= e:
                return r['name']
    return 'Sin turno'


def dur_bucket(minutes, dur_ranges):
    if minutes is None:
        return 'Sin datos'
    for r in dur_ranges:
        lo = r.get('from_min') or 0
        hi = r.get('to_min')
        if hi is None:
            if minutes >= lo:
                return r['name']
        else:
            if lo <= minutes <= hi:
                return r['name']
    return 'Sin datos'


def normalize_monroe(df: pd.DataFrame) -> pd.DataFrame:
    """Convierte el formato crudo de Monroe al formato estándar."""
    out = df.copy()

    # Fecha+hora de ingreso → Desde
    ingreso = (
        out['INGRESO FECHA'].astype(str) + ' ' +
        out['INGRESO HORA'].fillna(0).astype(int).astype(str).str.zfill(2) + ':' +
        out['INGRESO MINUTO'].fillna(0).astype(int).astype(str).str.zfill(2)
    )
    out['Desde'] = pd.to_datetime(ingreso, format='%d/%m/%Y %H:%M', errors='coerce')

    # Fecha+hora de egreso → Hasta
    egreso = (
        out['EGRESO FECHA'].astype(str) + ' ' +
        out['EGRESO HORA'].fillna(0).astype(int).astype(str).str.zfill(2) + ':' +
        out['EGRESO MINUTO'].fillna(0).astype(int).astype(str).str.zfill(2)
    )
    out['Hasta'] = pd.to_datetime(egreso, format='%d/%m/%Y %H:%M', errors='coerce')

    # Permanencia → Tiempo (formato "Xd HH:MM" compatible con parse_duration_minutes)
    def build_tiempo(row):
        try:
            d = int(row.get('PERM. DIAS', 0) or 0)
            h = int(row.get('PERM. HORAS', 0) or 0)
            m = int(row.get('PERM. MINS.', 0) or 0)
            if d > 0:
                return f'{d}d {h:02d}:{m:02d}'
            return f'{h:02d}:{m:02d}'
        except Exception:
            return None
    out['Tiempo'] = out.apply(build_tiempo, axis=1)

    # Importe cobrado
    out['Cobrado'] = pd.to_numeric(out['IMPORTE'], errors='coerce').fillna(0)

    # Cancelado: bool True → string 'Cancelado'
    out['Cancelado'] = out['CANCELADO'].apply(lambda v: 'Cancelado' if v is True or str(v).lower() == 'true' else '-')

    # Categoría y Tipo
    out['Categoría'] = out['CATEGORIA']
    out['Tipo']      = out['TIPO']

    # Acuerdos desde OBS (vacío = sin acuerdo)
    out['Empresa Acuerdo'] = out['OBS'].astype(str).str.strip().replace({'nan': '', 'NaN': ''})

    # Monroe: importe 0 no cancelado = operativo válido (tráfico corto o convenio $0)
    out['_allow_zero_importe'] = True

    return out


def run_analysis(df: pd.DataFrame, ranges: list, dur_ranges: list) -> dict:
    df = df.copy()

    # Detectar formato Monroe por presencia de columnas propias y normalizar
    if 'INGRESO FECHA' in df.columns:
        df = normalize_monroe(df)

    # Normalizar columna de importe: soporta tanto 'Cobrado' (nuevo) como 'Importe' (legacy Monroe)
    if 'Cobrado' in df.columns:
        df['_importe'] = pd.to_numeric(df['Cobrado'], errors='coerce').fillna(0)
    elif 'Importe' in df.columns:
        df['_importe'] = pd.to_numeric(df['Importe'], errors='coerce').fillna(0)
    else:
        df['_importe'] = 0

    for col in ['Desde', 'Hasta']:
        if col in df.columns:
            parsed = pd.to_datetime(df[col], format='%d/%m/%Y %H:%M', errors='coerce')
            if parsed.isna().mean() > 0.5:
                parsed = pd.to_datetime(df[col], errors='coerce')
            df[col + '_dt'] = parsed

    if 'Tiempo' in df.columns:
        df['dur_min'] = df['Tiempo'].apply(parse_duration_minutes)
    else:
        df['dur_min'] = None

    allow_zero = '_allow_zero_importe' in df.columns

    def operativo(row):
        cancelado = str(row.get('Cancelado', '') or '').strip()
        if cancelado == 'Cancelado':
            return False
        if allow_zero:
            return True
        try:
            importe = float(row.get('_importe', 0) or 0)
        except (TypeError, ValueError):
            importe = 0
        if importe == 0 and cancelado in ('', '-', '_'):
            return False
        return True

    df['_op'] = df.apply(operativo, axis=1)
    total_raw  = len(df)
    total_excl = int((~df['_op']).sum())
    df_op      = df[df['_op']].copy()
    total_op   = len(df_op)

    # turno de entrada (Desde) y turno de salida (Hasta)
    if 'Desde_dt' in df_op.columns:
        df_op['turno_entrada'] = df_op['Desde_dt'].apply(
            lambda dt: get_shift(dt, ranges) if pd.notna(dt) else 'Sin datos'
        )
        df_op['fecha'] = df_op['Desde_dt'].dt.date
    else:
        df_op['turno_entrada'] = 'Sin datos'
        df_op['fecha'] = None

    if 'Hasta_dt' in df_op.columns:
        df_op['turno_salida'] = df_op['Hasta_dt'].apply(
            lambda dt: get_shift(dt, ranges) if pd.notna(dt) else 'Sin datos'
        )
    else:
        df_op['turno_salida'] = 'Sin datos'

    # mantener compatibilidad: turno = turno de entrada
    df_op['turno'] = df_op['turno_entrada']

    df_op['dur_bucket'] = df_op['dur_min'].apply(lambda m: dur_bucket(m, dur_ranges))

    total_importe = float(df_op['_importe'].sum())
    avg_importe   = float(df_op['_importe'].mean()) if total_op > 0 else 0
    avg_dur       = float(df_op['dur_min'].mean()) if df_op['dur_min'].notna().any() else 0

    shift_order = [r['name'] for r in ranges] if ranges else []

    # entradas por turno
    entradas_by_turno = df_op.groupby('turno_entrada').size().to_dict()
    # salidas por turno
    salidas_by_turno  = df_op.groupby('turno_salida').size().to_dict()

    shift_stats = {}
    for turno, grp in df_op.groupby('turno_entrada'):
        shift_stats[str(turno)] = {
            'turno':      str(turno),
            'entradas':   int(entradas_by_turno.get(turno, 0)),
            'salidas':    int(salidas_by_turno.get(turno, 0)),
            'importe':    float(grp['_importe'].sum()),
            'avg_importe':float(grp['_importe'].mean()) if len(grp) > 0 else 0,
            'avg_dur':    float(grp['dur_min'].mean()) if grp['dur_min'].notna().any() else 0,
        }

    shift_table = []
    for name in shift_order:
        shift_table.append(shift_stats.get(name, {
            'turno': name, 'entradas': 0, 'salidas': 0,
            'importe': 0, 'avg_importe': 0, 'avg_dur': 0,
        }))
    if 'Sin turno' in shift_stats and shift_order:
        shift_table.append(shift_stats['Sin turno'])
    if not shift_order:
        shift_table = list(shift_stats.values())

    dur_order  = [r['name'] for r in dur_ranges]
    dur_counts = df_op['dur_bucket'].value_counts().to_dict()
    dur_dist   = {k: int(dur_counts.get(k, 0)) for k in dur_order}
    for k, v in dur_counts.items():
        if k not in dur_dist:
            dur_dist[k] = int(v)

    daily_data = {}
    if 'fecha' in df_op.columns and df_op['fecha'].notna().any():
        for fecha, grp in df_op.groupby('fecha'):
            daily_data[str(fecha)] = {
                'tickets': int(len(grp)),
                'importe': float(grp['_importe'].sum()),
            }

    cat_dist  = {str(k): int(v) for k, v in df_op['Categoría'].value_counts().items()} \
                if 'Categoría' in df_op.columns else {}
    tipo_dist = {str(k): int(v) for k, v in df_op['Tipo'].value_counts().items()} \
                if 'Tipo' in df_op.columns else {}

    # Distribución por empresa acuerdo: empresas con nombre + celda vacía = sin acuerdo
    acuerdo_dist = {}
    acuerdo_sin_acuerdo = 0
    if 'Empresa Acuerdo' in df_op.columns:
        col = df_op['Empresa Acuerdo'].astype(str).str.strip()
        mask_vacio = col.isin(['', 'nan', 'NaN', 'None'])
        acuerdo_sin_acuerdo = int(mask_vacio.sum())
        acuerdo_dist = {str(k): int(v) for k, v in col[~mask_vacio].value_counts().items()}

    return {
        'kpis': {
            'total_raw':       int(total_raw),
            'total_excluidos': total_excl,
            'total_operativo': int(total_op),
            'total_importe':   total_importe,
            'avg_importe':     avg_importe,
            'avg_dur_min':     avg_dur,
        },
        'shift_table':  shift_table,
        'dur_dist':     dur_dist,
        'daily_data':   daily_data,
        'cat_dist':     cat_dist,
        'tipo_dist':    tipo_dist,
        'acuerdo_dist':         acuerdo_dist,
        'acuerdo_sin_acuerdo':  acuerdo_sin_acuerdo,
    }


# ── routes ────────────────────────────────────────────────────────────────────

@app.route('/')
def index():
    return render_template('index.html', branches=BRANCHES)


@app.route('/api/upload', methods=['POST'])
def upload():
    if 'file' not in request.files:
        return jsonify({'error': 'No se recibió archivo'}), 400
    f     = request.files['file']
    fname = (f.filename or '').lower()
    if not (fname.endswith('.xlsx') or fname.endswith('.xls')):
        return jsonify({'error': 'Solo se aceptan archivos .xlsx o .xls'}), 400
    try:
        engine  = 'openpyxl' if fname.endswith('.xlsx') else 'xlrd'
        df      = pd.read_excel(f, engine=engine)
        file_id = str(uuid.uuid4())
        cache_put(file_id, df)
        return jsonify({
            'file_id':  file_id,
            'rows':     len(df),
            'columns':  list(df.columns),
            'preview':  df.head(6).astype(str).fillna('').values.tolist(),
        })
    except Exception as e:
        return jsonify({'error': f'Error al leer el archivo: {e}'}), 500


@app.route('/api/analyze', methods=['POST'])
def analyze():
    data       = request.get_json()
    file_id    = data.get('file_id')
    branch     = data.get('branch', '')
    ranges     = data.get('ranges', [])
    dur_ranges = data.get('dur_ranges', DEFAULT_DUR_RANGES)

    if not file_id or file_id not in file_cache:
        return jsonify({'error': 'Archivo no encontrado. Subí el Excel nuevamente.'}), 400

    df = file_cache[file_id]
    try:
        result = run_analysis(df, ranges, dur_ranges)
        result['branch']       = branch
        result['branch_label'] = BRANCHES.get(branch, {}).get('label', branch)
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': f'Error en el análisis: {e}'}), 500


@app.route('/api/export/excel', methods=['POST'])
def export_excel():
    data       = request.get_json()
    file_id    = data.get('file_id')
    branch     = data.get('branch', 'SIN_SUCURSAL')
    ranges     = data.get('ranges', [])
    dur_ranges = data.get('dur_ranges', DEFAULT_DUR_RANGES)

    if not file_id or file_id not in file_cache:
        return jsonify({'error': 'Archivo no encontrado'}), 400

    df = file_cache[file_id]
    try:
        result = run_analysis(df, ranges, dur_ranges)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

    output = BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:

        # ── KPIs: formato Métrica / Valor ──────────────────────────────────
        k = result['kpis']
        pd.DataFrame([
            {'Métrica': 'Tickets Operativos',        'Valor': k['total_operativo']},
            {'Métrica': 'Ingresos Totales',           'Valor': k['total_importe']},
            {'Métrica': 'Ticket Promedio',            'Valor': k['avg_importe']},
            {'Métrica': 'Duración Promedio (min)',    'Valor': k['avg_dur_min']},
            {'Métrica': 'Excluidos (Cancelados o $0)','Valor': k['total_excluidos']},
        ]).to_excel(writer, sheet_name='KPIs', index=False)

        # ── Turnos: filas = métricas, columnas = turnos ────────────────────
        if result['shift_table']:
            st = result['shift_table']
            turnos_cols = {r['turno']: r for r in st}
            col_names   = [r['turno'] for r in st]
            rows_turnos = [
                {'': 'Entradas',         **{t: turnos_cols[t]['entradas']    for t in col_names}},
                {'': 'Salidas',          **{t: turnos_cols[t]['salidas']     for t in col_names}},
                {'': 'Ingresos',         **{t: turnos_cols[t]['importe']     for t in col_names}},
                {'': 'Ticket Promedio',  **{t: turnos_cols[t]['avg_importe'] for t in col_names}},
                {'': 'Duración Promedio',**{t: turnos_cols[t]['avg_dur']     for t in col_names}},
            ]
            pd.DataFrame(rows_turnos).to_excel(writer, sheet_name='Turnos', index=False)

        # ── Duración: una fila, rangos como columnas ───────────────────────
        if result['dur_dist']:
            pd.DataFrame([result['dur_dist']]).to_excel(writer, sheet_name='Duración', index=False)

        # ── Categorías ─────────────────────────────────────────────────────
        if result['cat_dist']:
            pd.DataFrame(
                [{'Categoría': k, 'Tickets': v} for k, v in result['cat_dist'].items()]
            ).to_excel(writer, sheet_name='Categorías', index=False)

        # ── Por Día ────────────────────────────────────────────────────────
        if result['daily_data']:
            pd.DataFrame(
                [{'Fecha': k, 'Tickets': v['tickets'], 'Importe': v['importe']}
                 for k, v in sorted(result['daily_data'].items())]
            ).to_excel(writer, sheet_name='Por Día', index=False)

        # ── Acuerdos (solo si hay datos) ───────────────────────────────────
        if result.get('acuerdo_dist') or result.get('acuerdo_sin_acuerdo'):
            rows_ac = [{'Empresa Acuerdo': k, 'Tickets': v}
                       for k, v in result['acuerdo_dist'].items()]
            rows_ac.append({'Empresa Acuerdo': '(Sin acuerdo / celda vacía)',
                            'Tickets': result.get('acuerdo_sin_acuerdo', 0)})
            rows_ac.append({'Empresa Acuerdo': 'TOTAL',
                            'Tickets': sum(r['Tickets'] for r in rows_ac)})
            pd.DataFrame(rows_ac).to_excel(writer, sheet_name='Acuerdos', index=False)

    output.seek(0)
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    return send_file(
        output,
        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        as_attachment=True,
        download_name=f'analisis_{branch}_{ts}.xlsx',
    )


# ── entry point ───────────────────────────────────────────────────────────────

if __name__ == '__main__':
    port  = int(os.environ.get('PORT', 5001))
    debug = os.environ.get('FLASK_DEBUG', 'false').lower() == 'true'
    app.run(host='0.0.0.0', port=port, debug=debug)
