import path from 'node:path';
import { BrowserWindow, screen } from 'electron';
import { petLaneHeight } from '../shared/widget-geometry.mjs';
import { acrossDesktopGap, clampPetCenter, createDesktopPetMotion, stepDesktopPetMotion } from '../shared/desktop-pet-motion.mjs';

const BONE_SIZE = 28;
const intersects = (rect, x, y, size) => x < rect.x + rect.width && x + size > rect.x
  && y < rect.y + rect.height && y + size > rect.y;
const clamp = (n, min, max) => Math.max(min, Math.min(n, max));

// A display-sized paint surface stays still while the dog runs. All input goes
// through it, including at the dog's feet and at the bone under the cursor.
function createSurface(area, root, developmentURL) {
  const win = new BrowserWindow({
    ...area, title: '薪动 · 桌面小狗', frame: false, show: false, transparent: true,
    backgroundColor: '#00000000', roundedCorners: false, hasShadow: false,
    focusable: false, skipTaskbar: true, resizable: false, movable: false,
    fullscreenable: false, maximizable: false, minimizable: false, useContentSize: true,
    ...(process.platform === 'darwin' ? { type: 'panel', enableLargerThanScreen: true } : { thickFrame: false }),
    webPreferences: {
      preload: path.join(root, 'electron', 'desktop-pet-preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false,
      // Keep the paint surface's CSS scale independent of the app's zoom.
      partition: 'desktop-pet',
    },
  });
  try {
    win.setIgnoreMouseEvents(true);
    win.setAlwaysOnTop(true, 'pop-up-menu');
    if (process.platform === 'darwin') {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    }
    const contents = win.webContents;
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', event => event.preventDefault());
    contents.on('will-attach-webview', event => event.preventDefault());
    contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    contents.session.setPermissionCheckHandler(() => false);
    const loading = developmentURL
      ? win.loadURL(new URL('/pet.html', developmentURL).href)
      : win.loadFile(path.join(root, 'dist', 'pet.html'));
    return { win, loading, ready: false, shown: false, lastFrame: '' };
  } catch (error) {
    win.destroy();
    throw error;
  }
}

export class DesktopPet {
  constructor({ root, developmentURL, getWidget, getHit, notify }) {
    this.root = root;
    this.developmentURL = developmentURL;
    this.getWidget = getWidget;
    this.getHit = getHit;
    this.notify = notify;
    this.state = { phase: 'docked' };
    this.surfaces = new Map();
  }

  publish(state) {
    this.state = state;
    this.notify(state);
  }

  end(landing) {
    if (!this.trip) return;
    this.trip = null;
    for (const { win } of this.surfaces.values()) if (!win.isDestroyed()) win.destroy();
    this.surfaces.clear();
    this.publish({ phase: 'docked', ...landing });
  }

  home(widget, trip) {
    const bounds = widget.getContentBounds();
    const zoom = widget.webContents.getZoomFactor();
    const cssWidth = bounds.width / zoom;
    const cssX = clamp(trip.dockX, Math.min(cssWidth / 2, 12 + trip.cssSize / 2), Math.max(cssWidth / 2, cssWidth - 12 - trip.cssSize / 2));
    const cssY = petLaneHeight(bounds.height / zoom) + trip.dockYFromCard;
    return { x: bounds.x + cssX * zoom, y: bounds.y + cssY * zoom, cssX, size: trip.cssSize * zoom };
  }

  async setMode(active, reducedMotion) {
    const widget = this.getWidget();
    if (!widget || widget.isDestroyed()) {
      this.end();
      return this.state;
    }
    const trip = this.trip;
    if (trip) {
      if (typeof reducedMotion === 'boolean') trip.reduced = reducedMotion;
      trip.idleCursor = null;
      if (!trip.ready) {
        if (!active) this.end();
        else await trip.launch;
      } else {
        const phase = active ? 'chasing' : 'returning';
        if (this.state.phase !== phase) this.publish({ phase });
        this.tick(screen.getCursorScreenPoint());
      }
      return this.state;
    }
    if (!active) return this.state;
    const pet = this.getHit();
    if (!pet?.width || !pet.height) throw new Error('小狗尚未就位，请再点一次骨头');
    const launch = {
      cssSize: pet.width, dockX: pet.left + pet.width / 2, reduced: reducedMotion, ready: false,
      dockYFromCard: pet.top + pet.height / 2 - petLaneHeight(widget.getContentBounds().height / widget.webContents.getZoomFactor()),
    };
    this.trip = launch;
    launch.launch = this.launch(widget, launch, pet.facing).catch(error => {
      // Hiding the card or cancelling while its first renderer loads is normal.
      if (this.trip !== launch) return;
      this.end();
      throw error;
    });
    await launch.launch;
    return this.state;
  }

  async launch(widget, trip, facing) {
    this.displays = screen.getAllDisplays();
    const start = this.home(widget, trip);
    const display = screen.getDisplayNearestPoint({ x: Math.round(start.x), y: Math.round(start.y) });
    await this.surface(display).loading;
    if (this.trip !== trip || widget !== this.getWidget() || widget.isDestroyed()) return;
    // The original dog kept walking while the graphics page loaded.
    const hit = this.getHit();
    if (hit?.width) trip.dockX = hit.left + hit.width / 2;
    trip.pet = createDesktopPetMotion({ ...this.home(widget, trip), facing: hit?.facing ?? facing });
    trip.lastTime = performance.now();
    trip.ready = true;
    this.publish({ phase: 'chasing' });
    this.tick(screen.getCursorScreenPoint());
  }

  surface(display) {
    const existing = this.surfaces.get(display.id);
    if (existing) return existing;
    const surface = createSurface(display.workArea, this.root, this.developmentURL);
    this.surfaces.set(display.id, surface);
    const failed = error => {
      if (this.surfaces.get(display.id) !== surface || !this.trip) return;
      console.warn('Unable to draw the desktop pet:', error.message);
      this.end();
    };
    surface.loading.then(() => {
      surface.ready = true;
      if (this.trip) this.trip.idleCursor = null;
    }, error => {
      // launch() propagates first-surface failures to the bone button.
      if (this.trip?.ready) failed(error);
    });
    surface.win.webContents.on('render-process-gone', (_event, details) => failed(new Error(details.reason)));
    return surface;
  }

  displaysChanged() {
    if (!this.trip) return;
    this.trip.idleCursor = null;
    this.displays = screen.getAllDisplays();
    for (const [id, surface] of this.surfaces) {
      const display = this.displays.find(d => d.id === id);
      if (display) {
        surface.win.setBounds(display.workArea);
        surface.lastFrame = '';
      } else {
        this.surfaces.delete(id);
        surface.win.destroy();
      }
    }
  }

  tick(cursor) {
    const trip = this.trip;
    if (!trip?.ready) return;
    if (trip.idleCursor?.x === cursor.x && trip.idleCursor.y === cursor.y) return;
    trip.idleCursor = null;
    try {
      const widget = this.getWidget();
      if (!widget || widget.isDestroyed()) { this.end(); return; }
      const home = this.home(widget, trip);
      const returning = this.state.phase === 'returning';
      const area = screen.getDisplayNearestPoint(cursor).workArea;
      const bone = returning ? null : {
        x: clamp(cursor.x + (cursor.x + 38 > area.x + area.width ? -32 : 10), area.x, area.x + area.width - BONE_SIZE),
        y: clamp(cursor.y + (cursor.y + 37 > area.y + area.height ? -30 : 9), area.y, area.y + area.height - BONE_SIZE),
      };
      const target = returning ? home : clampPetCenter({ x: cursor.x - 15, y: cursor.y + 18 }, area, home.size);
      const now = performance.now();
      const pet = stepDesktopPetMotion(trip.pet, target, now - trip.lastTime, { returning, reducedMotion: trip.reduced });
      trip.lastTime = now;
      // Skip physical gaps in staggered monitor arrangements. Never clamp a
      // legitimate halfway position back onto the monitor where the run began.
      const position = acrossDesktopGap(pet, target, this.displays.map(display => display.bounds));
      trip.pet = { ...pet, x: position.x, y: position.y };
      if (returning && pet.arrived) { this.end({ dockX: home.cssX, facing: pet.facing }); return; }
      this.paint(trip.pet, home.size, bone);
      if (!returning && pet.arrived) trip.idleCursor = cursor;
    } catch (error) {
      console.warn('Unable to animate the desktop pet:', error.message);
      this.end();
    }
  }

  paint(pet, size, bone) {
    const left = pet.x - size / 2, top = pet.y - size / 2;
    for (const display of this.displays) {
      const area = display.workArea;
      const dogHere = intersects(area, left, top, size);
      const boneHere = bone && intersects(area, bone.x, bone.y, BONE_SIZE);
      if (!dogHere && !boneHere) {
        const idle = this.surfaces.get(display.id);
        if (idle?.shown) {
          idle.win.webContents.send('niuma:desktop-pet-frame', { dog: null, bone: null });
          idle.win.hide();
          idle.shown = false;
          idle.lastFrame = '';
        }
        continue;
      }
      const surface = this.surface(display);
      if (!surface.ready) continue;
      const { win } = surface;
      const bounds = win.getContentBounds();
      const frame = {
        dog: dogHere ? { x: left - bounds.x, y: top - bounds.y, size, facing: pet.facing, pose: pet.pose, frame: pet.frame } : null,
        bone: boneHere ? { x: bone.x - bounds.x, y: bone.y - bounds.y } : null,
      };
      const key = JSON.stringify(frame);
      if (key !== surface.lastFrame) {
        win.webContents.send('niuma:desktop-pet-frame', frame);
        surface.lastFrame = key;
      }
      if (!surface.shown) { win.showInactive(); surface.shown = true; }
    }
  }
}
