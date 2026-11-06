import layout from './widget-layout.json' with { type: 'json' };

export const fullWidgetHeight = layout.cardHeight + layout.laneHeight;

// Tiny remote displays can be shorter than the normal window. Preserve the
// controls first, and use only the remaining height for the transparent pet.
export function petLaneHeight(windowHeight) {
  return Math.min(layout.laneHeight, Math.max(0, windowHeight - layout.cardHeight));
}

// The user's scale stays a preference; tiny displays may need a smaller effective
// zoom to keep every card control visible. The pet lane yields height first.
export function widgetScaleInWorkArea(area, requestedScale = 1) {
  const preferred = Number.isFinite(requestedScale) && requestedScale > 0 ? requestedScale : 1;
  return Math.min(preferred, area.width / layout.width, area.height / layout.cardHeight);
}

// All coordinates from Electron's screen and BrowserWindow APIs are DIP, even
// when the two displays use different physical pixel densities.
export function widgetBoundsInWorkArea(area, cardAnchor, requestedScale = 1) {
  const scale = widgetScaleInWorkArea(area, requestedScale);
  const width = Math.min(Math.ceil(layout.width * scale), area.width);
  const height = Math.min(Math.ceil(fullWidgetHeight * scale), area.height);
  const right = area.x + area.width - width;
  const bottom = area.y + area.height - height;
  const desiredX = cardAnchor ? cardAnchor.x : right - 24;
  const desiredY = cardAnchor ? cardAnchor.y - petLaneHeight(height / scale) * scale : area.y + 40;
  return {
    width,
    height,
    x: Math.max(area.x, Math.min(Math.round(desiredX), right)),
    y: Math.max(area.y, Math.min(Math.round(desiredY), bottom)),
  };
}
