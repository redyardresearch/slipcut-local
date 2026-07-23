import type { Pain001DebtorConfig, PaymentRow, PaymentXmlProfileId, RecipientType } from '../types';
import { normaliseIban } from '../validation/iban';

export interface PaymentXmlProfile {
  id: PaymentXmlProfileId;
  label: string;
  fileName: string;
  namespace: string;
  version: 'pain.001.001.03' | 'pain.001.001.09';
  requiresStructuredExecutionDate: boolean;
  bicElementName: 'BIC' | 'BICFI';
  cbi: boolean;
}

export const PAYMENT_XML_PROFILES: PaymentXmlProfile[] = [
  {
    id: 'pain001-v3',
    label: 'PAIN.001 generico v3',
    fileName: 'pain001-v3.xml',
    namespace: 'urn:iso:std:iso:20022:tech:xsd:pain.001.001.03',
    version: 'pain.001.001.03',
    requiresStructuredExecutionDate: false,
    bicElementName: 'BIC',
    cbi: false,
  },
  {
    id: 'pain001-v9',
    label: 'PAIN.001 generico v9',
    fileName: 'pain001-v9.xml',
    namespace: 'urn:iso:std:iso:20022:tech:xsd:pain.001.001.09',
    version: 'pain.001.001.09',
    requiresStructuredExecutionDate: true,
    bicElementName: 'BICFI',
    cbi: false,
  },
  {
    id: 'cbi-pain001-v9',
    label: 'CBI Italia SCT v00.04.01 / pain.001.001.09',
    fileName: 'cbi-pain001-v9.xml',
    namespace: 'urn:iso:std:iso:20022:tech:xsd:pain.001.001.09',
    version: 'pain.001.001.09',
    requiresStructuredExecutionDate: true,
    bicElementName: 'BICFI',
    cbi: true,
  },
];

export function getPaymentXmlProfile(id: PaymentXmlProfileId): PaymentXmlProfile {
  return PAYMENT_XML_PROFILES.find((profile) => profile.id === id) ?? PAYMENT_XML_PROFILES[0];
}

function eur(amount: number): string {
  return amount.toFixed(2);
}

function text(value: string | number | boolean): string {
  return String(value);
}

function createElement(doc: XMLDocument, profile: PaymentXmlProfile, name: string, value?: string | number | boolean): Element {
  const node = doc.createElementNS(profile.namespace, name);
  if (value !== undefined) node.textContent = text(value);
  return node;
}

function append(parent: Element, child: Element): Element {
  parent.appendChild(child);
  return child;
}

function appendText(parent: Element, doc: XMLDocument, profile: PaymentXmlProfile, name: string, value: string | number | boolean): Element {
  return append(parent, createElement(doc, profile, name, value));
}

function appendIban(parent: Element, doc: XMLDocument, profile: PaymentXmlProfile, iban: string): Element {
  const id = append(parent, createElement(doc, profile, 'Id'));
  appendText(id, doc, profile, 'IBAN', normaliseIban(iban));
  return id;
}

function appendOtherId(
  parent: Element,
  doc: XMLDocument,
  profile: PaymentXmlProfile,
  idValue: string,
  schemeName: string,
): Element {
  const othr = append(parent, createElement(doc, profile, 'Othr'));
  appendText(othr, doc, profile, 'Id', idValue);
  const schmeNm = append(othr, createElement(doc, profile, 'SchmeNm'));
  appendText(schmeNm, doc, profile, 'Prtry', schemeName);
  return othr;
}

function appendPartyId(
  party: Element,
  doc: XMLDocument,
  profile: PaymentXmlProfile,
  idValue: string,
  recipientType: RecipientType,
  schemeName = 'CODICE_FISCALE',
): void {
  const id = append(party, createElement(doc, profile, 'Id'));
  if (recipientType === 'BUSINESS') {
    const orgId = append(id, createElement(doc, profile, 'OrgId'));
    appendOtherId(orgId, doc, profile, idValue, schemeName);
  } else {
    const prvtId = append(id, createElement(doc, profile, 'PrvtId'));
    appendOtherId(prvtId, doc, profile, idValue, schemeName);
  }
}

