using System;
using System.Diagnostics;
using System.Drawing;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Automation;
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
    delegate bool EachWindow(IntPtr hwnd, IntPtr unused);
    [DllImport("user32.dll")] static extern bool EnumWindows(EachWindow callback, IntPtr unused);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder buffer, int size);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool AllowSetForegroundWindow(uint pid);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr hwnd, uint msg, IntPtr w, IntPtr l);
    [DllImport("shell32.dll")] static extern int Shell_NotifyIconGetRect(ref IconId id, out Rect rect);
    [StructLayout(LayoutKind.Sequential)] struct IconId {
        public uint size; public IntPtr hwnd; public uint id; public Guid guid;
    }
    [StructLayout(LayoutKind.Sequential)] struct Rect { public int left, top, right, bottom; }
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
    static uint ProcessOf(IntPtr hwnd) { uint pid; GetWindowThreadProcessId(hwnd, out pid); return pid; }
    static string ClassOf(IntPtr hwnd) { var buf = new StringBuilder(160); GetClassName(hwnd, buf, buf.Capacity); return buf.ToString(); }
    static List<IntPtr> WindowsOf(uint pid) {
        var windows = new List<IntPtr>();
        EnumWindows(delegate(IntPtr hwnd, IntPtr unused) {
            if (ProcessOf(hwnd) == pid) windows.Add(hwnd);
            return true;
        }, IntPtr.Zero);
        return windows;
    }
    // The ordinary covering application received the actual last mouse click.
    // It can grant foreground permission just as Explorer does for a tray menu.
    const uint GrantForeground = 0x8000 + 81;
    class Receiver : Form {
        protected override void WndProc(ref Message message) {
            if (message.Msg == GrantForeground) {
                message.Result = GetForegroundWindow() == Handle && AllowSetForegroundWindow((uint)message.WParam.ToInt64())
                    ? new IntPtr(1) : IntPtr.Zero;
                return;
            }
            base.WndProc(ref message);
        }
    }
    static void TrayClick(uint pid, IntPtr receiver) {
        IntPtr host = WindowsOf(pid).Find(w => ClassOf(w) == "Electron_NotifyIconHostWindow");
        if (host == IntPtr.Zero) throw new InvalidOperationException("Electron tray host HWND missing for pid " + pid);
        // Electron 45.2.3 notify_icon_host.{cc,h}: kBaseIconId=2 plus the first
        // next_icon_id_=1, and the shell callback message is WM_APP+1.
        IconId id = new IconId { size = (uint)Marshal.SizeOf(typeof(IconId)), hwnd = host, id = 3 };
        Rect icon;
        int shellResult = Shell_NotifyIconGetRect(ref id, out icon);
        string route = "shell notification to the registered tray host";
        bool opened = false;
        if (shellResult == 0 && icon.right > icon.left && icon.bottom > icon.top) {
            var p = new System.Windows.Point((icon.left + icon.right) / 2, (icon.top + icon.bottom) / 2);
            // Hidden icons can be reported at the overflow chevron instead.
            var element = AutomationElement.FromPoint(p);
            if (element != null && element.Current.Name.IndexOf("\u85aa\u52a8", StringComparison.Ordinal) >= 0) {
                Move((int)p.X, (int)p.Y);
                Send(Button(8), Button(16));
                route = "physical right-click on the visible notification icon";
                opened = true;
            }
        }
        if (!opened) {
            if (SendMessage(receiver, GrantForeground, new IntPtr(pid), IntPtr.Zero) == IntPtr.Zero)
                throw new InvalidOperationException("Cover could not grant the tray foreground rights, current foreground=" + GetForegroundWindow());
            if (!PostMessage(host, 0x8001, new IntPtr(id.id), new IntPtr(0x0204)))
                throw new InvalidOperationException("Could not send the shell's right-button notification to " + host);
        }
        string label = "\u5c06\u6d6e\u7a97\u7f6e\u9876";
        var itemCondition = new AndCondition(
            new PropertyCondition(AutomationElement.NameProperty, label),
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.MenuItem));
        var details = new HashSet<string>();
        var listedWindows = new HashSet<IntPtr>();
        var timer = Stopwatch.StartNew();
        while (timer.ElapsedMilliseconds < 7000) {
            foreach (var hwnd in WindowsOf(pid)) {
                if (!IsWindowVisible(hwnd)) continue;
                string cls = ClassOf(hwnd);
                details.Add(cls);
                try {
                    var tree = AutomationElement.FromHandle(hwnd);
                    var item = tree.FindFirst(TreeScope.Subtree, itemCondition);
                    if (item == null && listedWindows.Add(hwnd)) {
                        var menuItems = tree.FindAll(TreeScope.Subtree, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.MenuItem));
                        foreach (AutomationElement other in menuItems) details.Add("menu=" + other.Current.Name);
                    }
                    if (item == null || !item.Current.IsEnabled || item.Current.IsOffscreen) continue;
                    var bounds = item.Current.BoundingRectangle;
                    if (bounds.IsEmpty || bounds.Width < 3 || bounds.Height < 3) continue;
                    var center = new Point((int)(bounds.X + bounds.Width / 2), (int)(bounds.Y + bounds.Height / 2));
                    Move(center.X, center.Y);
                    var hit = AutomationElement.FromPoint(new System.Windows.Point(center.X, center.Y));
                    // UIA can return the item itself or the text inside it.
                    if (ProcessOf(WindowFromPoint(center)) != pid) continue;
                    int depth = 0;
                    while (hit != null && hit.Current.Name != label && ++depth <= 4)
                        hit = TreeWalker.ControlViewWalker.GetParent(hit);
                    if (hit == null || hit.Current.Name != label) continue;
                    Send(Button(2), Button(4));
                    Console.WriteLine(route + "; real click on the UI Automation-identified pin menu item");
                    return;
                } catch (ElementNotAvailableException) { /* Menu opening or closing between queries. */ }
            }
            Thread.Sleep(120);
        }
        throw new InvalidOperationException("Pin menu item unavailable; route=" + route + ", shell HRESULT=" + shellResult +
            ", foreground=" + GetForegroundWindow() + ", owned visible HWND classes=" + string.Join(",", details));
    }

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
        if (action == "tray") { TrayClick(uint.Parse(args[1]), new IntPtr(long.Parse(args[2]))); return; }
        if (action == "show-cover" || action == "hide-cover") {
            var hwnd = new IntPtr(long.Parse(args[1]));
            if (ProcessOf(hwnd) != uint.Parse(args[2])) throw new InvalidOperationException("Wrong cover process");
            ShowWindow(hwnd, action == "show-cover" ? 4 : 0);
            return;
        }
        if (action == "escape") {
            Input key = new Input { type = 1, data = new InputData { keyboard = new Keyboard { key = 27 } } };
            Input up = key; up.data.keyboard.flags = 2; Send(key, up);
            return;
        }
        int x = int.Parse(args[1]), y = int.Parse(args[2]);
        if (action == "cover") {
            using (Form receiver = new Receiver()) {
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
