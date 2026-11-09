// Extracts the text of a source book PDF into Interpretation/sources/<name>.txt, with "=== page N ===" markers
// so knowledge-base entries can cite where a meaning came from.
// Usage: node tools/extract-pdf.mjs "<pdf path>" <output-name>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const [pdfPath, name] = process.argv.slice(2);
if (!pdfPath || !name) {
  console.error('Usage: node tools/extract-pdf.mjs "<pdf path>" <output-name>');
  process.exit(1);
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'Interpretation', 'sources');
mkdirSync(outDir, { recursive: true });

const doc = await getDocument({ data: new Uint8Array(readFileSync(pdfPath)), useSystemFonts: true, disableFontFace: true, verbosity: 0 }).promise;
const pages = [];
for (let n = 1; n <= doc.numPages; n++) {
  const page = await doc.getPage(n);
  const content = await page.getTextContent();
  let text = '';
  for (const item of content.items) {
    text += item.str;
    text += item.hasEOL ? '\n' : (item.str && !item.str.endsWith(' ') ? ' ' : '');
  }
  pages.push(`=== page ${n} ===\n${text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()}`);
  page.cleanup();
}

const out = join(outDir, `${name}.txt`);
writeFileSync(out, pages.join('\n\n') + '\n');
const chars = pages.reduce((sum, p) => sum + p.length, 0);
console.log(`${name}: ${doc.numPages} pages, ${chars.toLocaleString()} characters → ${out}`);
