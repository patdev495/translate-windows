import { pinyin } from 'pinyin-pro';
import cmuDict from '../assets/cmu-dict.json';

const PUNCTUATION_SPACING = /\s([\u3002\uff0c\u3001\uff1b\uff1a\uff1f\uff01\u2026\u201c\u201d\u2018\u2019\uff08\uff09[\]{}.,;:?!])/g;

export class PhoneticEngine {
  static getPinyin(text: string): string {
    return text.split('\n').map((line) => {
      const rawPinyin = pinyin(line, { nonZh: 'consecutive' });
      const cleanSpaces = rawPinyin.replace(/\s+/g, ' ').trim();
      return cleanSpaces.replace(PUNCTUATION_SPACING, '$1');
    }).join('\n');
  }

  static getEnglishIPA(text: string): string {
    const tokens = text.split(/([a-zA-Z'-]+)/);
    const mapped = tokens.map(token => {
      if (/^[a-zA-Z'-]+$/.test(token)) {
        const lower = token.toLowerCase();
        if (lower in cmuDict) {
          return (cmuDict as Record<string, string>)[lower];
        }
        return token;
      }
      return token;
    });
    return mapped.join('');
  }
}
