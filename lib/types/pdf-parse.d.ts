declare module 'pdf-parse/lib/pdf-parse.js' {
  interface PdfTextContent {
    items: Array<{ str: string; transform: number[] }>;
  }
  interface PdfPage {
    getTextContent(options?: { normalizeWhitespace?: boolean; disableCombineTextItems?: boolean }): Promise<PdfTextContent>;
  }
  interface PdfParseResult {
    numpages: number;
    text: string;
  }
  function pdfParse(data: Buffer, options?: { max?: number; pagerender?: (page: PdfPage) => Promise<string> | string }): Promise<PdfParseResult>;
  export = pdfParse;
}
