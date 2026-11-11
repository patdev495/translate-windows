import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { openDesktopPdf } from '../src/services/pdf-document';

test('Desktop PDF Reader opens a real local PDF and exposes its selectable source text', async () => {
  const document = await openDesktopPdf(new Uint8Array(readFileSync('tests/fixtures/hello.pdf')));
  try {
    const page = await document.getPage(1);
    const content = await page.getTextContent();
    expect(document.numPages).toBe(1);
    expect(content.items.filter(item => 'str' in item).map(item => 'str' in item ? item.str : '').join('')).toBe('Hello PDF');
  } finally { await document.destroy(); }
}, 30_000);
