import './style.css';
import type { PayslipExtraction } from './core/extraction/payslip';
import type { IbanMappingRow, Pain001DebtorConfig, PaymentRow, PaymentSettings, PaymentXmlProfileId, SplitResult } from './core/types';
import { extractionSummaryToCsv, buildPaymentRows, parseIbanMappingCsv } from './core/payment-export/csv';
import type { CsvExportTemplate, CsvExportTemplateConfig } from './core/payment-export/exportTemplates';
import { clearCsvExportTemplatesFromLocalStorage, configToJson, loadCsvExportTemplates, paymentsToTemplatedCsv, saveCsvExportTemplatesToLocalStorage, validateCsvTemplateConfig } from './core/payment-export/exportTemplates';
import { generatePaymentXml, getPaymentXmlProfile, PAYMENT_XML_PROFILES } from './core/payment-export/pain001';
import { formatEuro } from './core/extraction/number';
import { isValidIban } from './core/validation/iban';
import { downloadBlob, textBlob } from './ui/download';
import type { PdfWorkerDone, PdfWorkerMessage } from './workers/pdfWorker';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const SETTINGS_STORAGE_KEY = 'slipcut-local-payment-settings';
const IBAN_MAPPINGS_STORAGE_KEY = 'slipcut-local-iban-mappings';

let selectedPdf: File | null = null;
let splitResult: SplitResult | null = null;
let ibanMappings: IbanMappingRow[] = [];
let payments: PaymentRow[] = [];
let paymentWarnings: string[] = [];
let csvTemplateConfig: CsvExportTemplateConfig | null = null;
let csvTemplateSource: 'localStorage' | 'override' | 'default' | 'not-loaded' = 'not-loaded';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app root');

