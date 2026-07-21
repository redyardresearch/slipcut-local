import type { IbanMappingRow, PaymentRow, RecipientType } from '../types';
import type { PayslipExtraction } from '../extraction/payslip';
import { formatItalianDecimal } from '../extraction/number';
import { isValidIban, normaliseIban } from '../validation/iban';

function csvEscape(value: unknown): string {
  const text = String(value ?? '');
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function splitCsvLine(line: string): string[] {
  const separator = line.includes(';') && !line.includes(',') ? ';' : ',';
  const out: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"') {
      current += '"';
      i += 1;
    } else if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === separator && !inQuotes) {
      out.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  out.push(current.trim());
  return out;
}

function normaliseHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function normaliseRecipientType(value: string | undefined): RecipientType {
  const clean = (value ?? '').trim().toUpperCase();
  if (clean === 'BUSINESS' || clean === 'COMPANY' || clean === 'ORGANIZATION' || clean === 'ORG') return 'BUSINESS';
  return 'INDIVIDUAL';
}

function getByHeader(values: string[], headers: string[], aliases: string[]): string {
  const idx = headers.findIndex((header) => aliases.includes(header));
  return idx >= 0 ? values[idx] ?? '' : '';
}

export function parseIbanMappingCsv(csv: string): IbanMappingRow[] {
  const lines = csv.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  const firstValues = splitCsvLine(lines[0]);
  const headers = firstValues.map(normaliseHeader);
  const hasHeader = headers.some((header) => ['codice_fiscale', 'cf', 'iban', 'beneficiary_name', 'name', 'recipient_type', 'email'].includes(header));
  const dataLines = hasHeader ? lines.slice(1) : lines;

  return dataLines.map((line) => {
    const values = splitCsvLine(line);
    let codiceFiscale = '';
    let iban = '';
    let beneficiaryName = '';
    let recipientType: RecipientType = 'INDIVIDUAL';
    let email = '';

    if (hasHeader) {
      codiceFiscale = getByHeader(values, headers, ['codice_fiscale', 'cf', 'tax_code', 'fiscal_code']);
      iban = getByHeader(values, headers, ['iban']);
      beneficiaryName = getByHeader(values, headers, ['beneficiary_name', 'name', 'beneficiario', 'recipient_name']);
      recipientType = normaliseRecipientType(getByHeader(values, headers, ['recipient_type', 'tipo_destinatario', 'type']));
      email = getByHeader(values, headers, ['email', 'e_mail', 'mail', 'remittance_email', 'indirizzo_email']);
    } else {
      [codiceFiscale = '', iban = '', beneficiaryName = '', recipientType = 'INDIVIDUAL' as RecipientType, email = ''] = values as [string, string, string, RecipientType, string];
      recipientType = normaliseRecipientType(recipientType);
    }

    return {
      codiceFiscale: codiceFiscale.toUpperCase().replace(/\s+/g, ''),
      iban: normaliseIban(iban),
      beneficiaryName: beneficiaryName.trim(),
      recipientType,
      email: email.trim(),
    };
  }).filter((row) => row.codiceFiscale || row.iban || row.beneficiaryName);
}

export function buildPaymentRows(
  extractedRows: PayslipExtraction[],
  mappings: IbanMappingRow[],
  remittanceTemplate = 'Stipendio {period}',
): { payments: PaymentRow[]; warnings: string[] } {
  const warnings: string[] = [];
  const mappingByCf = new Map<string, IbanMappingRow>();

  for (const mapping of mappings) {
    if (!mapping.codiceFiscale) continue;
    if (mappingByCf.has(mapping.codiceFiscale)) warnings.push(`Mappatura duplicata per ${mapping.codiceFiscale}`);
    if (!isValidIban(mapping.iban)) warnings.push(`IBAN non valido per ${mapping.codiceFiscale}`);
    mappingByCf.set(mapping.codiceFiscale, mapping);
  }

  const payments: PaymentRow[] = [];
  for (const row of extractedRows) {
    if (!row.codiceFiscale || !row.period) continue;
    if (row.netAmount === null) {
      warnings.push(`Netto mancante a pagina ${row.pageNumber}`);
      continue;
    }
    const mapping = mappingByCf.get(row.codiceFiscale);
    if (!mapping) {
      warnings.push(`IBAN mancante per ${row.codiceFiscale} (${row.employeeName ?? `pagina ${row.pageNumber}`})`);
      continue;
    }
    if (!isValidIban(mapping.iban)) continue;

    payments.push({
      codiceFiscale: row.codiceFiscale,
      beneficiaryName: mapping.beneficiaryName || row.employeeName || row.codiceFiscale,
      recipientType: mapping.recipientType ?? 'INDIVIDUAL',
      email: mapping.email ?? '',
      iban: mapping.iban,
      amount: row.netAmount,
      period: row.period.yyyymm,
      remittanceInformation: remittanceTemplate.replaceAll('{period}', row.period.yyyymm).replaceAll('{name}', row.employeeName ?? ''),
      sourcePage: row.pageNumber,
    });
  }

  return { payments, warnings };
}

/**
 * Bulk transfer CSV format.
 * Amount is intentionally emitted as an unquoted decimal number with dot separator.
 * Recipient bank country is derived from the first two characters of the IBAN.
 */
export function paymentsToCsv(payments: PaymentRow[]): string {
  const header = ['Name', 'Recipient type', 'Email', 'IBAN', 'Recipient bank country', 'Currency', 'Amount', 'Payment reference'];
  const lines = payments.map((row) => [
    csvEscape(row.beneficiaryName),
    csvEscape(row.recipientType),
    csvEscape(row.email),
    csvEscape(row.iban),
    csvEscape(row.iban.slice(0, 2).toUpperCase()),
    'EUR',
    row.amount.toFixed(2),
    csvEscape(row.remittanceInformation),
  ].join(','));
  return [header.join(','), ...lines].join('\n');
}

export function ibanMappingTemplateToCsv(rows: PayslipExtraction[] = []): string {
  const header = ['codice_fiscale', 'beneficiary_name', 'iban', 'recipient_type', 'email'];
  const seen = new Set<string>();
  const lines = rows
    .filter((row) => row.codiceFiscale)
    .filter((row) => {
      if (!row.codiceFiscale || seen.has(row.codiceFiscale)) return false;
      seen.add(row.codiceFiscale);
      return true;
    })
    .map((row) => [
      row.codiceFiscale,
      row.employeeName ?? '',
      '',
      'INDIVIDUAL',
      '',
    ].map(csvEscape).join(','));

  if (lines.length === 0) lines.push(['RSSMRA80A01H501U', 'Mario Rossi', 'IT60X0542811101000000123456', 'INDIVIDUAL', 'mario.rossi@example.com'].map(csvEscape).join(','));
  return [header.join(','), ...lines].join('\n');
}

export function extractionSummaryToCsv(rows: PayslipExtraction[]): string {
  const header = ['page', 'layout', 'confidence', 'codice_fiscale', 'employee_name', 'period', 'gross_eur', 'net_eur', 'warnings'];
  const lines = rows.map((row) => [
    row.pageNumber,
    row.layout,
    Math.round(row.confidence * 100),
    row.codiceFiscale ?? '',
    row.employeeName ?? '',
    row.period?.yyyymm ?? '',
    row.grossAmount === null ? '' : formatItalianDecimal(row.grossAmount, 2),
    row.netAmount === null ? '' : formatItalianDecimal(row.netAmount, 2),
    row.warnings.join('|'),
  ].map(csvEscape).join(','));
  return [header.join(','), ...lines].join('\n');
}
