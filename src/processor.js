import * as XLSX from 'xlsx';
import { parse, isValid, addDays, format } from 'date-fns';

export function parseExcelContent(arrayBuffer) {
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  // Parse with raw strings to keep date formats or formatting
  const data = XLSX.utils.sheet_to_json(sheet, { raw: false, dateNF: 'yyyy-mm-dd hh:mm:ss' });
  return data;
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

  data.forEach((row, i) => {
    // 1. Encontrar valores (flexibilidad con nombres de columnas)
    const estado = row['Estado'] || row['estado'] || '';
    const importeStr = row['Importe'] || row['Total'] || '0';
    let importe = parseFloat(importeStr.replace(/[^0-9,-]+/g,"").replace(',', '.')) || 0;
    const isCancelado = estado.trim().toLowerCase() === 'cancelado';
    const hasCancelacion = Object.keys(row).some(k => k.toLowerCase().includes('cancelaci') && row[k]);
    
    // Filtro principal: Ignorar 'Cancelado' o (Importe = 0 y sin cancelación)
    if (isCancelado || (importe === 0 && !hasCancelacion)) {
      excludedCount++;
      return;
    }

    operativeCount++;
    totalRevenue += importe;

    // Calcular duración y turno de ingreso
    const ingreso = row['Fecha Ingreso'] || row['Ingreso'] || row['Entrada'];
    const egreso = row['Fecha Egreso'] || row['Egreso'] || row['Salida'];

    let ingresoDate = parseDateString(ingreso);
    let egresoDate = parseDateString(egreso);
    let durationMins = 0;

    if (ingreso && egreso) {
       if (ingresoDate && egresoDate) {
           durationMins = Math.max(0, (egresoDate.getTime() - ingresoDate.getTime()) / 60000);
       }
    } else {
       // Alternativa: buscar columna de duración si existe
       const durStr = row['Duración'] || row['Tiempo'] || '';
       const match = durStr.match(/(\d+)\s*(hs|h|min|m)/i);
       if (match) {
           durationMins = match[2].toLowerCase().startsWith('h') ? parseInt(match[1])*60 : parseInt(match[1]);
       }
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

    // Categorias Vehículos
    const category = row['Vehículo'] || row['Tipo'] || row['Categoría'] || 'Auto';
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
