import type { PaymentRow } from '../types';

export type CsvTemplateSource =
  | 'beneficiaryName'
  | 'recipientType'
  | 'email'
  | 'codiceFiscale'
  | 'iban'
  | 'recipientBankCountry'
  | 'currency'
  | 'amount'
  | 'period'
  | 'remittanceInformation'
  | 'sourcePage';

export type CsvTemplateFormat = 'text' | 'decimal-dot' | 'decimal-comma' | 'integer';

export interface CsvTemplateColumn {
  header: string;
  source?: CsvTemplateSource;
  fixed?: string | number | boolean;
  format?: CsvTemplateFormat;
}

export interface CsvTemplateLink {
  label: string;
  url: string;
}

export interface CsvExportTemplate {
  id: string;
  label: string;
  description?: string;
  links?: {
    info?: CsvTemplateLink | null;
    affiliate?: CsvTemplateLink | null;
  };
  columns: CsvTemplateColumn[];
}

export interface CsvExportTemplateConfig {
  schemaVersion: 1;
  templates: CsvExportTemplate[];
}

const TEMPLATE_STORAGE_KEY = 'slipcut-local-csv-export-templates';

function csvEscape(value: unknown, forceText = true): string {
  const text = String(value ?? '');
  // Decimal-comma values contain the CSV delimiter when the delimiter is a comma,
  // so they must be quoted. This is still a numeric-looking CSV value for
  // systems/locales that expect comma decimals.
  if (!forceText && /^-?\d+(?:[.,]\d+)?$/.test(text) && !text.includes(',')) return text;
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function validateUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}


function validateTemplateLinks(value: unknown): CsvExportTemplate['links'] | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object') throw new Error('Template links must be an object.');

  const raw = value as Partial<Record<'info' | 'affiliate', Partial<CsvTemplateLink> | null>>;
  const links: NonNullable<CsvExportTemplate['links']> = {};

  for (const key of ['info', 'affiliate'] as const) {
    const link = raw[key];
    if (link === undefined || link === null) {
      links[key] = null;
      continue;
    }
    if (!link.url || !validateUrl(String(link.url))) {
      throw new Error(`Template ${key} link must use an http(s) URL.`);
    }
    links[key] = {
      label: link.label ? String(link.label) : key === 'info' ? 'Learn more' : 'Open an account',
      url: String(link.url),
    };
  }

  return Object.keys(links).length > 0 ? links : undefined;
}

export function validateCsvTemplateConfig(value: unknown): CsvExportTemplateConfig {
  if (!value || typeof value !== 'object') throw new Error('Template config must be an object.');
  const raw = value as Partial<CsvExportTemplateConfig>;
  if (!Array.isArray(raw.templates)) throw new Error('Template config must contain a templates array.');

  const templates = raw.templates.map((template, index) => {
    if (!template || typeof template !== 'object') throw new Error(`Template ${index + 1} is invalid.`);
    const candidate = template as Partial<CsvExportTemplate>;
    if (!candidate.id || !candidate.label) throw new Error(`Template ${index + 1} must have id and label.`);
    if (!Array.isArray(candidate.columns) || candidate.columns.length === 0) throw new Error(`Template ${candidate.id} must define columns.`);

    const columns = candidate.columns.map((column, columnIndex) => {
      if (!column || typeof column !== 'object') throw new Error(`Template ${candidate.id} column ${columnIndex + 1} is invalid.`);
      const c = column as Partial<CsvTemplateColumn>;
      if (!c.header) throw new Error(`Template ${candidate.id} column ${columnIndex + 1} must have a header.`);
      if (!c.source && c.fixed === undefined) throw new Error(`Template ${candidate.id} column ${c.header} must have source or fixed.`);
      return {
        header: String(c.header),
        source: c.source,
        fixed: c.fixed,
        format: c.format ?? 'text',
      } satisfies CsvTemplateColumn;
    });

    const links = validateTemplateLinks(candidate.links);

    return {
      id: String(candidate.id),
      label: String(candidate.label),
      description: candidate.description ? String(candidate.description) : undefined,
      links,
      columns,
    } satisfies CsvExportTemplate;
  });

  return { schemaVersion: 1, templates };
}

export async function loadCsvExportTemplates(): Promise<{ config: CsvExportTemplateConfig; source: 'localStorage' | 'override' | 'default' }> {
  const stored = localStorage.getItem(TEMPLATE_STORAGE_KEY);
  if (stored) {
    try {
      return { config: validateCsvTemplateConfig(JSON.parse(stored)), source: 'localStorage' };
    } catch {
      localStorage.removeItem(TEMPLATE_STORAGE_KEY);
    }
  }

  const override = await fetchTemplateConfig('/config/export-templates.json');
  if (override) return { config: override, source: 'override' };

  const fallback = await fetchTemplateConfig('/config/export-templates.default.json');
  if (fallback) return { config: fallback, source: 'default' };

  throw new Error('No CSV export template configuration found.');
}

async function fetchTemplateConfig(url: string): Promise<CsvExportTemplateConfig | null> {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return null;
    return validateCsvTemplateConfig(await response.json());
  } catch {
    return null;
  }
}

export function saveCsvExportTemplatesToLocalStorage(config: CsvExportTemplateConfig): void {
  localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(validateCsvTemplateConfig(config), null, 2));
}

export function clearCsvExportTemplatesFromLocalStorage(): void {
  localStorage.removeItem(TEMPLATE_STORAGE_KEY);
}

export function configToJson(config: CsvExportTemplateConfig): string {
  return `${JSON.stringify(validateCsvTemplateConfig(config), null, 2)}\n`;
}

export function paymentsToTemplatedCsv(payments: PaymentRow[], template: CsvExportTemplate): string {
  const header = template.columns.map((column) => csvEscape(column.header)).join(',');
  const lines = payments.map((payment) => template.columns.map((column) => {
    const { value, numeric } = valueForColumn(payment, column);
    return csvEscape(value, !numeric);
  }).join(','));
  return [header, ...lines].join('\n');
}

function valueForColumn(payment: PaymentRow, column: CsvTemplateColumn): { value: string | number | boolean; numeric: boolean } {
  if (column.fixed !== undefined) {
    if (typeof column.fixed === 'number') return { value: column.fixed, numeric: true };
    if (typeof column.fixed === 'boolean') return { value: column.fixed ? 'TRUE' : 'FALSE', numeric: false };
    return { value: column.fixed, numeric: false };
  }

  switch (column.source) {
    case 'beneficiaryName': return { value: payment.beneficiaryName, numeric: false };
    case 'recipientType': return { value: payment.recipientType, numeric: false };
    case 'email': return { value: payment.email, numeric: false };
    case 'codiceFiscale': return { value: payment.codiceFiscale, numeric: false };
    case 'iban': return { value: payment.iban, numeric: false };
    case 'recipientBankCountry': return { value: payment.iban.slice(0, 2).toUpperCase(), numeric: false };
    case 'currency': return { value: 'EUR', numeric: false };
    case 'amount': return { value: formatAmount(payment.amount, column.format), numeric: true };
    case 'period': return { value: payment.period, numeric: false };
    case 'remittanceInformation': return { value: payment.remittanceInformation, numeric: false };
    case 'sourcePage': return { value: payment.sourcePage, numeric: true };
    default: return { value: '', numeric: false };
  }
}

function formatAmount(amount: number, format: CsvTemplateFormat = 'decimal-dot'): string {
  if (format === 'integer') return String(Math.round(amount));
  if (format === 'decimal-comma') return amount.toFixed(2).replace('.', ',');
  return amount.toFixed(2);
}
