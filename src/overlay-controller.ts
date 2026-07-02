export interface WindowAPI {
  close(): void;
}

export class OverlayController {
  constructor(private windowApi: WindowAPI) {}

  handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.windowApi.close();
    }
  }
}
