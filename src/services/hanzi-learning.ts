import { desktopStorage } from '../platform/storage';
function noteKey(character: string): string {
  return `hanzi-learning-note:${character}`;
}

const pendingWrites = new Map<string, Promise<void>>();

function saveField(key: string, value: string): Promise<void> {
  const previous = pendingWrites.get(key) ?? Promise.resolve();
  const pending = previous.catch(() => {}).then(() => desktopStorage.set({ [key]: value }));
  pendingWrites.set(key, pending);
  void pending.then(() => {
    if (pendingWrites.get(key) === pending) pendingWrites.delete(key);
  }, () => {
    if (pendingWrites.get(key) === pending) pendingWrites.delete(key);
  });
  return pending;
}

async function readField(key: string): Promise<string> {
  try {
    await pendingWrites.get(key)?.catch(() => {});
    const result = await desktopStorage.get(key);
    return typeof result[key] === 'string' ? result[key] : '';
  } catch {
    return '';
  }
}

export async function getHanziMemoryNote(character: string): Promise<string> {
  return readField(noteKey(character));
}

export async function saveHanziMemoryNote(character: string, note: string): Promise<void> {
  await saveField(noteKey(character), note);
}

function meaningKey(character: string, language: 'vi' | 'en'): string {
  return `hanzi-learning-meaning:${character}:${language}`;
}

export async function getPersonalHanziMeaning(character: string, language: 'vi' | 'en'): Promise<string> {
  return readField(meaningKey(character, language));
}

export async function savePersonalHanziMeaning(character: string, language: 'vi' | 'en', meaning: string): Promise<void> {
  await saveField(meaningKey(character, language), meaning);
}

function unidentifiedKey(character: string): string {
  return `hanzi-learning-unidentified:${character}`;
}

export async function getUnidentifiedStrokeExplanation(character: string): Promise<string> {
  return readField(unidentifiedKey(character));
}

export async function saveUnidentifiedStrokeExplanation(character: string, explanation: string): Promise<void> {
  await saveField(unidentifiedKey(character), explanation);
}

export interface HanziLearningEntry {
  note?: string;
  meanings?: { vi?: string; en?: string };
  unidentifiedStrokes?: string;
}

export interface HanziLearningBackup {
  version: 1;
  entries: Record<string, HanziLearningEntry>;
}

export async function exportHanziLearningBackup(): Promise<HanziLearningBackup> {
  const stored = await desktopStorage.get(null);
  const entries: Record<string, HanziLearningEntry> = {};
  for (const [key, value] of Object.entries(stored)) {
    if (typeof value !== 'string' || !value) continue;
    const note = key.match(/^hanzi-learning-note:(.)$/u);
    const meaning = key.match(/^hanzi-learning-meaning:(.):(vi|en)$/u);
    const unidentified = key.match(/^hanzi-learning-unidentified:(.)$/u);
    if (note) (entries[note[1]] ??= {}).note = value;
    if (meaning) {
      const entry = entries[meaning[1]] ??= {};
      entry.meanings ??= {};
      entry.meanings[meaning[2] as 'vi' | 'en'] = value;
    }
    if (unidentified) (entries[unidentified[1]] ??= {}).unidentifiedStrokes = value;
  }
  return { version: 1, entries };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function parseHanziLearningBackup(text: string): HanziLearningBackup {
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.entries)) {
    throw new Error('Unsupported Hanzi backup format');
  }
  const entries: Record<string, HanziLearningEntry> = {};
  for (const [character, raw] of Object.entries(parsed.entries)) {
    if ([...character].length !== 1 || !isRecord(raw)) throw new Error('Invalid Hanzi backup entry');
    if (Object.keys(raw).some(key => !['note', 'meanings', 'unidentifiedStrokes'].includes(key))) {
      throw new Error('Invalid Hanzi backup field');
    }
    const entry: HanziLearningEntry = {};
    if (raw.note !== undefined) {
      if (typeof raw.note !== 'string') throw new Error('Invalid Hanzi note');
      entry.note = raw.note;
    }
    if (raw.unidentifiedStrokes !== undefined) {
      if (typeof raw.unidentifiedStrokes !== 'string') throw new Error('Invalid Hanzi stroke explanation');
      entry.unidentifiedStrokes = raw.unidentifiedStrokes;
    }
    if (raw.meanings !== undefined) {
      if (!isRecord(raw.meanings) || Object.keys(raw.meanings).some(key => !['vi', 'en'].includes(key))) {
        throw new Error('Invalid Hanzi meanings');
      }
      entry.meanings = {};
      for (const language of ['vi', 'en'] as const) {
        const meaning = raw.meanings[language];
        if (meaning !== undefined) {
          if (typeof meaning !== 'string') throw new Error('Invalid Hanzi meaning');
          entry.meanings[language] = meaning;
        }
      }
    }
    entries[character] = entry;
  }
  return { version: 1, entries };
}

function backupValues(backup: HanziLearningBackup): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [character, entry] of Object.entries(backup.entries)) {
    if (entry.note) values[noteKey(character)] = entry.note;
    if (entry.meanings?.vi) values[meaningKey(character, 'vi')] = entry.meanings.vi;
    if (entry.meanings?.en) values[meaningKey(character, 'en')] = entry.meanings.en;
    if (entry.unidentifiedStrokes) values[unidentifiedKey(character)] = entry.unidentifiedStrokes;
  }
  return values;
}

export async function inspectHanziLearningImport(backup: HanziLearningBackup): Promise<{ additions: number; conflicts: number }> {
  const current = await desktopStorage.get(null);
  let additions = 0;
  let conflicts = 0;
  for (const [key, value] of Object.entries(backupValues(backup))) {
    if (typeof current[key] !== 'string' || !current[key]) additions++;
    else if (current[key] !== value) conflicts++;
  }
  return { additions, conflicts };
}

export async function importHanziLearningBackup(
  backup: HanziLearningBackup, conflicts: 'keep-current' | 'use-file',
): Promise<number> {
  const current = await desktopStorage.get(null);
  const changes: Record<string, string> = {};
  for (const [key, value] of Object.entries(backupValues(backup))) {
    if (conflicts === 'use-file' || typeof current[key] !== 'string' || !current[key]) {
      if (current[key] !== value) changes[key] = value;
    }
  }
  if (Object.keys(changes).length) await desktopStorage.set(changes);
  return Object.keys(changes).length;
}
