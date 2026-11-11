// Node 26 exposes an undefined native localStorage without a storage file.
// Vitest 1 then skips installing JSDOM's storage on the test global.
const dom = (globalThis as typeof globalThis & { jsdom?: { window: Window } }).jsdom;
if (dom) {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: dom.window.localStorage,
  });
}
