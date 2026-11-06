export type WorkArea = { x: number; y: number; width: number; height: number };
export type CardAnchor = { x: number; y: number };
export const fullWidgetHeight: number;
export function petLaneHeight(windowHeight: number): number;
export function widgetScaleInWorkArea(area: WorkArea, requestedScale?: number): number;
export function widgetBoundsInWorkArea(area: WorkArea, cardAnchor?: CardAnchor, requestedScale?: number): WorkArea;
