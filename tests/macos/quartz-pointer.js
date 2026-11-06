// Run only through /usr/bin/osascript -l JavaScript in a dedicated Mac test session.
// These events are dispatched by WindowServer, just like input on the physical desktop.
ObjC.import('CoreGraphics');
ObjC.import('Foundation');

function run(args) {
  if (typeof $.CGPreflightPostEventAccess === 'function' && !$.CGPreflightPostEventAccess()) {
    throw new Error('WindowServer mouse testing requires PostEvent access for osascript');
  }
  const action = args[0];
  let point = { x: Number(args[1]), y: Number(args[2]) };
  const source = $.CGEventSourceCreate(1); // kCGEventSourceStateHIDSystemState
  function post(type) {
    const event = $.CGEventCreateMouseEvent(source, type, point, 0);
    $.CGEventPost(0, event); // kCGHIDEventTap
  }
  if (action === 'escape') {
    $.CGEventPost(0, $.CGEventCreateKeyboardEvent(source, 53, true));
    $.CGEventPost(0, $.CGEventCreateKeyboardEvent(source, 53, false));
    return;
  }
  post(5); // kCGEventMouseMoved
  if (action === 'click' || action === 'drag') {
    $.NSThread.sleepForTimeInterval(0.08);
    post(1); // kCGEventLeftMouseDown
    if (action === 'drag') {
      const start = point;
      for (let step = 1; step <= 8; step++) {
        point = { x: start.x - step * 5, y: start.y - step * 4 };
        $.NSThread.sleepForTimeInterval(0.02);
        post(6); // kCGEventLeftMouseDragged
      }
    }
    $.NSThread.sleepForTimeInterval(0.03);
    post(2); // kCGEventLeftMouseUp
  }
}
