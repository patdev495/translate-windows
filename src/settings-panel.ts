import { SettingsManager, type Settings } from './services/settings';
import { NativeAutostartService } from './services/autostart';
import { listen } from '@tauri-apps/api/event';

export interface AutostartService {
  isEnabled(): Promise<boolean>;
  setEnabled(enabled: boolean): Promise<void>;
}

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
  | 'startWithWindows'
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
  'startWithWindows',
];

export class SettingsPanelController {
  private form: HTMLFormElement;
  private saveState: HTMLElement | null;
  private autostart: AutostartService;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private settingsListenerBound = false;

  constructor(
    form: HTMLFormElement,
    saveState: HTMLElement | null = document.getElementById('save-state'),
    autostart: AutostartService = NativeAutostartService
  ) {
    this.form = form;
    this.saveState = saveState;
    this.autostart = autostart;
  }

  async load(): Promise<void> {
    const settings = await SettingsManager.getSettings();
    const autostartEnabled = await this.autostart.isEnabled().catch(() => settings.startWithWindows);
    this.applySettings(settings, autostartEnabled);

    this.updateProviderVisibility();
    this.bindAutosave();
    this.bindSettingsSync();

    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.save();
    });
  }

  private applySettings(settings: Settings, autostartEnabled: boolean = settings.startWithWindows): void {
    for (const name of FIELD_NAMES) {
      const element = this.form.elements.namedItem(name);
      if (!element) continue;
      if (element instanceof HTMLInputElement && element.type === 'checkbox') {
        element.checked = name === 'startWithWindows' ? autostartEnabled : Boolean(settings[name]);
      } else if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement) {
        element.value = String(settings[name]);
      }
    }
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

    const updated = await SettingsManager.updateSettings(partial);
    await this.autostart.setEnabled(Boolean(updated.startWithWindows));
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

  private bindSettingsSync(): void {
    if (this.settingsListenerBound || !this.isTauriRuntime()) return;
    this.settingsListenerBound = true;
    void listen<Settings>('settings-changed', async (event) => {
      const autostartEnabled = await this.autostart.isEnabled().catch(() => event.payload.startWithWindows);
      this.applySettings(event.payload, autostartEnabled);
      this.updateProviderVisibility();
    });
  }

  private isTauriRuntime(): boolean {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  }
}
