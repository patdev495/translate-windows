import { invoke } from '@tauri-apps/api/core';
export async function addPinnedSnippet(dataUrl: string,x: number,y: number,width = 320,height = 200): Promise<void> {
  await invoke('open_snippet_window',{ dataUrl,x:Math.round(window.screenX+x),y:Math.round(window.screenY+y),width:Math.round(width),height:Math.round(height) });
}
