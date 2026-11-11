import { desktopRuntime as chrome } from '../platform/runtime';
export interface HanziComponent {
  character: string;
  meaning?: string;
  pinyin: string[];
  role?: 'meaning' | 'sound';
  isRadical: boolean;
  unknown: boolean;
  expandable: boolean;
}

export interface HanziBreakdown {
  character: string;
  meaning?: string;
  pinyin: string[];
  components: HanziComponent[];
  unidentifiedStrokeIndices: number[];
  strokeCount: number;
}

interface DictionaryRecord {
  character: string;
  definition?: string;
  pinyin?: string[];
  decomposition?: string;
  radical?: string;
  etymology?: { semantic?: string | null; phonetic?: string | null } | null;
  matches?: (number[] | null)[];
}

interface IdsNode { character: string; children: IdsNode[] }

const recordCache = new Map<string, Promise<DictionaryRecord | null>>();
const ternaryIds = new Set(['⿲', '⿳']);
const binaryIds = new Set(['⿰', '⿱', '⿴', '⿵', '⿶', '⿷', '⿸', '⿹', '⿺', '⿻']);

function parseIds(decomposition: string): IdsNode | null {
  const glyphs = [...decomposition];
  let index = 0;
  const parseNode = (): IdsNode | null => {
    const character = glyphs[index++];
    if (!character) return null;
    const childCount = ternaryIds.has(character) ? 3 : binaryIds.has(character) ? 2 : 0;
    const children: IdsNode[] = [];
    for (let child = 0; child < childCount; child++) {
      const node = parseNode();
      if (!node) return null;
      children.push(node);
    }
    return { character, children };
  };
  const root = parseNode();
  return root && index === glyphs.length ? root : null;
}

function namedParts(node: IdsNode): IdsNode[] {
  return node.children.length ? node.children.flatMap(namedParts) : [node];
}

async function loadRecord(character: string): Promise<DictionaryRecord | null> {
  let pending = recordCache.get(character);
  if (!pending) {
    const codePoint = character.codePointAt(0)?.toString(16).toUpperCase();
    if (!codePoint) return null;
    const url = chrome.runtime.getURL(`hanzi-dictionary/${codePoint}.json`);
    pending = fetch(url).then(async response => response.ok ? response.json() as Promise<DictionaryRecord> : null);
    recordCache.set(character, pending);
    void pending.catch(() => recordCache.delete(character));
  }
  return pending;
}

export async function getHanziBreakdown(character: string): Promise<HanziBreakdown> {
  const record = await loadRecord(character);
  const root = parseIds(record?.decomposition ?? '');
  const parts = root?.children.length ? root.children.flatMap(namedParts)
    : root?.character === '？' ? [root] : [];
  const components = await Promise.all(parts.map(async part => {
    const component = part.character;
    const detail = component === '？' ? null : await loadRecord(component);
    return {
      character: component,
      meaning: detail?.definition,
      pinyin: detail?.pinyin ?? [],
      role: record?.etymology?.semantic === component ? 'meaning' as const
        : record?.etymology?.phonetic === component ? 'sound' as const : undefined,
      isRadical: record?.radical === component,
      unknown: component === '？' || !detail,
      expandable: !!detail?.decomposition && !!parseIds(detail.decomposition)?.children.length,
    };
  }));
  const matches = record?.matches ?? [];
  return {
    character, meaning: record?.definition, pinyin: record?.pinyin ?? [], components,
    unidentifiedStrokeIndices: matches.flatMap((match, index) => match === null ? [index] : []),
    strokeCount: matches.length,
  };
}
