using System;
using System.Diagnostics;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

// Runs only on a GitHub-hosted Windows VM. The receiver is a normal, independent
// application, so a successful click proves which native window got the input.
class WidgetInput {
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out Point p);
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point p);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr window, uint flag);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint count, Input[] inputs, int size);
    [StructLayout(LayoutKind.Sequential)] struct Mouse {
        public int x, y; public uint data, flags, time; public UIntPtr extra;
    }
    [StructLayout(LayoutKind.Sequential)] struct Keyboard {
        public ushort key, scan; public uint flags, time; public UIntPtr extra;
    }
    [StructLayout(LayoutKind.Explicit)] struct InputData {
        [FieldOffset(0)] public Mouse mouse;
        [FieldOffset(0)] public Keyboard keyboard;
    }
    [StructLayout(LayoutKind.Sequential)] struct Input { public uint type; public InputData data; }

    static void Send(params Input[] events) {
        if (SendInput((uint)events.Length, events, Marshal.SizeOf(typeof(Input))) != events.Length)
            throw new InvalidOperationException("SendInput failed: " + Marshal.GetLastWin32Error());
    }
    static Input Button(uint flags) {
        return new Input { data = new InputData { mouse = new Mouse { flags = flags } } };
    }
    static void Move(int x, int y) {
        Point actual;
        if (!SetCursorPos(x, y) || !GetCursorPos(out actual) || actual.X != x || actual.Y != y)
            throw new InvalidOperationException("System pointer unavailable at " + x + "," + y);
    }
    static long Hit(Point p) { return GetAncestor(WindowFromPoint(p), 2).ToInt64(); }

    [STAThread]
    static void Main(string[] args) {
        if (Environment.GetEnvironmentVariable("GITHUB_ACTIONS") != "true" ||
            Environment.GetEnvironmentVariable("RUNNER_ENVIRONMENT") != "github-hosted" ||
            Environment.GetEnvironmentVariable("NIUMA_WINDOWS_NATIVE_INPUT") != "1" ||
            Process.GetCurrentProcess().SessionId == 0 || !Environment.UserInteractive)
            throw new InvalidOperationException("This probe requires an isolated, interactive GitHub-hosted Windows runner.");
        if (SetThreadDpiAwarenessContext(new IntPtr(-4)) == IntPtr.Zero)
            throw new InvalidOperationException("Could not enter the per-monitor DPI context.");
        string action = args[0];
        if (action == "escape") {
            Input key = new Input { type = 1, data = new InputData { keyboard = new Keyboard { key = 27 } } };
            Input up = key; up.data.keyboard.flags = 2; Send(key, up);
            return;
        }
        int x = int.Parse(args[1]), y = int.Parse(args[2]);
        if (action == "cover") {
            using (Form receiver = new Form()) {
                receiver.Text = "Niuma native input receiver";
                receiver.AutoScaleMode = AutoScaleMode.None;
                receiver.FormBorderStyle = FormBorderStyle.None;
                receiver.StartPosition = FormStartPosition.Manual;
                receiver.Bounds = new Rectangle(x, y, int.Parse(args[3]), int.Parse(args[4]));
                receiver.Shown += delegate {
                    // The runner hides the helper console using STARTUPINFO.
                    // Show the form explicitly after its first ShowWindow call.
                    ShowWindow(receiver.Handle, 5);
                    Console.WriteLine("READY " + receiver.Handle.ToInt64());
                };
                receiver.MouseDown += delegate { Console.WriteLine("CLICK"); };
                Application.Run(receiver);
            }
            return;
        }
        Point point = new Point(x, y);
        if (action == "hit") { Console.WriteLine(Hit(point)); return; }
        Move(x, y);
        if (action == "move") return;
        long expected = long.Parse(args[3]);
        // Crossing from the transparent lane into the dog or card is sampled by
        // the application. Never deliver a button press to an unidentified window.
        long hit = 0;
        for (int attempt = 0; attempt < 45; attempt++) {
            hit = Hit(point);
            if (hit == expected) break;
            Thread.Sleep(20);
        }
        if (hit != expected) throw new InvalidOperationException("Native hit " + hit + " at " + point + ", expected " + expected);
        if (action == "click") {
            Send(Button(2), Button(4));
        } else if (action == "drag") {
            Send(Button(2));
            try {
                for (int i = 1; i <= 12; i++) { Thread.Sleep(28); Move(x - 5 * i, y - 3 * i); }
            } finally { Send(Button(4)); }
        } else throw new ArgumentException("Unknown action: " + action);
    }
}
