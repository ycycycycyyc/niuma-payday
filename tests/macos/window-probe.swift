import Cocoa
import CoreGraphics

// This ordinary, separate application can receive clicks through or in front of
// the tested widget. Its input count and native window ID are exposed to the test only.
final class Receiver: NSView {
    let output: URL
    var clicks = 0

    init(frame: NSRect, output: URL) {
        self.output = output
        super.init(frame: frame)
    }

    required init?(coder: NSCoder) { fatalError() }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    func report() {
        let state = ["window": window!.windowNumber, "clicks": clicks]
        try! JSONSerialization.data(withJSONObject: state).write(to: output, options: .atomic)
    }

    override func mouseDown(with event: NSEvent) {
        clicks += 1
        report()
    }
}

let args = CommandLine.arguments
if args[1] == "cover" {
    let app = NSApplication.shared
    app.setActivationPolicy(.regular)
    app.finishLaunching()
    let x = Double(args[2])!, y = Double(args[3])!, w = Double(args[4])!, h = Double(args[5])!
    let rect = NSRect(x: x, y: NSScreen.screens[0].frame.maxY - y - h, width: w, height: h)
    let window = NSWindow(contentRect: rect, styleMask: [.titled], backing: .buffered, defer: false)
    window.title = "Input test receiver"
    window.isReleasedWhenClosed = false
    let receiver = Receiver(frame: NSRect(origin: .zero, size: rect.size), output: URL(fileURLWithPath: args[6]))
    window.contentView = receiver
    window.makeKeyAndOrderFront(nil)
    app.activate(ignoringOtherApps: true)
    receiver.report()
    app.run()
} else {
    let ids = [Int(args[2])!, Int(args[3])!]
    let windows = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as? [[String: Any]] ?? []
    let found = windows.enumerated().compactMap { (index, properties) -> [String: Int]? in
        guard let id = properties[kCGWindowNumber as String] as? Int, ids.contains(id),
              let level = properties[kCGWindowLayer as String] as? Int else { return nil }
        return ["id": id, "level": level, "order": index]
    }
    print(String(data: try JSONSerialization.data(withJSONObject: found), encoding: .utf8)!)
}
