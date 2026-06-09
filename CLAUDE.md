# Parking Analytics — Documentación de Proyecto

## Qué es esto

Web app interna para la cadena de estacionamientos **PointPark** (Buenos Aires, Argentina). Permite al equipo de administración cargar los reportes crudos que genera cada sistema de gestión de turnos, analizarlos y exportar los resultados en un Excel estructurado.

No hay base de datos. Todo es stateless: el archivo Excel se sube, se procesa en memoria y se descarta. No hay login ni autenticación.

---

## Stack

- **Backend:** Python 3 / Flask
- **Análisis de datos:** pandas, openpyxl, xlrd
- **Frontend:** HTML + CSS + vanilla JS, Chart.js 4 para gráficos
- **Deploy:** Render (plan gratuito, con spin-down por inactividad ~15 min)
- **Procfile:** `gunicorn app:app --bind 0.0.0.0:$PORT --workers 1 --timeout 120`

---

## Estructura de archivos

```
app.py                  — servidor Flask, lógica de análisis, rutas API
templates/index.html    — UI completa (una sola página)
static/css/style.css    — estilos (tema oscuro azul marino)
static/js/main.js       — lógica del frontend, gráficos, exportación
static/pointpark_logo.svg — logo de la empresa (recortado con viewBox ajustado)
requirements.txt
Procfile
```

---

## Sucursales configuradas

Todas en `BRANCHES` dentro de `app.py`. Cada sucursal tiene label, dirección y rangos de turnos horarios.

| Clave | Nombre | Turnos |
|---|---|---|
| ORO | Sucursal Oro | Mañana 06-13:59 / Tarde 14-19:59 / Noche 20-05:59 |
| RODRIGUEZ_PENA | Rodríguez Peña | Mañana 05-13:59 / Tarde 14-02:00 |
| CORRIENTES | Corrientes | Mañana 05-14:59 / Tarde 15-03:00 |
| BERUTI | Beruti | Mañana 06-13:59 / Tarde 14-19:59 / Noche 20-05:59 |
| RIVADAVIA | Rivadavia | Mañana 05-13:59 / Tarde 14-02:00 |
| YRIGOYEN | Yrigoyen | Mañana 05-13:59 / Tarde 14-02:00 |
| HOTEL_MADERO | Hotel Madero | Sin turnos configurados |
| MONROE | Monroe | Mañana 06-13:59 / Tarde 14-21:59 / Noche 22-05:59 |

---

## Dos formatos de reporte crudo

### Formato estándar (7 sucursales)

Generado por el sistema de gestión principal. Columnas clave:

| Columna | Descripción |
|---|---|
| `Desde` | Fecha y hora de entrada (dd/mm/yyyy HH:MM) |
| `Hasta` | Fecha y hora de salida |
| `Tiempo` | Duración (ej. `2:30` o `1d 03:15`) |
| `Cobrado` | Importe cobrado al cliente |
| `Cancelado` | String: `"Cancelado"` o `"-"` |
| `Categoría` | Auto / SUV / Camioneta / Moto / Bici |
| `Tipo` | Tipo de tarifa (x Hora, etc.) |
| `Empresa Acuerdo` | Nombre de empresa convenio (vacío = sin acuerdo) |

### Formato Monroe (distinto sistema)

Monroe usa otro software. Columnas clave:

| Columna Monroe | Equivalente estándar |
|---|---|
| `INGRESO FECHA` + `INGRESO HORA` + `INGRESO MINUTO` | `Desde` |
| `EGRESO FECHA` + `EGRESO HORA` + `EGRESO MINUTO` | `Hasta` |
| `PERM. DIAS` + `PERM. HORAS` + `PERM. MINS.` | `Tiempo` |
| `IMPORTE` | `Cobrado` |
| `IMPORTE PAGADO` | Lo que realmente abonó (usado para desglose de acuerdos) |
| `CANCELADO` | Boolean True/False |
| `CATEGORIA` | `Categoría` |
| `TIPO` | `Tipo` |
| `OBS` | `Empresa Acuerdo` (Showcase, Carrefour, etc.) |

La detección es automática: si el DataFrame tiene columna `INGRESO FECHA`, se ejecuta `normalize_monroe()` antes del análisis.

