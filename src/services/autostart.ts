import { invoke } from '@tauri-apps/api/core';
import type { AutostartService } from '../settings-panel';

export const NativeAutostartService: AutostartService = {
  isEnabled(): Promise<boolean> {
    return invoke<boolean>('get_autostart_enabled');
  },
  setEnabled(enabled: boolean): Promise<void> {
    return invoke<void>('set_autostart_enabled', { enabled });
  },
};
