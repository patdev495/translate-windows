import type { CropRect } from './crop-selector';

export type RecordingStatus = 'selecting' | 'ready' | 'recording' | 'saving' | 'saved' | 'discarded' | 'error';

export interface RecordingState {
  selectedRect: CropRect | null;
  screenRect: CropRect | null;
  status: RecordingStatus;
  error: string | null;
  savedPath: string | null;
  startedAt: number | null;
}

export interface RoundedRecordingRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RecordingCommandApi {
  start(rect: RoundedRecordingRect): Promise<void>;
  hideControls(): Promise<void>;
  stop(): Promise<string | null>;
  cancel(): Promise<void>;
  close(): Promise<void>;
}

export function createInitialRecordingState(): RecordingState {
  return {
    selectedRect: null,
    screenRect: null,
    status: 'selecting',
    error: null,
    savedPath: null,
    startedAt: null,
  };
}

export function getRecordingControlPosition(
  rect: CropRect,
  viewport: { width: number; height: number },
  controls: { width: number; height: number }
): { x: number; y: number } {
  const margin = 12;
  const centeredX = rect.x + (rect.width - controls.width) / 2;
  const x = Math.max(margin, Math.min(centeredX, viewport.width - controls.width - margin));
  const belowY = rect.y + rect.height + margin;
  const y = belowY + controls.height <= viewport.height - margin
    ? belowY
    : Math.max(margin, rect.y - controls.height - margin);

  return { x: Math.round(x), y: Math.round(y) };
}

function roundScreenRect(rect: CropRect): RoundedRecordingRect {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
  };
}

export class RecordingOverlayController {
  private state: RecordingState = createInitialRecordingState();

  constructor(
    private api: RecordingCommandApi,
    private now: () => number = () => Date.now()
  ) {}

  getState(): RecordingState {
    return { ...this.state };
  }

  selectRegion(selectedRect: CropRect, screenRect: CropRect): void {
    this.state = {
      ...this.state,
      selectedRect,
      screenRect,
      status: 'ready',
      error: null,
      savedPath: null,
      startedAt: null,
    };
  }

  async start(): Promise<void> {
    if (!this.state.screenRect) {
      this.state = { ...this.state, status: 'error', error: 'Select a recording area before starting.' };
      return;
    }

    try {
      await this.api.start(roundScreenRect(this.state.screenRect));
      this.state = { ...this.state, status: 'recording', error: null, startedAt: this.now() };
    } catch (err) {
      this.state = { ...this.state, status: 'error', error: err instanceof Error ? err.message : String(err) };
    }
  }

  async hideControls(): Promise<void> {
    await this.api.hideControls();
  }

  async stop(): Promise<void> {
    if (this.state.status !== 'recording') {
      this.state = { ...this.state, status: 'error', error: 'No screen recording is in progress.' };
      return;
    }

    this.state = { ...this.state, status: 'saving', error: null };
    try {
      const savedPath = await this.api.stop();
      this.state = {
        ...this.state,
        status: savedPath ? 'saved' : 'discarded',
        savedPath,
        error: savedPath ? null : 'Recording discarded.',
      };
    } catch (err) {
      this.state = { ...this.state, status: 'error', error: err instanceof Error ? err.message : String(err) };
    }
  }

  async cancel(): Promise<void> {
    await this.api.cancel();
    await this.api.close();
  }
}
