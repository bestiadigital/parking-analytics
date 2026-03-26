/* ── STATE ───────────────────────────────────────────────────────────────── */
const state = {
  fileId: null,
  fileName: null,
  lastResult: null,
  comparisons: [],
  charts: {},
};

/* ── CHART PALETTE ───────────────────────────────────────────────────────── */
const PALETTE = [
  '#3b82f6', '#06b6d4', '#8b5cf6', '#10b981',
  '#f59e0b', '#f43f5e', '#6366f1', '#14b8a6',
];
const GRID_COLOR  = 'rgba(26,51,86,.6)';
const TICK_COLOR  = '#3d6080';
const FONT_FAMILY = "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";

Chart.defaults.font.family = FONT_FAMILY;

/* ── INIT ────────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  setupDropzone();
  onBranchChange();           // populate address + ranges from first branch
});

/* ── BRANCH ──────────────────────────────────────────────────────────────── */
function onBranchChange() {
  const key = document.getElementById('branchSelect').value;
  const b   = BRANCHES[key] || {};
  document.getElementById('branchAddress').textContent = b.address || '';
  document.getElementById('headerBranch').textContent  = b.label   || key;
  renderRanges(b.ranges || []);
}

/* ── DROPZONE ────────────────────────────────────────────────────────────── */
function setupDropzone() {
  const zone  = document.getElementById('dropzone');
  const input = document.getElementById('fileInput');

  zone.addEventListener('dragover', e => {
    e.preventDefault();
    zone.classList.add('drag-over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });
  input.addEventListener('change', () => {
    if (input.files[0]) handleFile(input.files[0]);
  });
}

async function handleFile(file) {
  const zone = document.getElementById('dropzone');
  const info = document.getElementById('fileInfo');

  setLoading(true, 'Leyendo archivo...');

  const fd = new FormData();
  fd.append('file', file);

  try {
    const res  = await fetch('/api/upload', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al subir');

    state.fileId   = data.file_id;
    state.fileName = file.name;

    zone.classList.add('loaded');
    zone.querySelector('.drop-text').textContent = `✓  ${file.name}`;

    info.textContent = `${data.rows.toLocaleString('es-AR')} filas · ${data.columns.length} columnas`;
    info.classList.remove('hidden');

    showPreview(data);
  } catch (err) {
    alert('Error al cargar el archivo:\n' + err.message);
    zone.classList.remove('loaded');
  } finally {
    setLoading(false);
  }
}

/* ── PREVIEW ─────────────────────────────────────────────────────────────── */
function showPreview(data) {
  const section = document.getElementById('previewSection');
  const meta    = document.getElementById('previewMeta');
  const table   = document.getElementById('previewTable');

  meta.textContent = `${data.rows.toLocaleString('es-AR')} filas · ${data.columns.length} columnas · mostrando las primeras ${data.preview.length}`;

  // Build table
  let html = '<thead><tr>' + data.columns.map(c => `<th>${esc(c)}</th>`).join('') + '</tr></thead><tbody>';
  html += data.preview.map(row =>
    '<tr>' + row.map(cell => `<td>${esc(cell)}</td>`).join('') + '</tr>'
  ).join('');
  html += '</tbody>';
  table.innerHTML = html;

  section.classList.remove('hidden');
  document.getElementById('emptyState').classList.add('hidden');
}

function togglePreview() {
  const wrap  = document.getElementById('previewTableWrap');
  const label = document.getElementById('previewToggleLabel');
  const hidden = wrap.style.display === 'none';
  wrap.style.display = hidden ? '' : 'none';
  label.textContent  = hidden ? 'Ocultar' : 'Mostrar';
}

/* ── RANGE EDITOR ────────────────────────────────────────────────────────── */
function renderRanges(ranges) {
  const c = document.getElementById('rangesContainer');
  c.innerHTML = '';
  ranges.forEach(r => addRangeRow(r.name, r.start, r.end));
}

function addRangeRow(name = '', start = '', end = '') {
  const c   = document.getElementById('rangesContainer');
  const row = document.createElement('div');
  row.className = 'range-row';
  row.innerHTML = `
    <input type="text"  placeholder="Turno" value="${esc(name)}" class="r-name">
    <input type="text"  placeholder="Desde" value="${esc(start)}" class="r-start">
    <input type="text"  placeholder="Hasta" value="${esc(end)}"   class="r-end">
    <button class="btn-del" title="Eliminar" onclick="this.parentElement.remove()">×</button>`;
  c.appendChild(row);
}

function getRanges() {
  return [...document.querySelectorAll('#rangesContainer .range-row')].map(row => ({
    name:  row.querySelector('.r-name').value.trim(),
    start: row.querySelector('.r-start').value.trim(),
    end:   row.querySelector('.r-end').value.trim(),
  })).filter(r => r.name);
}

function resetRanges() {
  const key = document.getElementById('branchSelect').value;
  renderRanges(BRANCHES[key]?.ranges || []);
}

/* ── DURATION RANGE EDITOR ───────────────────────────────────────────────── */
(function initDurRanges() {
  document.addEventListener('DOMContentLoaded', () => renderDurRanges(DEFAULT_DUR_RANGES));
})();

function renderDurRanges(ranges) {
  const c = document.getElementById('durContainer');
  c.innerHTML = '';
  ranges.forEach(r => addDurRow(r.name, r.from_min, r.to_min));
}

function addDurRow(name = '', from_min = '', to_min = '') {
  const c   = document.getElementById('durContainer');
  const row = document.createElement('div');
  row.className = 'dur-row';
  row.innerHTML = `
    <input type="text"   placeholder="Rango" value="${esc(name)}"     class="d-name">
    <input type="number" placeholder="Desde"  value="${from_min ?? ''}" class="d-from" min="0">
    <input type="number" placeholder="Hasta"  value="${to_min ?? ''}"  class="d-to"   min="0">
    <button class="btn-del" title="Eliminar" onclick="this.parentElement.remove()">×</button>`;
  c.appendChild(row);
}

function getDurRanges() {
  return [...document.querySelectorAll('#durContainer .dur-row')].map(row => ({
    name:     row.querySelector('.d-name').value.trim(),
    from_min: toNumOrNull(row.querySelector('.d-from').value),
    to_min:   toNumOrNull(row.querySelector('.d-to').value),
  })).filter(r => r.name);
}

function resetDurRanges() { renderDurRanges(DEFAULT_DUR_RANGES); }

/* ── ANALYZE ─────────────────────────────────────────────────────────────── */
async function doAnalyze() {
  if (!state.fileId) {
    alert('Primero subí un archivo Excel.');
    return;
  }
  const branch    = document.getElementById('branchSelect').value;
  const ranges    = getRanges();
  const durRanges = getDurRanges();

  setLoading(true, 'Analizando datos...');

  try {
    const res  = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: state.fileId, branch, ranges, dur_ranges: durRanges }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error en el análisis');

    state.lastResult = { ...data, ranges, durRanges, fileName: state.fileName };
    renderResults(data);
    enablePostAnalysisButtons(true);
  } catch (err) {
    alert('Error:\n' + err.message);
  } finally {
    setLoading(false);
  }
}

/* ── RENDER RESULTS ──────────────────────────────────────────────────────── */
function renderResults(data) {
  document.getElementById('emptyState').classList.add('hidden');
  const section = document.getElementById('resultsSection');
  section.classList.remove('hidden');

  // Header
  document.getElementById('resultsBranchLabel').textContent = data.branch_label || data.branch;
  document.getElementById('resultsTimestamp').textContent =
    'Análisis realizado el ' + new Date().toLocaleString('es-AR');

  const k = data.kpis;
  const excPct = k.total_raw > 0 ? ((k.total_excluidos / k.total_raw) * 100).toFixed(1) : 0;
  document.getElementById('filterBadge').textContent =
    `${k.total_excluidos.toLocaleString('es-AR')} excluidos (${excPct}% del total)`;

  // KPIs
  renderKPIs(k);

  // Charts
  renderCharts(data);

  // Shift table
  renderShiftTable(data.shift_table);

  // Scroll to results
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderKPIs(k) {
  const container = document.getElementById('kpisRow');
  const avgDurStr = formatMinutes(k.avg_dur_min);
  container.innerHTML = `
    ${kpiCard(k.total_operativo.toLocaleString('es-AR'), 'Tickets operativos', 'info', 'blue')}
    ${kpiCard(k.total_excluidos.toLocaleString('es-AR'), 'Excluidos',          'warn', 'amber')}
    ${kpiCard(formatCurrency(k.total_importe),            'Ingresos totales',   'ok',   'green')}
    ${kpiCard(formatCurrency(k.avg_importe),              'Ticket promedio',    '',     '')}
    ${kpiCard(avgDurStr,                                  'Duración promedio',  '',     '')}
  `;
}

function kpiCard(value, label, cardClass, valueClass) {
  return `
    <div class="kpi-card ${cardClass}">
      <div class="kpi-value ${valueClass}">${value}</div>
      <div class="kpi-label">${label}</div>
    </div>`;
}

/* ── CHARTS ──────────────────────────────────────────────────────────────── */
function renderCharts(data) {
  // Destroy old charts
  Object.values(state.charts).forEach(c => c.destroy());
  state.charts = {};

  const { shift_table, dur_dist, daily_data, cat_dist } = data;

  // --- Tickets por turno (horizontal bar) ---
  const shiftLabels = shift_table.map(r => r.turno);
  const shiftTickets = shift_table.map(r => r.tickets);
  state.charts.turnos = new Chart(ctx('chartTurnos'), {
    type: 'bar',
    data: {
      labels: shiftLabels,
      datasets: [{
        data: shiftTickets,
        backgroundColor: PALETTE.slice(0, shiftLabels.length),
        borderRadius: 6,
        borderSkipped: false,
      }],
    },
    options: hbarOpts('Tickets', v => v.toLocaleString('es-AR')),
  });

  // --- Ingresos por turno ---
  const shiftIngresos = shift_table.map(r => r.importe);
  state.charts.ingresos = new Chart(ctx('chartIngresos'), {
    type: 'bar',
    data: {
      labels: shiftLabels,
      datasets: [{
        data: shiftIngresos,
        backgroundColor: ['#06b6d4', '#0891b2', '#0e7490'].slice(0, shiftLabels.length),
        borderRadius: 6,
        borderSkipped: false,
      }],
    },
    options: hbarOpts('Ingresos', v => formatCurrency(v)),
  });

  // --- Duración (doughnut) ---
  const durLabels = Object.keys(dur_dist);
  const durData   = Object.values(dur_dist);
  state.charts.duracion = new Chart(ctx('chartDuracion'), {
    type: 'doughnut',
    data: {
      labels: durLabels,
      datasets: [{ data: durData, backgroundColor: PALETTE, borderWidth: 2, borderColor: '#091628' }],
    },
    options: doughnutOpts(v => `${v.toLocaleString('es-AR')} tickets`),
  });

  // --- Categorías (doughnut) ---
  const catLabels = Object.keys(cat_dist);
  const catData   = Object.values(cat_dist);
  state.charts.categorias = new Chart(ctx('chartCategorias'), {
    type: 'doughnut',
    data: {
      labels: catLabels.length ? catLabels : ['Sin datos'],
      datasets: [{ data: catData.length ? catData : [1], backgroundColor: PALETTE.slice(2), borderWidth: 2, borderColor: '#091628' }],
    },
    options: doughnutOpts(v => `${v.toLocaleString('es-AR')} vehículos`),
  });

  // --- Evolución diaria (line) ---
  const sortedDates = Object.keys(daily_data).sort();
  const dailyTickets = sortedDates.map(d => daily_data[d].tickets);
  state.charts.diario = new Chart(ctx('chartDiario'), {
    type: 'line',
    data: {
      labels: sortedDates.map(d => fmtDate(d)),
      datasets: [{
        label: 'Tickets',
        data: dailyTickets,
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59,130,246,.08)',
        pointBackgroundColor: '#3b82f6',
        pointRadius: 3,
        pointHoverRadius: 5,
        tension: 0.3,
        fill: true,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0e2040',
          borderColor: '#254980',
          borderWidth: 1,
          titleColor: '#dde9f8',
          bodyColor: '#7fa2c8',
          callbacks: { label: c => ` ${c.parsed.y.toLocaleString('es-AR')} tickets` },
        },
      },
      scales: {
        x: { grid: { color: GRID_COLOR }, ticks: { color: TICK_COLOR, maxTicksLimit: 12 } },
        y: { grid: { color: GRID_COLOR }, ticks: { color: TICK_COLOR, precision: 0 }, beginAtZero: true },
      },
    },
  });
}

/* ── CHART OPTION HELPERS ────────────────────────────────────────────────── */
function hbarOpts(label, fmtFn) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: 'y',
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#0e2040',
        borderColor: '#254980',
        borderWidth: 1,
        titleColor: '#dde9f8',
        bodyColor: '#7fa2c8',
        callbacks: { label: c => ` ${fmtFn(c.parsed.x)}` },
      },
    },
    scales: {
      x: { grid: { color: GRID_COLOR }, ticks: { color: TICK_COLOR }, beginAtZero: true },
      y: { grid: { display: false },    ticks: { color: '#7fa2c8', font: { size: 12 } } },
    },
  };
}

