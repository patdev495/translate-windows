import { SettingsPanelController } from './settings-panel';
import './settings.css';
import { initializeLearningSettings } from './settings-learning';
import { invoke } from '@tauri-apps/api/core';

window.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('settings-form') as HTMLFormElement | null;
  if (!form) return;
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const activate = (tab: HTMLButtonElement) => {
    for (const item of tabs) {
      const selected = item === tab;
      item.setAttribute('aria-selected', String(selected));
      item.tabIndex = selected ? 0 : -1;
      const panel = document.getElementById(item.getAttribute('aria-controls')!);
      if (panel) panel.hidden = !selected;
    }
    localStorage.setItem('settings-tab', tab.id);
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activate(tab));
    tab.addEventListener('keydown', event => {
      const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[tabs.length - 1] : offset ? tabs[(index + offset + tabs.length) % tabs.length] : null;
      if (next) { event.preventDefault(); activate(next); next.focus(); }
    });
  });
  const previous = tabs.find(tab => tab.id === localStorage.getItem('settings-tab'));
  if (previous) activate(previous);
  const controller = new SettingsPanelController(form);
  await controller.load();
  initializeLearningSettings();
  for (const input of form.querySelectorAll<HTMLInputElement>('.shortcut-capture')) {
    const format = (value: string) => value.replace(/Key|Digit/g, '');
    const original = input.dataset.shortcut ?? input.value;
    input.dataset.shortcut = original;
    input.value = format(original);
    input.addEventListener('focus',()=> { if ('__TAURI_INTERNALS__' in window) void invoke('set_shortcut_capture',{capturing:true}); });
    const held = new Set<string>();
    let modifierShortcut = '';
    let usedKey = false;
    input.addEventListener('blur',()=> {
      held.clear(); modifierShortcut = ''; usedKey = false;
      if ('__TAURI_INTERNALS__' in window) void invoke('set_shortcut_capture',{capturing:false});
    });
    const saveShortcut = (shortcut: string) => {
      const previous = input.dataset.shortcut ?? original;
      input.dataset.shortcut = shortcut;
      input.value = shortcut;
      const error = document.getElementById('shortcut-error');
      if (error) error.textContent = '';
      void controller.save().then(() => { input.dataset.shortcut = shortcut; input.value = format(shortcut); }).catch(reason => {
        input.dataset.shortcut = previous;
        input.value = format(previous);
        if (error) error.textContent = reason instanceof Error ? reason.message : String(reason);
      });
    };
    input.addEventListener('keydown', event => {
      event.preventDefault();
      if (event.repeat) return;
      held.add(event.code);
      const modifiers = [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Meta'].filter(Boolean);
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) {
        if (!usedKey) modifierShortcut = modifiers.join('+');
        return;
      }
      usedKey = true;
      modifierShortcut = '';
      saveShortcut(['Backspace','Delete'].includes(event.key) ? 'disabled' : [...modifiers, event.code].join('+'));
    });
    input.addEventListener('keyup', event => {
      event.preventDefault();
      held.delete(event.code);
      if (held.size) return;
      if (!usedKey && modifierShortcut) saveShortcut(modifierShortcut);
      modifierShortcut = ''; usedKey = false;
    });
  }
});
