import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  DEFAULT_RENDER_FLAGS,
  Document,
  FLATTEN_NOTHINGTODO,
  FLATTEN_SUCCESS,
  PdfiumError,
  Page,
  cleanupLibrary,
  encodePngRgba,
  initializeLibrary
} from './pdfium.js';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function buildMinimalPdf(text: string): Uint8Array {
  const contentStream = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`;

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];

  objects.forEach((objectBody, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${objectBody}\nendobj\n`;
  });

  const xrefOffset = body.length;

  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;

  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }

  const trailer =
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`;

  return new TextEncoder().encode(body + xref + trailer);
}

describe('pdfium', () => {
  let documentBytes: Uint8Array;

  beforeAll(() => {
    expect(() => initializeLibrary()).not.toThrow();
    expect(() => initializeLibrary()).not.toThrow();

    documentBytes = buildMinimalPdf('Hello World');
  });

  afterAll(() => {
    cleanupLibrary();
  });

  it('opens documents from memory and reports the page count', () => {
    const doc = Document.openBytes(documentBytes);

    try {
      expect(doc.pageCount).toBeGreaterThan(0);
      expect(doc.pageCount).toBe(1);
      expect(doc.isClosed()).toBe(false);
      expect(doc.documentPtr).not.toBeNull();
    } finally {
      doc.close();
    }

    expect(doc.isClosed()).toBe(true);
  });

  it('exposes page dimensions', () => {
    const doc = Document.openBytes(documentBytes);
    const page = doc.getPage(0);

    try {
      expect(page.width).toBeCloseTo(612, 0);
      expect(page.height).toBeCloseTo(792, 0);
    } finally {
      page.close();
      doc.close();
    }
  });

  it('extracts text from pages', () => {
    const doc = Document.openBytes(documentBytes);

    try {
      const page = doc.getPage(0);

      expect(page.text).toContain('Hello World');
      expect(page.text).toBe(page.text);
    } finally {
      doc.close();
    }
  });

  it('extracts positioned text nodes', () => {
    const doc = Document.openBytes(documentBytes);

    try {
      const nodes = doc.getPage(0).textNodes();

      expect(nodes.length).toBeGreaterThan(0);

      for (const node of nodes) {
        expect(node.x).toBeGreaterThanOrEqual(-0.01);
        expect(node.x).toBeLessThanOrEqual(1.01);
        expect(node.y).toBeGreaterThanOrEqual(-0.5);
        expect(node.y).toBeLessThanOrEqual(1.01);
        expect(Number.isFinite(node.endx)).toBe(true);
        expect(Number.isFinite(node.endy)).toBe(true);
      }

      expect(nodes.map((node) => node.content).join('')).toContain('Hello World');
    } finally {
      doc.close();
    }
  });

  it('extracts per-object text objects', () => {
    const doc = Document.openBytes(documentBytes);

    try {
      const objects = doc.getPage(0).textObjects();

      expect(objects.length).toBeGreaterThan(0);
      expect(objects.map((object_) => object_.content).join('')).toContain('Hello World');

      for (const object_ of objects) {
        expect(object_.fontSize).toBeGreaterThan(0);
        expect(object_.w).toBeGreaterThan(0);
        expect(object_.h).toBeGreaterThan(0);
      }
    } finally {
      doc.close();
    }
  });

  it('renders pages to RGBA bitmaps', () => {
    const doc = Document.openBytes(documentBytes);

    try {
      const { data, width, height } = doc.getPage(0).renderToBitmap({ width: 120 });

      expect(width).toBe(120);
      expect(height).toBe(Math.round((792 * 120) / 612));
      expect(data.length).toBeGreaterThanOrEqual(width * height * 4);
    } finally {
      doc.close();
    }
  });

  it('renders pages to PNG bytes', () => {
    const doc = Document.openBytes(documentBytes);
    const page = doc.getPage(0);

    try {
      const options = { width: 100 };
      const bitmap = page.renderToBitmap(options);
      const png = page.renderToPng(options);

      expect(Array.from(png.slice(0, 8))).toEqual(PNG_SIGNATURE);
      expect(png.length).toBeGreaterThan(64);

      const view = new DataView(png.buffer, png.byteOffset, png.byteLength);

      expect(view.getUint32(8, false)).toBe(13);
      expect(png[12]).toBe('I'.charCodeAt(0));
      expect(png[13]).toBe('H'.charCodeAt(0));
      expect(png[14]).toBe('D'.charCodeAt(0));
      expect(png[15]).toBe('R'.charCodeAt(0));
      expect(view.getUint32(16, false)).toBe(bitmap.width);
      expect(view.getUint32(20, false)).toBe(bitmap.height);
      expect(png[24]).toBe(8);
      expect(png[25]).toBe(6);

      expect(Array.from(png.slice(png.length - 8, png.length - 4))).toEqual([
        'I'.charCodeAt(0),
        'E'.charCodeAt(0),
        'N'.charCodeAt(0),
        'D'.charCodeAt(0)
      ]);
    } finally {
      page.close();
      doc.close();
    }
  });

  it('encodes standalone PNG buffers', () => {
    const rgba = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);
    const png = encodePngRgba(rgba, 2, 2);

    expect(Array.from(png.slice(0, 8))).toEqual(PNG_SIGNATURE);
  });

  it('saves documents back to PDF bytes', () => {
    const doc = Document.openBytes(documentBytes);

    try {
      const saved = doc.saveToBuffer();
      const header = new TextDecoder('latin1').decode(saved.subarray(0, 5));

      expect(header).toBe('%PDF-');
      expect(saved.length).toBeGreaterThan(100);
    } finally {
      doc.close();
    }
  });

  it('creates brand new documents', () => {
    const doc = Document.create();

    try {
      expect(doc.pageCount).toBe(0);

      const saved = doc.saveToBuffer();

      expect(new TextDecoder('latin1').decode(saved.subarray(0, 5))).toBe('%PDF-');
    } finally {
      doc.close();
    }
  });

  it('flattens and rotates without errors on unrotated pages', () => {
    const doc = Document.openBytes(documentBytes);

    try {
      const page = doc.getPage(0);

      expect(page.rotate()).toBe(false);

      const flattenResult = page.flatten();

      expect([FLATTEN_SUCCESS, FLATTEN_NOTHINGTODO]).toContain(flattenResult);
    } finally {
      doc.close();
    }
  });

  it('rejects invalid documents and out-of-range page indexes', () => {
    expect(() => Document.openBytes(new TextEncoder().encode('definitely not a pdf'))).toThrow(PdfiumError);

    const doc = Document.openBytes(documentBytes);

    try {
      expect(() => doc.getPage(-1)).toThrow(PdfiumError);
      expect(() => doc.getPage(1)).toThrow(PdfiumError);
      expect(() => doc.getPage(1.5)).toThrow(PdfiumError);
    } finally {
      doc.close();
    }
  });

  it('guards against use after close', () => {
    const doc = Document.openBytes(documentBytes);
    const page = doc.getPage(0);

    doc.close();
    doc.close();

    expect(page.isClosed()).toBe(true);
    expect(() => doc.getPage(0)).toThrow(/closed/);
    expect(() => page.text).toThrow(/closed/);
    expect(() => page.renderToBitmap({ flags: DEFAULT_RENDER_FLAGS })).toThrow(/closed/);
  });

  it('caches pages per document instance', () => {
    const doc = Document.openBytes(documentBytes);

    try {
      const page: Page = doc.getPage(0);

      expect(doc.getPage(0)).toBe(page);
    } finally {
      doc.close();
    }
  });
});
