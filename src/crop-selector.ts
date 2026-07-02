export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CropSelectorOptions {
  onCrop(dataUrl: string | null, rect: CropRect): void;
}

interface Point {
  x: number;
  y: number;
}

/**
 * CropSelector attaches click-and-drag crop selection to a fullscreen canvas.
 * It draws a semi-transparent dark mask over unselected areas and a bright
 * cut-out for the selected region. On mouseup, if the selection has a non-zero
 * area it emits the cropped region as a PNG data URL via `onCrop`.
 */
export class CropSelector {
  private canvas: HTMLCanvasElement;
  private options: CropSelectorOptions;
  private ctx: CanvasRenderingContext2D | null = null;

  private start: Point | null = null;
  private current: Point | null = null;
  private dragging = false;

  // Bound handlers kept as references so we can remove them on detach
  private _onMouseDown: (e: MouseEvent) => void;
  private _onMouseMove: (e: MouseEvent) => void;
  private _onMouseUp: (e: MouseEvent) => void;

  constructor(canvas: HTMLCanvasElement, options: CropSelectorOptions) {
    this.canvas = canvas;
    this.options = options;

    this._onMouseDown = this.handleMouseDown.bind(this);
    this._onMouseMove = this.handleMouseMove.bind(this);
    this._onMouseUp = this.handleMouseUp.bind(this);
  }

  attach(): void {
    this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    this.canvas.addEventListener('mousedown', this._onMouseDown);
    this.canvas.addEventListener('mousemove', this._onMouseMove);
    this.canvas.addEventListener('mouseup', this._onMouseUp);
    this.drawIdleMask();
  }

  detach(): void {
    this.canvas.removeEventListener('mousedown', this._onMouseDown);
    this.canvas.removeEventListener('mousemove', this._onMouseMove);
    this.canvas.removeEventListener('mouseup', this._onMouseUp);
    this.dragging = false;
    this.start = null;
    this.current = null;
  }

  private clientToCanvas(e: MouseEvent): Point {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  private handleMouseDown(e: MouseEvent): void {
    this.start = this.clientToCanvas(e);
    this.current = { ...this.start };
    this.dragging = true;
  }

  private handleMouseMove(e: MouseEvent): void {
    if (!this.dragging || !this.start) return;
    this.current = this.clientToCanvas(e);
    this.drawMask();
  }

  private handleMouseUp(e: MouseEvent): void {
    if (!this.dragging || !this.start) return;
    this.current = this.clientToCanvas(e);
    this.dragging = false;

    const rect = this.buildRect(this.start, this.current);

    // Guard: zero-area selection (plain click with no movement)
    if (rect.width < 1 || rect.height < 1) {
      this.clearMask();
      this.drawIdleMask();
      this.start = null;
      this.current = null;
      return;
    }

    const dataUrl = this.extractRegion(rect);
    this.clearMask();
    this.start = null;
    this.current = null;

    this.options.onCrop(dataUrl, rect);
  }

  private buildRect(a: Point, b: Point): CropRect {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const width = Math.abs(b.x - a.x);
    const height = Math.abs(b.y - a.y);
    return { x, y, width, height };
  }

  private drawMask(): void {
    if (!this.ctx || !this.start || !this.current) return;
    const { width, height } = this.canvas;
    const rect = this.buildRect(this.start, this.current);

    this.ctx.clearRect(0, 0, width, height);
    this.ctx.save();

    // Dark semi-transparent mask over the whole canvas
    this.ctx.fillStyle = 'rgba(0,0,0,0.55)';
    this.ctx.fillRect(0, 0, width, height);

    // Cut out the selected region (composite clear)
    this.ctx.clearRect(rect.x, rect.y, rect.width, rect.height);

    // Dashed selection border
    this.ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    this.ctx.lineWidth = 1.5;
    this.ctx.setLineDash([6, 3]);
    this.ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);

    this.ctx.restore();
  }

  private drawIdleMask(): void {
    if (!this.ctx) return;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.fillStyle = 'rgba(0,0,0,0.18)';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private clearMask(): void {
    if (!this.ctx) return;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private extractRegion(rect: CropRect): string | null {
    // The overlay-bg <img> behind the canvas holds the screen capture.
    // We draw into an offscreen canvas and export it as PNG.
    const bg = document.getElementById('overlay-bg') as HTMLImageElement | null;
    const source = this.resolveSourceRect(rect, bg);

    if (!bg || !bg.complete || bg.naturalWidth <= 0) {
      return null;
    }

    const offscreen = document.createElement('canvas');
    offscreen.width = Math.max(1, Math.round(source.width));
    offscreen.height = Math.max(1, Math.round(source.height));
    const offCtx = offscreen.getContext('2d') as CanvasRenderingContext2D;
    offCtx.drawImage(
      bg,
      source.x,
      source.y,
      source.width,
      source.height,
      0,
      0,
      offscreen.width,
      offscreen.height
    );

    return offscreen.toDataURL('image/png');
  }

  private resolveSourceRect(rect: CropRect, bg: HTMLImageElement | null): CropRect {
    if (!bg || !bg.complete || bg.naturalWidth <= 0 || bg.naturalHeight <= 0) {
      return rect;
    }

    const displayed = bg.getBoundingClientRect();
    const displayWidth = displayed.width || this.canvas.clientWidth || this.canvas.width;
    const displayHeight = displayed.height || this.canvas.clientHeight || this.canvas.height;
    const scaleX = bg.naturalWidth / displayWidth;
    const scaleY = bg.naturalHeight / displayHeight;

    return {
      x: Math.round(rect.x * scaleX),
      y: Math.round(rect.y * scaleY),
      width: Math.round(rect.width * scaleX),
      height: Math.round(rect.height * scaleY),
    };
  }
}
