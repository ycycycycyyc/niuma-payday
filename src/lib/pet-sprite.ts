import walk from '../assets/widget-dog-walk.webp';
import actions from '../assets/widget-dog-actions.webp';
import companion from '../assets/widget-dog-companion.png';
import sleeping from '../assets/widget-dog-sleep.png';
import playing from '../assets/widget-dog-play.png';
import transitions from '../assets/widget-dog-transitions.png';
import anchorData from '../../shared/pet-sprite-anchors.json';

type SpriteBounds = { left: number; top: number; right: number; bottom: number; scale?: number };
type SheetName = 'walk' | 'actions' | 'companion' | 'sleep' | 'play' | 'transitions';
type SheetAnchors = { columns: number; rows: number; frames: SpriteBounds[]; scale?: number };
type AnchorManifest = { version: number; ground: number; sheets: Partial<Record<SheetName, SheetAnchors>> };
const anchors = anchorData as AnchorManifest;
const sheets = {
  walk: { asset: walk, columns: 4, rows: 1 }, actions: { asset: actions, columns: 7, rows: 1 },
  companion: { asset: companion, columns: 4, rows: 4 }, sleep: { asset: sleeping, columns: 6, rows: 3 },
  play: { asset: playing, columns: 4, rows: 3 }, transitions: { asset: transitions, columns: 8, rows: 6 },
} satisfies Record<SheetName, { asset: string; columns: number; rows: number }>;
const actionFrames: Record<string, number> = { stand: 0, turn: 1, crouch: 2, sit: 3, lift: 4, paw: 5, wag: 6 };
const sleepRows: Record<string, number> = { sleep: 0, 'sleep-side': 1, 'sleep-belly': 2 };
const bridgeRows: Record<string, number> = {
  'bridge-lick': 0, 'bridge-sleep': 1, 'bridge-side': 2,
  'bridge-belly': 3, 'bridge-play': 4, 'bridge-turn': 5,
};
const fullCell: SpriteBounds = { left: 0, top: 0, right: 1, bottom: 1 };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const own = (record: Record<string, number>, key: string) => Object.hasOwn(record, key);

export function describePetSprite(pose: string, frame: number) {
  const requested = Number.isFinite(frame) ? Math.max(0, Math.floor(frame)) : 0;
  let sheet: SheetName;
  let index: number;
  if (own(bridgeRows, pose)) { sheet = 'transitions'; index = bridgeRows[pose] * 8 + Math.min(7, requested); }
  else if (own(sleepRows, pose)) { sheet = 'sleep'; index = sleepRows[pose] * 6 + Math.min(5, requested); }
  else if (pose === 'play') { sheet = 'play'; index = Math.min(11, requested); }
  else if (pose === 'lick' || pose === 'roll') { sheet = 'companion'; index = (pose === 'roll' ? 12 : 0) + Math.min(3, requested); }
  else if (pose === 'walk') { sheet = 'walk'; index = Math.min(3, requested); }
  else { sheet = 'actions'; index = own(actionFrames, pose) ? actionFrames[pose] : 0; }
  const { asset, columns, rows } = sheets[sheet];
  const metadata = anchors.sheets[sheet];
  const source = metadata?.frames[index];
  const anchor = source && [source.left, source.top, source.right, source.bottom].every(Number.isFinite)
    && source.right > source.left && source.bottom > source.top ? source : fullCell;
  // Bridge frames match the widths of their standing/action endpoints; loop
  // artwork keeps the sheet's fixed scale so breathing never changes size.
  const calibratedScale = Number.isFinite(source?.scale) ? source!.scale : metadata?.scale;
  return {
    sheet, asset, columns, rows, column: index % columns, row: Math.floor(index / columns), sheetFrame: index,
    anchor, scale: Number.isFinite(calibratedScale) ? clamp(calibratedScale!, 0.1, 3) : 1,
    ground: Number.isFinite(anchors.ground) ? clamp(anchors.ground, 0, 1) : 0.98,
  };
}

export function applyPetSprite(element: HTMLElement, {
  pose, frame, facing, size, grounded = true,
}: { pose: string; frame: number; facing: 1 | -1; size: number; grounded?: boolean }) {
  const description = describePetSprite(pose, frame);
  const { sheet, asset, columns, rows, column, row, anchor, ground } = description;
  const scale = grounded ? description.scale : 1;
  const width = Number.isFinite(size) ? Math.max(0, size) : 76;
  const direction = facing < 0 ? -1 : 1;
  // Mirror around the unchanged logical square. Visible artwork is centered
  // and grounded inside that square; the button remains the same hit target.
  const dx = grounded ? direction * (0.5 - (anchor.left + anchor.right) / 2) * width * scale : 0;
  const dy = grounded ? (ground - 0.5 - (anchor.bottom - 0.5) * scale) * width : 0;
  if (element.dataset.sheet !== sheet) {
    element.dataset.sheet = sheet;
    element.style.backgroundImage = `url("${asset}")`;
    element.style.backgroundSize = `${columns * 100}% ${rows * 100}%`;
  }
  element.style.backgroundPosition = `${columns === 1 ? 50 : 100 * column / (columns - 1)}% ${rows === 1 ? 50 : 100 * row / (rows - 1)}%`;
  element.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(${direction * scale}, ${scale})`;
  element.dataset.pose = pose;
  element.dataset.frame = String(frame);
  element.dataset.grounded = String(grounded);
  element.dataset.anchorBottom = String(anchor.bottom);
  element.dataset.spriteScale = String(scale);
  return description;
}

let artwork: Promise<boolean> | undefined;
export function loadPetSpriteArtwork() {
  artwork ??= Promise.all(Object.values(sheets).map(({ asset }) => {
    const image = new Image();
    image.src = asset;
    return image.decode();
  })).then(() => true, () => false);
  return artwork;
}
