// Unit conversion. All internal geometry is in PDF points (1/72 inch).

export const PT_PER_IN = 72;
export const MM_PER_IN = 25.4;

export function toPt(value, unit) {
  if (unit === 'mm') return (value / MM_PER_IN) * PT_PER_IN;
  return value * PT_PER_IN;
}

export function fromPt(pt, unit) {
  if (unit === 'mm') return (pt / PT_PER_IN) * MM_PER_IN;
  return pt / PT_PER_IN;
}

export function convert(value, fromUnit, toUnit) {
  return fromPt(toPt(value, fromUnit), toUnit);
}

// Rounds a length for display in an input field.
export function roundFor(value, unit) {
  const factor = unit === 'mm' ? 100 : 1000;
  return Math.round(value * factor) / factor;
}

export function formatLength(value, unit) {
  const v = roundFor(value, unit);
  return unit === 'mm' ? `${v} mm` : `${v}"`;
}
