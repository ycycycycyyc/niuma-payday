import type { CompanionOrigin } from '../components/CompanionPet';

export function companionOrigin(dog: HTMLElement | null, field?: HTMLElement | null): CompanionOrigin {
  const rect = dog?.getBoundingClientRect();
  const area = field?.getBoundingClientRect();
  return {
    x: rect ? rect.left + rect.width / 2 - (area?.left ?? 0) : 100,
    y: rect ? rect.top + rect.height / 2 - (area?.top ?? 0) : 100,
    size: rect?.width || 76,
    facing: dog?.dataset.facing === '-1' ? -1 : 1,
    pose: dog?.dataset.pose,
    frame: Number(dog?.dataset.frame) || 0,
  };
}
