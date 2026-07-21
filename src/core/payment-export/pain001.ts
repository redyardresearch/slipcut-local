import type { Pain001DebtorConfig, PaymentRow } from '../types';
import { normaliseIban } from '../validation/iban';

function xmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function eur(amount: number): string {
  return amount.toFixed(2);
}


function remittanceAdviceEmail(payment: PaymentRow): string {
  if (!payment.email) return '';
  return `
          <Strd>
            <RmtLctnDtls>
              <Mtd>EMAL</Mtd>
              <ElctrncAdr>${xmlEscape(payment.email)}</ElctrncAdr>
            </RmtLctnDtls>
          </Strd>`;
}

function creditorIdentification(payment: PaymentRow): string {
  if (payment.recipientType === 'BUSINESS') {
    return `
          <Id>
            <OrgId>
              <Othr>
                <Id>${xmlEscape(payment.codiceFiscale)}</Id>
                <SchmeNm><Prtry>CODICE_FISCALE</Prtry></SchmeNm>
              </Othr>
            </OrgId>
          </Id>`;
  }

  return `
          <Id>
            <PrvtId>
              <Othr>
                <Id>${xmlEscape(payment.codiceFiscale)}</Id>
                <SchmeNm><Prtry>CODICE_FISCALE</Prtry></SchmeNm>
              </Othr>
            </PrvtId>
          </Id>`;
}

export function generatePain001(config: Pain001DebtorConfig, payments: PaymentRow[]): string {
  const now = new Date().toISOString();
  const controlSum = payments.reduce((sum, payment) => sum + payment.amount, 0);
  const transactions = payments.map((payment, index) => `
      <CdtTrfTxInf>
        <PmtId>
          <EndToEndId>${xmlEscape(`${config.messageId}-${index + 1}`)}</EndToEndId>
        </PmtId>
        <Amt>
          <InstdAmt Ccy="EUR">${eur(payment.amount)}</InstdAmt>
        </Amt>
        <Cdtr>
          <Nm>${xmlEscape(payment.beneficiaryName)}</Nm>${creditorIdentification(payment)}
        </Cdtr>
        <CdtrAcct>
          <Id><IBAN>${xmlEscape(normaliseIban(payment.iban))}</IBAN></Id>
        </CdtrAcct>
        <RmtInf>
          <Ustrd>${xmlEscape(payment.remittanceInformation)}</Ustrd>${remittanceAdviceEmail(payment)}
        </RmtInf>
      </CdtTrfTxInf>`).join('');

  const debtorAgent = config.debtorBic
    ? `<DbtrAgt><FinInstnId><BIC>${xmlEscape(config.debtorBic)}</BIC></FinInstnId></DbtrAgt>`
    : '<DbtrAgt><FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId></DbtrAgt>';

  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>${xmlEscape(config.messageId)}</MsgId>
      <CreDtTm>${now}</CreDtTm>
      <NbOfTxs>${payments.length}</NbOfTxs>
      <CtrlSum>${eur(controlSum)}</CtrlSum>
      <InitgPty><Nm>${xmlEscape(config.debtorName)}</Nm></InitgPty>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>${xmlEscape(config.paymentInfoId)}</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <BtchBookg>true</BtchBookg>
      <NbOfTxs>${payments.length}</NbOfTxs>
      <CtrlSum>${eur(controlSum)}</CtrlSum>
      <PmtTpInf>
        <SvcLvl><Cd>SEPA</Cd></SvcLvl>
        <CtgyPurp><Cd>SALA</Cd></CtgyPurp>
      </PmtTpInf>
      <ReqdExctnDt>${xmlEscape(config.requestedExecutionDate)}</ReqdExctnDt>
      <Dbtr><Nm>${xmlEscape(config.debtorName)}</Nm></Dbtr>
      <DbtrAcct><Id><IBAN>${xmlEscape(normaliseIban(config.debtorIban))}</IBAN></Id></DbtrAcct>
      ${debtorAgent}
      <ChrgBr>SLEV</ChrgBr>${transactions}
    </PmtInf>
  </CstmrCdtTrfInitn>
</Document>
`;
}
