export type DisplayUnit = 'm' | 'cm' | 'mm' | 'ft';

const FACTORS: Record<DisplayUnit, number> = { m: 1, cm: 100, mm: 1000, ft: 3.280839895 };

/** Formats a length stored in meters for display. */
export function formatLength(meters: number, unit: DisplayUnit = 'm'): string {
  const v = meters * FACTORS[unit];
  const digits = unit === 'mm' ? 0 : unit === 'cm' ? 1 : 2;
  return `${Number(v.toFixed(digits))} ${unit}`;
}

export function formatArea(m2: number, unit: DisplayUnit = 'm'): string {
  if (unit === 'ft') return `${(m2 * 10.7639).toFixed(1)} ft²`;
  return `${m2.toFixed(1)} m²`;
}

export function toDisplay(meters: number, unit: DisplayUnit): number {
  return meters * FACTORS[unit];
}

export function fromDisplay(value: number, unit: DisplayUnit): number {
  return value / FACTORS[unit];
}

/** Parses "1.8m", "180 cm", "1800mm", "6 ft" or a bare number (meters). */
export function parseLength(text: string): number | null {
  const m = text.trim().replace(',', '.').match(/^(-?\d+(?:\.\d+)?)\s*(mm|cm|m|ft|meter|meters|metre|metres|meter)?$/i);
  if (!m) return null;
  const v = parseFloat(m[1]);
  const u = (m[2] ?? 'm').toLowerCase();
  if (u === 'mm') return v / 1000;
  if (u === 'cm') return v / 100;
  if (u === 'ft') return v / FACTORS.ft;
  return v;
}
