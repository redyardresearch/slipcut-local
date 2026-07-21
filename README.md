# SlipCut Local v0.1.0

This archive contains the SlipCut Local Vite + TypeScript app with:

- Browser-only PDF processing in a Web Worker.
- PDF.js text extraction with geometry-aware `NETTO` amount detection.
- Per-page PDF splitting with ZIP generation.
- Codice Fiscale/name extraction improvements.
- Extraction summary CSV.
- IBAN mapping workflow.
- Bulk transfer CSV export.
- PAIN.001 XML export.
- LocalStorage-backed payment settings.

## Run locally

```bash
npm install
npm run dev
```

## Build for a static CDN

```bash
npm run build
npm run preview
```

Deploy the generated `dist/` directory.

## Payment CSV format

The payment CSV export uses this bulk transfer template:

```csv
Name,Recipient type,IBAN,Recipient bank country,Currency,Amount,Payment reference
Mario Rossi,INDIVIDUAL,IT60X0542811101000000123456,IT,EUR,1234.56,Stipendio 202606
```

Notes:

- `Amount` is emitted as an unquoted numeric decimal in international format, with `.` as separator.
- `Recipient type` defaults to `INDIVIDUAL`, which is appropriate for payslips.
- `Recipient bank country` is derived from the first two characters of the destination IBAN; `Currency` is `EUR`.

## IBAN mapping template

After extracting a PDF, click **Template mappatura IBAN** to download a template based on extracted employees:

```csv
codice_fiscale,beneficiary_name,iban,recipient_type,email
RSSMRA80A01H501U,Mario Rossi,,INDIVIDUAL
```

Fill in the IBANs and upload the completed file in the payment section.

The mapper accepts these headers:

- `codice_fiscale` or `cf`
- `beneficiary_name` or `name`
- `iban`
- `recipient_type` with `INDIVIDUAL` or `BUSINESS`

## PAIN.001 additions

PAIN.001 generation uses `pain.001.001.03` (XML PAIN.001 v3, supported by most banks that support PAIN.001). It marks the payment category as salary:

```xml
<CtgyPurp><Cd>SALA</Cd></CtgyPurp>
```

Each creditor is also identified using Codice Fiscale under:

- `<PrvtId>` when `recipient_type` is `INDIVIDUAL`
- `<OrgId>` when `recipient_type` is `BUSINESS`

## Local settings

The app lets the user save these fields in browser `localStorage`:

- Company name
- Sending IBAN
- Sending BIC
- Causale / remittance template

Use the buttons in **Impostazioni azienda e PAIN.001**:

- **Salva impostazioni**
- **Carica impostazioni**
- **Cancella impostazioni**

No settings are uploaded anywhere.


## Project links and support

- GitHub: https://github.com/redyardresearch/slipcut-local

If there is a problem, please open an issue on GitHub. If you like SlipCut Local and want to contact Red Yard Research for other projects, use the contact page: https://redyard.com/contatti/

## Docker static nginx image

Build the production image:

```bash
docker build -t slipcut-local:0.1.0 .
```

Run it locally:

```bash
docker run --rm -p 8080:80 slipcut-local:0.1.0
```

Then open:

```text
http://localhost:8080
```

The image uses a multi-stage build: Node builds the Vite app into `dist/`, then nginx serves only the static files.

## CSV export templates

SlipCut Local now loads CSV payment formats from runtime JSON configuration.

Load order:

1. Browser custom config saved in `localStorage`.
2. Deployment override at `/config/export-templates.json`.
3. Open-source default at `/config/export-templates.default.json`.

This keeps generic formats in the repository while allowing a Docker image, mounted file, or custom build to override labels, columns, and provider links without changing application code.

The default config includes:

- a generic 7-column bulk transfer CSV format;
- a `tot.money Bonifici Multipli` example based on `Nome Beneficiario,IBAN,Partita IVA o Codice Fiscale (Opzionale),Importo,Causale`;
- a custom example showing a fixed column, e.g. `{ "header": "Salary", "fixed": "TRUE" }`.

### Runtime Docker override

Mount a custom config over the default path:

```bash
docker run --rm -p 8080:80 \
  -v ./export-templates.json:/usr/share/nginx/html/config/export-templates.json:ro \
  slipcut-local:0.1.0
```

### Template column schema

Each column can use either `source` or `fixed`:

```json
{ "header": "Amount", "source": "amount", "format": "decimal-dot" }
{ "header": "Salary", "fixed": "TRUE" }
```

Supported sources:

- `beneficiaryName`
- `recipientType`
- `codiceFiscale`
- `iban`
- `recipientBankCountry`
- `currency`
- `amount`
- `period`
- `remittanceInformation`
- `sourcePage`

Users can also edit the JSON from the UI, save it to localStorage, load it from a file, or export it as a file.


Amount column formats support:

```text
decimal-dot     -> 1234.56
decimal-comma   -> 1234,56
integer         -> 1235
text            -> raw text formatting
```

Use `decimal-comma` in a template column like this:

```json
{ "header": "Importo", "source": "amount", "format": "decimal-comma" }
```

## License

SlipCut Local is licensed under the GNU Affero General Public License v3.0 or later.
