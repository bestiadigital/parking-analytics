export const BRANCHES = {
  "BERUTI": { address: "Beruti 3359", label: "Sucursal Beruti", ranges: [{end: "13:59", name: "Turno Mañana", start: "06:00"}, {end: "21:59", name: "Turno Tarde", start: "14:00"}, {end: "05:59", name: "Turno Noche", start: "22:00"}] },
  "CORRIENTES": { address: "Av. Corrientes 1237", label: "Sucursal Corrientes", ranges: [{end: "14:59", name: "Turno Mañana", start: "06:00"}, {end: "02:00", name: "Turno Tarde", start: "15:00"}] },
  "HOTEL_MADERO": { address: "Rosario Peñaloza 360", label: "Sucursal Hotel Madero", ranges: [] },
  "MONROE": { address: "Av. Monroe 1655", label: "Sucursal Monroe", ranges: [{end: "13:59", name: "Turno Mañana", start: "06:00"}, {end: "21:59", name: "Turno Tarde", start: "14:00"}, {end: "05:59", name: "Turno Noche", start: "22:00"}] },
  "ORO": { address: "Fray Justo Santa María de Oro 2150", label: "Sucursal Oro", ranges: [{end: "13:59", name: "Turno Mañana", start: "06:00"}, {end: "21:59", name: "Turno Tarde", start: "14:00"}, {end: "05:59", name: "Turno Noche", start: "22:00"}] },
  "RIVADAVIA": { address: "Av. Rivadavia 413", label: "Sucursal Rivadavia", ranges: [{end: "13:59", name: "Turno Mañana", start: "06:00"}, {end: "02:00", name: "Turno Tarde", start: "14:00"}] },
  "RODRIGUEZ_PENA": { address: "Rodríguez Peña 835", label: "Sucursal Rodríguez Peña", ranges: [{end: "13:59", name: "Turno Mañana", start: "06:00"}, {end: "02:00", name: "Turno Tarde", start: "14:00"}] },
  "YRIGOYEN": { address: "Av. Hipólito Yrigoyen 672", label: "Sucursal Yrigoyen", ranges: [{end: "13:59", name: "Turno Mañana", start: "05:00"}, {end: "02:00", name: "Turno Tarde", start: "14:00"}]}
};

export const DEFAULT_DUR_RANGES = [
  { name: '0 – 60 min',  from_min: 0,   to_min: 60  },
  { name: '1 – 2 hs',    from_min: 61,  to_min: 120 },
  { name: '2 – 3 hs',    from_min: 121, to_min: 180 },
  { name: '+3 hs',        from_min: 181, to_min: null },
];
