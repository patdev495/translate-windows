import { pinyin } from 'pinyin-pro';
import cmuDict from '../assets/cmu-dict.json';

export class PhoneticEngine {
  static getPinyin(text: string): string {
    const rawPinyin = pinyin(text, { nonZh: 'consecutive' });
    const cleanSpaces = rawPinyin.replace(/\s+/g, ' ').trim();
    // Remove space before common full-width and half-width punctuation marks
    return cleanSpaces.replace(/\s([。，、；：？！…“”‘’（）[\]{}.,;:?!])/g, '$1');
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