app.innerHTML = `
  <header class="site-header">
    <div class="header-content">
      <a href="https://redyard.com/" target="_blank" rel="noopener noreferrer" class="brand-link">
        <img class="ry-brand" src="/brand/logo-ry-square.png" alt="Red Yard Research" />
        <span>SlipCut Local <small>v0.1.1</small></span>
      </a>
      <nav>
        <a href="https://redyard.com/" target="_blank" rel="noopener noreferrer">Red Yard Research</a>
        <a href="https://github.com/redyardresearch/slipcut-local" target="_blank" rel="noopener noreferrer">GitHub</a>
        <a href="https://redyard.com/contatti/" target="_blank" rel="noopener noreferrer">Contatti</a>
      </nav>
    </div>
  </header>

  <main class="container">
    <section class="intro-card">
      <div>
        <p class="eyebrow">SlipCut Local</p>
        <h1>Un PDF. Tante buste paga. Pagamenti pronti.</h1>
        <p class="lead">Elabora i cedolini direttamente nel browser, genera lo ZIP separato per dipendente e prepara CSV o PAIN.001 partendo dalla mappatura Codice Fiscale → IBAN. Zero cookie, zero tracciamento.</p>
      </div>
      <div class="privacy-pill">🔒 I file restano nel browser · 0 cookie</div>
    </section>

    <section class="panel">
      <div class="panel-heading">
        <div>
          <h2>1. Carica e analizza il PDF</h2>
          <p>Trascina un PDF o scegli un file. Limite consigliato: 10MB e 250 pagine.</p>
        </div>
      </div>

      <form id="uploadForm">
        <div id="dropArea" class="upload-area" tabindex="0" role="button" aria-label="Seleziona o trascina PDF">
          <div class="upload-icon">PDF</div>
          <p>Trascina qui il tuo PDF</p>
          <p class="or">oppure</p>
          <button type="button" id="uploadBtn" class="btn secondary">Scegli un file</button>
          <input type="file" id="fileInput" accept="application/pdf,.pdf" />
        </div>
        <div id="fileInfo" class="file-info"></div>
        <div id="progressContainer" class="progress-wrap hidden">
          <div class="progress-track"><div id="progressBar" class="progress-bar"></div></div>
          <span id="progressText">0%</span>
        </div>
        <button type="submit" id="processBtn" class="btn primary" disabled>Elabora nel browser</button>
      </form>
    </section>

    <section id="resultsSection" class="panel hidden">
      <div class="panel-heading actions-heading">
        <div>
          <h2>2. Verifica l'estrazione</h2>
          <p id="resultSummary">Nessun risultato disponibile.</p>
        </div>
        <div class="actions">
          <button id="downloadZipBtn" class="btn primary" type="button">Scarica ZIP</button>
          <button id="downloadSummaryBtn" class="btn secondary" type="button">CSV estrazione</button>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Pag.</th>
              <th>Tipo</th>
              <th>CF</th>
              <th>Nome</th>
              <th>Periodo</th>
              <th>Netto</th>
              <th>Conf.</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody id="extractionRows"></tbody>
        </table>
      </div>
    </section>

    <section id="paymentSection" class="panel hidden">
      <div class="panel-heading">
        <div>
          <h2>3. Opzione pagamenti</h2>
          <p>Genera o carica la mappatura Codice Fiscale → IBAN/email, salvala nel browser se vuoi riusarla, poi scegli il formato CSV o genera il file XML PAIN.001/CBI. Il paese banca può essere ricavato automaticamente dalle prime due lettere dell'IBAN nelle colonne che lo richiedono.</p>
        </div>
      </div>

      <div class="payment-grid">
        <div class="field-group iban-mapping-group">
          <label for="mappingInput">Mappatura Codice Fiscale → IBAN/email</label>
          <input id="mappingInput" type="file" accept=".csv,text/csv" />
          <div class="iban-status-card">
            <p id="mappingSummary" class="help">Nessuna mappatura caricata. Puoi importare un CSV o gestire la mappatura in una tabella dedicata.</p>
            <button id="openIbanMappingsBtn" class="btn primary small" type="button">Gestisci mappatura IBAN</button>
          </div>
        </div>
        <div class="field-group">
          <label for="remittanceTemplate">Causale</label>
          <input id="remittanceTemplate" type="text" value="Stipendio {period}" />
          <p class="help">Placeholder disponibili: <code>{period}</code>, <code>{name}</code>.</p>
        </div>
      </div>

      <div class="export-card">
        <div class="export-card-header">
          <div>
            <h3>Formati di esportazione</h3>
            <p class="help">Scegli e configura separatamente il tracciato CSV per l'import massivo o il profilo XML PAIN.001/CBI.</p>
          </div>
          <div class="export-tabs" role="tablist" aria-label="Formati di esportazione pagamenti">
            <button id="csvExportTab" class="export-tab active" type="button" role="tab" aria-selected="true" aria-controls="csvExportPanel">CSV</button>
            <button id="xmlExportTab" class="export-tab" type="button" role="tab" aria-selected="false" aria-controls="xmlExportPanel">XML</button>
          </div>
        </div>

        <div id="csvExportPanel" class="export-panel active" role="tabpanel" aria-labelledby="csvExportTab">
          <div class="format-card">
            <div class="template-row">
              <label for="csvTemplateSelect">Formato CSV pagamenti</label>
              <select id="csvTemplateSelect"></select>
              <span id="csvTemplateLinks" class="template-links hidden"></span>
            </div>
            <p id="csvTemplateDescription" class="help">Caricamento formati CSV…</p>
            <details class="template-editor">
              <summary>Formati CSV personalizzati</summary>
              <p class="help">Qui puoi anche salvare una configurazione personalizzata nel browser o importarla/esportarla come JSON. Ogni colonna può usare <code>source</code> oppure un valore <code>fixed</code>, per esempio <code>{ "header": "Salary", "fixed": "TRUE" }</code>.</p>
              <textarea id="csvTemplateEditor" rows="12" spellcheck="false"></textarea>
              <div class="actions settings-actions">
                <button id="saveCsvTemplatesBtn" class="btn primary" type="button">Salva formati nel browser</button>
                <button id="loadCsvTemplatesFileBtn" class="btn secondary" type="button">Carica JSON</button>
                <button id="exportCsvTemplatesBtn" class="btn secondary" type="button">Esporta JSON</button>
                <button id="resetCsvTemplatesBtn" class="btn secondary" type="button">Ripristina template predefiniti</button>
                <input id="csvTemplatesFileInput" type="file" accept="application/json,.json" class="hidden" />
              </div>
              <p id="csvTemplateMessage" class="help"></p>
            </details>
          </div>
        </div>

        <div id="xmlExportPanel" class="export-panel" role="tabpanel" aria-labelledby="xmlExportTab" hidden>
          <div class="format-card">
            <div class="format-row">
              <label for="xmlProfileSelect">Formato XML pagamenti</label>
              <select id="xmlProfileSelect"></select>
            </div>
            <div class="payment-grid debtor-grid">
              <label>Company name<input id="debtorName" type="text" placeholder="Red Yard Research SRL" /></label>
              <label>Sending IBAN<input id="debtorIban" type="text" placeholder="IT..." /></label>
              <label>Sending BIC<input id="debtorBic" type="text" placeholder="BIC opzionale" /></label>
              <label>CBI CUC / codice cliente<input id="debtorCuc" type="text" placeholder="Opzionale, richiesto da alcune banche" /></label>
              <label>ABI banca ordinante<input id="debtorAbi" type="text" placeholder="Opzionale" /></label>
              <label>Data esecuzione<input id="executionDate" type="date" /></label>
              <label>Message ID<input id="messageId" type="text" /></label>
              <label>Payment Info ID<input id="paymentInfoId" type="text" /></label>
            </div>
            <div class="actions settings-actions">
              <button id="saveSettingsBtn" class="btn primary" type="button">Salva impostazioni</button>
              <button id="loadSettingsBtn" class="btn secondary" type="button">Carica impostazioni</button>
              <button id="clearSettingsBtn" class="btn secondary" type="button">Cancella impostazioni</button>
            </div>
            <p id="settingsMessage" class="help"></p>
          </div>
        </div>
      </div>

      <div class="actions payment-actions">
        <button id="buildPaymentsBtn" class="btn primary" type="button">Prepara pagamenti</button>
        <button id="downloadPaymentsCsvBtn" class="btn secondary" type="button" disabled>CSV pagamenti</button>
        <button id="downloadPainBtn" class="btn secondary" type="button" disabled>XML pagamenti</button>
      </div>

      <div id="paymentMessages" class="messages"></div>
      <div id="paymentsTableWrap" class="table-wrap hidden">
        <table>
          <thead>
            <tr>
              <th>Pag.</th>
              <th>Beneficiario</th>
              <th>Tipo</th>
              <th>CF</th>
              <th>IBAN</th>
              <th>Email</th>
              <th>Importo</th>
              <th>Causale</th>
            </tr>
          </thead>
          <tbody id="paymentRows"></tbody>
        </table>
      </div>
    </section>
  </main>

  <div id="ibanMappingsModal" class="app-modal hidden" role="dialog" aria-modal="true" aria-labelledby="ibanMappingsTitle">
    <div class="app-modal-card app-modal-card-wide">
      <button id="closeIbanMappingsModalBtn" class="app-modal-close" type="button" aria-label="Chiudi">×</button>
      <p class="eyebrow">Rubrica pagamenti</p>
      <h2 id="ibanMappingsTitle">Mappatura IBAN</h2>
      <p class="app-modal-intro">Completa o correggi gli IBAN per i beneficiari estratti. I dati restano solo in questo browser quando scegli di salvarli: SlipCut Local non usa cookie e non invia la mappatura a server esterni. L'email è opzionale e viene usata per l'avviso di pagamento/remittance advice, se il formato di export lo supporta.</p>
      <div id="ibanModalSummary" class="iban-modal-summary help"></div>
      <div class="table-wrap iban-table-wrap">
        <table class="iban-table">
          <thead>
            <tr>
              <th>Codice Fiscale</th>
              <th>Beneficiario</th>
              <th>IBAN</th>
              <th>Email avviso</th>
              <th>Tipo</th>
              <th>Stato</th>
            </tr>
          </thead>
          <tbody id="ibanMappingRows"></tbody>
        </table>
      </div>
      <div class="actions mapping-actions app-modal-actions">
        <button id="downloadMappingTemplateBtn" class="btn secondary small" type="button">Popola dai cedolini</button>
        <button id="saveIbanMappingsBtn" class="btn primary small" type="button">Salva nel browser</button>
        <button id="loadIbanMappingsBtn" class="btn secondary small" type="button">Carica dal browser</button>
        <button id="exportIbanMappingsBtn" class="btn secondary small" type="button">Scarica CSV</button>
        <button id="clearIbanMappingsBtn" class="btn secondary small" type="button">Cancella salvati</button>
        <button id="applyIbanMappingsBtn" class="btn primary small" type="button">Applica e chiudi</button>
      </div>
    </div>
  </div>

  <div id="downloadCelebrationModal" class="app-modal hidden" role="dialog" aria-modal="true" aria-labelledby="downloadCelebrationTitle">
    <div class="app-modal-card">
      <button id="closeCelebrationModalBtn" class="app-modal-close" type="button" aria-label="Chiudi">×</button>
      <p class="eyebrow">Fatto in locale</p>
      <h2 id="downloadCelebrationTitle">Semplice, no?</h2>
      <p id="downloadCelebrationMessage">Hai appena preparato un file senza caricare dati sensibili su un server e senza cookie.</p>
      <p>Se vuoi rendere così semplici anche altri processi della tua azienda, <a href="https://redyard.com/contatti/" target="_blank" rel="noopener noreferrer">parliamone</a>.</p>
      <button id="celebrationContactBtn" class="btn primary" type="button">Contattaci</button>
    </div>
  </div>

  <footer>
    <div class="footer-content">
      <p>© Red Yard Research — SlipCut Local v0.1.1. Elaborazione locale nel browser; nessun upload dei cedolini o degli IBAN. 0 cookie, 0 tracciamento.</p>
      <p>Problemi o suggerimenti? Apri una issue su <a href="https://github.com/redyardresearch/slipcut-local" target="_blank" rel="noopener noreferrer">GitHub</a>. Ti piace SlipCut Local e vuoi contattarci per altri progetti? Usa la <a href="https://redyard.com/contatti/" target="_blank" rel="noopener noreferrer">pagina contatti</a> sul sito Red Yard Research.</p>
      <p class="signature">Made in Calabria with ❤️ and 🌶️</p>
    </div>
  </footer>
`;

