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
            {'name': 'Turno Mañana', 'start': '06:00', 'end': '13:59'},
            {'name': 'Turno Tarde',  'start': '14:00', 'end': '02:00'},
        ],
    },
    'CORRIENTES': {
        'label': 'Sucursal Corrientes',
        'address': 'Av. Corrientes 1237',
        'ranges': [
            {'name': 'Turno Mañana', 'start': '06:00', 'end': '14:59'},
            {'name': 'Turno Tarde',  'start': '15:00', 'end': '02:00'},
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
            {'name': 'Turno Mañana', 'start': '06:00', 'end': '13:59'},
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


def run_analysis(df: pd.DataFrame, ranges: list, dur_ranges: list) -> dict:
    df = df.copy()

    if 'Importe' in df.columns:
        df['Importe'] = pd.to_numeric(df['Importe'], errors='coerce').fillna(0)

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

    def operativo(row):
        cancelado = str(row.get('Cancelado', '') or '').strip()
        if cancelado == 'Cancelado':
            return False
        try:
            importe = float(row.get('Importe', 0) or 0)
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

    if 'Desde_dt' in df_op.columns:
        df_op['turno'] = df_op['Desde_dt'].apply(
            lambda dt: get_shift(dt, ranges) if pd.notna(dt) else 'Sin datos'
        )
        df_op['fecha'] = df_op['Desde_dt'].dt.date
    else:
        df_op['turno'] = 'Sin datos'
        df_op['fecha'] = None

    df_op['dur_bucket'] = df_op['dur_min'].apply(lambda m: dur_bucket(m, dur_ranges))

    total_importe = float(df_op['Importe'].sum()) if 'Importe' in df_op.columns else 0
    avg_importe   = float(df_op['Importe'].mean()) if total_op > 0 and 'Importe' in df_op.columns else 0
    avg_dur       = float(df_op['dur_min'].mean()) if df_op['dur_min'].notna().any() else 0

    shift_order = [r['name'] for r in ranges] if ranges else []
    shift_stats = {}
    for turno, grp in df_op.groupby('turno'):
        shift_stats[str(turno)] = {
            'turno':      str(turno),
            'tickets':    int(len(grp)),
            'importe':    float(grp['Importe'].sum()) if 'Importe' in grp.columns else 0,
            'avg_importe':float(grp['Importe'].mean()) if len(grp) > 0 and 'Importe' in grp.columns else 0,
            'avg_dur':    float(grp['dur_min'].mean()) if grp['dur_min'].notna().any() else 0,
        }

    shift_table = []
    for name in shift_order:
        shift_table.append(shift_stats.get(name, {
            'turno': name, 'tickets': 0, 'importe': 0, 'avg_importe': 0, 'avg_dur': 0
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
                'importe': float(grp['Importe'].sum()) if 'Importe' in grp.columns else 0,
            }

    cat_dist  = {str(k): int(v) for k, v in df_op['Categoría'].value_counts().items()} \
                if 'Categoría' in df_op.columns else {}
    tipo_dist = {str(k): int(v) for k, v in df_op['Tipo'].value_counts().items()} \
                if 'Tipo' in df_op.columns else {}

    return {
        'kpis': {
            'total_raw':       int(total_raw),
            'total_excluidos': total_excl,
            'total_operativo': int(total_op),
            'total_importe':   total_importe,
            'avg_importe':     avg_importe,
            'avg_dur_min':     avg_dur,
        },
        'shift_table': shift_table,
        'dur_dist':    dur_dist,
        'daily_data':  daily_data,
        'cat_dist':    cat_dist,
        'tipo_dist':   tipo_dist,
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
        pd.DataFrame([result['kpis']]).to_excel(writer, sheet_name='KPIs', index=False)
        if result['shift_table']:
            pd.DataFrame(result['shift_table']).to_excel(writer, sheet_name='Por Turno', index=False)
        if result['dur_dist']:
            pd.DataFrame(
                [{'Duración': k, 'Tickets': v} for k, v in result['dur_dist'].items()]
            ).to_excel(writer, sheet_name='Por Duración', index=False)
        if result['daily_data']:
            pd.DataFrame(
                [{'Fecha': k, **v} for k, v in sorted(result['daily_data'].items())]
            ).to_excel(writer, sheet_name='Por Día', index=False)
        if result['cat_dist']:
            pd.DataFrame(
                [{'Categoría': k, 'Tickets': v} for k, v in result['cat_dist'].items()]
            ).to_excel(writer, sheet_name='Categorías', index=False)

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
