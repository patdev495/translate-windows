import { TranslationTooltip } from './tooltip';
import { SettingsManager, type Settings } from '../services/settings';
import { TranslationCoordinator } from '../services/translation-coordinator';

export interface TranslationContext { tooltip: TranslationTooltip; settings: Settings | null; active: boolean; generation: number }
export const createTranslationContext = (): TranslationContext => ({ tooltip:new TranslationTooltip(),settings:null,active:true,generation:0 });
export async function loadSettings(context: TranslationContext): Promise<void> {
  const settings = context.settings = await SettingsManager.getSettings();
  context.active = settings.translationActive;
  context.tooltip.updateFontSize(settings.tooltipFontSize);
  context.tooltip.updateHanziStrokeSpeed(settings.hanziStrokeSpeed);
  context.tooltip.updateHanziBreakdownSettings(settings.hanziBreakdownEnabled,settings.hanziBreakdownLanguage);
  context.tooltip.updatePhoneticsVisibility(settings.phoneticsVisible);
  if (!context.active) { context.generation++; context.tooltip.hide(); }
}
export function performTranslation(context: TranslationContext, text: string, x: number, y: number, width?: number): void {
  if (!context.active || !context.settings || !text.trim()) return;
  const generation = ++context.generation;
  const settings = context.settings;
  void TranslationCoordinator.translate(text,settings).then(data => {
    if (generation === context.generation && context.active) context.tooltip.show(x,y,text,data,settings.ttsEnabled,settings.phoneticsVisible,width);
  }).catch(error => { if (generation === context.generation) { const status = document.getElementById('pdf-translation-status'); if (status) status.textContent=String(error); } });
}
export function matchesOcrShortcut(context: TranslationContext,event: KeyboardEvent): boolean {
  const shortcut = context.settings?.ocrShortcut;
  const canonical = [event.ctrlKey && 'Ctrl',event.altKey && 'Alt',event.shiftKey && 'Shift',event.metaKey && 'Meta',event.code].filter(Boolean).join('+');
  return canonical === ({ 'ctrl-3':'Ctrl+Digit3','alt-space':'Alt+Space','ctrl-space':'Ctrl+Space','alt-o':'Alt+KeyO','ctrl-shift-o':'Ctrl+Shift+KeyO' } as Record<string,string>)[shortcut ?? 'disabled'];
}
export function translateSelectedPageText(context: TranslationContext): void {
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed || !selection.toString().trim()) return;
  const path = selection.anchorNode?.getRootNode();
  if (path instanceof ShadowRoot) return;
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  performTranslation(context,selection.toString(),rect.left,rect.bottom);
}
export function initTranslationListeners(context: TranslationContext,target: EventTarget = document): void {
  const held = new Set<string>();
  let modifierShortcut = '';
  const cancelShortcut = () => { held.clear(); modifierShortcut = ''; };
  window.addEventListener('blur', cancelShortcut);
  target.addEventListener('mouseup', event => {
    if ((event as MouseEvent).composedPath().some(node => node instanceof HTMLElement && (node.id === 'translation-extension-root' || node.id === 'translation-extension-hanzi-breakdown-root'))) return;
    if (context.settings?.autoSelectionTranslate) setTimeout(() => translateSelectedPageText(context),20);
  });
  target.addEventListener('mousedown',event => {
    modifierShortcut = '';
    if ((event as MouseEvent).composedPath().some(node => node instanceof HTMLElement && (node.id === 'translation-extension-root' || node.id === 'translation-extension-hanzi-breakdown-root'))) return;
    context.generation++; context.tooltip.hide();
  });
  target.addEventListener('keydown', event => {
    const key = event as KeyboardEvent;
    if (key.repeat) return;
    held.add(key.code);
    const modifiers = [key.ctrlKey && 'Ctrl',key.altKey && 'Alt',key.shiftKey && 'Shift',key.metaKey && 'Meta'].filter(Boolean).join('+');
    if (['Control','Alt','Shift','Meta'].includes(key.key)) {
      modifierShortcut = modifiers === context.settings?.translationShortcut ? modifiers : '';
      return;
    }
    modifierShortcut = '';
    const shortcut = [modifiers,key.code].filter(Boolean).join('+');
    if (shortcut === context.settings?.translationShortcut) { key.preventDefault(); translateSelectedPageText(context); }
  });
  target.addEventListener('keyup', event => {
    const key = event as KeyboardEvent;
    held.delete(key.code);
    if (held.size) return;
    if (modifierShortcut && modifierShortcut === context.settings?.translationShortcut) {
      key.preventDefault(); translateSelectedPageText(context);
    }
    modifierShortcut = '';
  });
}
