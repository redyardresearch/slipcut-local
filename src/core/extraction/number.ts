/** Utilities for Italian payroll numbers. */
export function parseItalianDecimal(value: string): number | null {
  const cleaned = value.trim().replace(/\s+/g, '').replace(/[€]/g, '');
  if (!/^-?\d{1,3}(?:\.\d{3})*(?:,\d+)?$|^-?\d+(?:,\d+)?$/.test(cleaned)) return null;
  const parsed = Number(cleaned.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatEuro(value: number): string {
  return value.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
}

export function formatItalianDecimal(value: number, decimals = 2): string {
  return value.toLocaleString('it-IT', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function findItalianMoneyValues(text: string): Array<{ raw: string; value: number; index: number }> {
  const matches: Array<{ raw: string; value: number; index: number }> = [];
  const re = /-?\d{1,3}(?:\.\d{3})+,\d{2}|-?\d+,\d{2}/g;
  for (const match of text.matchAll(re)) {
    const value = parseItalianDecimal(match[0]);
    if (value !== null) matches.push({ raw: match[0], value, index: match.index ?? -1 });
  }
  return matches;
}