const uploadForm = getElement<HTMLFormElement>('uploadForm');
const dropArea = getElement<HTMLDivElement>('dropArea');
const uploadBtn = getElement<HTMLButtonElement>('uploadBtn');
const fileInput = getElement<HTMLInputElement>('fileInput');
const fileInfo = getElement<HTMLDivElement>('fileInfo');
const processBtn = getElement<HTMLButtonElement>('processBtn');
const progressContainer = getElement<HTMLDivElement>('progressContainer');
const progressBar = getElement<HTMLDivElement>('progressBar');
const progressText = getElement<HTMLSpanElement>('progressText');
const resultsSection = getElement<HTMLElement>('resultsSection');
const resultSummary = getElement<HTMLParagraphElement>('resultSummary');
const extractionRows = getElement<HTMLTableSectionElement>('extractionRows');
const downloadZipBtn = getElement<HTMLButtonElement>('downloadZipBtn');
const downloadSummaryBtn = getElement<HTMLButtonElement>('downloadSummaryBtn');
const paymentSection = getElement<HTMLElement>('paymentSection');
const mappingInput = getElement<HTMLInputElement>('mappingInput');
const openIbanMappingsBtn = getElement<HTMLButtonElement>('openIbanMappingsBtn');
const ibanMappingsModal = getElement<HTMLDivElement>('ibanMappingsModal');
const closeIbanMappingsModalBtn = getElement<HTMLButtonElement>('closeIbanMappingsModalBtn');
const ibanModalSummary = getElement<HTMLDivElement>('ibanModalSummary');
const ibanMappingRows = getElement<HTMLTableSectionElement>('ibanMappingRows');
const applyIbanMappingsBtn = getElement<HTMLButtonElement>('applyIbanMappingsBtn');
const saveIbanMappingsBtn = getElement<HTMLButtonElement>('saveIbanMappingsBtn');
const loadIbanMappingsBtn = getElement<HTMLButtonElement>('loadIbanMappingsBtn');
const exportIbanMappingsBtn = getElement<HTMLButtonElement>('exportIbanMappingsBtn');
const clearIbanMappingsBtn = getElement<HTMLButtonElement>('clearIbanMappingsBtn');
const mappingSummary = getElement<HTMLParagraphElement>('mappingSummary');
const downloadMappingTemplateBtn = getElement<HTMLButtonElement>('downloadMappingTemplateBtn');
const remittanceTemplate = getElement<HTMLInputElement>('remittanceTemplate');
const buildPaymentsBtn = getElement<HTMLButtonElement>('buildPaymentsBtn');
const downloadPaymentsCsvBtn = getElement<HTMLButtonElement>('downloadPaymentsCsvBtn');
const downloadPainBtn = getElement<HTMLButtonElement>('downloadPainBtn');
const paymentMessages = getElement<HTMLDivElement>('paymentMessages');
const paymentsTableWrap = getElement<HTMLDivElement>('paymentsTableWrap');
const paymentRows = getElement<HTMLTableSectionElement>('paymentRows');
const debtorName = getElement<HTMLInputElement>('debtorName');
const debtorIban = getElement<HTMLInputElement>('debtorIban');
const debtorBic = getElement<HTMLInputElement>('debtorBic');
const debtorCuc = getElement<HTMLInputElement>('debtorCuc');
const debtorAbi = getElement<HTMLInputElement>('debtorAbi');
const xmlProfileSelect = getElement<HTMLSelectElement>('xmlProfileSelect');
const executionDate = getElement<HTMLInputElement>('executionDate');
const messageId = getElement<HTMLInputElement>('messageId');
const paymentInfoId = getElement<HTMLInputElement>('paymentInfoId');
const saveSettingsBtn = getElement<HTMLButtonElement>('saveSettingsBtn');
const loadSettingsBtn = getElement<HTMLButtonElement>('loadSettingsBtn');
const clearSettingsBtn = getElement<HTMLButtonElement>('clearSettingsBtn');
const settingsMessage = getElement<HTMLParagraphElement>('settingsMessage');
const csvTemplateSelect = getElement<HTMLSelectElement>('csvTemplateSelect');
const csvTemplateDescription = getElement<HTMLParagraphElement>('csvTemplateDescription');
const csvTemplateLinks = getElement<HTMLSpanElement>('csvTemplateLinks');
const csvTemplateEditor = getElement<HTMLTextAreaElement>('csvTemplateEditor');
const saveCsvTemplatesBtn = getElement<HTMLButtonElement>('saveCsvTemplatesBtn');
const loadCsvTemplatesFileBtn = getElement<HTMLButtonElement>('loadCsvTemplatesFileBtn');
const exportCsvTemplatesBtn = getElement<HTMLButtonElement>('exportCsvTemplatesBtn');
const resetCsvTemplatesBtn = getElement<HTMLButtonElement>('resetCsvTemplatesBtn');
const csvTemplatesFileInput = getElement<HTMLInputElement>('csvTemplatesFileInput');
const csvTemplateMessage = getElement<HTMLParagraphElement>('csvTemplateMessage');
const csvExportTab = getElement<HTMLButtonElement>('csvExportTab');
const xmlExportTab = getElement<HTMLButtonElement>('xmlExportTab');
const csvExportPanel = getElement<HTMLDivElement>('csvExportPanel');
const xmlExportPanel = getElement<HTMLDivElement>('xmlExportPanel');
const downloadCelebrationModal = getElement<HTMLDivElement>('downloadCelebrationModal');
const closeCelebrationModalBtn = getElement<HTMLButtonElement>('closeCelebrationModalBtn');
const celebrationContactBtn = getElement<HTMLButtonElement>('celebrationContactBtn');
const downloadCelebrationMessage = getElement<HTMLParagraphElement>('downloadCelebrationMessage');