function doughnutOpts(fmtFn) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '62%',
    plugins: {
      legend: {
        position: 'right',
        labels: { color: '#7fa2c8', font: { size: 11 }, boxWidth: 12, padding: 10 },
      },
      tooltip: {
        backgroundColor: '#0e2040',
        borderColor: '#254980',
        borderWidth: 1,
        titleColor: '#dde9f8',
        bodyColor: '#7fa2c8',
        callbacks: { label: c => ` ${fmtFn(c.parsed)}` },
      },
    },
  };
}

/* ── SHIFT TABLE ─────────────────────────────────────────────────────────── */
function renderShiftTable(rows) {
  const table = document.getElementById('shiftTable');
  if (!rows || !rows.length) { table.innerHTML = '<tr><td>Sin datos</td></tr>'; return; }

  let html = `
    <thead><tr>
      <th>Turno</th>
      <th class="num">Tickets</th>
      <th class="num">Ingresos</th>
      <th class="num">Ticket Prom.</th>
      <th class="num">Duración Prom.</th>
    </tr></thead><tbody>`;

  rows.forEach(r => {
    html += `<tr>
      <td>${esc(r.turno)}</td>
      <td class="num">${(r.tickets || 0).toLocaleString('es-AR')}</td>
      <td class="num">${formatCurrency(r.importe || 0)}</td>
      <td class="num">${formatCurrency(r.avg_importe || 0)}</td>
      <td class="num">${formatMinutes(r.avg_dur || 0)}</td>
    </tr>`;
  });

  table.innerHTML = html + '</tbody>';
}

