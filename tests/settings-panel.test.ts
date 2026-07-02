// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { SettingsPanelController } from '../src/settings-panel';
import { SettingsManager } from '../src/services/settings';

function makeForm(): HTMLFormElement {
  document.body.innerHTML = `
    <form id="settings-form">
      <select name="primaryTargetLang"><option value="vi">Vietnamese</option><option value="en">English</option></select>
      <select name="secondaryTargetLang"><option value="zh">Chinese</option><option value="none">None</option></select>
      <select name="reverseTargetLang"><option value="en">English</option><option value="none">None</option></select>
      <input type="checkbox" name="autoTranslate" />
      <select name="ocrShortcut"><option value="alt-space">Alt Space</option><option value="ctrl-space">Ctrl Space</option><option value="alt-o">Alt O</option></select>
      <select name="ocrModelTier"><option value="tiny">Tiny</option><option value="medium">Medium</option></select>
      <select name="ocrLanguage"><option value="ch">Chinese</option><option value="latin">Latin</option></select>
      <select name="provider"><option value="google">Google</option><option value="deepl">DeepL</option></select>
      <div id="deepl-key-container"><input type="password" name="deeplApiKey" /></div>
      <input type="checkbox" name="ttsEnabled" />
      <select name="tooltipFontSize"><option value="16">16</option><option value="24">24</option></select>
      <input type="checkbox" name="ocrPinImage" />
      <input type="checkbox" name="ocrCopyToClipboard" />
      <p id="save-state"></p>
    </form>
  `;
  return document.getElementById('settings-form') as HTMLFormElement;
}

describe('SettingsPanelController', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  test('loads saved settings into the control panel', async () => {
    await SettingsManager.updateSettings({
      primaryTargetLang: 'en',
      autoTranslate: false,
      ocrShortcut: 'alt-o',
      provider: 'deepl',
      deeplApiKey: 'test-key',
      ttsEnabled: false,
      ocrPinImage: true,
      ocrCopyToClipboard: false,
    });

    const form = makeForm();
    await new SettingsPanelController(form).load();

    expect((form.elements.namedItem('primaryTargetLang') as HTMLSelectElement).value).toBe('en');
    expect((form.elements.namedItem('autoTranslate') as HTMLInputElement).checked).toBe(false);
    expect((form.elements.namedItem('ocrShortcut') as HTMLSelectElement).value).toBe('alt-o');
    expect((form.elements.namedItem('provider') as HTMLSelectElement).value).toBe('deepl');
    expect((form.elements.namedItem('deeplApiKey') as HTMLInputElement).value).toBe('test-key');
    expect((form.elements.namedItem('ttsEnabled') as HTMLInputElement).checked).toBe(false);
    expect((form.elements.namedItem('ocrPinImage') as HTMLInputElement).checked).toBe(true);
    expect((form.elements.namedItem('ocrCopyToClipboard') as HTMLInputElement).checked).toBe(false);
    expect(document.getElementById('deepl-key-container')?.hidden).toBe(false);
  });

  test('saves changed settings for subsequent captures', async () => {
    const form = makeForm();
    const controller = new SettingsPanelController(form);
    await controller.load();

    (form.elements.namedItem('tooltipFontSize') as HTMLSelectElement).value = '24';
    (form.elements.namedItem('autoTranslate') as HTMLInputElement).checked = false;
    (form.elements.namedItem('ocrPinImage') as HTMLInputElement).checked = true;
    form.dispatchEvent(new Event('submit'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const settings = await SettingsManager.getSettings();
    expect(settings.tooltipFontSize).toBe('24');
    expect(settings.autoTranslate).toBe(false);
    expect(settings.ocrPinImage).toBe(true);
    expect(document.getElementById('save-state')?.textContent).toBe('Saved');
  });

  test('auto-saves provider, DeepL key, and TTS changes', async () => {
    const form = makeForm();
    const controller = new SettingsPanelController(form);
    await controller.load();

    (form.elements.namedItem('provider') as HTMLSelectElement).value = 'deepl';
    form.elements.namedItem('provider')?.dispatchEvent(new Event('change'));
    (form.elements.namedItem('deeplApiKey') as HTMLInputElement).value = 'abc:fx';
    form.elements.namedItem('deeplApiKey')?.dispatchEvent(new Event('input'));
    (form.elements.namedItem('ttsEnabled') as HTMLInputElement).checked = false;
    form.elements.namedItem('ttsEnabled')?.dispatchEvent(new Event('change'));

    await new Promise((resolve) => setTimeout(resolve, 160));

    const settings = await SettingsManager.getSettings();
    expect(settings.provider).toBe('deepl');
    expect(settings.deeplApiKey).toBe('abc:fx');
    expect(settings.ttsEnabled).toBe(false);
    expect(document.getElementById('deepl-key-container')?.hidden).toBe(false);
  });
});
