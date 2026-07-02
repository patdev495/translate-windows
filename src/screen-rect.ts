import type { CropRect } from './crop-selector';

export interface OverlayScreenGeometry {
  screenX: number;
  screenY: number;
  screenWidth: number;
  screenHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}

export function mapOverlayRectToScreenRect(
  rect: CropRect,
  geometry: OverlayScreenGeometry
): CropRect {
  const scaleX = geometry.screenWidth / geometry.viewportWidth;
  const scaleY = geometry.screenHeight / geometry.viewportHeight;

  return {
    x: geometry.screenX + rect.x * scaleX,
    y: geometry.screenY + rect.y * scaleY,
    width: rect.width * scaleX,
    height: rect.height * scaleY,
  };
}

export function getScreenRectMapper(
  params: URLSearchParams,
  viewportWidth: number,
  viewportHeight: number
): ((rect: CropRect) => CropRect) | undefined {
  const screenX = Number(params.get('screenX'));
  const screenY = Number(params.get('screenY'));
  const screenWidth = Number(params.get('screenWidth'));
  const screenHeight = Number(params.get('screenHeight'));

  if (
    !Number.isFinite(screenX) ||
    !Number.isFinite(screenY) ||
    !Number.isFinite(screenWidth) ||
    !Number.isFinite(screenHeight) ||
    !Number.isFinite(viewportWidth) ||
    !Number.isFinite(viewportHeight) ||
    screenWidth <= 0 ||
    screenHeight <= 0 ||
    viewportWidth <= 0 ||
    viewportHeight <= 0
  ) {
    return undefined;
  }

  return (rect: CropRect) => mapOverlayRectToScreenRect(rect, {
    screenX,
    screenY,
    screenWidth,
    screenHeight,
    viewportWidth,
    viewportHeight,
  });
}
