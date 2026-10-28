export function normalizeLatinOcrText(text: string): string {
  return text.replace(/\bAl\b/g, 'AI');
}