initialiseXmlProfileOptions();
initialiseDefaults();
loadIbanMappingsFromLocalStorage(false);
void refreshCsvTemplates();

function activateExportTab(tab: 'csv' | 'xml'): void {
  const csvActive = tab === 'csv';
  csvExportTab.classList.toggle('active', csvActive);
  xmlExportTab.classList.toggle('active', !csvActive);
  csvExportTab.setAttribute('aria-selected', String(csvActive));
  xmlExportTab.setAttribute('aria-selected', String(!csvActive));
  csvExportPanel.classList.toggle('active', csvActive);
  xmlExportPanel.classList.toggle('active', !csvActive);
  csvExportPanel.hidden = !csvActive;
  xmlExportPanel.hidden = csvActive;
}

csvExportTab.addEventListener('click', () => activateExportTab('csv'));
xmlExportTab.addEventListener('click', () => activateExportTab('xml'));

uploadBtn.addEventListener('click', () => fileInput.click());
dropArea.addEventListener('click', (event) => {
  if (event.target instanceof HTMLButtonElement) return;
  fileInput.click();
});
dropArea.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') fileInput.click();
});

for (const eventName of ['dragenter', 'dragover', 'dragleave', 'drop']) {
  dropArea.addEventListener(eventName, (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
}
for (const eventName of ['dragenter', 'dragover']) dropArea.addEventListener(eventName, () => dropArea.classList.add('highlight'));
for (const eventName of ['dragleave', 'drop']) dropArea.addEventListener(eventName, () => dropArea.classList.remove('highlight'));

dropArea.addEventListener('drop', (event) => {
  const file = event.dataTransfer?.files[0];
  if (file) selectPdf(file);
});

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) selectPdf(file);
});

uploadForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!selectedPdf) return;
  await processPdf(selectedPdf);
});

downloadZipBtn.addEventListener('click', () => {
  if (splitResult) {
    downloadBlob(splitResult.zipBlob, 'processed_files.zip');
    showDownloadCelebration('ZIP pronto: cedolini separati senza caricare il PDF su un server.');
  }
});

downloadSummaryBtn.addEventListener('click', () => {
  if (!splitResult) return;
  downloadBlob(textBlob(extractionSummaryToCsv(splitResult.rows), 'text/csv;charset=utf-8'), 'extraction_summary.csv');
  showDownloadCelebration('CSV estrazione pronto: dati verificabili, sempre in locale.');
});

openIbanMappingsBtn.addEventListener('click', () => {
  ensureMappingsContainExtractedPeople();
  renderIbanMappingEditor();
  openModal(ibanMappingsModal);
});

closeIbanMappingsModalBtn.addEventListener('click', closeIbanMappingsModal);
ibanMappingsModal.addEventListener('click', (event) => {
  if (event.target === ibanMappingsModal) closeIbanMappingsModal();
});

ibanMappingRows.addEventListener('input', (event) => {
  updateIbanMappingFromControl(event.target, false);
});
ibanMappingRows.addEventListener('change', (event) => {
  updateIbanMappingFromControl(event.target, true);
});

downloadMappingTemplateBtn.addEventListener('click', () => {
  ensureMappingsContainExtractedPeople();
  renderIbanMappingEditor('Righe popolate dai cedolini estratti. Completa gli IBAN mancanti e salva se vuoi riusarle.');
});

mappingInput.addEventListener('change', async () => {
  const file = mappingInput.files?.[0];
  if (!file) return;
  try {
    ibanMappings = mergeMappings(parseIbanMappingCsv(await file.text()), getExtractedPeopleMappings());
    renderIbanMappingSummary(`Mappatura importata da ${file.name}.`);
    renderIbanMappingEditor();
  } catch (error) {
    mappingSummary.textContent = error instanceof Error ? error.message : 'Mappatura IBAN non valida.';
  } finally {
    mappingInput.value = '';
  }
});

applyIbanMappingsBtn.addEventListener('click', () => {
  renderIbanMappingSummary('Mappatura IBAN applicata.');
  closeIbanMappingsModal();
});

saveIbanMappingsBtn.addEventListener('click', () => {
  localStorage.setItem(IBAN_MAPPINGS_STORAGE_KEY, mappingsToCsv(ibanMappings));
  renderIbanMappingSummary('Mappatura IBAN salvata solo in questo browser.');
  renderIbanMappingEditor('Mappatura salvata nel browser.');
});

loadIbanMappingsBtn.addEventListener('click', () => {
  const loaded = loadIbanMappingsFromLocalStorage(true);
  if (!loaded) renderIbanMappingEditor('Nessuna mappatura IBAN salvata trovata.');
});

exportIbanMappingsBtn.addEventListener('click', () => {
  downloadBlob(textBlob(mappingsToCsv(ibanMappings), 'text/csv;charset=utf-8'), 'iban_mapping.csv');
  showDownloadCelebration('Mappatura IBAN esportata: pronta da riusare o condividere internamente.');
});

clearIbanMappingsBtn.addEventListener('click', () => {
  ibanMappings = [];
  localStorage.removeItem(IBAN_MAPPINGS_STORAGE_KEY);
  renderIbanMappingSummary('Mappatura IBAN cancellata dal browser.');
  renderIbanMappingEditor('Mappatura cancellata. Puoi ripopolarla dai cedolini o importare un CSV.');
});

saveSettingsBtn.addEventListener('click', () => savePaymentSettings());
loadSettingsBtn.addEventListener('click', () => {
  const loaded = loadPaymentSettings();
  settingsMessage.textContent = loaded ? 'Impostazioni caricate.' : 'Nessuna impostazione salvata trovata.';
});
clearSettingsBtn.addEventListener('click', () => {
  localStorage.removeItem(SETTINGS_STORAGE_KEY);
  settingsMessage.textContent = 'Impostazioni cancellate dal browser.';
});

xmlProfileSelect.addEventListener('change', () => {
  updateXmlProfileHelp();
});

