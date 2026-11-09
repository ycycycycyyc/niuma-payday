export type DesktopPetPoint = { x: number; y: number };
export type DesktopPetBounds = DesktopPetPoint & { width: number; height: number };
export type DesktopPetPose = 'walk' | 'stand' | 'turn' | 'crouch' | 'sit' | 'lift' | 'paw' | 'wag';
export type DesktopPetLaunchPose = { pose: DesktopPetPose; frame: number; stepPhase: number; speed: number };
export interface DesktopPetMotion extends DesktopPetPoint {
  vx: number; vy: number; facing: 1 | -1;
  stepPhase: number; frame: number; pose: DesktopPetPose; arrived: boolean;
}
export function normalizePetLaunchPose(value: unknown): DesktopPetLaunchPose | undefined;
export function createDesktopPetMotion(seed: DesktopPetPoint & { facing?: 1 | -1; launchPose?: DesktopPetLaunchPose }): DesktopPetMotion;
export function clampPetCenter(point: DesktopPetPoint, bounds: DesktopPetBounds, size: number): DesktopPetPoint;
export const BONE_SIZE: number;
export function placeChaseBone(pointer: DesktopPetPoint, bounds: DesktopPetBounds, petSize: number): {
  target: DesktopPetPoint; position: DesktopPetPoint;
};
export function acrossDesktopGap(point: DesktopPetPoint, target: DesktopPetPoint, displayBounds: DesktopPetBounds[]): DesktopPetPoint;
export function stepDesktopPetMotion(state: DesktopPetMotion, target: DesktopPetPoint, elapsedMs: number, options?: {
  returning?: boolean; reducedMotion?: boolean;
}): DesktopPetMotion;