/* ── COMPARISON ──────────────────────────────────────────────────────────── */
function addToComparison() {
  if (!state.lastResult) { alert('Realizá un análisis primero.'); return; }
  state.comparisons.push({ ...state.lastResult, ts: new Date().toLocaleTimeString('es-AR') });
  renderComparison();
  document.getElementById('comparisonSection').classList.remove('hidden');
  document.getElementById('comparisonSection').scrollIntoView({ behavior: 'smooth' });
}

function renderComparison() {
  const container = document.getElementById('comparisonContent');
  const items     = state.comparisons;
  if (!items.length) { container.innerHTML = '<p style="color:var(--text-muted)">Sin comparaciones todavía.</p>'; return; }

  const headers = ['Métrica', ...items.map(i => `${i.branch_label}<br><small>${i.ts}</small>`)];
  const rows = [
    ['Tickets operativos', ...items.map(i => i.kpis.total_operativo.toLocaleString('es-AR'))],
    ['Excluidos',          ...items.map(i => i.kpis.total_excluidos.toLocaleString('es-AR'))],
    ['Ingresos totales',   ...items.map(i => formatCurrency(i.kpis.total_importe))],
    ['Ticket promedio',    ...items.map(i => formatCurrency(i.kpis.avg_importe))],
    ['Duración promedio',  ...items.map(i => formatMinutes(i.kpis.avg_dur_min))],
  ];

  let html = '<div class="table-wrap"><table class="data-table"><thead><tr>';
  html += headers.map(h => `<th>${h}</th>`).join('');
  html += '</tr></thead><tbody>';
  rows.forEach(row => {
    html += '<tr>' + row.map((c, i) => `<td${i > 0 ? ' class="num"' : ''}>${c}</td>`).join('') + '</tr>';
  });
  html += '</tbody></table></div>';
  container.innerHTML = html;
}

