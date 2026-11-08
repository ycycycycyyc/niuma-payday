export const PET_RESTORE_TARGET_MS = 650;

export type PetRestoreRect = { x: number; y: number; width: number; height: number };

type RestoreTargetOptions = {
  enabled?: () => boolean;
  onChange?: (rect: PetRestoreRect | null) => void;
};

// Keep the same transparent event target under the first click while the dog
// keeps moving. Only the hit target waits for the second click, not the artwork.
export function createPetRestoreTarget(button: HTMLButtonElement, options: RestoreTargetOptions = {}) {
  const target = document.createElement('span');
  target.className = 'pet-restore-target';
  target.setAttribute('data-pet-restore-target', '');
  target.setAttribute('aria-hidden', 'true');
  Object.assign(target.style, {
    position: 'absolute', inset: '0', zIndex: '1', pointerEvents: 'inherit',
  });
  button.append(target);

  let anchor: PetRestoreRect | null = null;
  let expiresAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let destroyed = false;

  function enabled() {
    return !destroyed && button.isConnected && !button.hidden && !button.disabled && (options.enabled?.() ?? true);
  }

  function clear() {
    const wasActive = anchor !== null;
    anchor = null;
    expiresAt = 0;
    clearTimeout(timer);
    timer = undefined;
    target.style.transform = '';
    target.style.width = '';
    target.style.height = '';
    if (wasActive) options.onChange?.(null);
  }

  function sync() {
    if (!anchor) return;
    if (!enabled() || performance.now() >= expiresAt) { clear(); return; }
    const current = button.getBoundingClientRect();
    if (!current.width || !current.height) { clear(); return; }
    target.style.width = `${anchor.width}px`;
    target.style.height = `${anchor.height}px`;
    target.style.transform = `translate3d(${anchor.x - current.x}px, ${anchor.y - current.y}px, 0)`;
  }

  function arm(event: PointerEvent) {
    if (!enabled() || !event.isPrimary || event.button !== 0) return;
    sync();
    if (anchor) return;
    const rect = button.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    anchor = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    expiresAt = performance.now() + PET_RESTORE_TARGET_MS;
    timer = setTimeout(clear, PET_RESTORE_TARGET_MS);
    sync();
    if (anchor) options.onChange?.({ ...anchor });
  }

  button.addEventListener('pointerdown', arm);

  return {
    sync,
    clear,
    destroy() {
      if (destroyed) return;
      clear();
      destroyed = true;
      button.removeEventListener('pointerdown', arm);
      target.remove();
    },
  };
}
