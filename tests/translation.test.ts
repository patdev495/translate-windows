import { describe, test, expect, beforeEach, vi } from 'vitest';
import { TranslationEngine } from '../src/services/translation';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('TranslationEngine', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  test('should translate English to Vietnamese and return detected language', async () => {
    // Mock response for Google Translate (hello -> Xin chào)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        [
          ["Xin chào", "hello", null, null, 1]
        ],
        null,
        "en"
      ]
    });

    const result = await TranslationEngine.translate('hello', 'vi', 'en');
    expect(result).toEqual({
      translation: 'Xin chào',
      detectedLang: 'en'
    });

    // Check fetch parameters
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('tl=vi');
    expect(calledUrl).toContain('q=hello');
  });

  test('should auto-toggle to secondary target language if source matches primary target language', async () => {
    // First call (translating to primary language "vi"): detected source is "vi"
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        [
          ["Xin chào", "Xin chào", null, null, 1]
        ],
        null,
        "vi"
      ]
    });

    // Second call (translating to secondary language "en"): "Xin chào" -> "Hello"
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        [
          ["Hello", "Xin chào", null, null, 1]
        ],
        null,
        "vi"
      ]
    });

    const result = await TranslationEngine.translate('Xin chào', 'vi', 'en');
    expect(result).toEqual({
      translation: 'Hello',
      detectedLang: 'vi'
    });

    // Check that fetch was called twice
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toContain('tl=vi');
    expect(mockFetch.mock.calls[1][0]).toContain('tl=en');
  });

  test('should handle multi-sentence translation correctly', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        [
          ["Xin chào.", "Hello.", null, null, 1],
          [" Thế giới.", " World.", null, null, 1]
        ],
        null,
        "en"
      ]
    });

    const result = await TranslationEngine.translate('Hello. World.', 'vi', 'en');
    expect(result.translation).toBe('Xin chào. Thế giới.');
    expect(result.detectedLang).toBe('en');
  });
});
