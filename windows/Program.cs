// Keystone for Windows — native host.
//
// A normal Windows window (title bar, taskbar icon, native file dialogs, native clipboard) that hosts the
// Keystone interface inside Microsoft's WebView2 control. The interface (Keystone.html) and the WebView2
// helper DLLs are embedded in this single exe. The page cannot reach the network (its Content-Security-Policy
// forbids it and the host only serves the embedded page); everything it needs from the outside world goes
// through the small message bridge below — see docs/host-bridge.md.
//
// Written for the C# 5 compiler that ships with Windows (no extra tools needed to build).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Win32;

[assembly: AssemblyTitle("Keystone")]
[assembly: AssemblyProduct("Keystone")]
[assembly: AssemblyDescription("A simple, modern password vault that opens KeePass (.kdbx) databases")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

namespace Keystone
{
    static class Native
    {
        public static readonly uint WM_SHOWME = RegisterWindowMessage("Keystone.ShowMe.v1");
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern uint RegisterWindowMessage(string name);
        [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr w, IntPtr l);
        [DllImport("user32.dll")] public static extern bool SetWindowDisplayAffinity(IntPtr hWnd, uint affinity);
        [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr hWnd, int attr, ref int value, int size);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern IntPtr LoadLibrary(string path);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern bool GetVolumeInformation(string root, StringBuilder volName, int volNameSize, out uint serial, out uint maxComponent, out uint flags, StringBuilder fsName, int fsNameSize);
    }

    class DriveRef { public string Root, Label, Serial; public bool Removable, IsSystem; }

    // Finds databases on connected drives (USB sticks first) and recognises a drive again by its volume serial number,
    // so the database is found no matter which drive letter Windows hands out.
    static class Drives
    {
        static readonly string[] SkipDirs = { "$RECYCLE.BIN", "System Volume Information", "RECYCLER" };
        static readonly Regex Likely = new Regex("keepass|keystone|vault|password|secret|keys?$", RegexOptions.IgnoreCase);

        public static string VolumeSerial(string root)
        {
            StringBuilder lbl = new StringBuilder(261), fs = new StringBuilder(261);
            uint serial, maxc, flags;
            return Native.GetVolumeInformation(root, lbl, 261, out serial, out maxc, out flags, fs, 261) ? serial.ToString("X8") : "";
        }

        // KEYSTONE_FAKE_DRIVES="SERIAL|Label|C:\folder;SERIAL2|Label2|C:\folder2" stands in for real USB drives (used by the tests).
        public static List<DriveRef> Enumerate()
        {
            List<DriveRef> list = new List<DriveRef>();
            string fake = Environment.GetEnvironmentVariable("KEYSTONE_FAKE_DRIVES");
            if (!string.IsNullOrEmpty(fake))
            {
                foreach (string part in fake.Split(';'))
                {
                    string[] f = part.Split('|');
                    if (f.Length == 3 && Directory.Exists(f[2]))
                        list.Add(new DriveRef { Root = f[2].TrimEnd('\\') + "\\", Serial = f[0], Label = f[1], Removable = true });
                }
                return list;
            }
            string sys = Path.GetPathRoot(Environment.SystemDirectory);
            foreach (DriveInfo d in DriveInfo.GetDrives())
            {
                try
                {
                    if (d.DriveType != DriveType.Removable && d.DriveType != DriveType.Fixed) continue;
                    if (!d.IsReady) continue;
                    string root = d.RootDirectory.FullName;
                    list.Add(new DriveRef { Root = root, Label = d.VolumeLabel, Serial = VolumeSerial(root), Removable = d.DriveType == DriveType.Removable, IsSystem = string.Equals(root, sys, StringComparison.OrdinalIgnoreCase) });
                }
                catch (Exception) { }
            }
            return list;
        }

        public static DriveRef Of(string path)
        {
            DriveRef best = null;
            foreach (DriveRef d in Enumerate())
                if (path.StartsWith(d.Root, StringComparison.OrdinalIgnoreCase) && (best == null || d.Root.Length > best.Root.Length)) best = d;
            if (best != null) return best;
            string root = Path.GetPathRoot(path);
            return new DriveRef { Root = root, Label = "", Serial = VolumeSerial(root), Removable = false, IsSystem = false };
        }

        public static Dictionary<string, object> Describe(DriveRef d, string path)
        {
            Dictionary<string, object> r = new Dictionary<string, object>();
            r["root"] = d.Root; r["drive"] = d.Root.TrimEnd('\\'); r["label"] = d.Label ?? ""; r["serial"] = d.Serial ?? "";
            r["removable"] = d.Removable; r["system"] = d.IsSystem;
            r["rel"] = path != null && path.StartsWith(d.Root, StringComparison.OrdinalIgnoreCase) ? path.Substring(d.Root.Length) : null;
            return r;
        }

        public static string FindKey(string dbPath, string root)
        {
            string dir = Path.GetDirectoryName(dbPath), bn = Path.GetFileNameWithoutExtension(dbPath);
            foreach (string ext in new[] { ".keyx", ".key" })
            {
                string p = Path.Combine(dir, bn + ext);
                if (File.Exists(p)) return p;
            }
            string[] here = KeysIn(dir);
            if (here.Length == 1) return here[0];
            if (root != null && !string.Equals(dir.TrimEnd('\\') + "\\", root, StringComparison.OrdinalIgnoreCase))
            {
                string[] top = KeysIn(root);
                if (top.Length == 1) return top[0];
            }
            return null;
        }
        static string[] KeysIn(string dir)
        {
            try
            {
                // (Windows treats the pattern "*.key" as also matching ".keyx", so filter by the exact extension)
                List<string> l = new List<string>();
                foreach (string f in Directory.GetFiles(dir))
                {
                    string ext = Path.GetExtension(f);
                    if ((string.Equals(ext, ".keyx", StringComparison.OrdinalIgnoreCase) || string.Equals(ext, ".key", StringComparison.OrdinalIgnoreCase))
                        && !Path.GetFileName(f).StartsWith(".", StringComparison.Ordinal)) l.Add(f);
                }
                return l.ToArray();
            }
            catch (Exception) { return new string[0]; }
        }

        // USB sticks: the drive root and every folder one level down. Other (internal / external fixed) drives: the root
        // and folders that look like they hold a password vault. The system drive is never scanned.
        public static List<object> Scan()
        {
            List<object> result = new List<object>();
            foreach (DriveRef d in Enumerate())
            {
                if (d.IsSystem) continue;
                List<string> dirs = new List<string>();
                dirs.Add(d.Root);
                try
                {
                    int n = 0;
                    foreach (string sub in Directory.GetDirectories(d.Root))
                    {
                        string nm = Path.GetFileName(sub);
                        if (Array.IndexOf(SkipDirs, nm) >= 0 || nm.StartsWith(".", StringComparison.Ordinal)) continue;
                        if (!d.Removable && !Likely.IsMatch(nm)) continue;
                        dirs.Add(sub);
                        if (++n >= 200) break;
                    }
                }
                catch (Exception) { }
                foreach (string dir in dirs)
                {
                    string[] dbs;
                    try { dbs = Directory.GetFiles(dir, "*.kdbx"); } catch (Exception) { continue; }
                    Array.Sort(dbs, StringComparer.OrdinalIgnoreCase);
                    foreach (string db in dbs)
                    {
                        string name = Path.GetFileName(db);
                        if (name.StartsWith(".", StringComparison.Ordinal) || name.IndexOf(" (backup ", StringComparison.OrdinalIgnoreCase) >= 0) continue;   // Keystone's own backups
                        Dictionary<string, object> c = Describe(d, db);
                        FileInfo fi = new FileInfo(db);
                        c["dbPath"] = db; c["name"] = name; c["size"] = fi.Length;
                        string key = FindKey(db, d.Root);
                        c["keyPath"] = key; c["keyName"] = key == null ? null : Path.GetFileName(key);
                        c["keyRel"] = key != null && key.StartsWith(d.Root, StringComparison.OrdinalIgnoreCase) ? key.Substring(d.Root.Length) : null;
                        result.Add(c);
                        if (result.Count >= 24) return result;
                    }
                }
            }
            return result;
        }

        // Where is the remembered database now? Same path if it is still the same drive, otherwise look for the drive by its serial number.
        public static Dictionary<string, object> Resolve(string dbPath, string dbRel, string vol, string keyPath, string keyRel, string keyVol)
        {
            Dictionary<string, object> r = new Dictionary<string, object>();
            r["found"] = false;
            string db = null; DriveRef where = null;
            if (!string.IsNullOrEmpty(dbPath) && File.Exists(dbPath))
            {
                DriveRef d = Of(dbPath);
                if (string.IsNullOrEmpty(vol) || d.Serial == vol) { db = dbPath; where = d; }
            }
            if (db == null && !string.IsNullOrEmpty(vol) && !string.IsNullOrEmpty(dbRel))
            {
                foreach (DriveRef d in Enumerate())
                {
                    if (d.Serial != vol) continue;
                    string cand = Path.Combine(d.Root, dbRel);
                    if (File.Exists(cand)) { db = cand; where = d; break; }
                }
            }
            if (db == null) return r;
            string key = null;
            if (!string.IsNullOrEmpty(keyPath))
            {
                if (!string.IsNullOrEmpty(keyRel) && keyVol == vol) { string kc = Path.Combine(where.Root, keyRel); if (File.Exists(kc)) key = kc; }
                if (key == null && File.Exists(keyPath) && (string.IsNullOrEmpty(keyVol) || Of(keyPath).Serial == keyVol)) key = keyPath;
            }
            r["found"] = true; r["dbPath"] = db; r["keyPath"] = key; r["size"] = new FileInfo(db).Length;
            r["drive"] = where.Root.TrimEnd('\\'); r["label"] = where.Label ?? ""; r["removable"] = where.Removable; r["system"] = where.IsSystem;
            return r;
        }
    }

    static class Program
    {
        public static string DataDir
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Keystone"); }
        }

        public static byte[] ReadResource(string name)
        {
            using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream(name))
            {
                if (s == null) throw new FileNotFoundException("Missing embedded resource " + name);
                byte[] b = new byte[s.Length];
                int n = 0;
                while (n < b.Length) { int r = s.Read(b, n, b.Length - n); if (r <= 0) break; n += r; }
                return b;
            }
        }

        [STAThread]
        static int Main(string[] args)
        {
            AppDomain.CurrentDomain.AssemblyResolve += ResolveEmbedded;   // WebView2's managed DLLs live inside this exe
            return Start(args);
        }

        static Assembly ResolveEmbedded(object sender, ResolveEventArgs e)
        {
            string name = new AssemblyName(e.Name).Name;
            if (name == "Microsoft.Web.WebView2.Core" || name == "Microsoft.Web.WebView2.WinForms")
                return Assembly.Load(ReadResource(name + ".dll"));
            return null;
        }

        // The native WebView2 loader must be a real file; extract it (verified by hash every run) and load it by full path.
        static void PreloadLoader()
        {
            string arch = RuntimeInformation.ProcessArchitecture == Architecture.Arm64 ? "arm64" : (IntPtr.Size == 8 ? "x64" : "x86");
            byte[] data = ReadResource("WebView2Loader." + arch + ".dll");
            string dir = Path.Combine(DataDir, "bin", arch);
            Directory.CreateDirectory(dir);
            string path = Path.Combine(dir, "WebView2Loader.dll");
            using (SHA256 sha = SHA256.Create())
            {
                bool ok = false;
                try { ok = File.Exists(path) && Convert.ToBase64String(sha.ComputeHash(File.ReadAllBytes(path))) == Convert.ToBase64String(sha.ComputeHash(data)); } catch (IOException) { }
                if (!ok) File.WriteAllBytes(path, data);
            }
            if (Native.LoadLibrary(path) == IntPtr.Zero) throw new DllNotFoundException("Could not load WebView2Loader.dll");
        }

        [MethodImpl(MethodImplOptions.NoInlining)]
        static int Start(string[] args)
        {
            bool created;
            using (Mutex mutex = new Mutex(true, @"Local\Keystone.SingleInstance.v1", out created))
            {
                if (!created)
                {
                    if (args.Length > 0)
                    {
                        try { Directory.CreateDirectory(DataDir); File.AppendAllText(Path.Combine(DataDir, "open-request.txt"), string.Join("\n", args) + "\n"); } catch (Exception) { }
                    }
                    Native.PostMessage((IntPtr)0xFFFF, Native.WM_SHOWME, IntPtr.Zero, IntPtr.Zero);   // wake the running instance
                    return 0;
                }
                try { PreloadLoader(); }
                catch (Exception ex) { MessageBox.Show("Keystone could not start.\n\n" + ex.Message, "Keystone", MessageBoxButtons.OK, MessageBoxIcon.Error); return 1; }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new MainForm(args));
            }
            return 0;
        }
    }

    class MainForm : Form
    {
        const string Origin = "https://keystone.app";
        static readonly DateTime Epoch = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        const string Csp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; worker-src blob:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; frame-ancestors 'none'; object-src 'none'";

        readonly string[] args;
        readonly JavaScriptSerializer json = new JavaScriptSerializer();
        readonly bool debug = !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("KEYSTONE_DEBUG_PORT"));
        readonly bool allowCapture = Environment.GetEnvironmentVariable("KEYSTONE_ALLOW_CAPTURE") == "1";
        WebView2 web;
        CoreWebView2Environment env;
        bool jsReady, forceClose, closePending, dark, capture;
        string lastClip;
        readonly System.Windows.Forms.Timer clipTimer = new System.Windows.Forms.Timer();
        Dictionary<string, object> state = new Dictionary<string, object>();   // window placement + last folders
        string StatePath { get { return Path.Combine(Program.DataDir, "window.json"); } }

        public MainForm(string[] args)
        {
            this.args = args;
            json.MaxJsonLength = int.MaxValue;
            Text = "Keystone";
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch (Exception) { }
            dark = SystemPrefersDark();
            BackColor = dark ? Color.FromArgb(18, 18, 17) : Color.FromArgb(241, 239, 234);
            MinimumSize = new Size(900, 620);
            Size = new Size(1280, 840);
            StartPosition = FormStartPosition.CenterScreen;
            LoadState();
            web = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = BackColor };
            Controls.Add(web);
            clipTimer.Tick += delegate { clipTimer.Stop(); ClearClipboardIfOurs(); };
            Shown += delegate { InitWeb(); };
            SystemEvents.SessionSwitch += OnSessionSwitch;
        }

        // ------------------------------------------------------------------ startup
        async void InitWeb()
        {
            try
            {
                string extra = "--disable-background-networking --disable-component-update --disable-default-apps --disable-sync --disable-features=Translate";
                string port = Environment.GetEnvironmentVariable("KEYSTONE_DEBUG_PORT");
                if (!string.IsNullOrEmpty(port)) extra += " --remote-debugging-port=" + port;
                CoreWebView2EnvironmentOptions opts = new CoreWebView2EnvironmentOptions(extra);
                env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(Program.DataDir, "WebView2"), opts);
                await web.EnsureCoreWebView2Async(env);
            }
            catch (Exception ex)
            {
                if (ex.GetType().Name == "WebView2RuntimeNotFoundException")
                {
                    if (MessageBox.Show("Keystone needs the Microsoft Edge WebView2 Runtime, which isn't installed on this PC.\n\nOpen the Microsoft download page now?", "Keystone", MessageBoxButtons.YesNo, MessageBoxIcon.Information) == DialogResult.Yes)
                        OpenExternal("https://go.microsoft.com/fwlink/p/?LinkId=2124703");
                }
                else MessageBox.Show("Keystone could not start its window.\n\n" + ex.Message, "Keystone", MessageBoxButtons.OK, MessageBoxIcon.Error);
                forceClose = true; Close(); return;
            }
            CoreWebView2 core = web.CoreWebView2;
            CoreWebView2Settings s = core.Settings;
            s.AreDevToolsEnabled = debug;
            s.AreBrowserAcceleratorKeysEnabled = debug;
            s.IsStatusBarEnabled = false;
            s.IsZoomControlEnabled = false;
            s.IsPasswordAutosaveEnabled = false;
            s.IsGeneralAutofillEnabled = false;
            s.IsSwipeNavigationEnabled = false;
            s.IsBuiltInErrorPageEnabled = false;
            s.AreDefaultScriptDialogsEnabled = false;

            core.AddWebResourceRequestedFilter(Origin + "/*", CoreWebView2WebResourceContext.All);
            core.WebResourceRequested += OnResourceRequested;
            core.WebMessageReceived += OnMessage;
            core.NavigationStarting += delegate (object o, CoreWebView2NavigationStartingEventArgs e) { if (!e.Uri.StartsWith(Origin + "/", StringComparison.Ordinal)) e.Cancel = true; };
            core.NewWindowRequested += delegate (object o, CoreWebView2NewWindowRequestedEventArgs e) { e.Handled = true; OpenExternal(e.Uri); };
            core.PermissionRequested += delegate (object o, CoreWebView2PermissionRequestedEventArgs e) { e.State = CoreWebView2PermissionState.Deny; };
            core.DownloadStarting += delegate (object o, CoreWebView2DownloadStartingEventArgs e) { e.Cancel = true; };
            core.ContextMenuRequested += OnContextMenu;
            core.DocumentTitleChanged += delegate (object o, object e) { string t = core.DocumentTitle; Text = string.IsNullOrEmpty(t) ? "Keystone" : t; };
            core.ProcessFailed += delegate (object o, CoreWebView2ProcessFailedEventArgs e) { if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited) { forceClose = true; Close(); } };

            ApplyTheme(dark);
            string hash = Environment.GetEnvironmentVariable("KEYSTONE_TEST") == "1" ? "#ks-test" : "";
            core.Navigate(Origin + "/index.html" + hash);
        }

        // ------------------------------------------------------------------ serving the embedded page
        void OnResourceRequested(object sender, CoreWebView2WebResourceRequestedEventArgs e)
        {
            Uri u = new Uri(e.Request.Uri);
            if (u.AbsolutePath == "/" || u.AbsolutePath == "/index.html")
            {
                byte[] html = Program.ReadResource("Keystone.html");
                e.Response = env.CreateWebResourceResponse(new MemoryStream(html), 200, "OK",
                    "Content-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: " + Csp);
            }
            else e.Response = env.CreateWebResourceResponse(null, 404, "Not Found", "Cache-Control: no-store");
        }

        // only Cut / Copy / Paste / Select all (no Back, Reload, Save as, Inspect ...)
        void OnContextMenu(object sender, CoreWebView2ContextMenuRequestedEventArgs e)
        {
            var items = e.MenuItems;
            for (int i = items.Count - 1; i >= 0; i--)
            {
                string n = items[i].Name;
                bool keep = n == "cut" || n == "copy" || n == "paste" || n == "selectAll" || n == "undo" || n == "redo";
                if (!keep) items.RemoveAt(i);
            }
            if (items.Count == 0) e.Handled = true;
        }

        // ------------------------------------------------------------------ the bridge
        async void OnMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            int id = 0;
            try
            {
                Dictionary<string, object> m = json.DeserializeObject(e.WebMessageAsJson) as Dictionary<string, object>;
                if (m == null) return;
                if (m.ContainsKey("id")) id = Convert.ToInt32(m["id"]);
                string cmd = Convert.ToString(m["cmd"]);
                if (cmd == "drop") { HandleDrop(e); return; }
                object result = await Dispatch(cmd, m);
                Reply(id, true, result, null, null);
            }
            catch (Exception ex)
            {
                if (id != 0) Reply(id, false, null, ex.Message, CodeOf(ex));
            }
        }

        static string CodeOf(Exception ex)
        {
            if (ex is FileNotFoundException || ex is DirectoryNotFoundException) return "FileNotFound";
            if (ex is UnauthorizedAccessException) return "Unauthorized";
            if (ex is IOException) return "IO";
            return "Error";
        }

        void Reply(int id, bool ok, object result, string error, string code)
        {
            Dictionary<string, object> r = new Dictionary<string, object>();
            r["id"] = id; r["ok"] = ok;
            if (ok) r["result"] = result; else { r["error"] = error; r["code"] = code; }
            Post(r);
        }
        void PostEvent(string name, object data)
        {
            Dictionary<string, object> r = new Dictionary<string, object>();
            r["event"] = name; r["data"] = data;
            Post(r);
        }
        void Post(object payload)
        {
            if (web != null && web.CoreWebView2 != null) web.CoreWebView2.PostWebMessageAsJson(json.Serialize(payload));
        }

        static string S(Dictionary<string, object> m, string key) { object v; return m.TryGetValue(key, out v) && v != null ? Convert.ToString(v) : null; }

        static string RequirePath(string p)
        {
            if (string.IsNullOrEmpty(p) || !Path.IsPathRooted(p)) throw new ArgumentException("Invalid path");
            return p;
        }
        static long MTime(string path) { return (long)(File.GetLastWriteTimeUtc(path) - Epoch).TotalMilliseconds; }
        static Dictionary<string, object> Info(string path)
        {
            FileInfo fi = new FileInfo(path);
            Dictionary<string, object> d = new Dictionary<string, object>();
            d["path"] = path; d["name"] = fi.Name; d["size"] = fi.Exists ? fi.Length : 0L; d["mtime"] = fi.Exists ? MTime(path) : 0L;
            return d;
        }

        async Task<object> Dispatch(string cmd, Dictionary<string, object> m)
        {
            switch (cmd)
            {
                case "ready": jsReady = true; FlushOpen(); return null;
                case "launchArgs": return args;
                case "openDialog": return ShowOpen(S(m, "kind"));
                case "saveDialog": return ShowSave(S(m, "kind"), S(m, "suggestedName"));
                case "readFile":
                    {
                        string path = RequirePath(S(m, "path"));
                        byte[] data = await Task.Run(() => File.ReadAllBytes(path));
                        Dictionary<string, object> d = new Dictionary<string, object>();
                        d["data"] = Convert.ToBase64String(data); d["size"] = (long)data.Length; d["mtime"] = MTime(path);
                        return d;
                    }
                case "statFile":
                    {
                        string path = RequirePath(S(m, "path"));
                        Dictionary<string, object> d = new Dictionary<string, object>();
                        bool ex = File.Exists(path);
                        d["exists"] = ex; d["size"] = ex ? new FileInfo(path).Length : 0L; d["mtime"] = ex ? MTime(path) : 0L;
                        return d;
                    }
                case "writeFile":
                    {
                        string path = RequirePath(S(m, "path"));
                        byte[] data = Convert.FromBase64String(S(m, "data"));
                        await Task.Run(() => AtomicWrite(path, data));
                        Dictionary<string, object> d = new Dictionary<string, object>();
                        d["size"] = (long)data.Length; d["mtime"] = MTime(path);
                        return d;
                    }
                case "findKey":
                    {
                        string path = RequirePath(S(m, "path"));
                        DriveRef d = Drives.Of(path);
                        return Drives.FindKey(path, d.Removable ? d.Root : null);
                    }
                case "scanDrives": return await Task.Run(() => Drives.Scan());
                case "volumeInfo":
                    {
                        string path = RequirePath(S(m, "path"));
                        return Drives.Describe(Drives.Of(path), path);
                    }
                case "resolveRecent":
                    {
                        string dbPath = S(m, "dbPath"), dbRel = S(m, "dbRel"), vol = S(m, "vol"), keyPath = S(m, "keyPath"), keyRel = S(m, "keyRel"), keyVol = S(m, "keyVol");
                        return await Task.Run(() => Drives.Resolve(dbPath, dbRel, vol, keyPath, keyRel, keyVol));
                    }
                case "pruneBackups": PruneBackups(RequirePath(S(m, "dir")), S(m, "prefix"), Convert.ToInt32(m["keep"])); return null;
                case "clipboardCopy": ClipboardCopy(S(m, "text"), Convert.ToInt32(m["clearMs"])); return null;
                case "clipboardClear": ClearClipboardIfOurs(); return null;
                case "openUrl": OpenExternal(S(m, "url")); return null;
                case "theme": ApplyTheme(Convert.ToBoolean(m["dark"])); return null;
                case "captureProtection": SetCapture(Convert.ToBoolean(m["on"])); return null;
                case "dirty": return null;     // (the page title already carries the unsaved marker)
                case "quit": forceClose = true; Close(); return null;
                case "closeCancelled": closePending = false; return null;
                default: throw new ArgumentException("Unknown command: " + cmd);
            }
        }

        void HandleDrop(CoreWebView2WebMessageReceivedEventArgs e)
        {
            List<object> list = new List<object>();
            if (e.AdditionalObjects != null)
            {
                foreach (object o in e.AdditionalObjects)
                {
                    CoreWebView2File f = o as CoreWebView2File;
                    if (f != null && File.Exists(f.Path)) list.Add(Info(f.Path));
                }
            }
            if (list.Count > 0) PostEvent("dropped", list);
        }

        // ------------------------------------------------------------------ files
        static void AtomicWrite(string path, byte[] data)
        {
            string dir = Path.GetDirectoryName(path);
            if (!Directory.Exists(dir)) throw new DirectoryNotFoundException("Folder not found: " + dir);
            string tmp = Path.Combine(dir, "." + Path.GetFileName(path) + "." + Guid.NewGuid().ToString("N").Substring(0, 8) + ".tmp");
            try
            {
                using (FileStream fs = new FileStream(tmp, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                {
                    fs.Write(data, 0, data.Length);
                    fs.Flush(true);
                }
                if (!SameBytes(File.ReadAllBytes(tmp), data)) throw new IOException("The temporary file did not verify.");
                try
                {
                    if (File.Exists(path)) File.Replace(tmp, path, null); else File.Move(tmp, path);
                }
                catch (Exception ex)
                {
                    if (!(ex is IOException || ex is PlatformNotSupportedException || ex is UnauthorizedAccessException)) throw;
                    File.Copy(tmp, path, true);   // e.g. file systems without ReplaceFile support
                }
                if (!SameBytes(File.ReadAllBytes(path), data)) throw new IOException("The file on disk does not match what was written. Your changes are still safe in memory.");
            }
            finally { try { if (File.Exists(tmp)) File.Delete(tmp); } catch (Exception) { } }
        }
        static bool SameBytes(byte[] a, byte[] b)
        {
            if (a.Length != b.Length) return false;
            for (int i = 0; i < a.Length; i++) if (a[i] != b[i]) return false;
            return true;
        }
        static void PruneBackups(string dir, string prefix, int keep)
        {
            if (string.IsNullOrEmpty(prefix) || keep < 1 || !Directory.Exists(dir)) return;
            List<string> files = new List<string>(Directory.GetFiles(dir, "*.kdbx"));
            files.RemoveAll(delegate (string f) { return !Path.GetFileName(f).StartsWith(prefix, StringComparison.OrdinalIgnoreCase); });
            files.Sort(StringComparer.OrdinalIgnoreCase);                     // names embed the date and time, oldest first
            for (int i = 0; i < files.Count - keep; i++) { try { File.Delete(files[i]); } catch (Exception) { } }
        }

        object ShowOpen(string kind)
        {
            using (OpenFileDialog d = new OpenFileDialog())
            {
                bool db = kind != "key";
                d.Title = db ? "Open KeePass database" : "Choose key file";
                d.Filter = db ? "KeePass database (*.kdbx)|*.kdbx|All files (*.*)|*.*" : "Key files (*.keyx;*.key)|*.keyx;*.key|All files (*.*)|*.*";
                d.CheckFileExists = true; d.RestoreDirectory = true;
                string last = StateString(db ? "dbDir" : "keyDir");
                if (last != null && Directory.Exists(last)) d.InitialDirectory = last;
                if (d.ShowDialog(this) != DialogResult.OK) return null;
                state[db ? "dbDir" : "keyDir"] = Path.GetDirectoryName(d.FileName);
                return Info(d.FileName);
            }
        }
        object ShowSave(string kind, string suggested)
        {
            using (SaveFileDialog d = new SaveFileDialog())
            {
                d.Title = "Save";
                if (kind == "key") { d.Filter = "KeePass key file (*.keyx)|*.keyx|All files (*.*)|*.*"; d.DefaultExt = "keyx"; }
                else if (kind == "any") d.Filter = "All files (*.*)|*.*";
                else { d.Filter = "KeePass database (*.kdbx)|*.kdbx|All files (*.*)|*.*"; d.DefaultExt = "kdbx"; }
                d.FileName = string.IsNullOrEmpty(suggested) ? "" : suggested;
                d.OverwritePrompt = true; d.RestoreDirectory = true;
                string last = StateString(kind == "key" ? "keyDir" : "dbDir");
                if (last != null && Directory.Exists(last)) d.InitialDirectory = last;
                if (d.ShowDialog(this) != DialogResult.OK) return null;
                Dictionary<string, object> r = new Dictionary<string, object>();
                r["path"] = d.FileName; r["name"] = Path.GetFileName(d.FileName);
                return r;
            }
        }

        // ------------------------------------------------------------------ clipboard
        void ClipboardCopy(string text, int clearMs)
        {
            DataObject d = new DataObject();
            d.SetText(text, TextDataFormat.UnicodeText);
            // keep passwords out of Windows clipboard history and cloud clipboard
            d.SetData("ExcludeClipboardContentFromMonitorProcessing", new MemoryStream(new byte[] { 1, 0, 0, 0 }));
            d.SetData("CanIncludeInClipboardHistory", new MemoryStream(new byte[] { 0, 0, 0, 0 }));
            d.SetData("CanUploadToCloudClipboard", new MemoryStream(new byte[] { 0, 0, 0, 0 }));
            Clipboard.SetDataObject(d, true, 10, 100);
            lastClip = text;
            clipTimer.Stop();
            if (clearMs > 0) { clipTimer.Interval = clearMs; clipTimer.Start(); }
        }
        // Only clears when the clipboard still holds what we put there (never clobbers something you copied since).
        void ClearClipboardIfOurs()
        {
            if (lastClip == null) return;
            try { if (Clipboard.ContainsText() && Clipboard.GetText() == lastClip) Clipboard.Clear(); }
            catch (Exception) { try { Thread.Sleep(80); if (Clipboard.ContainsText() && Clipboard.GetText() == lastClip) Clipboard.Clear(); } catch (Exception) { } }
            lastClip = null;
        }

        // ------------------------------------------------------------------ window
        static void OpenExternal(string url)
        {
            Uri u;
            if (string.IsNullOrEmpty(url) || !Uri.TryCreate(url, UriKind.Absolute, out u)) return;
            if (u.Scheme != "http" && u.Scheme != "https" && u.Scheme != "mailto" && u.Scheme != "ftp") return;
            try { Process.Start(new ProcessStartInfo(u.AbsoluteUri) { UseShellExecute = true }); } catch (Exception) { }
        }

        static bool SystemPrefersDark()
        {
            try { object v = Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "AppsUseLightTheme", 1); return v is int && (int)v == 0; }
            catch (Exception) { return false; }
        }

        void ApplyTheme(bool isDark)
        {
            dark = isDark;
            BackColor = dark ? Color.FromArgb(18, 18, 17) : Color.FromArgb(241, 239, 234);
            if (web != null) web.DefaultBackgroundColor = BackColor;
            if (!IsHandleCreated) return;
            int on = dark ? 1 : 0;
            Native.DwmSetWindowAttribute(Handle, 20, ref on, 4);                   // dark title bar (Windows 10 20H1+ / 11)
            Native.DwmSetWindowAttribute(Handle, 19, ref on, 4);
            int cap = dark ? 0x00161717 : 0x00F3F7F8;                              // title bar colour = the app's top bar (Windows 11)
            int txt = dark ? 0x00E6EDEF : 0x00191C1D;
            Native.DwmSetWindowAttribute(Handle, 35, ref cap, 4);
            Native.DwmSetWindowAttribute(Handle, 36, ref txt, 4);
        }

        void SetCapture(bool on)
        {
            capture = on && !allowCapture;
            if (!IsHandleCreated) return;
            if (!Native.SetWindowDisplayAffinity(Handle, capture ? 0x11u : 0u) && capture) Native.SetWindowDisplayAffinity(Handle, 0x1u);
        }

        void OnSessionSwitch(object sender, SessionSwitchEventArgs e)
        {
            if (e.Reason == SessionSwitchReason.SessionLock && IsHandleCreated) BeginInvoke(new Action(delegate { PostEvent("sessionLock", null); }));
        }

        readonly List<string> pendingOpen = new List<string>();
        void CheckOpenRequests()
        {
            try
            {
                string p = Path.Combine(Program.DataDir, "open-request.txt");
                if (File.Exists(p))
                {
                    string txt = File.ReadAllText(p);
                    File.Delete(p);
                    foreach (string line in txt.Split('\n'))
                    {
                        string f = line.Trim().Trim('"');
                        if (f.EndsWith(".kdbx", StringComparison.OrdinalIgnoreCase) && File.Exists(f)) pendingOpen.Add(f);
                    }
                }
            }
            catch (Exception) { }
            if (jsReady) FlushOpen();
        }
        void FlushOpen()
        {
            foreach (string f in pendingOpen) { Dictionary<string, object> d = new Dictionary<string, object>(); d["path"] = f; PostEvent("openFile", d); }
            pendingOpen.Clear();
        }
        System.Windows.Forms.Timer driveTimer;
        // A drive was plugged in or removed: tell the page (twice, because a volume can take a moment to become readable).
        void ScheduleDrivesChanged()
        {
            if (driveTimer == null)
            {
                driveTimer = new System.Windows.Forms.Timer();
                driveTimer.Tick += delegate
                {
                    if (driveTimer.Tag == null) { driveTimer.Tag = "again"; driveTimer.Interval = 2500; }
                    else driveTimer.Stop();
                    PostEvent("drivesChanged", null);
                };
            }
            driveTimer.Stop(); driveTimer.Tag = null; driveTimer.Interval = 700; driveTimer.Start();
        }

        protected override void WndProc(ref Message m)
        {
            if ((uint)m.Msg == Native.WM_SHOWME)
            {
                if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
                Activate();
                CheckOpenRequests();
            }
            else if (m.Msg == 0x0219)                                       // WM_DEVICECHANGE
            {
                long ev = m.WParam.ToInt64();
                if (ev == 0x8000 || ev == 0x8004) ScheduleDrivesChanged();  // DBT_DEVICEARRIVAL / DBT_DEVICEREMOVECOMPLETE
            }
            base.WndProc(ref m);
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            ApplyTheme(dark);
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (!forceClose && jsReady && (e.CloseReason == CloseReason.UserClosing || e.CloseReason == CloseReason.TaskManagerClosing) && web != null && web.CoreWebView2 != null)
            {
                if (closePending)
                {
                    // asked once already and the page hasn't answered: let the user force it
                    if (MessageBox.Show(this, "Keystone is waiting for you to answer a question in the window.\n\nClose anyway? Unsaved changes will be lost.", "Keystone", MessageBoxButtons.YesNo, MessageBoxIcon.Warning) != DialogResult.Yes) { e.Cancel = true; return; }
                }
                else
                {
                    closePending = true;
                    e.Cancel = true;
                    PostEvent("closeRequested", null);                // the page decides (offers to save), then calls 'quit' or 'closeCancelled'
                    return;
                }
            }
            SaveState();
            ClearClipboardIfOurs();
            SystemEvents.SessionSwitch -= OnSessionSwitch;
            base.OnFormClosing(e);
        }

        // ------------------------------------------------------------------ remembered window position + folders
        string StateString(string key) { object v; return state.TryGetValue(key, out v) ? v as string : null; }
        void LoadState()
        {
            try
            {
                if (!File.Exists(StatePath)) return;
                Dictionary<string, object> s = json.DeserializeObject(File.ReadAllText(StatePath)) as Dictionary<string, object>;
                if (s == null) return;
                state = s;
                if (s.ContainsKey("w") && s.ContainsKey("h") && s.ContainsKey("x") && s.ContainsKey("y"))
                {
                    Rectangle r = new Rectangle(Convert.ToInt32(s["x"]), Convert.ToInt32(s["y"]), Convert.ToInt32(s["w"]), Convert.ToInt32(s["h"]));
                    bool visible = false;
                    foreach (Screen sc in Screen.AllScreens) if (sc.WorkingArea.IntersectsWith(r)) visible = true;
                    if (visible && r.Width >= 600 && r.Height >= 400) { StartPosition = FormStartPosition.Manual; Bounds = r; }
                    if (s.ContainsKey("max") && Convert.ToBoolean(s["max"])) WindowState = FormWindowState.Maximized;
                }
            }
            catch (Exception) { }
        }
        void SaveState()
        {
            try
            {
                Rectangle r = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
                state["x"] = r.X; state["y"] = r.Y; state["w"] = r.Width; state["h"] = r.Height;
                state["max"] = WindowState == FormWindowState.Maximized;
                Directory.CreateDirectory(Program.DataDir);
                File.WriteAllText(StatePath, json.Serialize(state));
            }
            catch (Exception) { }
        }
    }
}