closeCelebrationModalBtn.addEventListener('click', hideDownloadCelebration);
downloadCelebrationModal.addEventListener('click', (event) => {
  if (event.target === downloadCelebrationModal) hideDownloadCelebration();
});
celebrationContactBtn.addEventListener('click', () => {
  window.open('https://redyard.com/contatti/', '_blank', 'noopener,noreferrer');
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    hideDownloadCelebration();
    closeIbanMappingsModal();
  }
});

csvTemplateSelect.addEventListener('change', () => {
  renderCsvTemplateDetails();
  savePaymentSettings();
});

saveCsvTemplatesBtn.addEventListener('click', async () => {
  try {
    const parsed = validateCsvTemplateConfig(JSON.parse(csvTemplateEditor.value));
    saveCsvExportTemplatesToLocalStorage(parsed);
    await refreshCsvTemplates('localStorage');
    csvTemplateMessage.textContent = 'Formati CSV salvati nel browser.';
  } catch (error) {
    csvTemplateMessage.textContent = error instanceof Error ? error.message : 'Configurazione CSV non valida.';
  }
});

loadCsvTemplatesFileBtn.addEventListener('click', () => csvTemplatesFileInput.click());

csvTemplatesFileInput.addEventListener('change', async () => {
  const file = csvTemplatesFileInput.files?.[0];
  if (!file) return;
  try {
    const parsed = validateCsvTemplateConfig(JSON.parse(await file.text()));
    csvTemplateEditor.value = configToJson(parsed);
    saveCsvExportTemplatesToLocalStorage(parsed);
    await refreshCsvTemplates('localStorage');
    csvTemplateMessage.textContent = `Formati caricati da ${file.name} e salvati nel browser.`;
  } catch (error) {
    csvTemplateMessage.textContent = error instanceof Error ? error.message : 'File JSON non valido.';
  } finally {
    csvTemplatesFileInput.value = '';
  }
});

exportCsvTemplatesBtn.addEventListener('click', () => {
  if (!csvTemplateConfig) return;
  downloadBlob(textBlob(configToJson(csvTemplateConfig), 'application/json;charset=utf-8'), 'export-templates.json');
});

resetCsvTemplatesBtn.addEventListener('click', async () => {
  clearCsvExportTemplatesFromLocalStorage();
  await refreshCsvTemplates();
  csvTemplateMessage.textContent = 'Formati personalizzati cancellati.';
});

buildPaymentsBtn.addEventListener('click', () => {
  if (!splitResult) return;
  const result = buildPaymentRows(splitResult.rows, ibanMappings, remittanceTemplate.value.trim() || 'Stipendio {period}');
  payments = result.payments;
  paymentWarnings = result.warnings;
  renderPayments();
});

downloadPaymentsCsvBtn.addEventListener('click', () => {
  const template = getSelectedCsvTemplate();
  if (!template) {
    paymentMessages.innerHTML = '<p class="error">Seleziona un formato CSV valido.</p>';
    return;
  }
  const fileName = `payments-${template.id}.csv`;
  downloadBlob(textBlob(paymentsToTemplatedCsv(payments, template), 'text/csv;charset=utf-8'), fileName);
  showDownloadCelebration('CSV pagamenti pronto. Bello quando una procedura mensile diventa un clic, vero?');
});

downloadPainBtn.addEventListener('click', () => {
  const config = getPainConfig();
  if (!config) return;
  const profile = getPaymentXmlProfile(config.profileId);
  downloadBlob(textBlob(generatePaymentXml(config, payments), 'application/xml;charset=utf-8'), profile.fileName);
  showDownloadCelebration(`${profile.label} generato: dalla busta paga al flusso banca, sempre in locale.`);
});

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}

function selectPdf(file: File): void {
  resetOutputs();
  if (!isPdf(file)) {
    showFileError('Errore: il file selezionato non è un PDF.');
    return;
  }
  if (file.size > MAX_FILE_BYTES) {
    showFileError('Errore: il file supera 10MB.');
    return;
  }
  selectedPdf = file;
  processBtn.disabled = false;
  fileInfo.innerHTML = `<p>File selezionato: <strong>${escapeHtml(file.name)}</strong> <button type="button" id="removeFileBtn" class="link-button">Rimuovi</button></p>`;
  getElement<HTMLButtonElement>('removeFileBtn').addEventListener('click', () => {
    selectedPdf = null;
    fileInput.value = '';
    fileInfo.textContent = '';
    processBtn.disabled = true;
    resetOutputs();
  });
}

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

function showFileError(message: string): void {
  selectedPdf = null;
  processBtn.disabled = true;
  fileInfo.innerHTML = `<p class="error">${escapeHtml(message)}</p>`;
}

async function processPdf(file: File): Promise<void> {
  processBtn.disabled = true;
  setProgress(0, 1);
  progressContainer.classList.remove('hidden');
  fileInfo.innerHTML = `<p>Elaborazione di <strong>${escapeHtml(file.name)}</strong> in corso…</p>`;

  try {
    const arrayBuffer = await file.arrayBuffer();
    splitResult = await runPdfWorker(file.name, arrayBuffer);
    fileInfo.innerHTML = '<p class="success">File processato correttamente.</p>';
    renderExtractions(splitResult.rows);
    resultsSection.classList.remove('hidden');
    paymentSection.classList.remove('hidden');
    ensureMappingsContainExtractedPeople();
  } catch (error) {
    fileInfo.innerHTML = `<p class="error">${escapeHtml(error instanceof Error ? error.message : 'Errore durante l\'elaborazione.')}</p>`;
  } finally {
    processBtn.disabled = false;
  }
}

function runPdfWorker(fileName: string, arrayBuffer: ArrayBuffer): Promise<SplitResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./workers/pdfWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<PdfWorkerMessage>) => {
      const message = event.data;
      if (message.type === 'progress') {
        setProgress(message.processedPages, message.totalPages);
        return;
      }
      if (message.type === 'error') {
        worker.terminate();
        reject(new Error(message.message));
        return;
      }
      if (message.type !== 'done') {
        // Ignore messages not emitted by our worker protocol. This avoids trying to
        // render `undefined.rows` if a nested library posts diagnostic messages.
        return;
      }

      if (!isWorkerDoneMessage(message)) {
        worker.terminate();
        reject(new Error('Risposta del worker PDF non valida: righe di estrazione mancanti.'));
        return;
      }

      const zipBlob = new Blob([message.zipBuffer], { type: 'application/zip' });
      worker.terminate();
      resolve({
        zipBlob,
        rows: message.rows,
        skippedPages: message.skippedPages,
        processedPages: message.processedPages,
        totalPages: message.totalPages,
      });
    };
    worker.onerror = (error) => {
      worker.terminate();
      reject(new Error(error.message));
    };
    worker.postMessage({ type: 'split-pdf', fileName, arrayBuffer }, [arrayBuffer]);
  });
}

