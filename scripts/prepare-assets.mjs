import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'public');
const source = resolve(root, 'third_party/makemeahanzi');
const stroke = resolve(root, 'node_modules/hanzi-writer-data');
const pdf = resolve(root, 'node_modules/pdfjs-dist');
const dictionary = readFileSync(resolve(source, 'dictionary.txt'), 'utf8');
const version = createHash('sha256').update(dictionary).update(readFileSync(resolve(stroke,'package.json'))).update(readFileSync(resolve(pdf,'package.json'))).digest('hex');
const marker = resolve(output, '.learning-assets-version');
if (existsSync(marker) && readFileSync(marker,'utf8') === version && existsSync(resolve(output,'hanzi-data/6211.json')) && existsSync(resolve(output,'pdf.worker.min.mjs'))) {
  console.log('Offline learning and PDF assets are ready.');
} else {
  for (const directory of ['hanzi-data','hanzi-dictionary','licenses','pdf-assets']) mkdirSync(resolve(output,directory), { recursive:true });
  for (const name of readdirSync(stroke)) {
    if (!name.endsWith('.json') || [...name.slice(0,-5)].length !== 1) continue;
    const code = name.slice(0,-5).codePointAt(0).toString(16).toUpperCase();
    copyFileSync(resolve(stroke,name),resolve(output,'hanzi-data',`${code}.json`));
  }
  for (const line of dictionary.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const record = JSON.parse(line);
    const code = record.character.codePointAt(0).toString(16).toUpperCase();
    writeFileSync(resolve(output,'hanzi-dictionary',`${code}.json`),JSON.stringify(record));
  }
  copyFileSync(resolve(stroke,'ARPHICPL.TXT'),resolve(output,'hanzi-data/ARPHICPL.TXT'));
  for (const file of ['LGPL','COPYING','PROVENANCE.md','dictionary.txt']) copyFileSync(resolve(source,file),resolve(output,'licenses',`makemeahanzi-${file}`));
  for (const file of ['LICENSE','COPYING.md']) copyFileSync(resolve(root,'node_modules/hanzi-writer',file),resolve(output,'licenses',`hanzi-writer-${file}`));
  copyFileSync(resolve(pdf,'LICENSE'),resolve(output,'licenses/pdfjs-LICENSE'));
  copyFileSync(resolve(pdf,'legacy/build/pdf.worker.min.mjs'),resolve(output,'pdf.worker.min.mjs'));
  for (const directory of ['cmaps','standard_fonts','wasm']) cpSync(resolve(pdf,directory),resolve(output,'pdf-assets',directory),{ recursive:true });
  copyFileSync(resolve(root,'src/assets/cmu-dict.json'),resolve(output,'cmu-dict.json'));
  writeFileSync(marker,version);
  console.log('Prepared offline Hanzi, dictionary, pronunciation and PDF assets.');
}
