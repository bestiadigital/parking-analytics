import React, { useState, useRef, useEffect } from 'react';
import { Upload, Focus, Activity, AlertTriangle, FileSpreadsheet, TrendingUp, Car } from 'lucide-react';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip as ChartTooltip, Legend,
  ArcElement, PointElement, LineElement, Filler
} from 'chart.js';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import { parseExcelContent, processAnalytics } from './processor';
import { BRANCHES, DEFAULT_DUR_RANGES } from './constants';
import * as XLSX from 'xlsx';

ChartJS.register(
  CategoryScale, LinearScale, BarElement, Title, ChartTooltip, Legend, ArcElement, PointElement, LineElement, Filler
);

const PALETTE = ['#3b82f6', '#06b6d4', '#8b5cf6', '#10b981', '#f59e0b', '#f43f5e', '#6366f1', '#14b8a6'];

const formatCurrency = (n) => `$${Math.round(n || 0).toLocaleString('es-AR')}`;
const formatMinutes = (m) => {
  if (!m) return '—';
  m = Math.round(m);
  const h = Math.floor(m / 60);
  const min = m % 60;
  return h === 0 ? `${min}m` : `${h}h ${min}m`;
};

export default function App() {
  const [branch, setBranch] = useState('ORO');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [rawData, setRawData] = useState(null);
  const [fileName, setFileName] = useState('');
  
  // Settings State
  const [shifts, setShifts] = useState(BRANCHES['ORO'].ranges);
  const [durRanges, setDurRanges] = useState(DEFAULT_DUR_RANGES);
  
  const fileInputRef = useRef(null);

  // Sync shifts when branch changes
  useEffect(() => {
     setShifts(BRANCHES[branch].ranges);
  }, [branch]);

  // Re-run analytics when raw data or settings change
  useEffect(() => {
     if (rawData && shifts.length > 0 && durRanges.length > 0) {
         try {
            const analytics = processAnalytics(rawData, shifts, durRanges);
            setResults({ ...analytics, filename: fileName });
         } catch(e) {
            console.error("Error running analytics", e);
         }
     }
  }, [rawData, shifts, durRanges, fileName]);

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setLoading(true);
    setFileName(file.name);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const parsedData = parseExcelContent(arrayBuffer);
      setRawData(parsedData); // This will trigger the useEffect to processAnalytics
    } catch (err) {
      alert("Error procesando el archivo: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const updateShift = (index, field, value) => {
      const newShifts = [...shifts];
      newShifts[index][field] = value;
      setShifts(newShifts);
  };

  const addShift = () => setShifts([...shifts, {name: 'Nuevo', start: '00:00', end: '23:59'}]);
  const removeShift = (i) => setShifts(shifts.filter((_, idx) => idx !== i));
  const resetShifts = () => setShifts(BRANCHES[branch].ranges);

  const updateDur = (index, field, value) => {
      const newDurs = [...durRanges];
      newDurs[index][field] = field === 'name' ? value : (value === '' ? null : Number(value));
      setDurRanges(newDurs);
  };
  const addDur = () => setDurRanges([...durRanges, {name: 'Nuevo', from_min: 0, to_min: 60}]);
  const removeDur = (i) => setDurRanges(durRanges.filter((_, idx) => idx !== i));
  const resetDurs = () => setDurRanges(DEFAULT_DUR_RANGES);

  const handleDragOver = (e) => e.preventDefault();
  const handleDrop = async (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      fileInputRef.current.files = dataTransfer.files;
      handleFileUpload({ target: fileInputRef.current });
    }
  };

  const exportToExcel = () => {
    if (!results) return;
    const { kpis, shift_table, dur_dist, cat_dist } = results;

    const wb = XLSX.utils.book_new();

    // 1. KPIs
    const kpiData = [
      ['Métrica', 'Valor'],
      ['Tickets Operativos', kpis.total_operativo],
      ['Ingresos Totales', kpis.total_importe],
      ['Ticket Promedio', kpis.avg_importe],
      ['Duración Promedio (min)', kpis.avg_dur_min],
      ['Excluidos (Cancelados o $0)', kpis.total_excluidos]
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(kpiData), 'KPIs');

    // 2. Detalle por Turno
    const shiftData = shift_table.map(r => ({
      'Turno': r.turno,
      'Entradas': r.entradas,
      'Salidas': r.salidas,
      'Ingresos': r.importe,
      'Ticket Promedio': r.avg_importe,
      'Duración Promedio (min)': r.avg_dur
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(shiftData), 'Turnos');

    // 3. Duración (horizontal: headers en fila 1, valores en fila 2)
    const durEntries = Object.entries(dur_dist);
    const durHeaders = durEntries.map(([k]) => k);
    const durValues = durEntries.map(([, v]) => v);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([durHeaders, durValues]), 'Duración');

    // 4. Categorias
    const CATEGORIAS = ['Auto', 'SUV', 'Camioneta', 'Moto', 'Bici'];
    const catData = CATEGORIAS.map(cat => ({ 'Categoría': cat, 'Tickets': cat_dist[cat] || 0 }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(catData), 'Categorías');

    XLSX.writeFile(wb, `Analisis_${branch}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const renderKPIs = () => {
    if (!results) return null;
    const { kpis, projections } = results;
    
    return (
      <div className="kpis-grid">
        <div className="glass-panel kpi-card">
          <div className="kpi-value text-info">{kpis.total_operativo.toLocaleString('es-AR')}</div>
          <div className="kpi-label flex items-center gap-2"><Car size={16}/> Tickets Operativos</div>
        </div>
        <div className="glass-panel kpi-card">
          <div className="kpi-value text-success">{formatCurrency(kpis.total_importe)}</div>
          <div className="kpi-label flex items-center gap-2"><Activity size={16}/> Ingresos Totales</div>
        </div>
        <div className="glass-panel kpi-card">
          <div className="kpi-value text-warning">{formatCurrency(kpis.avg_importe)}</div>
          <div className="kpi-label flex items-center gap-2">Ticket Promedio</div>
        </div>
        <div className="glass-panel kpi-card">
          <div className="kpi-value" style={{color: '#94a3b8'}}>{formatMinutes(kpis.avg_dur_min)}</div>
          <div className="kpi-label">Duración Promedio</div>
        </div>
        
        <div className="glass-panel kpi-card kpi-projection">
          <div className="kpi-value">{formatCurrency(projections.thirty_day_projection)}</div>
          <div className="kpi-label flex items-center gap-2" style={{color: 'rgba(255,255,255,0.7)'}}>
            <TrendingUp size={16} /> Proyección 30 Días
          </div>
        </div>

        <div className="glass-panel kpi-card" style={{border: '1px solid rgba(245, 158, 11, 0.3)'}}>
          <div className="kpi-value text-warning">{kpis.total_excluidos.toLocaleString('es-AR')}</div>
          <div className="kpi-label flex items-center gap-2"><AlertTriangle size={16}/> Cancelados o $0</div>
        </div>
      </div>
    );
  };

  const renderCharts = () => {
    if (!results) return null;
    const { shift_table, cat_dist, daily_data } = results;

    const shiftLabels = shift_table.map(s => s.turno);
    const shiftIngresos = shift_table.map(s => s.importe);

    const barData = {
      labels: shiftLabels,
      datasets: [{
        label: 'Ingresos',
        data: shiftIngresos,
        backgroundColor: ['#06b6d4', '#0891b2', '#0e7490'].slice(0, shiftLabels.length),
        borderRadius: 6
      }]
    };

    const catLabels = Object.keys(cat_dist);
    const catData = Object.values(cat_dist);
    const doughnutData = {
      labels: catLabels.length ? catLabels : ['Sin datos'],
      datasets: [{
        data: catData.length ? catData : [1],
        backgroundColor: PALETTE.slice(2),
        borderWidth: 0
      }]
    };

    const sortedDates = Object.keys(daily_data).sort();
    const dailyTickets = sortedDates.map(d => daily_data[d].tickets);
    const lineData = {
      labels: sortedDates,
      datasets: [{
        label: 'Tickets',
        data: dailyTickets,
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59,130,246,0.1)',
        fill: true,
        tension: 0.4
      }]
    };

    const chartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#94a3b8' } },
          y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } }
        }
    };

    return (
      <div className="charts-grid">
        <div className="glass-panel chart-wrapper">
          <h3 className="chart-title">Ingresos por Turno</h3>
          <div className="chart-inner">
            <Bar data={barData} options={chartOptions} />
          </div>
        </div>
        <div className="glass-panel chart-wrapper">
          <h3 className="chart-title">Categorías de Vehículos</h3>
          <div className="chart-inner">
            <Doughnut data={doughnutData} options={{...chartOptions, cutout: '70%', plugins: { legend: { position: 'right', labels: {color: '#fff'} } }}} />
          </div>
        </div>
        <div className="glass-panel chart-wrapper full-width">
          <h3 className="chart-title">Evolución Diaria de Tickets</h3>
          <div className="chart-inner">
            <Line data={lineData} options={chartOptions} />
          </div>
        </div>
      </div>
    );
  };

  const renderTable = () => {
    if (!results) return null;
    return (
        <div className="glass-panel chart-wrapper full-width">
            <h3 className="chart-title">Detalle por Turno</h3>
            <div className="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>Turno</th>
                            <th className="num">Tickets</th>
                            <th className="num">Ingresos</th>
                            <th className="num">Ticket Prom.</th>
                            <th className="num">Duración Prom.</th>
                        </tr>
                    </thead>
                    <tbody>
                        {results.shift_table.map((r, i) => (
                            <tr key={i}>
                                <td>{r.turno}</td>
                                <td className="num">{r.tickets.toLocaleString('es-AR')}</td>
                                <td className="num">{formatCurrency(r.importe)}</td>
                                <td className="num">{formatCurrency(r.avg_importe)}</td>
                                <td className="num">{formatMinutes(r.avg_dur)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
  };

  return (
    <>
      <header className="header">
        <div className="logo">
          <Focus color="#3b82f6" fill="rgba(59,130,246,0.2)"/> Parking Analytics Pro
        </div>
        <div style={{color: '#94a3b8', fontSize: '0.9rem'}}>
            {BRANCHES[branch].label} — {BRANCHES[branch].address}
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar">
          <div className="glass-panel" style={{padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem'}}>
             <div>
                <label className="range-title" style={{display: 'block', marginBottom: '0.5rem'}}>
                    Sucursal
                </label>
                <select className="select-input" value={branch} onChange={(e) => setBranch(e.target.value)}>
                  {Object.keys(BRANCHES).map(k => (
                      <option key={k} value={k}>{BRANCHES[k].label}</option>
                  ))}
                </select>
             </div>

             <div style={{marginTop: '0.5rem'}}>
                <div 
                    className="upload-zone"
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current.click()}
                >
                    <Upload size={32} color="#3b82f6" />
                    <div>
                        <strong>Arrastrá el Excel aquí</strong>
                        <div style={{fontSize: '0.8rem', color: '#94a3b8', marginTop: '4px'}}>
                            {loading ? "Procesando..." : (results ? results.filename : "o haz clic para seleccionar")}
                        </div>
                    </div>
                    <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".xlsx,.xls,.csv" hidden />
                </div>
             </div>
             
             {/* EDITABLE RANGES: TURNOS */}
             <div className="range-section">
                 <div className="range-header">
                     <span className="range-title">Turnos</span>
                     <div style={{display:'flex', gap:'8px'}}>
                        <button className="btn-tiny" onClick={addShift}>+ Agregar</button>
                        <button className="btn-tiny" onClick={resetShifts} style={{borderColor:'transparent'}}>Resetear</button>
                     </div>
                 </div>
                 {shifts.map((s, i) => (
                     <div className="range-row" key={i}>
                         <input className="range-input" style={{flex: 1.5}} value={s.name} onChange={(e) => updateShift(i, 'name', e.target.value)} />
                         <input className="range-input" style={{flex: 1}} value={s.start} onChange={(e) => updateShift(i, 'start', e.target.value)} />
                         <input className="range-input" style={{flex: 1}} value={s.end} onChange={(e) => updateShift(i, 'end', e.target.value)} />
                         <button className="btn-del" onClick={() => removeShift(i)}>×</button>
                     </div>
                 ))}
             </div>

             {/* EDITABLE RANGES: DURACION */}
             <div className="range-section">
                 <div className="range-header">
                     <span className="range-title">Duración</span>
                     <div style={{display:'flex', gap:'8px'}}>
                        <button className="btn-tiny" onClick={addDur}>+ Agregar</button>
                        <button className="btn-tiny" onClick={resetDurs} style={{borderColor:'transparent'}}>Resetear</button>
                     </div>
                 </div>
                 {durRanges.map((d, i) => (
                     <div className="range-row" key={i}>
                         <input className="range-input" style={{flex: 1.5}} value={d.name} onChange={(e) => updateDur(i, 'name', e.target.value)} />
                         <input className="range-input" type="number" placeholder="0" style={{flex: 1}} value={d.from_min !== null ? d.from_min : ''} onChange={(e) => updateDur(i, 'from_min', e.target.value)} />
                         <input className="range-input" type="number" placeholder="∞" style={{flex: 1}} value={d.to_min !== null ? d.to_min : ''} onChange={(e) => updateDur(i, 'to_min', e.target.value)} />
                         <button className="btn-del" onClick={() => removeDur(i)}>×</button>
                     </div>
                 ))}
             </div>

             {results && (
                 <>
                   <button className="btn" style={{marginTop: '1rem'}} onClick={() => window.print()}>
                       <FileSpreadsheet size={18} /> Exportar PDF
                   </button>
                   <button className="btn" style={{marginTop: '0.5rem', background: '#10b981'}} onClick={exportToExcel}>
                       <FileSpreadsheet size={18} /> Exportar Excel
                   </button>
                 </>
             )}
          </div>
        </aside>

        <main className="main-content">
          {!results && !loading && (
              <div className="glass-panel" style={{padding: '4rem 2rem', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', minHeight: '400px'}}>
                  <Activity size={48} color="#3b82f6" />
                  <h2>Listo para analizar</h2>
                  <p style={{color: '#94a3b8'}}>Seleccioná una sucursal y subí tu reporte Excel para ver la magia.</p>
              </div>
          )}
          
          {loading && (
             <div className="glass-panel" style={{padding: '4rem 2rem', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '400px'}}>
                 <div style={{display: 'flex', gap: '12px', alignItems: 'center', color: '#3b82f6'}}>
                     <Upload size={24} className="animate-bounce" /> Procesando inteligencia de datos...
                 </div>
             </div>
          )}

          {results && !loading && (
              <>
                 {renderKPIs()}
                 {renderCharts()}
                 {renderTable()}
              </>
          )}
        </main>
      </div>
    </>
  );
}
