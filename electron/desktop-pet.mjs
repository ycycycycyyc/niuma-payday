import path from 'node:path';
import { BrowserWindow, screen } from 'electron';
import { petLaneHeight } from '../shared/widget-geometry.mjs';
import { acrossDesktopGap, BONE_SIZE, clampPetCenter, createDesktopPetMotion, placeChaseBone, stepDesktopPetMotion } from '../shared/desktop-pet-motion.mjs';
import { createCompanionMotion, placeCompanionMotion, stepCompanionMotion } from '../shared/desktop-pet-companion.mjs';

const FIRST_PAINT_TIMEOUT = 5000;
const COLD_SURFACE_MS = 250;
const RESTORE_TARGET_MS = 650;
const intersects = (rect, x, y, size) => x < rect.x + rect.width && x + size > rect.x
  && y < rect.y + rect.height && y + size > rect.y;
const clamp = (n, min, max) => Math.max(min, Math.min(n, max));

function setCompanionShape(surface, rects) {
  if (!surface.nativeCompanionShape) return;
  const key = rects.length ? JSON.stringify(rects) : '';
  if (key === (surface.shapeKey || '')) return;
  surface.win.setShape(rects);
  surface.shapeKey = key;
}

function enclosingRect(x, y, width, height) {
  const left = Math.floor(x), top = Math.floor(y);
  return { x: left, y: top, width: Math.ceil(x + width) - left, height: Math.ceil(y + height) - top };
}

function hideSurface(surface) {
  if (!surface.shown || surface.win.isDestroyed()) return;
  surface.win.webContents.send('niuma:desktop-pet-frame', { dog: null, bone: null, sampleTime: performance.now() });
  surface.win.hide();
  setCompanionShape(surface, []);
  surface.shown = false;
  surface.lastFrame = '';
  if (surface.acceptsMouse) surface.win.setIgnoreMouseEvents(true);
  surface.acceptsMouse = false;
}

function companionReleasePoint(surface, client) {
  // This unzoomed renderer reports CSS pixels relative to the capturing window.
  const bounds = surface.win.getContentBounds();
  const point = { x: Math.round(bounds.x + client.x), y: Math.round(bounds.y + client.y) };
  if (process.platform !== 'win32' || (client.x >= 0 && client.x < bounds.width &&
      client.y >= 0 && client.y < bounds.height)) return point;
  // Outside that window, its local DIPs still use the source display scale.
  // Convert via physical pixels to get the destination display's desktop DIPs.
  const physical = screen.dipToScreenRect(surface.win, { ...point, width: 1, height: 1 });
  return screen.screenToDipPoint({ x: physical.x, y: physical.y });
}

