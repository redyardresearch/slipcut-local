import type { PayslipExtraction } from './extraction/payslip';

export interface SplitResult {
  zipBlob: Blob;
  rows: PayslipExtraction[];
  skippedPages: number[];
  processedPages: number;
  totalPages: number;
}

export type RecipientType = 'INDIVIDUAL' | 'BUSINESS';

export interface IbanMappingRow {
  codiceFiscale: string;
  iban: string;
  beneficiaryName: string;
  recipientType: RecipientType;
  email: string;
}

export interface PaymentRow {
  codiceFiscale: string;
  beneficiaryName: string;
  recipientType: RecipientType;
  email: string;
  iban: string;
  amount: number;
  period: string;
  remittanceInformation: string;
  sourcePage: number;
}

export interface Pain001DebtorConfig {
  debtorName: string;
  debtorIban: string;
  debtorBic?: string;
  messageId: string;
  paymentInfoId: string;
  requestedExecutionDate: string;
}

export interface PaymentSettings {
  debtorName: string;
  debtorIban: string;
  debtorBic: string;
  remittanceTemplate: string;
  selectedCsvTemplateId?: string;
}
