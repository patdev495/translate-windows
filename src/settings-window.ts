import { SettingsPanelController } from './settings-panel';
import { initializeOcrModelLifecycle } from './services/ocr-preload';
import './settings.css';

window.addEventListener('DOMContentLoaded', async () => {
  void initializeOcrModelLifecycle();
  const form = document.getElementById('settings-form') as HTMLFormElement | null;
  if (!form) return;
  await new SettingsPanelController(form).load();
});
