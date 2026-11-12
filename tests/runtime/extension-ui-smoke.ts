// Real WebView2 UI validation using only synthetic text, PDF and a temporary profile.
import { invoke } from '@tauri-apps/api/core';
import { currentMonitor, getCurrentWindow } from '@tauri-apps/api/window';

async function until<T>(read: () => T | Promise<T>, description: string): Promise<NonNullable<T>> {
  const deadline=Date.now()+40_000;
  while(Date.now()<deadline) { const value=await read(); if(value) return value as NonNullable<T>; await new Promise(resolve=>setTimeout(resolve,50)); }
  throw new Error(`Timed out: ${description}`);
}
function check(value: unknown,message: string): asserts value { if(!value) throw new Error(message); }

export async function verify(label: string): Promise<void> {
  try {
    const result: Record<string,unknown>={};
    if(label==='main') {
      const response=await invoke<any>('desktop_request',{message:{type:'GET_ACCOUNT_LINK_STATUS'}});
      check(response.success && response.status.state==='unlinked','Synthetic profile must be unlinked'); result.host=true;
    } else if(label==='settings') {
      const shortcut=await until(()=> { const input=document.getElementById('translation-shortcut') as HTMLInputElement; return input?.value==='Alt+Q' && input; },'Settings initialization');
      document.getElementById('tab-provider')!.click();
      check(!document.getElementById('panel-provider')!.hidden,'Provider tab must be visible');
      shortcut.dispatchEvent(new KeyboardEvent('keydown',{key:'r',code:'KeyR',altKey:true,bubbles:true}));
      await until(()=>shortcut.value==='Alt+R','Custom shortcut saved');
      const settings=await invoke<any>('get_app_settings');
      check(settings.translationShortcut==='Alt+KeyR' && settings.inputReplacementShortcut==='Alt+KeyW','Shortcuts must remain independent');
      check(document.querySelectorAll('[role="tab"]').length===5,'All five settings tabs must exist');
      result.tabs=5; result.shortcut=settings.translationShortcut;
      shortcut.dispatchEvent(new KeyboardEvent('keyup',{key:'r',code:'KeyR',altKey:true,bubbles:true}));
      shortcut.dispatchEvent(new KeyboardEvent('keydown',{key:'Control',code:'ControlLeft',ctrlKey:true,bubbles:true}));
      shortcut.dispatchEvent(new KeyboardEvent('keyup',{key:'Control',code:'ControlLeft',bubbles:true}));
      await until(()=>shortcut.value==='Ctrl','Standalone Ctrl shortcut saved');
      await until(async()=>(await invoke<any>('get_app_settings')).translationShortcut==='Ctrl','Native settings retain a standalone modifier');
      result.shortcut='Ctrl';
      document.getElementById('tab-website')!.click();
      document.getElementById('learning-account-link')!.click();
      await until(()=>document.getElementById('learning-account-status')?.textContent?.includes('Đang chờ'),'Pending website link');
      await invoke('smoke_approve_link');
      window.dispatchEvent(new Event('focus'));
      await until(()=>document.getElementById('learning-account-status')?.textContent==='Đã liên kết: Synthetic learner','Website approval reflected in Settings');
      result.accountLinked=true;
    } else if(label==='pdf') {
      await until(()=>document.getElementById('page-total')?.textContent==='/ 1','PDF page count');
      await until(()=>document.querySelector('.textLayer')?.textContent?.includes('Hello PDF'),'Actual PDF text layer');
      check(document.querySelector('canvas')!.width>0,'PDF must render into a real canvas');
      result.pages=1; result.text='Hello PDF';
    } else if(label==='tooltip') {
      const root=await until(()=>document.getElementById('translation-extension-root')?.shadowRoot,'Tooltip mount');
      const text=await until(()=>root.querySelector('.tt-source-text'),'Tooltip source');
      check(text.textContent==='你好','Tooltip source must match payload');
      const card=root.querySelector<HTMLElement>('#tooltip')!;
      await until(()=> {
        const bounds=card.getBoundingClientRect();
        return Math.abs(bounds.left)<1 && Math.abs(bounds.top)<1 && Math.abs(bounds.width-window.innerWidth)<1 && Math.abs(bounds.height-window.innerHeight)<1;
      },'Native window fits the reading card without an inset');
      check(Math.abs(card.getBoundingClientRect().width-382)<1,'Short text must use the extension 350px reading width plus its 32px padding');
      const nativeWindow=getCurrentWindow();
      const inner=await nativeWindow.innerSize();
      const outer=await nativeWindow.outerSize();
      check(inner.width===outer.width && inner.height===outer.height,'Native tooltip must have no outer window frame');
      const monitor=await currentMonitor();
      check(monitor,'Native tooltip needs a monitor');
      await until(async()=> {
        const position=await nativeWindow.outerPosition();
        const size=await nativeWindow.innerSize();
        return Math.abs(position.x-(monitor.workArea.position.x+(monitor.workArea.size.width-size.width)/2))<=2 && Math.abs(position.y-(monitor.workArea.position.y+(monitor.workArea.size.height-size.height)/2))<=2;
      },'Native tooltip centers in the usable monitor area');
      result.layout={width:Math.round(card.getBoundingClientRect().width),inset:0,outerFrame:0,centered:true};
      const range=document.createRange(); range.selectNodeContents(text);
      const selection=window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      text.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,composed:true}));
      const button=await until(()=>root.querySelector<HTMLButtonElement>('.tt-hanzi-button'),'Hanzi controls');
      button.click();
      await until(()=>button.querySelector('svg path'),'Real Hanzi stroke data');
      root.querySelector<HTMLButtonElement>('.copy-button')!.click();
      await until(()=>root.querySelector('.tt-copy-ok'),'Copy feedback');
      const clipboard=await invoke<string>('smoke_clipboard'); check(clipboard==='你好','Native copy must receive exact Chinese text');
      result.strokePaths=button.querySelectorAll('svg path').length; result.copy=clipboard;
    } else if(label==='hanzi-breakdown') {
      const root=await until(()=>document.getElementById('translation-extension-hanzi-breakdown-root')?.shadowRoot,'Breakdown mount');
      await until(()=>root.querySelectorAll('.hanzi-breakdown-component').length>0,'Offline Hanzi components');
      const card=root.querySelector<HTMLElement>('.hanzi-breakdown-card')!;
      await until(()=> {
        const bounds=card.getBoundingClientRect();
        return Math.abs(bounds.left)<1 && Math.abs(bounds.top)<1 && Math.abs(bounds.width-window.innerWidth)<1 && Math.abs(bounds.height-window.innerHeight)<1;
      },'Breakdown card fits native window without an outer layer');
      const inner=await getCurrentWindow().innerSize(), outer=await getCurrentWindow().outerSize();
      check(inner.width===outer.width && inner.height===outer.height,'Breakdown has no native outer frame');
      result.layout={inset:0,outerFrame:0,width:Math.round(card.getBoundingClientRect().width)};
      const input=await until(()=>root.querySelector<HTMLTextAreaElement>('.hanzi-breakdown-note textarea'),'Memory note input');
      input.value='Synthetic WebView2 memory note'; input.dispatchEvent(new Event('input',{bubbles:true}));
      await until(()=>[...root.querySelectorAll('[role="status"]')].some(node=>node.textContent==='Saved'),'Memory note saved');
      result.components=root.querySelectorAll('.hanzi-breakdown-component').length; result.noteSaved=true;
      // User-resizable note field must grow inside the card's scroll area,
      // without creating a second page scrollbar or an uncovered native frame.
      input.style.height='2000px';
      check(input.isConnected,'Resized breakdown note field remains connected');
      await until(()=>card.scrollHeight>card.clientHeight && Math.abs(card.getBoundingClientRect().height-window.innerHeight)<1,'Breakdown scroll stays inside the fitted card');
      card.scrollTop=card.scrollHeight;
      check(card.scrollTop>0 && document.documentElement.scrollHeight<=window.innerHeight+1,'Only the breakdown card scrolls');
      result.internalScroll=true;
      const component=root.querySelector<HTMLButtonElement>('.hanzi-breakdown-component button[data-component]');
      if(component) {
        const previous=card;
        component.click();
        const next=await until(()=> {
          const nextCard=root.querySelector<HTMLElement>('.hanzi-breakdown-card');
          return nextCard && nextCard!==previous && nextCard.querySelector('.hanzi-breakdown-back') ? nextCard : null;
        },'Breakdown component navigation');
        await until(()=> {
          const bounds=next.getBoundingClientRect();
          return Math.abs(bounds.left)<1 && Math.abs(bounds.top)<1 && Math.abs(bounds.width-window.innerWidth)<1 && Math.abs(bounds.height-window.innerHeight)<1;
        },'Nested breakdown keeps the card flush to the native window');
        result.componentNavigation=true;
      }
    }
    await invoke('smoke_page_done',{label,result});
  } catch(error) {
    const card=label==='hanzi-breakdown' ? document.getElementById('translation-extension-hanzi-breakdown-root')?.shadowRoot?.querySelector('.hanzi-breakdown-card') : document.getElementById('translation-extension-root')?.shadowRoot?.querySelector('#tooltip');
    const geometry=['tooltip','hanzi-breakdown'].includes(label) ? {card:card?.getBoundingClientRect().toJSON(),scrollHeight:card?.scrollHeight,clientHeight:card?.clientHeight,viewport:{width:window.innerWidth,height:window.innerHeight},inner:await getCurrentWindow().innerSize().catch(()=>null),outer:await getCurrentWindow().outerSize().catch(()=>null)} : undefined;
    await invoke('smoke_page_done',{label,result:{error:error instanceof Error ? error.message : String(error),geometry}});
  }
}
