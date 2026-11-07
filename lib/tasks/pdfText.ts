import pdfParse from 'pdf-parse/lib/pdf-parse.js';

/** An inspection report is about 11 pages. Anything much bigger is not one. */
const MAX_PAGES = 40;
export const MAX_PDF_BYTES = 2_500_000;

export class NotAPdfError extends Error {}

/**
 * Plain text of a PDF, one line per row of the page, with the words of a row separated by spaces.
 * (The library's default glues table cells together, which would make "Major 0 20" read "Major020".)
 */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  if (buffer.length === 0 || buffer.length > MAX_PDF_BYTES || buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new NotAPdfError('That does not look like a PDF (or it is over 2.5 MB).');
  }
  try {
    const result = await pdfParse(buffer, {
      max: MAX_PAGES,
      pagerender: async (page) => {
        const content = await page.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false });
        let out = '';
        let y: number | null = null;
        for (const item of content.items) {
          const itemY = item.transform[5];
          if (y !== null && Math.abs(itemY - y) > 2) out += '\n';
          else if (out && !out.endsWith('\n')) out += ' ';
          out += item.str;
          y = itemY;
        }
        return out;
      },
    });
    return result.text;
  } catch {
    throw new NotAPdfError('Could not read that PDF. Is it protected or damaged?');
  }
}
