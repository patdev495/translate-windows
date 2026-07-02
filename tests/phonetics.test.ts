import { describe, test, expect } from 'vitest';
import { PhoneticEngine } from '../src/services/phonetics';

describe('PhoneticEngine - Chinese Pinyin', () => {
  test('should convert Chinese characters to Pinyin with tone marks', () => {
    const result = PhoneticEngine.getPinyin('我喜欢学习汉语');
    expect(result).toBe('wǒ xǐ huan xué xí hàn yǔ');
  });

  test('should handle punctuation and English words in Chinese sentences gracefully', () => {
    const result = PhoneticEngine.getPinyin('Hello, 我喜欢学习汉语！');
    // Non-chinese parts and punctuation should be preserved.
    // pinyin-pro usually preserves non-Chinese when called with the right options or we can handle it.
    expect(result).toBe('Hello, wǒ xǐ huan xué xí hàn yǔ！');
  });
});

describe('PhoneticEngine - English IPA', () => {
  test('should convert English words to IPA', () => {
    const result = PhoneticEngine.getEnglishIPA('hello');
    expect(result).toBe('həˈɫoʊ');
  });

  test('should convert full sentences preserving punctuation and casing', () => {
    const result = PhoneticEngine.getEnglishIPA('Hello, world!');
    expect(result).toBe('həˈɫoʊ, ˈwɝɫd!');
  });

  test('should degrade gracefully for unknown words', () => {
    const result = PhoneticEngine.getEnglishIPA('xyzabc');
    expect(result).toBe('xyzabc');
  });
});