function clearComparison() {
  state.comparisons = [];
  document.getElementById('comparisonSection').classList.add('hidden');
}

/* ── EXPORT ──────────────────────────────────────────────────────────────── */
async function exportExcel() {
  if (!state.fileId || !state.lastResult) return;
  const branch    = document.getElementById('branchSelect').value;
  const ranges    = getRanges();
  const durRanges = getDurRanges();

  setLoading(true, 'Generando Excel...');
  try {
    const res = await fetch('/api/export/excel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: state.fileId, branch, ranges, dur_ranges: durRanges }),
    });
    if (!res.ok) throw new Error('Error al generar Excel');
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `analisis_${branch}_${datestamp()}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert('Error:\n' + err.message);
  } finally {
    setLoading(false);
  }
}

function exportPdf() {
  window.print();
}

/* ── HELPERS ─────────────────────────────────────────────────────────────── */
function setLoading(on, text = 'Cargando...') {
  const overlay = document.getElementById('loadingOverlay');
  document.getElementById('loadingText').textContent = text;
  overlay.classList.toggle('hidden', !on);
  document.getElementById('analyzeBtn').disabled = on;
}

function enablePostAnalysisButtons(on) {
  document.getElementById('compareBtn').disabled    = !on;
  document.getElementById('exportExcelBtn').disabled = !on;
  document.getElementById('exportPdfBtn').disabled   = !on;
}

function formatCurrency(n) {
  return '$\u202f' + Math.round(n || 0).toLocaleString('es-AR');
}

function formatMinutes(m) {
  if (!m) return '—';
  m = Math.round(m);
  const h = Math.floor(m / 60);
  const min = m % 60;
  if (h === 0) return `${min}m`;
  return `${h}h ${min}m`;
}

function fmtDate(isoStr) {
  // isoStr = 'YYYY-MM-DD'
  const parts = isoStr.split('-');
  if (parts.length === 3) return `${parts[2]}/${parts[1]}`;
  return isoStr;
}

function datestamp() {
  const n = new Date();
  return `${n.getFullYear()}${String(n.getMonth()+1).padStart(2,'0')}${String(n.getDate()).padStart(2,'0')}`;
}

function ctx(id) { return document.getElementById(id).getContext('2d'); }

function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function toNumOrNull(v) {
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}
