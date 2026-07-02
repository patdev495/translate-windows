import { describe, test, expect, vi } from 'vitest';
import { OverlayController } from '../src/overlay-controller';

describe('OverlayController', () => {
  test('should close the window when Escape key is pressed', () => {
    const mockWindow = { close: vi.fn() };
    const controller = new OverlayController(mockWindow);

    const escEvent = { key: 'Escape' } as KeyboardEvent;
    controller.handleKeyDown(escEvent);

    expect(mockWindow.close).toHaveBeenCalledTimes(1);
  });

  test('should not close the window when other keys are pressed', () => {
    const mockWindow = { close: vi.fn() };
    const controller = new OverlayController(mockWindow);

    const enterEvent = { key: 'Enter' } as KeyboardEvent;
    controller.handleKeyDown(enterEvent);

    expect(mockWindow.close).not.toHaveBeenCalled();
  });
});