function appendOptionalDebtorOrganizationId(
  party: Element,
  doc: XMLDocument,
  profile: PaymentXmlProfile,
  config: Pain001DebtorConfig,
): void {
  const value = config.debtorCuc?.trim() || config.debtorAbi?.trim();
  if (!value) return;

  const id = append(party, createElement(doc, profile, 'Id'));
  const orgId = append(id, createElement(doc, profile, 'OrgId'));
  appendOtherId(orgId, doc, profile, value, config.debtorCuc?.trim() ? 'CBI_CUC' : 'ABI');
}

function appendDebtorAgent(parent: Element, doc: XMLDocument, profile: PaymentXmlProfile, config: Pain001DebtorConfig): void {
  const dbtrAgt = append(parent, createElement(doc, profile, 'DbtrAgt'));
  const finInstnId = append(dbtrAgt, createElement(doc, profile, 'FinInstnId'));

  if (config.debtorBic?.trim()) {
    appendText(finInstnId, doc, profile, profile.bicElementName, config.debtorBic.trim().toUpperCase());
  } else if (config.debtorAbi?.trim()) {
    appendOtherId(finInstnId, doc, profile, config.debtorAbi.trim(), 'ABI');
  } else {
    const othr = append(finInstnId, createElement(doc, profile, 'Othr'));
    appendText(othr, doc, profile, 'Id', 'NOTPROVIDED');
  }
}

function appendRequestedExecutionDate(parent: Element, doc: XMLDocument, profile: PaymentXmlProfile, requestedExecutionDate: string): void {
  if (profile.requiresStructuredExecutionDate) {
    const reqdExctnDt = append(parent, createElement(doc, profile, 'ReqdExctnDt'));
    appendText(reqdExctnDt, doc, profile, 'Dt', requestedExecutionDate);
    return;
  }

  appendText(parent, doc, profile, 'ReqdExctnDt', requestedExecutionDate);
}

function appendPaymentTypeInformation(parent: Element, doc: XMLDocument, profile: PaymentXmlProfile): void {
  const pmtTpInf = append(parent, createElement(doc, profile, 'PmtTpInf'));
  const svcLvl = append(pmtTpInf, createElement(doc, profile, 'SvcLvl'));
  appendText(svcLvl, doc, profile, 'Cd', 'SEPA');

  if (profile.cbi) {
    const lclInstrm = append(pmtTpInf, createElement(doc, profile, 'LclInstrm'));
    appendText(lclInstrm, doc, profile, 'Prtry', 'CBI');
  }

  const ctgyPurp = append(pmtTpInf, createElement(doc, profile, 'CtgyPurp'));
  appendText(ctgyPurp, doc, profile, 'Cd', 'SALA');
}

function appendRemittanceInformation(parent: Element, doc: XMLDocument, profile: PaymentXmlProfile, payment: PaymentRow): void {
  const rmtInf = append(parent, createElement(doc, profile, 'RmtInf'));
  appendText(rmtInf, doc, profile, 'Ustrd', payment.remittanceInformation);

  if (!payment.email) return;

  const strd = append(rmtInf, createElement(doc, profile, 'Strd'));
  const rmtLctnDtls = append(strd, createElement(doc, profile, 'RmtLctnDtls'));
  appendText(rmtLctnDtls, doc, profile, 'Mtd', 'EMAL');
  appendText(rmtLctnDtls, doc, profile, 'ElctrncAdr', payment.email);
}

