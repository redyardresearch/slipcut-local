import type { PayslipExtraction } from '../extraction/payslip';

export interface IbanMapping {
  codiceFiscale: string;
  iban: string;
  beneficiaryName?: string;
}

export interface PaymentRow {
  codiceFiscale: string;
  beneficiaryName: string;
  iban: string;
  amount: number;
  period: string;
  remittance: string;
  sourcePage: number;
}

export interface PaymentBuildResult {
  rows: PaymentRow[];
  errors: Array<{ pageNumber: number; message: string }>;
}

export function buildPaymentRows(
  extractions: PayslipExtraction[],
  mappings: IbanMapping[],
  remittanceTemplate = 'Stipendio {period}',
): PaymentBuildResult {
  const mappingByCf = new Map(mappings.map(m => [m.codiceFiscale.toUpperCase(), m]));
  const rows: PaymentRow[] = [];
  const errors: Array<{ pageNumber: number; message: string }> = [];

  for (const extraction of extractions) {
    if (!extraction.codiceFiscale || !extraction.period || extraction.netAmount === null) {
      errors.push({ pageNumber: extraction.pageNumber, message: 'Estrazione incompleta per pagamento' });
      continue;
    }

    const mapping = mappingByCf.get(extraction.codiceFiscale);
    if (!mapping) {
      errors.push({ pageNumber: extraction.pageNumber, message: `IBAN mancante per ${extraction.codiceFiscale}` });
      continue;
    }

    rows.push({
      codiceFiscale: extraction.codiceFiscale,
      beneficiaryName: mapping.beneficiaryName || extraction.employeeName || extraction.codiceFiscale,
      iban: mapping.iban,
      amount: extraction.netAmount,
      period: extraction.period.yyyymm,
      remittance: remittanceTemplate.replaceAll('{period}', extraction.period.yyyymm),
      sourcePage: extraction.pageNumber,
    });
  }

  return { rows, errors };
}
