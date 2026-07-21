/// <reference lib="webworker" />

import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import pdfJsWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { buildPayslipFolder, extractPayslipPage, type PayslipExtraction, type PayslipPageGeometry, type PositionedTextItem } from '../core/extraction/payslip';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfJsWorkerUrl;

const MAX_PAGES = 250;

type WorkerRequest = {
  type: 'split-pdf';
  fileName: string;
  arrayBuffer: ArrayBuffer;
};

type WorkerProgress = {
  type: 'progress';
  processedPages: number;
  totalPages: number;
};

export type PdfWorkerDone = {
  type: 'done';
  zipBuffer: ArrayBuffer;
  rows: PayslipExtraction[];
  skippedPages: number[];
  processedPages: number;
  totalPages: number;
};

type WorkerFailure = {
  type: 'error';
  message: string;
};

export type PdfWorkerMessage = WorkerProgress | PdfWorkerDone | WorkerFailure;

type TextItemLike = {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
};

function postProgress(message: WorkerProgress): void {
  self.postMessage(message);
}

function toPositionedTextItems(items: unknown[]): PositionedTextItem[] {
  return items
    .map((item) => {
      const textItem = item as TextItemLike;
      const str = String(textItem.str ?? '').trim();
      const transform = textItem.transform ?? [];
      return {
        str,
        x: Number(transform[4] ?? 0),
        y: Number(transform[5] ?? 0),
        width: Number(textItem.width ?? 0),
        height: Number(textItem.height ?? transform[3] ?? 0),
      };
    })
    .filter((item) => item.str.length > 0);
}

function reconstructLines(positioned: PositionedTextItem[]): string {
  const buckets = new Map<number, Array<{ str: string; x: number }>>();
  for (const item of positioned) {
    const yBucket = Math.round(item.y / 3) * 3;
    const line = buckets.get(yBucket) ?? [];
    line.push({ str: item.str, x: item.x });
    buckets.set(yBucket, line);
  }

  return [...buckets.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, line]) => line.sort((a, b) => a.x - b.x).map((item) => item.str).join(' '))
    .join('\n');
}

async function extractTextByPage(pdfData: Uint8Array, totalPages: number): Promise<PayslipExtraction[]> {
  const loadingTask = pdfjsLib.getDocument({ data: pdfData });
  const pdf = await loadingTask.promise;
  const rows: PayslipExtraction[] = [];

  for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 1) {
    const page = await pdf.getPage(pageIndex + 1);
    const textContent = await page.getTextContent();
    const positionedItems = toPositionedTextItems(textContent.items as unknown[]);
    const rawText = reconstructLines(positionedItems);
    const geometry: PayslipPageGeometry = { items: positionedItems };
    rows.push(extractPayslipPage(rawText, pageIndex + 1, geometry));
    postProgress({ type: 'progress', processedPages: pageIndex + 1, totalPages });
  }

  return rows;
}

async function splitPdfToZip(arrayBuffer: ArrayBuffer, fileName: string): Promise<PdfWorkerDone> {
  const sourceBytes = new Uint8Array(arrayBuffer.slice(0));
  const sourcePdf = await PDFDocument.load(sourceBytes);
  const pageCount = sourcePdf.getPageCount();
  const totalPages = Math.min(pageCount, MAX_PAGES);
  const rows = await extractTextByPage(new Uint8Array(arrayBuffer.slice(0)), totalPages);
  const zip = new JSZip();
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const baseName = fileName.replace(/\.pdf$/i, '') || timestamp;
  const skippedPages: number[] = [];

  for (const row of rows) {
    const folderPath = buildPayslipFolder(row);
    if (!folderPath) {
      skippedPages.push(row.pageNumber);
      continue;
    }

    const outputPdf = await PDFDocument.create();
    const [page] = await outputPdf.copyPages(sourcePdf, [row.pageNumber - 1]);
    outputPdf.addPage(page);
    const outputBytes = await outputPdf.save();
    zip.file(`${folderPath}/${baseName}_page_${row.pageNumber}.pdf`, outputBytes);
  }

  if (pageCount > MAX_PAGES) {
    zip.file('note.txt', `The original PDF has ${pageCount} pages, but only the first ${MAX_PAGES} pages were processed.`);
  }

  if (skippedPages.length > 0) {
    zip.file('skipped_pages.txt', `The following pages were skipped due to missing data: ${skippedPages.join(', ')}`);
  }

  zip.file('extraction_rows.json', JSON.stringify(rows, null, 2));
  const zipBuffer = await zip.generateAsync({ type: 'arraybuffer' });

  return { type: 'done', zipBuffer, rows, skippedPages, processedPages: totalPages, totalPages: pageCount };
}

self.addEventListener('message', async (event: MessageEvent<WorkerRequest>) => {
  if (event.data.type !== 'split-pdf') return;

  try {
    const result = await splitPdfToZip(event.data.arrayBuffer, event.data.fileName);
    self.postMessage(result, [result.zipBuffer]);
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'Unknown PDF processing error',
    } satisfies WorkerFailure);
  }
});
