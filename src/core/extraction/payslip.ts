import { extractPrimaryCodiceFiscale, matchNameToCodiceFiscale } from './codiceFiscale';
import { extractPeriod, type Period } from './periods';
import { findItalianMoneyValues, parseItalianDecimal } from './number';

export type PayslipLayout = 'employee' | 'collaborator' | 'unknown';
export type NetAmountSource = 'netto-box-position' | 'employee-bottom-fallback' | 'collaborator-text-fallback' | 'generic-text-fallback' | 'not-found';

export interface PositionedTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PayslipPageGeometry {
  items: PositionedTextItem[];
}

export interface PayslipExtraction {
  pageNumber: number;
  layout: PayslipLayout;
  codiceFiscale: string | null;
  employeeName: string | null;
  period: Period | null;
  netAmount: number | null;
  netAmountSource: NetAmountSource;
  grossAmount: number | null;
  confidence: number;
  warnings: string[];
  rawText: string;
}

export function detectPayslipLayout(text: string): PayslipLayout {
  const upper = text.toUpperCase();
  if (upper.includes('PERCIPIENTE PERIODO COMPENSO') || upper.includes('COMPENSO LORDO')) return 'collaborator';
  if (upper.includes('COD. FISC.') || upper.includes('NETTO') || upper.includes('RETRIBUZIONE ORDINARIA')) return 'employee';
  return 'unknown';
}

export function extractPayslipPage(text: string, pageNumber: number, geometry?: PayslipPageGeometry): PayslipExtraction {
  const layout = detectPayslipLayout(text);
  const codiceFiscale = extractPrimaryCodiceFiscale(text);
  const period = extractPeriod(text);
  const employeeName = extractEmployeeName(text, layout, codiceFiscale);
  const netExtraction = extractNetAmountDetailed(text, layout, geometry);
  const netAmount = netExtraction.value;
  const grossAmount = extractGrossAmount(text, layout);
  const warnings: string[] = [];

  if (!codiceFiscale) warnings.push('Codice Fiscale non trovato o checksum non valido');
  if (!period) warnings.push('Periodo non trovato');
  if (!employeeName) warnings.push('Nome dipendente/collaboratore non trovato');
  if (netAmount === null) warnings.push('Netto non trovato');
  if (netAmount !== null && netExtraction.source !== 'netto-box-position') {
    warnings.push(`Netto estratto con fallback testuale: verificare importo (${netExtraction.source})`);
  }

  const required = [codiceFiscale, period].filter(Boolean).length;
  const optional = [employeeName, netAmount !== null].filter(Boolean).length;
  const amountBonus = netExtraction.source === 'netto-box-position' ? 0.1 : 0;
  const confidence = Math.min(1, required * 0.35 + optional * 0.15 + (layout !== 'unknown' ? 0.15 : 0) + amountBonus);

  return {
    pageNumber,
    layout,
    codiceFiscale,
    employeeName,
    period,
    netAmount,
    netAmountSource: netExtraction.source,
    grossAmount,
    confidence,
    warnings,
    rawText: text,
  };
}

