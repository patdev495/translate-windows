import { SettingsManager, type Settings } from './services/settings';

type FieldName = keyof Pick<
  Settings,
  | 'primaryTargetLang'
  | 'secondaryTargetLang'
  | 'reverseTargetLang'
  | 'autoTranslate'
  | 'ocrShortcut'
  | 'ocrModelTier'
  | 'ocrLanguage'
  | 'ttsEnabled'
  | 'provider'
  | 'deeplApiKey'
  | 'tooltipFontSize'
  | 'ocrPinImage'
  | 'ocrCopyToClipboard'
>;

const FIELD_NAMES: FieldName[] = [
  'primaryTargetLang',
  'secondaryTargetLang',
  'reverseTargetLang',
  'autoTranslate',
  'ocrShortcut',
  'ocrModelTier',
  'ocrLanguage',
  'ttsEnabled',
  'provider',
  'deeplApiKey',
  'tooltipFontSize',
  'ocrPinImage',
  'ocrCopyToClipboard',
];

export class SettingsPanelController {
  private form: HTMLFormElement;
  private saveState: HTMLElement | null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(form: HTMLFormElement, saveState: HTMLElement | null = document.getElementById('save-state')) {
    this.form = form;
    this.saveState = saveState;
  }

  async load(): Promise<void> {
    const settings = await SettingsManager.getSettings();
    for (const name of FIELD_NAMES) {
      const element = this.form.elements.namedItem(name);
      if (!element) continue;
      if (element instanceof HTMLInputElement && element.type === 'checkbox') {
        element.checked = Boolean(settings[name]);
      } else if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement) {
        element.value = String(settings[name]);
      }
    }

    this.updateProviderVisibility();
    this.bindAutosave();

    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.save();
    });
  }

  async save(): Promise<void> {
    const partial: Partial<Settings> = {};
    for (const name of FIELD_NAMES) {
      const element = this.form.elements.namedItem(name);
      if (!element) continue;
      if (element instanceof HTMLInputElement && element.type === 'checkbox') {
        (partial as Record<string, unknown>)[name] = element.checked;
      } else if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement) {
        (partial as Record<string, unknown>)[name] = element.value;
      }
    }

    await SettingsManager.updateSettings(partial);
    if (this.saveState) {
      this.saveState.textContent = 'Saved';
    }
  }

  private bindAutosave(): void {
    const fields = FIELD_NAMES
      .map((name) => this.form.elements.namedItem(name))
      .filter((element): element is HTMLInputElement | HTMLSelectElement => {
        return element instanceof HTMLInputElement || element instanceof HTMLSelectElement;
      });

    for (const field of fields) {
      const eventName = field instanceof HTMLInputElement && field.type !== 'checkbox' ? 'input' : 'change';
      field.addEventListener(eventName, () => {
        if (field.name === 'provider') {
          this.updateProviderVisibility();
        }
        this.scheduleSave();
      });
    }

    const toggleDeepL = document.getElementById('toggle-deepl-key') as HTMLButtonElement | null;
    const deeplKey = this.form.elements.namedItem('deeplApiKey') as HTMLInputElement | null;
    toggleDeepL?.addEventListener('click', () => {
      if (!deeplKey) return;
      deeplKey.type = deeplKey.type === 'password' ? 'text' : 'password';
    });
  }

  private scheduleSave(): void {
    if (this.saveState) {
      this.saveState.textContent = 'Saving...';
    }
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      void this.save();
    }, 120);
  }

  private updateProviderVisibility(): void {
    const provider = this.form.elements.namedItem('provider') as HTMLSelectElement | null;
    const container = document.getElementById('deepl-key-container');
    if (!provider || !container) return;
    container.hidden = provider.value !== 'deepl';
  }
}