function setProgress(done: number, total: number): void {
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  progressBar.style.width = `${percent}%`;
  progressText.textContent = `${percent}%`;
}

function isWorkerDoneMessage(message: PdfWorkerMessage): message is PdfWorkerDone {
  return message.type === 'done'
    && message.zipBuffer instanceof ArrayBuffer
    && Array.isArray(message.rows)
    && Array.isArray(message.skippedPages)
    && typeof message.processedPages === 'number'
    && typeof message.totalPages === 'number';
}

function renderExtractions(rows: PayslipExtraction[] | undefined): void {
  const safeRows = Array.isArray(rows) ? rows : [];
  const okRows = safeRows.filter((row) => row.codiceFiscale && row.period);
  const missingNet = safeRows.filter((row) => row.netAmount === null).length;
  resultSummary.textContent = `${okRows.length}/${safeRows.length} pagine pronte per ZIP. ${missingNet} pagine senza netto rilevato.`;
  extractionRows.innerHTML = safeRows.map((row) => `
    <tr class="${row.warnings.length ? 'warning-row' : ''}">
      <td>${row.pageNumber}</td>
      <td>${escapeHtml(row.layout)}</td>
      <td>${escapeHtml(row.codiceFiscale ?? '—')}</td>
      <td>${escapeHtml(row.employeeName ?? '—')}</td>
      <td>${escapeHtml(row.period?.yyyymm ?? '—')}</td>
      <td>${row.netAmount === null ? '—' : escapeHtml(formatEuro(row.netAmount))}</td>
      <td>${Math.round(row.confidence * 100)}%</td>
      <td>${escapeHtml(row.warnings.join(', ') || 'OK')}</td>
    </tr>
  `).join('');
}


async function refreshCsvTemplates(preferredSource?: 'localStorage'): Promise<void> {
  try {
    const previouslySelected = csvTemplateSelect.value || collectPaymentSettings().selectedCsvTemplateId;
    const loaded = await loadCsvExportTemplates();
    csvTemplateConfig = loaded.config;
    csvTemplateSource = preferredSource ?? loaded.source;
    csvTemplateSelect.innerHTML = csvTemplateConfig.templates.map((template) => `<option value="${escapeHtml(template.id)}">${escapeHtml(template.label)}</option>`).join('');
    if (previouslySelected && csvTemplateConfig.templates.some((template) => template.id === previouslySelected)) {
      csvTemplateSelect.value = previouslySelected;
    }
    csvTemplateEditor.value = configToJson(csvTemplateConfig);
    renderCsvTemplateDetails();
  } catch (error) {
    csvTemplateDescription.textContent = error instanceof Error ? error.message : 'Errore nel caricamento dei formati CSV.';
    csvTemplateMessage.textContent = csvTemplateDescription.textContent;
  }
}

function getSelectedCsvTemplate(): CsvExportTemplate | null {
  return csvTemplateConfig?.templates.find((template) => template.id === csvTemplateSelect.value) ?? csvTemplateConfig?.templates[0] ?? null;
}

function renderCsvTemplateDetails(): void {
  const template = getSelectedCsvTemplate();
  if (!template) {
    csvTemplateDescription.textContent = 'Nessun formato CSV disponibile.';
    csvTemplateLinks.replaceChildren();
    csvTemplateLinks.classList.add('hidden');
    return;
  }
  const sourceLabel = csvTemplateSource === 'localStorage'
    ? 'template personalizzato'
    : csvTemplateSource === 'default'
      ? 'template di default'
      : '';
  const description = template.description ?? '';
  csvTemplateDescription.textContent = sourceLabel ? `${description} (${sourceLabel})`.trim() : description;
  renderCsvTemplateLinks(template);
}


function renderCsvTemplateLinks(template: CsvExportTemplate): void {
  csvTemplateLinks.replaceChildren();

  const linkItems = [
    {
      link: template.links?.info,
      fallbackLabel: 'Scopri di più',
      rel: 'noopener noreferrer',
      className: 'template-link template-link-info',
    },
    {
      link: template.links?.affiliate,
      fallbackLabel: 'Apri un conto',
      rel: 'sponsored noopener noreferrer',
      className: 'template-link template-link-affiliate',
    },
  ];

  for (const item of linkItems) {
    if (!item.link?.url) continue;

    if (csvTemplateLinks.childElementCount > 0) {
      csvTemplateLinks.appendChild(document.createTextNode(' · '));
    }

    const anchor = document.createElement('a');
    anchor.href = item.link.url;
    anchor.target = '_blank';
    anchor.rel = item.rel;
    anchor.textContent = item.link.label || item.fallbackLabel;
    anchor.className = item.className;
    csvTemplateLinks.appendChild(anchor);
  }

  csvTemplateLinks.classList.toggle('hidden', csvTemplateLinks.childElementCount === 0);
}

function openModal(modal: HTMLElement): void {
  downloadCelebrationModal.classList.add('hidden');
  ibanMappingsModal.classList.add('hidden');
  modal.classList.remove('hidden');
  document.body.classList.add('modal-open');
}

function closeModal(modal: HTMLElement): void {
  modal.classList.add('hidden');
  if (downloadCelebrationModal.classList.contains('hidden') && ibanMappingsModal.classList.contains('hidden')) {
    document.body.classList.remove('modal-open');
  }
}

function closeIbanMappingsModal(): void {
  closeModal(ibanMappingsModal);
  renderIbanMappingSummary();
}

function getExtractedPeopleMappings(): IbanMappingRow[] {
  const seen = new Set<string>();
  const rows: IbanMappingRow[] = [];
  for (const row of splitResult?.rows ?? []) {
    if (!row.codiceFiscale || seen.has(row.codiceFiscale)) continue;
    seen.add(row.codiceFiscale);
    rows.push({
      codiceFiscale: row.codiceFiscale,
      beneficiaryName: row.employeeName ?? '',
      iban: '',
      recipientType: 'INDIVIDUAL',
      email: '',
    });
  }
  return rows;
}

function ensureMappingsContainExtractedPeople(): void {
  ibanMappings = mergeMappings(ibanMappings, getExtractedPeopleMappings());
  renderIbanMappingSummary();
}