function appendCreditTransfer(parent: Element, doc: XMLDocument, profile: PaymentXmlProfile, config: Pain001DebtorConfig, payment: PaymentRow, index: number): void {
  const cdtTrfTxInf = append(parent, createElement(doc, profile, 'CdtTrfTxInf'));

  const pmtId = append(cdtTrfTxInf, createElement(doc, profile, 'PmtId'));
  appendText(pmtId, doc, profile, 'EndToEndId', `${config.messageId}-${index + 1}`);

  const amt = append(cdtTrfTxInf, createElement(doc, profile, 'Amt'));
  const instdAmt = appendText(amt, doc, profile, 'InstdAmt', eur(payment.amount));
  instdAmt.setAttribute('Ccy', 'EUR');

  const cdtr = append(cdtTrfTxInf, createElement(doc, profile, 'Cdtr'));
  appendText(cdtr, doc, profile, 'Nm', payment.beneficiaryName);
  appendPartyId(cdtr, doc, profile, payment.codiceFiscale, payment.recipientType);

  const cdtrAcct = append(cdtTrfTxInf, createElement(doc, profile, 'CdtrAcct'));
  appendIban(cdtrAcct, doc, profile, payment.iban);

  appendRemittanceInformation(cdtTrfTxInf, doc, profile, payment);
}

function serialiseXml(doc: XMLDocument): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(doc)}\n`;
}

export function generatePaymentXml(config: Pain001DebtorConfig, payments: PaymentRow[]): string {
  const profile = getPaymentXmlProfile(config.profileId ?? 'pain001-v3');
  const doc = document.implementation.createDocument(profile.namespace, 'Document', null);
  const documentElement = doc.documentElement;
  const controlSum = payments.reduce((sum, payment) => sum + payment.amount, 0);

  const cstmr = append(documentElement, createElement(doc, profile, 'CstmrCdtTrfInitn'));

  const grpHdr = append(cstmr, createElement(doc, profile, 'GrpHdr'));
  appendText(grpHdr, doc, profile, 'MsgId', config.messageId);
  appendText(grpHdr, doc, profile, 'CreDtTm', new Date().toISOString());
  appendText(grpHdr, doc, profile, 'NbOfTxs', payments.length);
  appendText(grpHdr, doc, profile, 'CtrlSum', eur(controlSum));
  const initgPty = append(grpHdr, createElement(doc, profile, 'InitgPty'));
  appendText(initgPty, doc, profile, 'Nm', config.debtorName);
  if (profile.cbi) appendOptionalDebtorOrganizationId(initgPty, doc, profile, config);

  const pmtInf = append(cstmr, createElement(doc, profile, 'PmtInf'));
  appendText(pmtInf, doc, profile, 'PmtInfId', config.paymentInfoId);
  appendText(pmtInf, doc, profile, 'PmtMtd', 'TRF');
  appendText(pmtInf, doc, profile, 'BtchBookg', true);
  appendText(pmtInf, doc, profile, 'NbOfTxs', payments.length);
  appendText(pmtInf, doc, profile, 'CtrlSum', eur(controlSum));
  appendPaymentTypeInformation(pmtInf, doc, profile);
  appendRequestedExecutionDate(pmtInf, doc, profile, config.requestedExecutionDate);

  const dbtr = append(pmtInf, createElement(doc, profile, 'Dbtr'));
  appendText(dbtr, doc, profile, 'Nm', config.debtorName);
  if (profile.cbi) appendOptionalDebtorOrganizationId(dbtr, doc, profile, config);

  const dbtrAcct = append(pmtInf, createElement(doc, profile, 'DbtrAcct'));
  appendIban(dbtrAcct, doc, profile, config.debtorIban);

  appendDebtorAgent(pmtInf, doc, profile, config);
  appendText(pmtInf, doc, profile, 'ChrgBr', 'SLEV');

  payments.forEach((payment, index) => appendCreditTransfer(pmtInf, doc, profile, config, payment, index));

  return serialiseXml(doc);
}

export function generatePain001(config: Pain001DebtorConfig, payments: PaymentRow[]): string {
  return generatePaymentXml({ ...config, profileId: config.profileId ?? 'pain001-v3' }, payments);
}
