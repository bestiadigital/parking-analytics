import * as XLSX from 'xlsx';
import { parse, isValid, addDays, format } from 'date-fns';

export function parseExcelContent(arrayBuffer) {
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  // Parse with raw strings to keep date formats or formatting
  const data = XLSX.utils.sheet_to_json(sheet, { raw: false, dateNF: 'yyyy-mm-dd hh:mm:ss' });

  // Debug: log column names and first row to console
  if (data.length > 0) {
    console.log('[Parking] Columnas detectadas:', Object.keys(data[0]));
    console.log('[Parking] Primera fila:', data[0]);
    console.log('[Parking] Columnas normalizadas:', Object.keys(data[0]).map(k => norm(k)));
  }

  return data;
}

// Normaliza string: minúsculas, sin acentos, sin espacios extra
function norm(str) {
  return str.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Helper: finds a value in a row by trying multiple possible column names (case-insensitive, accent-insensitive)
function findCol(row, candidates) {
  const keys = Object.keys(row);
  for (const candidate of candidates) {
    const found = keys.find(k => norm(k) === norm(candidate));
    if (found !== undefined && row[found] !== undefined && row[found] !== '') return row[found];
  }
  return null;
}

// Detecta si el archivo es formato Monroe (columnas de hora y minuto separadas)
function detectFormat(data) {
  if (!data || data.length === 0) return 'STANDARD';
  const keys = Object.keys(data[0]).map(k => norm(k));
  return (keys.includes('ingreso hora') || keys.includes('ingreso minuto')) ? 'MONROE' : 'STANDARD';
}

// Combina fecha + hora + minuto del formato Monroe en un Date
function buildMonroeDate(fecha, hora, minuto) {
  if (!fecha) return null;
  const parts = String(fecha).match(/(\d+)\/(\d+)\/(\d+)/);
  if (!parts) return null;
  const h = String(hora || '0').padStart(2, '0');
  const m = String(minuto || '0').padStart(2, '0');
  return new Date(`${parts[3]}-${parts[2]}-${parts[1]}T${h}:${m}:00`);
}

export function processAnalytics(data, shifts, durRanges) {
  let operativeCount = 0;
  let excludedCount = 0;
  let totalRevenue = 0;
  let totalDurationMinutes = 0;

  const shiftStats = {};
  shifts.forEach(s => {
    shiftStats[s.name] = { tickets: 0, ingresos: 0, duracionTotal: 0, salidas: 0 };
  });

  const durationStats = {};
  durRanges.forEach(r => {
    durationStats[r.name] = 0;
  });
  
  const categoryStats = {};
  const dailyData = {};
  const obsStats = {};
  const format_type = detectFormat(data);

  data.forEach((row, i) => {
    // 1. Importe
    const importeRaw = format_type === 'MONROE'
      ? findCol(row, ['Importe Pagado', 'importe pagado', 'Importe', 'importe'])
      : findCol(row, ['Importe', 'Total', 'Monto', 'Precio', 'Valor', 'importe', 'total']);
    const importeStr = importeRaw != null ? String(importeRaw) : '0';
    let importe = 0;
    const cleanStr = importeStr.replace(/[^0-9.,]/g, '');
    if (cleanStr.match(/,\d{2}$/)) {
      importe = parseFloat(cleanStr.replace(/\./g, '').replace(',', '.')) || 0;
    } else {
      importe = parseFloat(cleanStr.replace(/,/g, '')) || 0;
    }

    // 2. Cancelación
    const canceladoVal = findCol(row, ['Cancelado', 'cancelado', 'Estado', 'estado', 'Status']);
    const canceladoStr = String(canceladoVal || '').trim().toLowerCase();
    // Monroe: "falso" = válido, "verdadero" = cancelado
    // Estándar: "cancelado" = cancelado, "-" = válido
    const isCancelado = format_type === 'MONROE'
      ? (canceladoStr === 'verdadero' || canceladoStr === 'true')
      : (canceladoStr === 'cancelado');

    if (isCancelado || importe === 0) {
      excludedCount++;
      return;
    }

    operativeCount++;
    totalRevenue += importe;

    // 3. Fechas de ingreso y egreso
    let ingresoDate, egresoDate;
    if (format_type === 'MONROE') {
      ingresoDate = buildMonroeDate(
        findCol(row, ['Ingreso Fecha', 'ingreso fecha']),
        findCol(row, ['Ingreso Hora', 'ingreso hora']),
        findCol(row, ['Ingreso Minuto', 'ingreso minuto'])
      );
      egresoDate = buildMonroeDate(
        findCol(row, ['Egreso Fecha', 'egreso fecha']),
        findCol(row, ['Egreso Hora', 'egreso hora']),
        findCol(row, ['Egreso Minuto', 'egreso minuto'])
      );
    } else {
      const ingreso = findCol(row, ['Desde', 'desde', 'Fecha Ingreso', 'Ingreso', 'Entrada', 'fecha ingreso', 'ingreso', 'entrada']);
      const egreso = findCol(row, ['Hasta', 'hasta', 'Fecha Egreso', 'Egreso', 'Salida', 'fecha egreso', 'egreso', 'salida']);
      ingresoDate = parseDateString(ingreso);
      egresoDate = parseDateString(egreso);
    }

    let durationMins = 0;
    if (ingresoDate && egresoDate) {
      durationMins = Math.max(0, (egresoDate.getTime() - ingresoDate.getTime()) / 60000);
    } else if (format_type !== 'MONROE') {
       const durStr = findCol(row, ['Duración', 'Duracion', 'Tiempo', 'duración', 'duracion', 'tiempo']) || '';
       const match = durStr.match(/(\d+)\s*(hs|h|min|m)/i);
       if (match) {
           durationMins = match[2].toLowerCase().startsWith('h') ? parseInt(match[1])*60 : parseInt(match[1]);
       }
    }

    // 4. OBS (solo Monroe)
    if (format_type === 'MONROE') {
      const obs = findCol(row, ['Obs', 'obs', 'OBS', 'Obs.', 'obs.', 'Observacion', 'observacion']);
      let obsKey = obs && String(obs).trim() !== '' && String(obs).trim() !== '0' ? String(obs).trim() : 'Sin OBS';
      if (obsKey.toLowerCase().includes('showcase')) obsKey = 'Showcase';
      obsStats[obsKey] = (obsStats[obsKey] || 0) + 1;
    }

    totalDurationMinutes += durationMins;

    // Clasificar en Turno según hora de ingreso
    if (ingresoDate) {
        const hour = ingresoDate.getHours();
        const minute = ingresoDate.getMinutes();
        const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
        
        let assignedShift = "Otro";
        for (const shift of shifts) {
            if (isTimeInRange(timeStr, shift.start, shift.end)) {
                assignedShift = shift.name;
                break;
            }
        }
        
        if (shiftStats[assignedShift]) {
            shiftStats[assignedShift].tickets++;
            shiftStats[assignedShift].ingresos += importe;
            shiftStats[assignedShift].duracionTotal += durationMins;
        } else {
            shiftStats[assignedShift] = { tickets: 1, ingresos: importe, duracionTotal: durationMins, salidas: 0 };
        }

        // Clasificar salida en turno según hora de egreso
        if (egresoDate) {
            const eHour = egresoDate.getHours();
            const eMinute = egresoDate.getMinutes();
            const eTimeStr = `${eHour.toString().padStart(2, '0')}:${eMinute.toString().padStart(2, '0')}`;
            let assignedExitShift = null;
            for (const shift of shifts) {
                if (isTimeInRange(eTimeStr, shift.start, shift.end)) {
                    assignedExitShift = shift.name;
                    break;
                }
            }
            if (assignedExitShift) {
                if (shiftStats[assignedExitShift]) {
                    shiftStats[assignedExitShift].salidas++;
                } else {
                    shiftStats[assignedExitShift] = { tickets: 0, ingresos: 0, duracionTotal: 0, salidas: 1 };
                }
            }
        }

        // Datos diarios
        const dateKey = format(ingresoDate, 'yyyy-MM-dd');
        if (!dailyData[dateKey]) dailyData[dateKey] = { tickets: 0, revenue: 0 };
        dailyData[dateKey].tickets++;
        dailyData[dateKey].revenue += importe;
    }

    // Clasificar Duración
    let assignedDur = "Desconocida";
    for (const r of durRanges) {
        if (r.to_min === null && durationMins >= r.from_min) {
            assignedDur = r.name; break;
        } else if (durationMins >= r.from_min && durationMins <= r.to_min) {
            assignedDur = r.name; break;
        }
    }
    if (assignedDur !== "Desconocida") {
        durationStats[assignedDur]++;
    }

    // Categorias Vehículos (Categoría va primero; Tipo es tipo de estadía, no vehículo)
    const category = findCol(row, ['Categoría', 'Categoria', 'Vehículo', 'Vehiculo', 'categoría', 'categoria', 'vehículo', 'vehiculo']) || 'Auto';
    categoryStats[category] = (categoryStats[category] || 0) + 1;
  });

  // Calculate Projections (Feature requested!)
  const daysOfData = Object.keys(dailyData).length || 1;
  const avgTicketsPerDay = operativeCount / daysOfData;
  const avgRevenuePerDay = totalRevenue / daysOfData;
  const projectedRevenue30Days = avgRevenuePerDay * 30;

  // Formatting final tables
  const shiftTable = Object.keys(shiftStats).map(k => {
      const s = shiftStats[k];
      return {
          turno: k,
          tickets: s.tickets,
          entradas: s.tickets,
          salidas: s.salidas,
          importe: s.ingresos,
          avg_importe: s.tickets > 0 ? s.ingresos / s.tickets : 0,
          avg_dur: s.tickets > 0 ? s.duracionTotal / s.tickets : 0
      };
  });

  console.log('[Parking] cat_dist:', categoryStats);
  console.log('[Parking] obs_dist:', obsStats);

  return {
    kpis: {
      total_operativo: operativeCount,
      total_excluidos: excludedCount,
      total_importe: totalRevenue,
      avg_importe: operativeCount > 0 ? totalRevenue / operativeCount : 0,
      avg_dur_min: operativeCount > 0 ? totalDurationMinutes / operativeCount : 0,
    },
    projections: {
       avg_revenue_day: avgRevenuePerDay,
       thirty_day_projection: projectedRevenue30Days
    },
    shift_table: shiftTable,
    dur_dist: durationStats,
    cat_dist: categoryStats,
    obs_dist: obsStats,
    format_type,
    daily_data: dailyData
  };
}

function parseDateString(str) {
    if (!str) return null;
    let d = new Date(str);
    if (!isNaN(d.getTime())) return d;
    // Attempt DD/MM/YYYY hh:mm
    const parts = str.match(/(\d+)\/(\d+)\/(\d+)\s+(\d+):(\d+)/);
    if (parts) {
        return new Date(`${parts[3]}-${parts[2]}-${parts[1]}T${parts[4]}:${parts[5]}:00`);
    }
    return null;
}

function isTimeInRange(time, start, end) {
   // times are HH:mm
   const t = timeToMin(time);
   const s = timeToMin(start);
   const e = timeToMin(end);
   if (s <= e) return t >= s && t <= e;
   // wrap around midnight (e.g. 20:00 to 05:59)
   return t >= s || t <= e;
}

function timeToMin(tStr) {
    const [h,m] = tStr.split(':').map(Number);
    return h * 60 + m;
}