function mergeMappings(primaryRows: IbanMappingRow[], fallbackRows: IbanMappingRow[]): IbanMappingRow[] {
  const byCf = new Map<string, IbanMappingRow>();

  for (const row of [...fallbackRows, ...primaryRows]) {
    const codiceFiscale = row.codiceFiscale.toUpperCase().replace(/\s+/g, '');
    if (!codiceFiscale) continue;
    const existing = byCf.get(codiceFiscale);
    byCf.set(codiceFiscale, {
      codiceFiscale,
      beneficiaryName: row.beneficiaryName || existing?.beneficiaryName || '',
      iban: row.iban.toUpperCase().replace(/\s+/g, ''),
      recipientType: row.recipientType === 'BUSINESS' ? 'BUSINESS' : 'INDIVIDUAL',
      email: row.email?.trim() || existing?.email || '',
    });
  }

  return Array.from(byCf.values()).sort((a, b) => a.beneficiaryName.localeCompare(b.beneficiaryName) || a.codiceFiscale.localeCompare(b.codiceFiscale));
}

function renderIbanMappingSummary(prefix?: string): void {
  const extractedCount = getExtractedPeopleMappings().length;
  const mappedExtractedCount = getExtractedPeopleMappings().filter((person) => {
    const mapping = ibanMappings.find((row) => row.codiceFiscale === person.codiceFiscale);
    return mapping?.iban && isValidIban(mapping.iban);
  }).length;
  const invalidCount = ibanMappings.filter((row) => row.iban && !isValidIban(row.iban)).length;
  const emptyIbanCount = ibanMappings.filter((row) => !row.iban).length;
  const businessCount = ibanMappings.filter((row) => row.recipientType === 'BUSINESS').length;
  const parts = [
    extractedCount ? `${extractedCount} beneficiari estratti` : '',
    extractedCount ? `${mappedExtractedCount}/${extractedCount} IBAN pronti` : `${ibanMappings.length} righe`,
    invalidCount ? `${invalidCount} IBAN non validi` : '',
    emptyIbanCount ? `${emptyIbanCount} IBAN mancanti` : '',
    ibanMappings.length ? `Tipo: ${ibanMappings.length - businessCount} INDIVIDUAL, ${businessCount} BUSINESS` : '',
  ].filter(Boolean);
  mappingSummary.textContent = `${prefix ? `${prefix} ` : ''}${parts.join(' · ') || 'Nessuna mappatura caricata.'}`;
}

function renderIbanMappingEditor(message?: string): void {
  const invalidCount = ibanMappings.filter((row) => row.iban && !isValidIban(row.iban)).length;
  const missingCount = ibanMappings.filter((row) => !row.iban).length;
  ibanModalSummary.textContent = message ?? `${ibanMappings.length} righe · ${missingCount} IBAN mancanti · ${invalidCount} IBAN non validi`;

  if (ibanMappings.length === 0) {
    ibanMappingRows.innerHTML = '<tr><td colspan="6" class="empty-cell">Nessuna riga. Popola dai cedolini o importa un CSV dalla pagina principale.</td></tr>';
    return;
  }

  ibanMappingRows.innerHTML = ibanMappings.map((row, index) => {
    const isMissing = !row.iban;
    const isInvalid = Boolean(row.iban) && !isValidIban(row.iban);
    const status = isMissing ? 'IBAN mancante' : isInvalid ? 'IBAN non valido' : 'OK';
    const rowClass = isMissing ? 'mapping-row-missing' : isInvalid ? 'mapping-row-invalid' : 'mapping-row-ok';
    return `
      <tr class="${rowClass}">
        <td><code>${escapeHtml(row.codiceFiscale)}</code></td>
        <td><input class="mapping-name-input" data-index="${index}" data-field="beneficiaryName" type="text" value="${escapeHtml(row.beneficiaryName)}" aria-label="Beneficiario ${escapeHtml(row.codiceFiscale)}" /></td>
        <td><input class="mapping-iban-input" data-index="${index}" data-field="iban" type="text" value="${escapeHtml(row.iban)}" placeholder="IT..." aria-label="IBAN ${escapeHtml(row.codiceFiscale)}" /></td>
        <td><input class="mapping-email-input" data-index="${index}" data-field="email" type="email" value="${escapeHtml(row.email)}" placeholder="nome@azienda.it" aria-label="Email avviso ${escapeHtml(row.codiceFiscale)}" /></td>
        <td>
          <select data-index="${index}" data-field="recipientType" aria-label="Tipo destinatario ${escapeHtml(row.codiceFiscale)}">
            <option value="INDIVIDUAL" ${row.recipientType === 'INDIVIDUAL' ? 'selected' : ''}>INDIVIDUAL</option>
            <option value="BUSINESS" ${row.recipientType === 'BUSINESS' ? 'selected' : ''}>BUSINESS</option>
          </select>
        </td>
        <td><span class="mapping-status">${status}</span></td>
      </tr>
    `;
  }).join('');
}

function updateIbanMappingFromControl(target: EventTarget | null, shouldRerender = true): void {
  if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
  const index = Number(target.dataset.index);
  const field = target.dataset.field as keyof IbanMappingRow | undefined;
  if (!Number.isInteger(index) || index < 0 || index >= ibanMappings.length || !field) return;

  if (field === 'beneficiaryName') ibanMappings[index].beneficiaryName = target.value.trim();
  if (field === 'iban') ibanMappings[index].iban = target.value.toUpperCase().replace(/\s+/g, '');
  if (field === 'email') ibanMappings[index].email = target.value.trim();
  if (field === 'recipientType') ibanMappings[index].recipientType = target.value === 'BUSINESS' ? 'BUSINESS' : 'INDIVIDUAL';

  renderIbanMappingSummary();
  if (shouldRerender) renderIbanMappingEditor();
}

function loadIbanMappingsFromLocalStorage(showMessage: boolean): boolean {
  const stored = localStorage.getItem(IBAN_MAPPINGS_STORAGE_KEY);
  if (!stored) return false;
  try {
    ibanMappings = mergeMappings(parseIbanMappingCsv(stored), getExtractedPeopleMappings());
    if (showMessage) renderIbanMappingSummary('Mappatura IBAN caricata dal browser.');
    renderIbanMappingEditor(showMessage ? 'Mappatura caricata dal browser.' : undefined);
    return true;
  } catch {
    localStorage.removeItem(IBAN_MAPPINGS_STORAGE_KEY);
    return false;
  }
}

