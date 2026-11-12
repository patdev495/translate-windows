import { latencyEvent, latencySpan } from './latency';
import { desktopRuntime as chrome } from '../platform/runtime';
import { OutputFormat, pinyin, segment } from 'pinyin-pro';

let cmuDictCache: Record<string, string> | null = null;
let cmuDictLoadPromise: Promise<Record<string, string>> | null = null;

const zhRunPattern = /[\u3400-\u9fff\uf900-\ufaff]+/g;
const zhCharPattern = /[\u3400-\u9fff\uf900-\ufaff]/;

async function getCmuDict(traceId?: string): Promise<Record<string, string>> {
  if (cmuDictCache) { latencyEvent('dictionary-hit', 0, traceId); return cmuDictCache; }
  if (cmuDictLoadPromise) { latencyEvent('dictionary-wait', 0, traceId); return cmuDictLoadPromise; }

  if (!cmuDictLoadPromise) {
    latencyEvent('dictionary-miss', 0, traceId);
    cmuDictLoadPromise = (async () => {
      try {
        const url = chrome.runtime.getURL('cmu-dict.json');
        const response = await latencySpan('dictionary-fetch', () => fetch(url), traceId);
        if (!response.ok) throw new Error(`CMU dictionary HTTP ${response.status}`);
        cmuDictCache = await latencySpan('dictionary-parse', () => response.json(), traceId);
      } catch (err) {
        console.error('Failed to load CMU dictionary:', err);
      }
      return cmuDictCache || {};
    })().finally(() => { cmuDictLoadPromise = null; });
  }
  return cmuDictLoadPromise;
}

export class PhoneticEngine {
  static getPinyin(text: string): string {
    const isolatedCharacter = text.trim();
    if (/^\p{Script=Han}$/u.test(isolatedCharacter)) {
      return `${isolatedCharacter} ${PhoneticEngine.getPinyinReadings(isolatedCharacter).join(' / ')}`;
    }
    return text
      .split('\n')
      .map(line => line.replace(zhRunPattern, run => formatZhPinyinRun(run)).replace(/\s+([,.;:?!])/g, '$1'))
      .join('\n');
  }

  static getPinyinReadings(character: string): string[] {
    return pinyin(character, { multiple: true, type: 'array' }) as string[];
  }

  static async getEnglishIPA(text: string, traceId?: string): Promise<string> {
    return latencySpan('ipa', () => this.englishIPA(text, traceId), traceId);
  }

  private static async englishIPA(text: string, traceId?: string): Promise<string> {
    const cmuDict = await latencySpan('dictionary-load', () => getCmuDict(traceId), traceId);
    const tokens = text.split(/([a-zA-Z'-]+)/);
    const grouped: string[] = [];

    for (const token of tokens) {
      if (token.length === 0) {
        continue;
      }

      if (/^[a-zA-Z'-]+$/.test(token)) {
        const lower = token.toLowerCase();
        if (lower in cmuDict) {
          grouped.push(`${token} ${cmuDict[lower]}`);
        } else {
          grouped.push(token);
        }
        continue;
      }

      if (token.trim().length === 0) {
        continue;
      }

      if (grouped.length > 0) {
        grouped[grouped.length - 1] += token.trimEnd();
      } else {
        grouped.push(token.trimStart());
      }
    }

    return grouped.join(' · ');
  }
}

function formatZhPinyinRun(run: string): string {
  return segmentZhWords(run)
    .map(word => `${word} ${formatPinyin(word)}`)
    .join(' · ');
}

function segmentZhWords(run: string): string[] {
  const segmenterCtor = (globalThis.Intl as typeof Intl & { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (segmenterCtor) {
    const segmenter = new segmenterCtor('zh', { granularity: 'word' });
    const words = Array.from(segmenter.segment(run))
      .map(item => item.segment)
      .filter(item => zhCharPattern.test(item));
    if (words.length > 0) {
      return words;
    }
  }

  const segmented = segment(run, { format: OutputFormat.AllSegment, nonZh: 'consecutive' });
  return segmented
    .map(item => item.origin)
    .filter(item => zhCharPattern.test(item));
}

function formatPinyin(word: string): string {
  return pinyin(word, { nonZh: 'consecutive' }).replace(/\s+/g, ' ').trim();
}