---

## Lógica de "ticket operativo"

Un ticket se **excluye** si:
1. `Cancelado == "Cancelado"` (cancelación explícita), **o**
2. `Cobrado == 0` **y** `Cancelado` no es una cancelación explícita

**Excepción Monroe:** el filtro 2 no aplica. Los tickets con importe $0 no cancelados son operativos válidos porque pueden ser:
- Estadías menores al tiempo mínimo de cobro (15 min)
- Convenios con tolerancia de tiempo gratuita

Esto está implementado con el flag `_allow_zero_importe = True` que `normalize_monroe()` inyecta en el DataFrame.

---

## Análisis: qué calcula `run_analysis()`

Recibe el DataFrame ya normalizado, los rangos de turno y los rangos de duración.

**KPIs globales:**
- Tickets operativos, excluidos, total bruto
- Ingresos totales, ticket promedio, duración promedio (min)

**Por turno** (basado en hora de entrada `Desde`):
- Entradas (tickets cuya hora de entrada cae en ese turno)
- Salidas (tickets cuya hora de salida cae en ese turno)
- Ingresos, ticket promedio, duración promedio

**Distribución por duración:** rangos configurables (default: 0-60min / 1-2hs / 2-3hs / +3hs)

**Categorías de vehículos:** conteo por tipo

**Evolución diaria:** tickets e ingresos por fecha

**Acuerdos empresariales:**
- Estándar: conteo por empresa + fila "sin acuerdo" + total
- Monroe: igual pero con columnas adicionales `Igual a $0` / `Mayor que $0` usando `IMPORTE PAGADO`. Todas las variantes de "SHOWCASE - X hr" se agrupan bajo un único bloque `SHOWCASE`.

---

## Export Excel — estructura de pestañas

| Pestaña | Formato |
|---|---|
| KPIs | Dos columnas: Métrica / Valor |
| Turnos | Filas = métricas (Entradas, Salidas, Ingresos, Ticket Promedio, Duración Promedio) / Columnas = turnos |
| Duración | Una fila, rangos como columnas |
| Categorías | Categoría / Tickets |
| Por Día | Fecha / Tickets / Importe |
| Acuerdos | Solo aparece si hay datos. Monroe incluye Igual a $0 y Mayor que $0 |

El archivo de referencia para validar el formato es `Analisis_ORO_2026-04-16.xlsx` (en la raíz del repo, no commiteado).

---

## API endpoints

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/` | Sirve la UI |
| POST | `/api/upload` | Recibe el Excel, lo cachea en memoria, devuelve `file_id`, preview y columnas |
| POST | `/api/analyze` | Recibe `file_id` + `branch` + rangos, devuelve JSON con todos los resultados |
| POST | `/api/export/excel` | Mismos parámetros que analyze, devuelve archivo `.xlsx` |

El caché en memoria es un `OrderedDict` limitado a 100 entradas (LRU). Si el servidor se reinicia (como pasa en Render con el spin-down), el `file_id` se pierde y hay que volver a subir el archivo.

---

## Consideraciones de deploy

- **Render free tier:** el servidor se duerme tras ~15 min de inactividad. El primer request después tarda 50s+. Solución recomendada: configurar UptimeRobot para hacer ping cada 10 minutos.
- **Workers:** 1 worker en gunicorn. El caché en memoria no es compartido entre workers, por eso se usa 1.
- **Límite de archivo:** 50 MB configurado en Flask.

---

## Estado actual (junio 2026)

- Todas las sucursales operativas excepto Hotel Madero (sin turnos configurados, pendiente de datos)
- Monroe normalizado y validado contra los números de administración (14.090 tickets operativos para mayo 2026)
- El nuevo formato de reporte estándar (columna `Cobrado` en lugar de `Importe`) está implementado con fallback al formato viejo para compatibilidad
- Export Excel alineado con el formato de referencia de administración

## Pendiente / conocido

- Hotel Madero no tiene rangos de turno configurados — cuando se defina el horario operativo hay que agregarlo en `BRANCHES['HOTEL_MADERO']['ranges']`
- El caché es volátil: un reinicio del servidor (frecuente en Render free) invalida todos los `file_id` activos