// Only the companion dog accepts input for dragging and restoring the widget.
// Chasing and returning dogs stay click-through; feeding belongs to the widget.
function createSurface(area, root, developmentURL) {
  const createdAt = performance.now();
  const win = new BrowserWindow({
    ...area, title: '薪动 · 桌面小狗', frame: false, show: false, transparent: true,
    backgroundColor: '#00000000', roundedCorners: false, hasShadow: false,
    focusable: false, skipTaskbar: true, resizable: false, movable: false,
    fullscreenable: false, maximizable: false, minimizable: false, useContentSize: true,
    ...(process.platform === 'darwin' ? { type: 'panel', acceptFirstMouse: true, enableLargerThanScreen: true } : { thickFrame: false }),
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
    return { win, loading, createdAt, ready: false, prepared: false, shown: false, lastFrame: '',
      nativeCompanionShape: process.platform === 'win32' };
  } catch (error) {
    win.destroy();
    throw error;
  }
}

export class DesktopPet {
  constructor({ root, developmentURL, getWidget, getHit, notify, restoreWidget, onCompanionFailure }) {
    this.root = root;
    this.developmentURL = developmentURL;
    this.getWidget = getWidget;
    this.getHit = getHit;
    this.notify = notify;
    this.restoreWidget = restoreWidget;
    this.onCompanionFailure = onCompanionFailure;
    this.state = { phase: 'docked' };
    this.surfaces = new Map();
  }

  publish(state) {
    this.state = state;
    this.notify(state);
  }

  end(landing) {
    const trip = this.trip;
    this.trip = null;
    clearInterval(this.companionTimer);
    this.companionTimer = undefined;
    trip?.cancelLaunch?.();
    const widget = landing && this.getWidget();
    const keep = widget && !widget.isDestroyed() ? screen.getDisplayMatching(widget.getBounds()).id : null;
    for (const [id, surface] of this.surfaces) {
      if (id === keep && !surface.win.isDestroyed()) hideSurface(surface);
      else {
        this.surfaces.delete(id);
        if (!surface.win.isDestroyed()) surface.win.destroy();
      }
    }
    if (trip) this.publish({ phase: 'docked', ...landing });
  }

  dockCompanion() {
    if (this.state.phase !== 'companion') return;
    this.end({ dockX: this.trip.dockX, facing: this.trip.pet.facing });
  }

  async startCompanion(reducedMotion, isCurrent = () => true) {
    // Reuse a current chase in place, or paint the card's dog before hiding it.
    if (!this.trip?.ready) await this.setMode(true, reducedMotion);
    const trip = this.trip;
    if (!trip?.ready || !isCurrent()) return;
    trip.reduced = reducedMotion;
    const widget = this.getWidget();
    if (!widget || widget.isDestroyed()) return;
    trip.size = this.home(widget, trip).size;
    const area = screen.getDisplayNearestPoint({ x: Math.round(trip.pet.x), y: Math.round(trip.pet.y) }).workArea;
    trip.pet = createCompanionMotion(trip.pet, area, trip.size);
    trip.lastTime = performance.now();
    this.publish({ phase: 'companion' });
    this.tick(screen.getCursorScreenPoint());
    this.companionTimer ??= setInterval(() => this.tick(screen.getCursorScreenPoint()), 24);
  }

  holdsCompanion(event, surface) {
    if (this.state.phase !== 'companion' || !this.trip?.ready || !surface.shown || surface.win.isDestroyed()) return false;
    const frame = surface.win.webContents.mainFrame;
    return event.processId === frame.processId && event.frameId === frame.routingId;
  }

  setRestoreTarget(event, surface, rect) {
    if (!this.holdsCompanion(event, surface)) return;
    if (rect === null) {
      if (this.trip.restoreTarget?.surface === surface) this.trip.restoreTarget = null;
      return;
    }
    const trip = this.trip;
    if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ||
        Math.abs(rect.width - trip.size) > .1 || Math.abs(rect.height - trip.size) > .1) return;
    const bounds = surface.win.getContentBounds();
    const x = bounds.x + rect.x, y = bounds.y + rect.y;
    if (Math.abs(x + rect.width / 2 - trip.pet.x) > trip.size ||
        Math.abs(y + rect.height / 2 - trip.pet.y) > trip.size) return;
    // Keep only the first click's input target still. The dog and its animation
    // continue moving while Chromium recognizes a second click on that target.
    trip.restoreTarget = { x, y, width: rect.width, height: rect.height,
      until: performance.now() + RESTORE_TARGET_MS, surface };
  }

  hitsRestoreTarget(cursor) {
    const target = this.trip?.restoreTarget;
    if (!target) return false;
    if (performance.now() >= target.until) {
      this.trip.restoreTarget = null;
      return false;
    }
    return cursor.x >= target.x && cursor.x < target.x + target.width &&
      cursor.y >= target.y && cursor.y < target.y + target.height;
  }

  companionGesture(event, surface, phase, point) {
    if (!this.holdsCompanion(event, surface) || this.trip.suspended) return;
    const trip = this.trip;
    if (phase === 'press') {
      if (trip.press || !point || ![point.x, point.y].every(Number.isFinite) ||
          Math.max(Math.abs(point.x), Math.abs(point.y)) > trip.size / 2 + 1) return;
      trip.press = { surface, offset: point, dragging: false };
    } else {
      if (trip.press?.surface !== surface) return;
      if (phase === 'drag') {
        trip.press.dragging = true;
        trip.restoreTarget = null;
      } else if (phase === 'release') {
        // A quick move after mouseup can precede this IPC. Use the actual
        // release event's position for the last drag frame.
        if (trip.press.dragging && point && [point.x, point.y].every(Number.isFinite)) {
          this.tick(companionReleasePoint(surface, point));
        }
        trip.press = null;
      } else return;
    }
    this.tick(screen.getCursorScreenPoint());
  }

  overWidgetCard(cursor) {
    const widget = this.getWidget();
    if (!widget || widget.isDestroyed() || !widget.isVisible() || widget.isMinimized()) return false;
    const bounds = widget.getContentBounds();
    const zoom = widget.webContents.getZoomFactor();
    const top = bounds.y + petLaneHeight(bounds.height / zoom) * zoom;
    return cursor.x >= bounds.x && cursor.x < bounds.x + bounds.width &&
      cursor.y >= top && cursor.y < bounds.y + bounds.height;
  }

  syncPetMouseRegion(cursor) {
    const canInteract = this.state.phase === 'companion';
    const hit = canInteract && !this.overWidgetCard(cursor) &&
      (this.hitsCompanion(cursor) || this.hitsRestoreTarget(cursor));
    for (const surface of this.surfaces.values()) {
      if (surface.win.isDestroyed()) continue;
      const b = surface.win.getBounds();
      // Pointer capture belongs to the surface where the press began, even
      // when the pointer races beyond the sprite or crosses to another display.
      const press = this.trip?.press;
      const overSurface = cursor.x >= b.x && cursor.x < b.x + b.width && cursor.y >= b.y && cursor.y < b.y + b.height;
      const accepts = Boolean(surface.shown && canInteract && (press ? press.surface === surface :
        surface.nativeCompanionShape || (hit && overSurface)));
      if (accepts !== Boolean(surface.acceptsMouse)) {
        surface.win.setIgnoreMouseEvents(!accepts);
        surface.acceptsMouse = accepts;
      }
    }
  }

  hitsCompanion(cursor) {
    const trip = this.trip;
    if (!trip?.pet || !trip.size) return false;
    // Match the renderer's square button. Grounded feet reach 98% of its
    // height, outside the old circular hit area, so those clicks fell through.
    const half = trip.size / 2;
    return cursor.x >= trip.pet.x - half && cursor.x < trip.pet.x + half &&
      cursor.y >= trip.pet.y - half && cursor.y < trip.pet.y + half;
  }

  tickCompanion(cursor) {
    const trip = this.trip;
    const now = performance.now();
    if (trip.press?.dragging) {
      const { offset } = trip.press;
      // Electron's global cursor and work areas use the same desktop DIP space.
      const area = screen.getDisplayNearestPoint(cursor).workArea;
      trip.pet = placeCompanionMotion(trip.pet, { x: cursor.x + offset.x, y: cursor.y + offset.y }, area);
    } else {
      const area = screen.getDisplayNearestPoint({ x: Math.round(trip.pet.x), y: Math.round(trip.pet.y) }).workArea;
      trip.pet = stepCompanionMotion(trip.pet, now - trip.lastTime, {
        bounds: area, size: trip.size, reducedMotion: trip.reduced,
      });
    }
    trip.lastTime = now;
    this.paint({ ...trip.pet, ...(trip.reduced ? { vx: 0, vy: 0 } : {}) }, trip.size, null);
    this.syncPetMouseRegion(cursor);
  }

  prewarm() {
    const widget = this.getWidget();
    if (this.trip || !widget || widget.isDestroyed()) return;
    try {
      const display = screen.getDisplayMatching(widget.getBounds());
      for (const [id, surface] of this.surfaces) {
        if (id === display.id) continue;
        this.surfaces.delete(id);
        if (!surface.win.isDestroyed()) surface.win.destroy();
      }
      // Load the local page and its sprite sheets; the native surface stays hidden until takeoff.
      this.surface(display);
    } catch (error) {
      console.warn('Unable to prepare the desktop pet:', error.message);
    }
  }

  suspend() {
    if (this.state.phase !== 'companion') { this.end(); return; }
    clearInterval(this.companionTimer);
    this.companionTimer = undefined;
    this.trip.suspended = true;
    this.trip.press = null;
    this.trip.restoreTarget = null;
    for (const surface of this.surfaces.values()) hideSurface(surface);
  }

  resume() {
    if (this.state.phase !== 'companion' || !this.trip?.suspended) return;
    this.trip.suspended = false;
    this.trip.lastTime = performance.now();
    this.tick(screen.getCursorScreenPoint());
    this.companionTimer ??= setInterval(() => this.tick(screen.getCursorScreenPoint()), 24);
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
      // Hidden widget renderers can still report a preference change. That
      // must not recall a companion into a card that remains minimized.
      if (this.state.phase === 'companion') return this.state;
      if (trip.idleCursor) trip.lastTime = performance.now();
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
    const requestedAt = performance.now();
    const painted = Promise.withResolvers();
    const timeout = setTimeout(() => painted.reject(new Error('桌面小狗未能及时显示，请再点一次骨头')), FIRST_PAINT_TIMEOUT);
    trip.cancelLaunch = painted.resolve;
    try {
      while (this.trip === trip && this.getWidget() === widget && !widget.isDestroyed()) {
        // While a cold surface loads, the dog keeps walking and the card can move or change zoom.
        const hit = this.getHit();
        const zoom = widget.webContents.getZoomFactor();
        if (hit?.width) {
          trip.dockX = hit.left + hit.width / 2;
          trip.cssSize = hit.width;
          trip.dockYFromCard = hit.top + hit.height / 2 - petLaneHeight(widget.getContentBounds().height / zoom);
        }
        const home = this.home(widget, trip);
        const display = screen.getDisplayNearestPoint({ x: Math.round(home.x), y: Math.round(home.y) });
        const surface = this.surface(display);
        if (!surface.prepared && (!surface.ready || requestedAt - surface.createdAt < COLD_SURFACE_MS)) {
          // Starting the native compositor can delay both windows. Keep the card's dog
          // in charge while the empty click-through surface receives its first stable refreshes.
          trip.launchSurface = surface;
          surface.win.showInactive();
          surface.shown = true;
          if (!surface.ready) await Promise.race([surface.loading, painted.promise]);
          if (this.trip !== trip) return;
          const prepared = Promise.withResolvers();
          trip.confirmPrepared = prepared.resolve;
          surface.win.webContents.send('niuma:desktop-pet-prepare');
          await Promise.race([prepared.promise, painted.promise]);
          if (this.trip !== trip) return;
          trip.confirmPrepared = null;
          surface.prepared = true;
          // Re-read the latest dock coordinates and pose, including any move to another display.
          continue;
        }
        // A user can drag the dock past an edge. Start at its nearest visible point if the
        // entire sprite is outside the work area, so a first paint can still be acknowledged.
        const firstPosition = intersects(display.workArea, home.x - home.size / 2, home.y - home.size / 2, home.size)
          ? home : clampPetCenter(home, display.workArea, home.size);
        const pose = hit?.launchPose;
        trip.pet = createDesktopPetMotion({ ...firstPosition, facing: hit?.facing ?? facing,
          launchPose: pose && { ...pose, speed: pose.speed * zoom } });
        trip.launchSurface = surface;
        trip.confirmFirstFrame = painted.resolve;
        this.paint(trip.pet, home.size, null, surface);
        await painted.promise;
        if (this.trip !== trip) return;
        trip.lastTime = performance.now();
        trip.ready = true;
        this.publish({ phase: 'chasing' });
        this.tick(screen.getCursorScreenPoint());
        return;
      }
      if (this.trip === trip) this.end();
    } finally {
      clearTimeout(timeout);
      trip.confirmPrepared?.();
      trip.cancelLaunch = trip.confirmPrepared = trip.confirmFirstFrame = trip.launchSurface = null;
    }
  }

  surface(display) {
    const existing = this.surfaces.get(display.id);
    if (existing) return existing;
    const surface = createSurface(display.workArea, this.root, this.developmentURL);
    this.surfaces.set(display.id, surface);
    const failed = error => {
      if (this.surfaces.get(display.id) !== surface) return;
      console.warn('Unable to draw the desktop pet:', error.message);
      const wasCompanion = this.state.phase === 'companion';
      this.end();
      if (wasCompanion) this.onCompanionFailure?.();
    };
    surface.loading.then(() => {
      surface.ready = true;
      if (this.trip) this.trip.idleCursor = null;
    }, error => {
      // The launching caller owns initial-load errors; a failed prewarm must be retriable.
      if (!this.trip || this.trip.ready) failed(error);
      else if (this.surfaces.get(display.id) === surface) {
        this.surfaces.delete(display.id);
        if (!surface.win.isDestroyed()) surface.win.destroy();
      }
    });
    const contents = surface.win.webContents;
    const fromLaunchSurface = event => {
      if (this.trip?.launchSurface !== surface || !surface.shown || contents.isDestroyed()) return false;
      const mainFrame = contents.mainFrame;
      return event.processId === mainFrame.processId && event.frameId === mainFrame.routingId;
    };
    contents.ipc.on('niuma:desktop-pet-surface-ready', event => {
      if (fromLaunchSurface(event)) this.trip.confirmPrepared?.();
    });
    contents.ipc.on('niuma:desktop-pet-first-paint', event => {
      if (fromLaunchSurface(event)) this.trip.confirmFirstFrame?.();
    });
    contents.ipc.on('niuma:desktop-pet-restore-target', (event, rect) => this.setRestoreTarget(event, surface, rect));
    contents.ipc.on('niuma:desktop-pet-gesture', (event, phase, point) => this.companionGesture(event, surface, phase, point));
    contents.ipc.on('niuma:desktop-pet-restore-widget', event => {
      if (!this.holdsCompanion(event, surface) || this.restoring) return;
      this.restoring = true;
      void Promise.resolve().then(() => this.restoreWidget?.()).catch(error => {
        console.warn('Unable to restore the salary widget:', error.message);
      }).finally(() => { this.restoring = false; });
    });
    contents.ipc.on('niuma:desktop-pet-motion-preference', (event, reduced) => {
      const frame = contents.mainFrame;
      if (typeof reduced !== 'boolean' || event.processId !== frame.processId || event.frameId !== frame.routingId) return;
      surface.reduced = reduced;
      if (this.trip) this.trip.reduced = reduced;
    });
    contents.on('render-process-gone', (_event, details) => failed(new Error(details.reason)));
    surface.win.on('closed', () => failed(new Error('桌面绘制窗口已关闭')));
    return surface;
  }

  displaysChanged() {
    if (!this.trip && !this.surfaces.size) return;
    if (this.trip) this.trip.idleCursor = null;
    this.displays = screen.getAllDisplays();
    for (const [id, surface] of this.surfaces) {
      const display = this.displays.find(d => d.id === id);
      if (display) {
        surface.win.setBounds(display.workArea);
        surface.lastFrame = '';
      } else {
        this.surfaces.delete(id);
        if (this.trip?.press?.surface === surface) this.trip.press = null;
        surface.win.destroy();
        if (this.trip?.launchSurface === surface) this.end();
      }
    }
  }

  tick(cursor) {
    const trip = this.trip;
    if (!trip?.ready) return;
    if (trip.suspended) return;
    if (this.state.phase === 'companion') {
      try { this.tickCompanion(cursor); } catch (error) {
        console.warn('Unable to animate the companion:', error.message);
        this.end();
        this.onCompanionFailure?.();
      }
      return;
    }
    if (trip.idleCursor?.x === cursor.x && trip.idleCursor.y === cursor.y) {
      this.syncPetMouseRegion(cursor);
      return;
    }
    // Time spent standing beside the bone cannot count towards her first new stride.
    if (trip.idleCursor) trip.lastTime = performance.now();
    trip.idleCursor = null;
    try {
      const widget = this.getWidget();
      if (!widget || widget.isDestroyed()) { this.end(); return; }
      const home = this.home(widget, trip);
      const returning = this.state.phase === 'returning';
      const area = screen.getDisplayNearestPoint(cursor).workArea;
      const bone = returning ? null : placeChaseBone(cursor, area, home.size);
      const target = bone?.target ?? home;
      const now = performance.now();
      const pet = stepDesktopPetMotion(trip.pet, target, now - trip.lastTime, { returning, reducedMotion: trip.reduced });
      trip.lastTime = now;
      // Skip physical gaps in staggered monitor arrangements. Never clamp a
      // legitimate halfway position back onto the monitor where the run began.
      const position = acrossDesktopGap(pet, target, this.displays.map(display => display.bounds));
      trip.pet = { ...pet, x: position.x, y: position.y };
      if (returning && pet.arrived) { this.end({ dockX: home.cssX, facing: pet.facing }); return; }
      this.paint(trip.pet, home.size, bone?.position ?? null);
      this.syncPetMouseRegion(cursor);
      if (!returning && pet.arrived) trip.idleCursor = cursor;
    } catch (error) {
      console.warn('Unable to animate the desktop pet:', error.message);
      this.end();
    }
  }

  paint(pet, size, bone, handoffSurface = null) {
    if (this.trip) this.trip.size = size;
    const left = pet.x - size / 2, top = pet.y - size / 2;
    const sampleTime = performance.now();
    for (const display of this.displays) {
      const area = display.workArea;
      // Keep the capturing renderer alive, with its button drawn outside the
      // viewport, until it receives pointerup on a cross-display drag.
      const dogHere = intersects(area, left, top, size) ||
        (this.trip?.press && this.trip.press.surface === this.surfaces.get(display.id));
      const boneHere = bone && intersects(area, bone.x, bone.y, BONE_SIZE);
      if (!dogHere && !boneHere) {
        const idle = this.surfaces.get(display.id);
        if (idle) hideSurface(idle);
        continue;
      }
      const surface = this.surface(display);
      if (!surface.ready) continue;
      const { win } = surface;
      const bounds = win.getContentBounds();
      const frame = {
        dog: dogHere ? { x: left - bounds.x, y: top - bounds.y, size, facing: pet.facing, pose: pet.pose, frame: pet.frame,
          vx: pet.vx, vy: pet.vy, interactive: this.state.phase === 'companion',
          feedable: false, reducedMotion: Boolean(this.trip?.reduced) } : null,
        bone: boneHere ? { x: bone.x - bounds.x, y: bone.y - bounds.y } : null,
        feeding: null,
        menuOpen: false,
        ...(surface === handoffSurface ? { handoff: true } : {}),
      };
      if (surface.nativeCompanionShape) {
        // Windows must know the input region before the pointer enters it.
        // During a press the original window keeps capture even on a fast drag.
        const rects = [];
        if (frame.dog?.interactive && this.trip.press?.surface !== surface) {
          const dog = frame.dog;
          // Leave room for the compositor's small interpolation between samples.
          rects.push(enclosingRect(dog.x - 2, dog.y - 2, size + 4, size + 4));
          const anchor = this.trip.restoreTarget;
          if (anchor?.surface === surface && anchor.until > sampleTime) {
            rects.push(enclosingRect(anchor.x - bounds.x, anchor.y - bounds.y, anchor.width, anchor.height));
          }
        }
        setCompanionShape(surface, rects);
      }
      const key = JSON.stringify(frame);
      if (key !== surface.lastFrame) {
        win.webContents.send('niuma:desktop-pet-frame', { ...frame, sampleTime });
        surface.lastFrame = key;
      }
      if (!surface.shown) { win.showInactive(); surface.shown = true; }
    }
  }
}
