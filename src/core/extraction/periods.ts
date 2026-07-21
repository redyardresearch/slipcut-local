export interface Period {
  label: string;
  year: string;
  month: string;
  yyyymm: string;
}

const MONTHS: Record<string, string> = {
  GENNAIO: '01', FEBBRAIO: '02', MARZO: '03', APRILE: '04', MAGGIO: '05', GIUGNO: '06',
  LUGLIO: '07', AGOSTO: '08', SETTEMBRE: '09', OTTOBRE: '10', NOVEMBRE: '11', DICEMBRE: '12',
};

export function extractPeriod(text: string): Period | null {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const monthNameRe = new RegExp(`\\b(${Object.keys(MONTHS).join('|')})\\s+(20\\d{2}|19\\d{2})\\b`, 'i');
  const monthNameMatch = normalized.match(monthNameRe);
  if (monthNameMatch) {
    const monthName = monthNameMatch[1].toUpperCase();
    const year = monthNameMatch[2];
    const month = MONTHS[monthName];
    return { label: `${capitalize(monthName)} ${year}`, year, month, yyyymm: `${year}${month}` };
  }

  const dates = [...normalized.matchAll(/\b(\d{2})\/(\d{2})\/(20\d{2}|19\d{2})\b/g)];
  if (dates.length >= 2) {
    const last = dates[dates.length - 1];
    const month = last[2];
    const year = last[3];
    return { label: `${month}/${year}`, year, month, yyyymm: `${year}${month}` };
  }
  return null;
}

function capitalize(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1).toLowerCase();
}