export function extractEmployeeName(
  text: string,
  layout: PayslipLayout = detectPayslipLayout(text),
  codiceFiscale: string | null = extractPrimaryCodiceFiscale(text),
): string | null {
  const lines = getUsefulLines(text);

  // Strongest rule: inspect every text field that looks like a person name and
  // keep only candidates whose generated Codice Fiscale name prefix matches the
  // actual CF. This avoids returning company names, addresses, job titles, or
  // nearby labels just because they are close to the CF in text order.
  const cfMatched = findCodiceFiscaleMatchedName(lines, codiceFiscale);
  if (cfMatched) return cfMatched;

  // Fallbacks below are intentionally kept for malformed/truncated PDFs where
  // the printed name cannot be matched to the CF prefix, but they should no
  // longer be the primary extraction path.
  if (layout === 'collaborator' && codiceFiscale) {
    const cfIndex = lines.findIndex((line) => line.includes(codiceFiscale));
    if (cfIndex > 0) {
      for (let i = cfIndex - 1; i >= Math.max(0, cfIndex - 4); i -= 1) {
        const candidate = normalizeNameLine(lines[i]);
        if (candidate) return candidate;
      }
    }
  }

  const bottomIdentityCandidates = lines
    .map((line) => line.match(/^\s*\d{1,4}\s+([A-ZÀ-ÖØ-Ý' -]{5,})\s*$/i)?.[1])
    .filter(Boolean)
    .map(String)
    .map(normalizeNameLine)
    .filter((value): value is string => Boolean(value));

  if (bottomIdentityCandidates.length > 0) return bottomIdentityCandidates[bottomIdentityCandidates.length - 1];

  if (codiceFiscale) {
    const cfIndex = lines.findIndex((line) => line.includes(codiceFiscale));
    if (cfIndex >= 0) {
      for (let i = cfIndex + 1; i < Math.min(lines.length, cfIndex + 8); i += 1) {
        const candidate = normalizeNameLine(lines[i]);
        if (candidate) return candidate;
      }
    }
  }

  return null;
}

function findCodiceFiscaleMatchedName(lines: string[], codiceFiscale: string | null): string | null {
  if (!codiceFiscale) return null;

  const candidates = collectNameCandidates(lines);
  for (const candidate of candidates) {
    const match = matchNameToCodiceFiscale(candidate, codiceFiscale);
    if (match) return match.normalizedName;
  }

  return null;
}

function collectNameCandidates(lines: string[]): string[] {
  const seen = new Set<string>();
  const candidates: string[] = [];

  for (const line of lines) {
    for (const candidate of candidateNameFieldsFromLine(line)) {
      const normalized = normalizeNameLine(candidate);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      candidates.push(normalized);
    }
  }

  return candidates;
}

function candidateNameFieldsFromLine(line: string): string[] {
  const withoutLeadingCodes = line
    .replace(/^\s*\d{1,6}\s+/, '')
    .replace(/^\s*[A-Z]\s+/, '')
    .trim();

  const fields = new Set<string>();
  addIfNameLike(fields, withoutLeadingCodes);

  // Some extracted lines contain multiple visual fields merged together. Split
  // around common numeric/date/money separators and test each alphabetic chunk.
  for (const part of withoutLeadingCodes.split(/(?:\d{1,2}\/\d{1,2}\/\d{2,4}|\d{1,3}(?:\.\d{3})*,\d{2}|\b\d+\b|[-–|:;])/g)) {
    addIfNameLike(fields, part);
  }

  // Also try every 2- to 5-token window inside longer uppercase chunks. This is
  // useful when a name is embedded in a line with surrounding payroll metadata.
  const tokens = withoutLeadingCodes
    .replace(/[^A-ZÀ-ÖØ-Ý' ]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  for (let start = 0; start < tokens.length; start += 1) {
    for (let length = 2; length <= 5 && start + length <= tokens.length; length += 1) {
      addIfNameLike(fields, tokens.slice(start, start + length).join(' '));
    }
  }

  return [...fields];
}

function addIfNameLike(fields: Set<string>, value: string): void {
  const candidate = value.replace(/\s+/g, ' ').trim();
  if (!candidate) return;
  const tokens = candidate.split(/\s+/).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 6) return;
  if (!/^[A-ZÀ-ÖØ-Ý' -]+$/i.test(candidate)) return;
  fields.add(candidate);
}

export function extractGrossAmount(text: string, layout: PayslipLayout = detectPayslipLayout(text)): number | null {
  const normalized = text.replace(/\s+/g, ' ');
  const match = layout === 'collaborator'
    ? normalized.match(/\b1352\s+COMPENSO\s+LORDO\b.*?\b(\d{1,3}(?:\.\d{3})*,\d{2})\b/i)
    : normalized.match(/\b1\s+RETRIBUZIONE\s+ORDINARIA\b.*?\b(\d{1,3}(?:\.\d{3})*,\d{2})\b/i);
  return match ? parseItalianDecimal(match[1]) : null;
}

export function extractNetAmount(text: string, layout: PayslipLayout = detectPayslipLayout(text), geometry?: PayslipPageGeometry): number | null {
  return extractNetAmountDetailed(text, layout, geometry).value;
}

export function extractNetAmountDetailed(
  text: string,
  layout: PayslipLayout = detectPayslipLayout(text),
  geometry?: PayslipPageGeometry,
): { value: number | null; source: NetAmountSource } {
  const positional = extractNetAmountFromNettoBox(geometry);
  if (positional !== null) return { value: positional, source: 'netto-box-position' };

  const lines = getUsefulLines(text);

  const employerIndex = lines.findIndex((line) => /CF:\s*0?\d{11}\b/i.test(line));
  if (employerIndex >= 0) {
    for (let i = employerIndex + 1; i < Math.min(lines.length, employerIndex + 8); i += 1) {
      const amountOnly = lines[i].match(/^\s*(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*$/);
      if (amountOnly) {
        const parsed = parseItalianDecimal(amountOnly[1]);
        if (parsed !== null) return { value: parsed, source: 'employee-bottom-fallback' };
      }
    }
  }

  if (layout === 'collaborator') {
    const idx = lines.findIndex((line) => /ARROT\.\s*PRECEDENTE.*NETTO\s+CORRISPOSTO/i.test(line));
    if (idx >= 0) {
      const stop = lines.findIndex((line, lineIdx) => lineIdx > idx && /PROGRESSIVO\s+COMPENSO/i.test(line));
      const end = stop >= 0 ? stop : Math.min(lines.length, idx + 25);
      const windowText = lines.slice(idx, end).join(' ');
      const values = findItalianMoneyValues(windowText).filter((value) => Math.abs(value.value) >= 100 && Math.abs(value.value) <= 50000);
      if (values.length > 0) return { value: values[values.length - 1].value, source: 'collaborator-text-fallback' };
    }
  }

  const nettoIndex = text.toUpperCase().lastIndexOf('NETTO');
  if (nettoIndex >= 0) {
    const windowText = text.slice(nettoIndex, nettoIndex + 1200);
    const values = findItalianMoneyValues(windowText).filter((value) => Math.abs(value.value) >= 100 && Math.abs(value.value) <= 50000);
    if (values.length > 0) return { value: values[values.length - 1].value, source: 'generic-text-fallback' };
  }

  return { value: null, source: 'not-found' };
}

/**
 * Extract the payable amount from the same visual box as the NETTO label.
 *
 * The previous implementation used plain text order and could accidentally pick
 * gross, taxable, or progressive amounts. PDF text order is not the same as the
 * visual grid, so the payment amount should be selected geometrically: locate the
 * NETTO / NETTO CORRISPOSTO label and then take the nearest currency-looking
 * value to its right in the same box, allowing for a small vertical offset because
 * the amount can be baseline-aligned slightly below the label.
 */
export function extractNetAmountFromNettoBox(geometry?: PayslipPageGeometry): number | null {
  if (!geometry?.items?.length) return null;

  const items = geometry.items
    .map((item) => ({ ...item, upper: item.str.toUpperCase().replace(/\s+/g, ' ').trim() }))
    .filter((item) => item.str.trim().length > 0);

  const labels = items.filter((item) => isNettoLabel(item.upper, items, item));
  const amountItems = items
    .map((item) => ({ item, value: parseItalianDecimal(item.str) }))
    .filter((entry): entry is { item: typeof items[number]; value: number } => (
      entry.value !== null
      && Math.abs(entry.value) >= 100
      && Math.abs(entry.value) <= 50000
      && /^-?\d{1,3}(?:\.\d{3})*,\d{2}$/.test(entry.item.str.trim())
    ));

  type Candidate = { value: number; score: number };
  const candidates: Candidate[] = [];

  for (const label of labels) {
    const labelText = collectNearbyText(items, label, 80);
    const exactNettoBonus = /\bNETTO\b/.test(labelText) && !/NON\s+ARROT|ARROT\.\s*PREC|RITENUTA\s+NETTA/i.test(labelText) ? 100 : 0;
    const collaboratorBonus = /NETTO\s+CORRISPOSTO/.test(labelText) ? 40 : 0;

    for (const { item: amount, value } of amountItems) {
      const dx = amount.x - (label.x + Math.max(label.width, 0));
      const dy = Math.abs(amount.y - label.y);
      const below = label.y - amount.y;

      // Primary case: amount is visually to the right of the NETTO label, on the
      // same baseline or slightly lower in the same rectangular box.
      const isRightOfLabel = dx >= -4 && dx <= 220;
      const isSameBoxVertically = dy <= 26 || (below >= 0 && below <= 58);
      if (!isRightOfLabel || !isSameBoxVertically) continue;

      const horizontalScore = Math.max(0, 90 - Math.abs(dx - 45));
      const verticalScore = Math.max(0, 80 - dy * 2);
      const reasonablePayrollBonus = value >= 500 && value <= 10000 ? 25 : 0;
      candidates.push({
        value,
        score: exactNettoBonus + collaboratorBonus + horizontalScore + verticalScore + reasonablePayrollBonus,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.value ?? null;
}

function isNettoLabel(upper: string, items: Array<PositionedTextItem & { upper: string }>, item: PositionedTextItem): boolean {
  if (!upper.includes('NETTO')) return false;
  if (/NON\s+ARROT|RITENUTA\s+NETTA|RITENUTA\s+NETTA|RITENUTE|CONGUAGLIO|ARROT\.\s*PREC/i.test(upper)) return false;

  if (/\bNETTO\b/.test(upper) || /NETTO\s+CORRISPOSTO/.test(upper)) return true;

  const near = collectNearbyText(items, item, 85);
  return /\bNETTO\b/.test(near) && !/NON\s+ARROT|RITENUTE|CONGUAGLIO|ARROT\.\s*PREC/i.test(near);
}

function collectNearbyText(
  items: Array<PositionedTextItem & { upper: string }>,
  anchor: PositionedTextItem,
  xWindow: number,
): string {
  return items
    .filter((item) => Math.abs(item.y - anchor.y) <= 4 && Math.abs(item.x - anchor.x) <= xWindow)
    .sort((a, b) => a.x - b.x)
    .map((item) => item.upper)
    .join(' ');
}

export function buildPayslipFolder(extraction: PayslipExtraction): string | null {
  if (!extraction.codiceFiscale || !extraction.period) return null;
  return `${extraction.codiceFiscale}/${extraction.period.yyyymm}`;
}

function getUsefulLines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

function normalizeNameLine(line: string): string | null {
  const cleaned = line
    .replace(/\b(CS|CZ|RC|PG|FI|NA|LE|BA|PV)\b$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!/^[A-ZÀ-ÖØ-Ý' -]{5,}$/i.test(cleaned)) return null;
  if (/\b(RED|YARD|RESEARCH|SRL|VIA|PIAZZA|CORSO|LIVELLO|IMPIEGATO|COLLABORATORE|DOCENTE|MANGONE|RENDE)\b/i.test(cleaned)) return null;
  const parts = cleaned.split(/\s+/);
  if (parts.length < 2 || parts.length > 5) return null;
  return parts.map((part) => part.toUpperCase()).join(' ');
}
