// Keystone Setup (Windows) — installer and uninstaller in one small exe.
//
//   Keystone-Setup.exe               guided install
//   Keystone-Setup.exe /S            silent install   (add /nodesktop, /noassoc, /D=C:\Where\To\Install — /D must be last)
//   Uninstall.exe                    guided uninstall (installed next to Keystone.exe; also in Settings > Apps)
//   Uninstall.exe /uninstall /S      silent uninstall (add /purge to also delete Keystone's settings)
//
// Installs for the current user only (no administrator rights needed) into %LOCALAPPDATA%\Programs\Keystone.
// Never touches database files. Written for the C# 5 compiler that ships with Windows.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("Keystone Setup")]
[assembly: AssemblyProduct("Keystone")]
[assembly: AssemblyDescription("Installs Keystone, a simple modern password vault for KeePass databases")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

namespace KeystoneSetup
{
    class Options
    {
        public string InstallDir;
        public bool DesktopShortcut = true;
        public bool FileAssociation = true;
        public bool Launch = true;
        public bool Silent;
        public bool Purge;
        public bool Uninstall;
    }

    static class Log
    {
        static readonly string Path_ = Path.Combine(Path.GetTempPath(), "Keystone-Setup.log");
        public static void Write(string msg)
        {
            try { File.AppendAllText(Path_, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + msg + "\r\n"); } catch (Exception) { }
        }
    }

    static class Native
    {
        [DllImport("shell32.dll")] public static extern void SHChangeNotify(int eventId, uint flags, IntPtr a, IntPtr b);
        [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr hWnd, int attr, ref int value, int size);
    }

    static class Core
    {
        public const string AppName = "Keystone";
        public const string Version = "1.0.0";
        public const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\Keystone";
        public const string ProgId = "Keystone.Database";

        public static string DefaultDir
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Programs\Keystone"); }
        }
        public static string DataDir
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Keystone"); }
        }
        static string StartMenuLink { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Keystone.lnk"); } }
        static string DesktopLink { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Keystone.lnk"); } }

        // where is it installed now (for upgrades and uninstall)?
        public static string ExistingDir()
        {
            try { using (RegistryKey k = Registry.CurrentUser.OpenSubKey(UninstallKey)) { if (k != null) return k.GetValue("InstallLocation") as string; } } catch (Exception) { }
            return null;
        }

        public static bool WebView2Present()
        {
            const string guid = @"SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
            foreach (RegistryHive hive in new[] { RegistryHive.LocalMachine, RegistryHive.CurrentUser })
                foreach (RegistryView view in new[] { RegistryView.Registry32, RegistryView.Registry64 })
                {
                    try
                    {
                        using (RegistryKey b = RegistryKey.OpenBaseKey(hive, view))
                        using (RegistryKey k = b.OpenSubKey(guid))
                        {
                            string pv = k == null ? null : k.GetValue("pv") as string;
                            if (!string.IsNullOrEmpty(pv) && pv != "0.0.0.0") return true;
                        }
                    }
                    catch (Exception) { }
                }
            return false;
        }

        static byte[] Payload()
        {
            using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.Keystone.exe"))
            {
                if (s == null) throw new FileNotFoundException("This setup program is incomplete (missing payload).");
                byte[] b = new byte[s.Length]; int n = 0;
                while (n < b.Length) { int r = s.Read(b, n, b.Length - n); if (r <= 0) break; n += r; }
                return b;
            }
        }

        // Asks a running Keystone from this install folder to close (it offers to save unsaved changes first).
        static void CloseRunningApp(string exePath)
        {
            foreach (Process p in Process.GetProcessesByName("Keystone"))
            {
                try
                {
                    string path = null;
                    try { path = p.MainModule.FileName; } catch (Win32Exception) { }
                    if (path == null || !string.Equals(path, exePath, StringComparison.OrdinalIgnoreCase)) continue;
                    Log.Write("asking running Keystone (pid " + p.Id + ") to close");
                    p.CloseMainWindow();
                    if (!p.WaitForExit(20000)) throw new IOException("Keystone is still running. Close it (answer any save prompt) and try again.");
                }
                finally { p.Dispose(); }
            }
        }

        static void Shortcut(string linkPath, string target, string workDir, string description)
        {
            Type t = Type.GetTypeFromProgID("WScript.Shell");
            dynamic shell = Activator.CreateInstance(t);
            dynamic lnk = shell.CreateShortcut(linkPath);
            lnk.TargetPath = target; lnk.WorkingDirectory = workDir; lnk.Description = description; lnk.IconLocation = target + ",0";
            lnk.Save();
            Marshal.FinalReleaseComObject(lnk); Marshal.FinalReleaseComObject(shell);
        }

        static void SetStr(RegistryKey k, string name, string value) { k.SetValue(name, value, RegistryValueKind.String); }

        public static void Install(Options o, Action<int, string> report)
        {
            string dir = Path.GetFullPath(o.InstallDir);
            string exe = Path.Combine(dir, "Keystone.exe"), unins = Path.Combine(dir, "Uninstall.exe");
            Log.Write("install to " + dir);
            report(5, "Checking for a running copy…");
            CloseRunningApp(exe);

            report(15, "Copying files…");
            Directory.CreateDirectory(dir);
            byte[] payload = Payload();
            string tmp = exe + ".new";
            File.WriteAllBytes(tmp, payload);
            if (File.Exists(exe)) File.Delete(exe);
            File.Move(tmp, exe);
            string self = Assembly.GetExecutingAssembly().Location;
            if (!string.Equals(Path.GetFullPath(self), unins, StringComparison.OrdinalIgnoreCase)) File.Copy(self, unins, true);
            using (Stream ns = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.notices.txt"))   // third-party license notices travel with the program
            {
                if (ns != null) using (FileStream fs = File.Create(Path.Combine(dir, "THIRD_PARTY_NOTICES.txt"))) ns.CopyTo(fs);
            }

            report(55, "Creating shortcuts…");
            Shortcut(StartMenuLink, exe, dir, "Keystone — your KeePass vault");
            if (o.DesktopShortcut) Shortcut(DesktopLink, exe, dir, "Keystone — your KeePass vault");
            else if (File.Exists(DesktopLink)) File.Delete(DesktopLink);

            report(70, "Registering with Windows…");
            using (RegistryKey k = Registry.CurrentUser.CreateSubKey(UninstallKey))
            {
                SetStr(k, "DisplayName", AppName); SetStr(k, "DisplayVersion", Version); SetStr(k, "Publisher", AppName);
                SetStr(k, "InstallLocation", dir); SetStr(k, "DisplayIcon", "\"" + exe + "\",0");
                SetStr(k, "UninstallString", "\"" + unins + "\" /uninstall");
                SetStr(k, "QuietUninstallString", "\"" + unins + "\" /uninstall /S");
                SetStr(k, "InstallDate", DateTime.Now.ToString("yyyyMMdd"));
                k.SetValue("NoModify", 1, RegistryValueKind.DWord); k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                k.SetValue("EstimatedSize", (int)((payload.Length + new FileInfo(unins).Length) / 1024), RegistryValueKind.DWord);
            }
            if (o.FileAssociation) RegisterAssociation(exe); else RemoveAssociation();
            Native.SHChangeNotify(0x08000000, 0, IntPtr.Zero, IntPtr.Zero);   // SHCNE_ASSOCCHANGED
            report(100, "Done");
            Log.Write("install finished");
        }

        // "Open with Keystone" for .kdbx — it does not take over the default if you already have another program for them.
        static void RegisterAssociation(string exe)
        {
            string cmd = "\"" + exe + "\" \"%1\"";
            using (RegistryKey k = Registry.CurrentUser.CreateSubKey(@"Software\Classes\" + ProgId))
            {
                SetStr(k, "", "KeePass database");
                using (RegistryKey i = k.CreateSubKey("DefaultIcon")) SetStr(i, "", "\"" + exe + "\",0");
                using (RegistryKey c = k.CreateSubKey(@"shell\open\command")) SetStr(c, "", cmd);
            }
            using (RegistryKey k = Registry.CurrentUser.CreateSubKey(@"Software\Classes\.kdbx\OpenWithProgids")) k.SetValue(ProgId, new byte[0], RegistryValueKind.None);
            using (RegistryKey k = Registry.CurrentUser.CreateSubKey(@"Software\Classes\Applications\Keystone.exe"))
            {
                SetStr(k, "FriendlyAppName", AppName);
                using (RegistryKey c = k.CreateSubKey(@"shell\open\command")) SetStr(c, "", cmd);
                using (RegistryKey s = k.CreateSubKey("SupportedTypes")) SetStr(s, ".kdbx", "");
            }
            using (RegistryKey k = Registry.CurrentUser.CreateSubKey(@"Software\Keystone\Capabilities"))
            {
                SetStr(k, "ApplicationName", AppName); SetStr(k, "ApplicationDescription", "Open and edit KeePass (.kdbx) databases");
                using (RegistryKey f = k.CreateSubKey("FileAssociations")) SetStr(f, ".kdbx", ProgId);
            }
            using (RegistryKey k = Registry.CurrentUser.CreateSubKey(@"Software\RegisteredApplications")) SetStr(k, "Keystone", @"Software\Keystone\Capabilities");
        }

        static void RemoveAssociation()
        {
            try { Registry.CurrentUser.DeleteSubKeyTree(@"Software\Classes\" + ProgId, false); } catch (Exception) { }
            try { Registry.CurrentUser.DeleteSubKeyTree(@"Software\Classes\Applications\Keystone.exe", false); } catch (Exception) { }
            try { Registry.CurrentUser.DeleteSubKeyTree(@"Software\Keystone", false); } catch (Exception) { }
            try { using (RegistryKey k = Registry.CurrentUser.OpenSubKey(@"Software\Classes\.kdbx\OpenWithProgids", true)) { if (k != null) k.DeleteValue(ProgId, false); } } catch (Exception) { }
            try { using (RegistryKey k = Registry.CurrentUser.OpenSubKey(@"Software\RegisteredApplications", true)) { if (k != null) k.DeleteValue("Keystone", false); } } catch (Exception) { }
        }

        // removes a folder tree, retrying briefly (a just-closed program can still hold a file for a moment) and logging what remains
        static void DeleteTree(string path)
        {
            for (int attempt = 0; attempt < 8; attempt++)
            {
                if (!Directory.Exists(path)) { Log.Write("removed " + path); return; }
                foreach (string f in Directory.GetFiles(path, "*", SearchOption.AllDirectories))
                {
                    try { File.SetAttributes(f, FileAttributes.Normal); File.Delete(f); } catch (Exception) { }
                }
                try { Directory.Delete(path, true); } catch (Exception ex) { if (attempt == 7) Log.Write("could not fully remove " + path + ": " + ex.Message); }
                if (Directory.Exists(path)) Thread.Sleep(500);
            }
            if (Directory.Exists(path)) Log.Write("left behind: " + path);
        }

        public static string PendingSelfDelete;

        // An exe cannot delete itself while it runs, so once we have exited a hidden command removes the last file and the folder.
        public static void RunSelfDelete()
        {
            if (PendingSelfDelete == null) return;
            string dir = PendingSelfDelete; PendingSelfDelete = null;
            string args = "/c ping 127.0.0.1 -n 3 >nul & del /f /q \"" + Path.Combine(dir, "Uninstall.exe") + "\" & rmdir \"" + dir + "\"";
            try { Process.Start(new ProcessStartInfo("cmd.exe", args) { CreateNoWindow = true, UseShellExecute = false, WindowStyle = ProcessWindowStyle.Hidden }); } catch (Exception) { }
        }

        public static void Uninstall(Options o, Action<int, string> report)
        {
            string dir = Path.GetFullPath(o.InstallDir);
            string exe = Path.Combine(dir, "Keystone.exe");
            Log.Write("uninstall from " + dir + (o.Purge ? " (purge)" : ""));
            report(10, "Closing Keystone…");
            CloseRunningApp(exe);

            report(30, "Removing shortcuts…");
            foreach (string l in new[] { StartMenuLink, DesktopLink }) { try { if (File.Exists(l)) File.Delete(l); } catch (Exception) { } }

            report(50, "Removing registrations…");
            RemoveAssociation();
            try { Registry.CurrentUser.DeleteSubKeyTree(UninstallKey, false); } catch (Exception) { }
            Native.SHChangeNotify(0x08000000, 0, IntPtr.Zero, IntPtr.Zero);

            report(70, "Removing files…");
            string self = Path.GetFullPath(Assembly.GetExecutingAssembly().Location);
            foreach (string f in Directory.Exists(dir) ? Directory.GetFiles(dir) : new string[0])
            {
                if (string.Equals(Path.GetFullPath(f), self, StringComparison.OrdinalIgnoreCase)) continue;      // this program: removed below
                try { File.Delete(f); } catch (Exception) { }
            }
            if (o.Purge)
            {
                report(85, "Removing settings…");
                DeleteTree(DataDir);
            }
            PendingSelfDelete = Directory.Exists(dir) ? dir : null;      // finished off by RunSelfDelete() once this program has exited
            report(100, "Done");
            Log.Write("uninstall finished");
        }
    }

    // ------------------------------------------------------------------------------------------------ custom-painted controls (Apple-style)
    static class Gfx
    {
        public static GraphicsPath Rounded(RectangleF r, float d)
        {
            GraphicsPath p = new GraphicsPath();
            if (d <= 0) { p.AddRectangle(r); return p; }
            if (d > r.Height) d = r.Height;
            p.AddArc(r.X, r.Y, d, d, 180, 90); p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90); p.AddArc(r.X, r.Bottom - d, d, d, 90, 90); p.CloseFigure();
            return p;
        }
        public static Color Mix(Color a, Color b, float t)
        {
            return Color.FromArgb((int)(a.R + (b.R - a.R) * t), (int)(a.G + (b.G - a.G) * t), (int)(a.B + (b.B - a.B) * t));
        }
    }

    // a macOS-style switch
    class Pill : Control
    {
        public Color Backdrop = Color.White, OnColor = Color.FromArgb(52, 199, 89), OffColor = Color.FromArgb(200, 200, 205);
        bool on; float pos; System.Windows.Forms.Timer tm;
        public event EventHandler CheckedChanged;
        public bool Checked
        {
            get { return on; }
            set { if (on == value) return; on = value; tm.Start(); if (CheckedChanged != null) CheckedChanged(this, EventArgs.Empty); }
        }
        public Pill(bool value)
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.Selectable, true);
            on = value; pos = value ? 1f : 0f; TabStop = true; Cursor = Cursors.Hand; Size = new Size(42, 26);
            tm = new System.Windows.Forms.Timer { Interval = 15 };
            tm.Tick += delegate
            {
                float target = on ? 1f : 0f; pos += (target - pos) * 0.38f;
                if (Math.Abs(target - pos) < 0.02f) { pos = target; tm.Stop(); }
                Invalidate();
            };
        }
        protected override void OnClick(EventArgs e) { base.OnClick(e); Focus(); Checked = !Checked; }
        protected override void OnKeyDown(KeyEventArgs e) { base.OnKeyDown(e); if (e.KeyCode == Keys.Space) { Checked = !Checked; e.Handled = true; } }
        protected override void OnGotFocus(EventArgs e) { base.OnGotFocus(e); Invalidate(); }
        protected override void OnLostFocus(EventArgs e) { base.OnLostFocus(e); Invalidate(); }
        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics; g.Clear(Backdrop); g.SmoothingMode = SmoothingMode.AntiAlias;
            RectangleF r = new RectangleF(2, 2, Width - 5, Height - 5);
            using (GraphicsPath p = Gfx.Rounded(r, r.Height))
            using (SolidBrush b = new SolidBrush(Gfx.Mix(OffColor, OnColor, pos))) g.FillPath(b, p);
            float d = r.Height - 4, x = r.X + 2 + pos * (r.Width - d - 4);
            using (SolidBrush sh = new SolidBrush(Color.FromArgb(50, 0, 0, 0))) g.FillEllipse(sh, x, r.Y + 2.8f, d, d);
            g.FillEllipse(Brushes.White, x, r.Y + 2, d, d);
            if (Focused && ShowFocusCues)
                using (GraphicsPath p = Gfx.Rounded(new RectangleF(0.5f, 0.5f, Width - 2, Height - 2), Height - 2))
                using (Pen pen = new Pen(Color.FromArgb(120, 0, 122, 255), 2)) g.DrawPath(pen, p);
        }
    }

    // rounded push button
    class AppButton : Button
    {
        public Color Fill, FillHover, FillDown, Ink, Border, Backdrop, Ring = Color.FromArgb(120, 0, 122, 255); public bool Primary;
        bool hot, down;
        public AppButton()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true);
            FlatStyle = FlatStyle.Flat; FlatAppearance.BorderSize = 0; Cursor = Cursors.Hand; UseVisualStyleBackColor = false;
        }
        protected override void OnMouseEnter(EventArgs e) { hot = true; Invalidate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { hot = down = false; Invalidate(); base.OnMouseLeave(e); }
        protected override void OnMouseDown(MouseEventArgs e) { down = true; Invalidate(); base.OnMouseDown(e); }
        protected override void OnMouseUp(MouseEventArgs e) { down = false; Invalidate(); base.OnMouseUp(e); }
        protected override void OnEnabledChanged(EventArgs e) { base.OnEnabledChanged(e); Invalidate(); }
        protected override void OnGotFocus(EventArgs e) { base.OnGotFocus(e); Invalidate(); }
        protected override void OnLostFocus(EventArgs e) { base.OnLostFocus(e); Invalidate(); }
        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics; g.Clear(Backdrop); g.SmoothingMode = SmoothingMode.AntiAlias;
            Color f = down ? FillDown : (hot ? FillHover : Fill), ink = Ink;
            if (!Enabled) { f = Gfx.Mix(f, Backdrop, 0.55f); ink = Gfx.Mix(ink, Backdrop, 0.4f); }
            RectangleF r = new RectangleF(2, 2, Width - 5, Height - 5);
            using (GraphicsPath p = Gfx.Rounded(r, 14))
            {
                using (SolidBrush b = new SolidBrush(f)) g.FillPath(b, p);
                if (!Primary) using (Pen pen = new Pen(Border, 1)) g.DrawPath(pen, p);
            }
            if (Focused && ShowFocusCues)
                using (GraphicsPath p = Gfx.Rounded(new RectangleF(0.5f, 0.5f, Width - 2, Height - 2), 16))
                using (Pen pen = new Pen(Ring, 2)) g.DrawPath(pen, p);
            TextRenderer.DrawText(g, Text, Font, ClientRectangle, ink, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.NoPadding);
        }
    }

    // slim, rounded progress bar that eases toward its value
    class SlimBar : Control
    {
        public Color Track, Fill, Backdrop;
        float shown; int target; System.Windows.Forms.Timer tm;
        public int Value { get { return target; } set { target = Math.Max(0, Math.Min(100, value)); tm.Start(); } }
        public SlimBar()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true);
            tm = new System.Windows.Forms.Timer { Interval = 15 };
            tm.Tick += delegate { shown += (target - shown) * 0.2f; if (Math.Abs(target - shown) < 0.3f) { shown = target; tm.Stop(); } Invalidate(); };
        }
        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics; g.Clear(Backdrop); g.SmoothingMode = SmoothingMode.AntiAlias;
            RectangleF r = new RectangleF(0, 0, Width, Height);
            using (GraphicsPath p = Gfx.Rounded(r, Height)) using (SolidBrush b = new SolidBrush(Track)) g.FillPath(b, p);
            if (shown > 0.5f)
            {
                float w = Math.Max(Height, Width * shown / 100f);
                using (GraphicsPath p = Gfx.Rounded(new RectangleF(0, 0, w, Height), Height)) using (SolidBrush b = new SolidBrush(Fill)) g.FillPath(b, p);
            }
        }
    }

    // inset grouped list: one rounded surface with hairline separators
    class Group : Panel
    {
        public Color Surface, Line, Backdrop; public int Rows = 1;
        public Group() { DoubleBuffered = true; ResizeRedraw = true; }
        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics; g.Clear(Backdrop); g.SmoothingMode = SmoothingMode.AntiAlias;
            RectangleF r = new RectangleF(0.5f, 0.5f, Width - 1.5f, Height - 1.5f);
            using (GraphicsPath p = Gfx.Rounded(r, 20))
            {
                using (SolidBrush b = new SolidBrush(Surface)) g.FillPath(b, p);
                using (Pen pen = new Pen(Line, 1)) g.DrawPath(pen, p);
            }
            using (Pen pen = new Pen(Line, 1))
                for (int i = 1; i < Rows; i++) { float y = (float)Height * i / Rows; g.DrawLine(pen, 16, y, Width - 1, y); }
        }
    }

    // ------------------------------------------------------------------------------------------------ the wizard window
    class Wizard : Form
    {
        readonly Options o;
        readonly bool dark;
        readonly Color bg, surface, ink, ink2, line, accent, red, green;
        Panel pageOptions, pageProgress, pageFinish;
        Group grpLaunch;
        Label pathLabel;
        string dir;
        Pill chkDesktop, chkAssoc, chkLaunch, chkPurge;
        SlimBar bar; Label stepLabel, finishTitle, finishText;
        AppButton btnPrimary, btnCancel;
        Image logo;
        bool working, ok;

        static bool SystemDark()
        {
            try { object v = Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "AppsUseLightTheme", 1); return v is int && (int)v == 0; }
            catch (Exception) { return false; }
        }

        public Wizard(Options options)
        {
            o = options; dir = o.InstallDir;
            dark = SystemDark();
            bg = dark ? Color.FromArgb(28, 28, 30) : Color.FromArgb(245, 245, 247);
            surface = dark ? Color.FromArgb(44, 44, 46) : Color.White;
            ink = dark ? Color.FromArgb(245, 245, 247) : Color.FromArgb(29, 29, 31);
            ink2 = dark ? Color.FromArgb(174, 174, 178) : Color.FromArgb(108, 108, 112);
            line = dark ? Color.FromArgb(70, 70, 74) : Color.FromArgb(226, 226, 230);
            accent = dark ? Color.FromArgb(10, 132, 255) : Color.FromArgb(0, 122, 255);
            red = dark ? Color.FromArgb(255, 69, 58) : Color.FromArgb(255, 59, 48);
            green = dark ? Color.FromArgb(48, 209, 88) : Color.FromArgb(52, 199, 89);
            try { using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.icon.png")) { if (s != null) logo = new Bitmap(s); } } catch (Exception) { }
            AutoScaleDimensions = new SizeF(96F, 96F); AutoScaleMode = AutoScaleMode.Dpi;
            Font = new Font("Segoe UI", 9.5F); DoubleBuffered = true;
            Text = o.Uninstall ? "Uninstall Keystone" : "Keystone Setup";
            try { Icon = Icon.ExtractAssociatedIcon(Assembly.GetExecutingAssembly().Location); } catch (Exception) { }
            FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false; MinimizeBox = true;
            StartPosition = FormStartPosition.CenterScreen; ClientSize = new Size(520, 480); BackColor = bg; ForeColor = ink;

            btnPrimary = MakeButton(o.Uninstall ? "Uninstall" : "Install"); btnPrimary.SetBounds(344, 428, 136, 32);
            btnCancel = MakeButton("Cancel"); btnCancel.SetBounds(238, 428, 96, 32);
            StylePrimary(btnPrimary, o.Uninstall ? red : accent); StyleSecondary(btnCancel);
            btnPrimary.Click += delegate { OnPrimary(); };
            btnCancel.Click += delegate { if (!working) Close(); };
            Controls.AddRange(new Control[] { btnPrimary, btnCancel });
            AcceptButton = btnPrimary; CancelButton = btnCancel;           // Enter = Install, Esc = Cancel
            BuildPages();
            Show(pageOptions);
        }

        AppButton MakeButton(string text)
        {
            return new AppButton { Text = text, Font = new Font("Segoe UI Semibold", 10F), Backdrop = bg, TabStop = true };
        }
        void StylePrimary(AppButton b, Color c)
        {
            b.Primary = true; b.Fill = c; b.FillHover = Gfx.Mix(c, Color.Black, 0.12f); b.FillDown = Gfx.Mix(c, Color.Black, 0.26f); b.Ink = Color.White; b.Border = c; b.Invalidate();
        }
        void StyleSecondary(AppButton b)
        {
            b.Primary = false; b.Fill = surface; b.FillHover = Gfx.Mix(surface, ink, 0.05f); b.FillDown = Gfx.Mix(surface, ink, 0.1f); b.Ink = ink; b.Border = line; b.Invalidate();
        }
        Label MakeLabel(string text, int x, int y, int w, int h, float size, string family, Color color, ContentAlignment align)
        {
            return new Label { Text = text, Left = x, Top = y, Width = w, Height = h, ForeColor = color, BackColor = Color.Transparent, Font = new Font(family, size), TextAlign = align, AutoEllipsis = false };
        }
        Label Title(string text) { return MakeLabel(text, 0, 2, 520, 36, 21F, "Segoe UI Semibold", ink, ContentAlignment.MiddleCenter); }
        Label Subtitle(string text, int h) { return MakeLabel(text, 60, 44, 400, h, 10F, "Segoe UI", ink2, ContentAlignment.TopCenter); }
        Pill MakePill(bool value, Color backdrop, int row)
        {
            Pill p = new Pill(value) { Backdrop = backdrop, OnColor = green, OffColor = dark ? Color.FromArgb(88, 88, 92) : Color.FromArgb(213, 213, 217) };
            p.SetBounds(440 - 16 - 42, row * 46 + 10, 42, 26);
            return p;
        }
        Group MakeGroup(int rows, int top)
        {
            return new Group { Left = 40, Top = top, Width = 440, Height = rows * 46, Rows = rows, Surface = surface, Line = line, Backdrop = bg, BackColor = bg };
        }
        // one row of a group: a label that also toggles its switch
        void AddSwitchRow(Group g, string text, Pill p, int row)
        {
            Label l = MakeLabel(text, 16, row * 46, 340, 46, 10F, "Segoe UI", ink, ContentAlignment.MiddleLeft);
            l.Cursor = Cursors.Hand; l.Click += delegate { p.Checked = !p.Checked; };
            p.AccessibleName = text;
            g.Controls.Add(l); g.Controls.Add(p);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            if (logo == null) return;
            Graphics g = e.Graphics; g.InterpolationMode = InterpolationMode.HighQualityBicubic; g.SmoothingMode = SmoothingMode.AntiAlias; g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            float k = ClientSize.Width / 520f, s = 112 * k;
            g.DrawImage(logo, new RectangleF((ClientSize.Width - s) / 2f, 12 * k, s, s));
        }

        void BuildPages()
        {
            // ---- options page (install) / confirm page (uninstall)
            pageOptions = new Panel { Left = 0, Top = 128, Width = 520, Height = 286, BackColor = bg };
            if (!o.Uninstall)
            {
                pageOptions.Controls.Add(Title("Install Keystone"));
                pageOptions.Controls.Add(Subtitle("A calm, simple way to open your KeePass databases. Everything stays on this computer, with no network connections.", 56));
                Group g = MakeGroup(3, 104);
                g.Controls.Add(MakeLabel("Location", 16, 0, 80, 46, 10F, "Segoe UI", ink, ContentAlignment.MiddleLeft));
                pathLabel = MakeLabel(Fit(dir), 100, 0, 252, 46, 9.5F, "Segoe UI", ink2, ContentAlignment.MiddleRight);
                pathLabel.AutoEllipsis = true; pathLabel.TextAlign = ContentAlignment.MiddleRight;
                Label change = MakeLabel("Change…", 356, 0, 70, 46, 10F, "Segoe UI", accent, ContentAlignment.MiddleRight);
                change.Cursor = Cursors.Hand;
                change.Click += delegate
                {
                    using (FolderBrowserDialog d = new FolderBrowserDialog { Description = "Choose where to install Keystone", ShowNewFolderButton = true })
                    { if (d.ShowDialog(this) == DialogResult.OK) { dir = Path.Combine(d.SelectedPath, "Keystone"); pathLabel.Text = Fit(dir); } }
                };
                g.Controls.AddRange(new Control[] { pathLabel, change });
                chkDesktop = MakePill(o.DesktopShortcut, surface, 1); AddSwitchRow(g, "Desktop shortcut", chkDesktop, 1);
                chkAssoc = MakePill(o.FileAssociation, surface, 2); AddSwitchRow(g, "Offer “Open with Keystone” for .kdbx files", chkAssoc, 2);
                pageOptions.Controls.Add(g);
                if (!Core.WebView2Present())
                {
                    pageOptions.Controls.Add(MakeLabel("The Microsoft Edge WebView2 Runtime wasn’t found. Keystone needs it; it ships with current Windows 10 and 11.", 40, 246, 440, 30, 8.5F, "Segoe UI", dark ? Color.FromArgb(255, 159, 10) : Color.FromArgb(184, 97, 0), ContentAlignment.TopCenter));
                    LinkLabel get = new LinkLabel { Text = "Get it from Microsoft", Left = 40, Top = 268, Width = 440, Height = 16, LinkColor = accent, ActiveLinkColor = accent, BackColor = Color.Transparent, Font = new Font("Segoe UI", 8.5F), TextAlign = ContentAlignment.TopCenter };
                    get.Click += delegate { try { Process.Start(new ProcessStartInfo("https://go.microsoft.com/fwlink/p/?LinkId=2124703") { UseShellExecute = true }); } catch (Exception) { } };
                    pageOptions.Controls.Add(get);
                }
            }
            else
            {
                pageOptions.Controls.Add(Title("Remove Keystone?"));
                pageOptions.Controls.Add(Subtitle("Keystone will be removed from this computer. Your databases and key files are never touched.", 56));
                Group g = MakeGroup(1, 104);
                chkPurge = MakePill(o.Purge, surface, 0); AddSwitchRow(g, "Also delete Keystone’s settings", chkPurge, 0);
                pageOptions.Controls.Add(g);
                pageOptions.Controls.Add(MakeLabel("Settings include the remembered database and your preferences.", 40, 158, 440, 20, 8.5F, "Segoe UI", ink2, ContentAlignment.TopCenter));
            }
            Controls.Add(pageOptions);

            // ---- progress page
            pageProgress = new Panel { Left = 0, Top = 128, Width = 520, Height = 286, BackColor = bg, Visible = false };
            pageProgress.Controls.Add(Title(o.Uninstall ? "Removing Keystone…" : "Installing Keystone…"));
            bar = new SlimBar { Left = 80, Top = 112, Width = 360, Height = 6, Track = dark ? Color.FromArgb(68, 68, 72) : Color.FromArgb(222, 222, 226), Fill = accent, Backdrop = bg };
            stepLabel = MakeLabel("", 40, 130, 440, 22, 9.5F, "Segoe UI", ink2, ContentAlignment.TopCenter);
            pageProgress.Controls.AddRange(new Control[] { bar, stepLabel });
            Controls.Add(pageProgress);

            // ---- finish page
            pageFinish = new Panel { Left = 0, Top = 128, Width = 520, Height = 286, BackColor = bg, Visible = false };
            finishTitle = Title("");
            finishText = MakeLabel("", 50, 44, 420, 84, 10F, "Segoe UI", ink2, ContentAlignment.TopCenter);
            grpLaunch = MakeGroup(1, 140);
            chkLaunch = MakePill(o.Launch, surface, 0); AddSwitchRow(grpLaunch, "Start Keystone now", chkLaunch, 0);
            pageFinish.Controls.AddRange(new Control[] { finishTitle, finishText, grpLaunch });
            Controls.Add(pageFinish);
        }

        // shorten a long path from the left so it stays on one line
        string Fit(string s)
        {
            Font f = new Font("Segoe UI", 9.5F);
            while (s.Length > 12 && TextRenderer.MeasureText(s, f).Width > 244) { int i = s.IndexOf(Path.DirectorySeparatorChar, s.StartsWith("\u2026") ? 2 : 0); if (i < 0) break; s = "\u2026" + s.Substring(i); }
            return s;
        }

        void Show(Panel p) { pageOptions.Visible = pageProgress.Visible = pageFinish.Visible = false; p.Visible = true; }

        void OnPrimary()
        {
            if (btnPrimary.Text == "Done" || btnPrimary.Text == "Close")
            {
                if (ok && !o.Uninstall && chkLaunch.Checked) LaunchApp();
                Close(); return;
            }
            if (!o.Uninstall)
            {
                string d = dir.Trim();
                if (d.Length == 0 || !Path.IsPathRooted(d)) { MessageBox.Show(this, "Please choose a full folder path to install into.", "Keystone Setup", MessageBoxButtons.OK, MessageBoxIcon.Information); return; }
                o.InstallDir = d; o.DesktopShortcut = chkDesktop.Checked; o.FileAssociation = chkAssoc.Checked;
            }
            else o.Purge = chkPurge.Checked;
            Run();
        }

        void Run()
        {
            Show(pageProgress); working = true; btnPrimary.Enabled = false; btnCancel.Enabled = false;
            Action<int, string> report = delegate (int pct, string msg) { BeginInvoke(new Action(delegate { bar.Value = pct; stepLabel.Text = msg; })); };
            Thread t = new Thread(delegate ()
            {
                string error = null;
                try { if (o.Uninstall) Core.Uninstall(o, report); else Core.Install(o, report); }
                catch (Exception ex) { error = ex.Message; Log.Write("FAILED: " + ex); }
                Thread.Sleep(450);
                BeginInvoke(new Action(delegate { Finished(error); }));
            });
            t.SetApartmentState(ApartmentState.STA); t.IsBackground = true; t.Start();
        }

        void Finished(string error)
        {
            working = false; btnCancel.Visible = false; btnPrimary.Enabled = true; ok = error == null;
            Show(pageFinish); btnPrimary.Focus();
            if (ok)
            {
                finishTitle.Text = o.Uninstall ? "Keystone was removed" : "Keystone is ready";
                finishText.ForeColor = ink2;
                finishText.Text = o.Uninstall ? "Thanks for trying it. Your databases were not touched."
                    : "Find Keystone in the Start menu" + (o.DesktopShortcut ? " or on your desktop" : "") + ".\n\nPlug in your USB drive and Keystone will find your database on its own.";
                grpLaunch.Visible = !o.Uninstall; btnPrimary.Text = "Done"; StylePrimary(btnPrimary, accent);
            }
            else
            {
                finishTitle.Text = o.Uninstall ? "Couldn’t finish removing" : "Setup couldn’t finish";
                finishText.Height = 130; finishText.ForeColor = red;
                finishText.Text = error + "\n\nNothing else was changed. A log is at " + Path.Combine(Path.GetTempPath(), "Keystone-Setup.log");
                grpLaunch.Visible = false; btnPrimary.Text = "Close"; StyleSecondary(btnPrimary);
            }
        }

        void LaunchApp()
        {
            try { Process.Start(new ProcessStartInfo(Path.Combine(o.InstallDir, "Keystone.exe")) { UseShellExecute = false, WorkingDirectory = o.InstallDir }); } catch (Exception) { }
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            int on = dark ? 1 : 0; Native.DwmSetWindowAttribute(Handle, 20, ref on, 4);
        }
        protected override void OnFormClosing(FormClosingEventArgs e) { if (working) e.Cancel = true; base.OnFormClosing(e); }

        // screenshots for documentation / tests: KEYSTONE_SETUP_PREVIEW=progress|finish
        public void Preview(string page)
        {
            if (page == "progress") { Show(pageProgress); bar.Value = 60; stepLabel.Text = "Creating shortcuts…"; btnPrimary.Enabled = false; btnCancel.Enabled = false; }
            else if (page == "finish") { ok = true; Finished(null); }
        }
    }

    static class Program
    {
        [STAThread]
        static int Main(string[] args)
        {
            Options o = new Options();
            string exePath = Assembly.GetExecutingAssembly().Location;
            bool runningAsUninstaller = string.Equals(Path.GetFileName(exePath), "Uninstall.exe", StringComparison.OrdinalIgnoreCase);
            o.Uninstall = runningAsUninstaller;
            foreach (string a in args)
            {
                string s = a.ToLowerInvariant();
                if (s == "/s" || s == "/silent" || s == "/quiet") o.Silent = true;
                else if (s == "/uninstall") o.Uninstall = true;
                else if (s == "/purge") o.Purge = true;
                else if (s == "/nodesktop") o.DesktopShortcut = false;
                else if (s == "/noassoc") o.FileAssociation = false;
                else if (s == "/nolaunch") o.Launch = false;
                else if (s.StartsWith("/d=")) o.InstallDir = a.Substring(3).Trim('"');
            }
            if (o.Silent) o.Launch = false;
            if (o.InstallDir == null) o.InstallDir = (o.Uninstall ? Core.ExistingDir() : null) ?? (Core.ExistingDir() ?? Core.DefaultDir);
            if (o.Uninstall && runningAsUninstaller) o.InstallDir = Path.GetDirectoryName(exePath);
            Log.Write((o.Uninstall ? "uninstall" : "install") + " started" + (o.Silent ? " (silent)" : "") + " args=" + string.Join(" ", args));

            if (o.Silent)
            {
                try { if (o.Uninstall) Core.Uninstall(o, delegate (int p, string m) { }); else Core.Install(o, delegate (int p, string m) { }); Core.RunSelfDelete(); return 0; }
                catch (Exception ex) { Log.Write("FAILED: " + ex); return 1; }
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Wizard w = new Wizard(o);
            string preview = Environment.GetEnvironmentVariable("KEYSTONE_SETUP_PREVIEW");
            if (!string.IsNullOrEmpty(preview)) w.Shown += delegate { w.Preview(preview); };
            Application.Run(w);
            Core.RunSelfDelete();
            return 0;
        }
    }
}
