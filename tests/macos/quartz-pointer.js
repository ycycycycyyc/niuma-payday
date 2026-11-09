// Run only through /usr/bin/osascript -l JavaScript in a dedicated Mac test session.
// These events are dispatched by WindowServer, just like input on the physical desktop.
ObjC.import('CoreGraphics');
ObjC.import('Foundation');

function run(args) {
  if (typeof $.CGPreflightPostEventAccess === 'function' && !$.CGPreflightPostEventAccess()) {
    throw new Error('WindowServer mouse testing requires PostEvent access for osascript');
  }
  const action = args[0];
  const immediate = /-now$/.test(action);
  const fromTarget = /-target-/.test(action);
  let target;
  if (fromTarget) {
    const raw = $.NSString.stringWithContentsOfFileEncodingError(args[1], 4, null);
    target = JSON.parse(ObjC.unwrap(raw));
    if (Date.now() - target.capturedAt > 1000) throw new Error('The observed pet target is stale');
  }
  let point = target ? { x: target.x, y: target.y } : { x: Number(args[1]), y: Number(args[2]) };
  const source = $.CGEventSourceCreate(1); // kCGEventSourceStateHIDSystemState
  function post(type, clickCount) {
    const event = $.CGEventCreateMouseEvent(source, type, point, 0);
    if (clickCount) $.CGEventSetIntegerValueField(event, 1, clickCount); // kCGMouseEventClickState
    $.CGEventPost(0, event); // kCGHIDEventTap
  }
  if (action === 'escape') {
    $.CGEventPost(0, $.CGEventCreateKeyboardEvent(source, 53, true));
    $.CGEventPost(0, $.CGEventCreateKeyboardEvent(source, 53, false));
    return;
  }
  if (![point.x, point.y].every(Number.isFinite)) throw new Error('Expected a finite desktop point');
  const startPoint = { x: point.x, y: point.y };
  post(5); // kCGEventMouseMoved
  if (/^(?:click|double-click|drag)(?:-target)?(?:-now)?$/.test(action)) {
    // Regression mode intentionally posts move and down back-to-back. Waiting
    // for the application's 24ms cursor sample would hide a lost first press.
    if (!immediate) $.NSThread.sleepForTimeInterval(0.08);
    post(1, 1); // kCGEventLeftMouseDown
    if (/^drag/.test(action)) {
      const start = point;
      const destination = target?.destination ?? { x: start.x - 40, y: start.y - 32 };
      for (let step = 1; step <= 8; step++) {
        point = { x: start.x + (destination.x - start.x) * step / 8,
          y: start.y + (destination.y - start.y) * step / 8 };
        $.NSThread.sleepForTimeInterval(0.02);
        post(6); // kCGEventLeftMouseDragged
      }
    }
    $.NSThread.sleepForTimeInterval(0.03);
    post(2, 1); // kCGEventLeftMouseUp
    if (/^double-click/.test(action)) {
      $.NSThread.sleepForTimeInterval(0.055);
      post(1, 2);
      $.NSThread.sleepForTimeInterval(0.025);
      post(2, 2);
    }
  }
  return JSON.stringify({ action, start: startPoint, end: point, moveToDownWaitMs: immediate ? 0 : 80,
    clickCount: /^double-click/.test(action) ? 2 : /^click|^drag/.test(action) ? 1 : 0 });
}
