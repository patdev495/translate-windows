import { SettingsPanelController } from './settings-panel';
import './settings.css';

window.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('settings-form') as HTMLFormElement | null;
  if (!form) return;
  await new SettingsPanelController(form).load();
});