function mappingsToCsv(rows: IbanMappingRow[]): string {
  const header = ['codice_fiscale', 'beneficiary_name', 'iban', 'recipient_type', 'email'];
  const lines = rows.map((row) => [
    row.codiceFiscale,
    row.beneficiaryName,
    row.iban,
    row.recipientType,
    row.email,
  ].map(csvCell).join(','));
  return `${[header.join(','), ...lines].join('\n')}\n`;
}

function csvCell(value: unknown): string {
  const text = String(value ?? '');
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function showDownloadCelebration(message: string): void {
  downloadCelebrationMessage.textContent = message;
  openModal(downloadCelebrationModal);
}

function hideDownloadCelebration(): void {
  closeModal(downloadCelebrationModal);
}

function renderPayments(): void {
  const total = payments.reduce((sum, payment) => sum + payment.amount, 0);
  const warningsHtml = paymentWarnings.length
    ? `<ul>${paymentWarnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul>`
    : '<p class="success">Tutte le righe di pagamento sono pronte.</p>';

  paymentMessages.innerHTML = `
    <div class="payment-summary">
      <strong>${payments.length}</strong> pagamenti preparati — totale <strong>${escapeHtml(formatEuro(total))}</strong>
    </div>
    ${warningsHtml}
  `;

  paymentRows.innerHTML = payments.map((payment) => `
    <tr>
      <td>${payment.sourcePage}</td>
      <td>${escapeHtml(payment.beneficiaryName)}</td>
      <td>${escapeHtml(payment.recipientType)}</td>
      <td>${escapeHtml(payment.codiceFiscale)}</td>
      <td>${escapeHtml(maskIban(payment.iban))}</td>
      <td>${escapeHtml(payment.email || '—')}</td>
      <td>${escapeHtml(formatEuro(payment.amount))}</td>
      <td>${escapeHtml(payment.remittanceInformation)}</td>
    </tr>
  `).join('');

  paymentsTableWrap.classList.toggle('hidden', payments.length === 0);
  downloadPaymentsCsvBtn.disabled = payments.length === 0;
  downloadPainBtn.disabled = payments.length === 0;
}


function initialiseXmlProfileOptions(): void {
  xmlProfileSelect.innerHTML = PAYMENT_XML_PROFILES.map((profile) => `
    <option value="${profile.id}">${escapeHtml(profile.label)}</option>
  `).join('');
}

function selectedXmlProfileId(): PaymentXmlProfileId {
  const id = xmlProfileSelect.value as PaymentXmlProfileId;
  return PAYMENT_XML_PROFILES.some((profile) => profile.id === id) ? id : 'pain001-v3';
}

function updateXmlProfileHelp(): void {
  const profile = getPaymentXmlProfile(selectedXmlProfileId());
  const cbiNote = profile.cbi
    ? ' Profilo CBI: compila CUC/codice cliente e/o ABI se richiesto dalla tua banca.'
    : '';
  settingsMessage.textContent = `Formato XML selezionato: ${profile.label}.${cbiNote}`;
}

function getPainConfig(): Pain001DebtorConfig | null {
  if (!debtorName.value.trim() || !debtorIban.value.trim() || !executionDate.value) {
    paymentMessages.innerHTML = '<p class="error">Completa nome ordinante, IBAN ordinante e data esecuzione per generare il file XML pagamenti.</p>';
    return null;
  }
  if (!isValidIban(debtorIban.value)) {
    paymentMessages.innerHTML = '<p class="error">IBAN ordinante non valido.</p>';
    return null;
  }
  return {
    debtorName: debtorName.value.trim(),
    debtorIban: debtorIban.value.trim(),
    debtorBic: debtorBic.value.trim() || undefined,
    debtorAbi: debtorAbi.value.trim() || undefined,
    debtorCuc: debtorCuc.value.trim() || undefined,
    messageId: messageId.value.trim() || defaultMessageId(),
    paymentInfoId: paymentInfoId.value.trim() || `${defaultMessageId()}-PMT`,
    requestedExecutionDate: executionDate.value,
    profileId: selectedXmlProfileId(),
  };
}

function initialiseDefaults(): void {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  executionDate.value = tomorrow.toISOString().slice(0, 10);
  messageId.value = defaultMessageId();
  paymentInfoId.value = `${messageId.value}-PMT`;
  loadPaymentSettings();
  updateXmlProfileHelp();
}

function collectPaymentSettings(): PaymentSettings {
  return {
    debtorName: debtorName.value.trim(),
    debtorIban: debtorIban.value.trim(),
    debtorBic: debtorBic.value.trim(),
    debtorAbi: debtorAbi.value.trim(),
    debtorCuc: debtorCuc.value.trim(),
    remittanceTemplate: remittanceTemplate.value.trim() || 'Stipendio {period}',
    selectedCsvTemplateId: csvTemplateSelect.value || undefined,
    selectedXmlProfileId: selectedXmlProfileId(),
  };
}

function applyPaymentSettings(settings: PaymentSettings): void {
  debtorName.value = settings.debtorName ?? '';
  debtorIban.value = settings.debtorIban ?? '';
  debtorBic.value = settings.debtorBic ?? '';
  debtorAbi.value = settings.debtorAbi ?? '';
  debtorCuc.value = settings.debtorCuc ?? '';
  remittanceTemplate.value = settings.remittanceTemplate || 'Stipendio {period}';
  if (settings.selectedCsvTemplateId) csvTemplateSelect.value = settings.selectedCsvTemplateId;
  if (settings.selectedXmlProfileId) xmlProfileSelect.value = settings.selectedXmlProfileId;
  renderCsvTemplateDetails();
  updateXmlProfileHelp();
}

function savePaymentSettings(): void {
  const settings = collectPaymentSettings();
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  settingsMessage.textContent = 'Impostazioni salvate nel browser.';
}

function loadPaymentSettings(): boolean {
  const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as PaymentSettings;
    applyPaymentSettings(parsed);
    return true;
  } catch {
    localStorage.removeItem(SETTINGS_STORAGE_KEY);
    return false;
  }
}

function defaultMessageId(): string {
  return `SLIPCUT-${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}`;
}

function resetOutputs(): void {
  splitResult = null;
  payments = [];
  paymentWarnings = [];
  resultsSection.classList.add('hidden');
  paymentSection.classList.add('hidden');
  paymentsTableWrap.classList.add('hidden');
  progressContainer.classList.add('hidden');
  downloadPaymentsCsvBtn.disabled = true;
  downloadPainBtn.disabled = true;
}

function maskIban(iban: string): string {
  const clean = iban.replace(/\s+/g, '');
  if (clean.length <= 8) return clean;
  return `${clean.slice(0, 4)}…${clean.slice(-4)}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char] ?? char);
}
