// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { exportHanziLearningBackup, importHanziLearningBackup, parseHanziLearningBackup, getHanziMemoryNote, getPersonalHanziMeaning } from '../src/services/hanzi-learning';

test('an extension JSON backup imports into desktop and exports without losing personal Hanzi meanings or notes', async () => {
  localStorage.clear();
  const backup = parseHanziLearningBackup('{"version":1,"entries":{"明":{"note":"Nhớ mặt trời và mặt trăng","meanings":{"vi":"sáng","en":"bright"}}}}');
  await importHanziLearningBackup(backup, 'keep-current');
  expect(await getHanziMemoryNote('明')).toBe('Nhớ mặt trời và mặt trăng');
  expect(await getPersonalHanziMeaning('明', 'vi')).toBe('sáng');
  expect(await exportHanziLearningBackup()).toEqual({ version: 1, entries: { '明': { note: 'Nhớ mặt trời và mặt trăng', meanings: { vi: 'sáng', en: 'bright' } } } });
});
