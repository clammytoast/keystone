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

    // ------------------------------------------------------------------------------------------------ the wizard window
    class Wizard : Form
    {
        readonly Options o;
        readonly bool dark;
        readonly Color bg, panel, ink, ink2, line, accent = Color.FromArgb(26, 106, 88), accentHover = Color.FromArgb(21, 89, 74);
        Panel pageOptions, pageProgress, pageFinish;
        TextBox dirBox; CheckBox chkDesktop, chkAssoc, chkLaunch, chkPurge;
        ProgressBar bar; Label stepLabel, finishTitle, finishText;
        Button btnPrimary, btnCancel;
        bool working, ok;

        static bool SystemDark()
        {
            try { object v = Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "AppsUseLightTheme", 1); return v is int && (int)v == 0; }
            catch (Exception) { return false; }
        }

        public Wizard(Options options)
        {
            o = options;
            dark = SystemDark();
            bg = dark ? Color.FromArgb(29, 29, 27) : Color.White;
            panel = dark ? Color.FromArgb(23, 23, 22) : Color.FromArgb(248, 247, 243);
            ink = dark ? Color.FromArgb(239, 237, 230) : Color.FromArgb(29, 28, 25);
            ink2 = dark ? Color.FromArgb(182, 178, 167) : Color.FromArgb(87, 84, 76);
            line = dark ? Color.FromArgb(58, 58, 55) : Color.FromArgb(208, 204, 192);
            AutoScaleDimensions = new SizeF(96F, 96F); AutoScaleMode = AutoScaleMode.Dpi;
            Font = new Font("Segoe UI", 9.5F);
            Text = o.Uninstall ? "Uninstall Keystone" : "Keystone Setup";
            try { Icon = Icon.ExtractAssociatedIcon(Assembly.GetExecutingAssembly().Location); } catch (Exception) { }
            FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false; MinimizeBox = true;
            StartPosition = FormStartPosition.CenterScreen; ClientSize = new Size(640, 420); BackColor = bg; ForeColor = ink;

            Panel side = new Panel { Left = 0, Top = 0, Width = 210, Height = 420, BackColor = accent };
            side.Paint += PaintBanner;
            Controls.Add(side);

            btnPrimary = MakeButton(o.Uninstall ? "Uninstall" : "Install", true); btnPrimary.SetBounds(440, 366, 176, 36);
            btnCancel = MakeButton("Cancel", false); btnCancel.SetBounds(332, 366, 100, 36);
            btnPrimary.Click += delegate { OnPrimary(); };
            btnCancel.Click += delegate { if (!working) Close(); };
            Controls.AddRange(new Control[] { btnPrimary, btnCancel });
            AcceptButton = btnPrimary; CancelButton = btnCancel;           // Enter = Install, Esc = Cancel
            BuildPages();
            Show(pageOptions);
            if (o.Uninstall) { btnPrimary.BackColor = Color.FromArgb(179, 38, 30); }
        }

        Button MakeButton(string text, bool primary)
        {
            Button b = new Button { Text = text, FlatStyle = FlatStyle.Flat, Cursor = Cursors.Hand, Font = new Font("Segoe UI Semibold", 9.5F) };
            b.FlatAppearance.BorderSize = primary ? 0 : 1; b.FlatAppearance.BorderColor = line;
            b.BackColor = primary ? accent : bg; b.ForeColor = primary ? Color.White : ink;
            b.FlatAppearance.MouseOverBackColor = primary ? accentHover : (dark ? Color.FromArgb(45, 45, 42) : Color.FromArgb(239, 237, 230));
            return b;
        }
        Label MakeLabel(string text, int x, int y, int w, int h, float size, FontStyle style, Color color)
        {
            return new Label { Text = text, Left = x, Top = y, Width = w, Height = h, ForeColor = color, BackColor = Color.Transparent, Font = new Font("Segoe UI", size, style), AutoEllipsis = false };
        }
        CheckBox MakeCheck(string text, int y, bool value)
        {
            CheckBox c = new CheckBox { Text = text, Left = 250, Top = y, Width = 366, Height = 26, Checked = value, ForeColor = ink, BackColor = Color.Transparent, FlatStyle = FlatStyle.System };
            return c;
        }

        void PaintBanner(object sender, PaintEventArgs e)
        {
            Graphics g = e.Graphics; g.SmoothingMode = SmoothingMode.AntiAlias;
            // logo: white rounded square with a teal keystone and keyhole
            Rectangle r = new Rectangle(34, 48, 72, 72);
            using (GraphicsPath p = Rounded(r, 20)) g.FillPath(Brushes.White, p);
            float k = 72f / 32f; float ox = 34, oy = 48;
            Func<float, float, PointF> pt = delegate (float x, float y) { return new PointF(ox + x * k, oy + y * k); };
            using (SolidBrush b = new SolidBrush(accent))
            {
                g.FillPolygon(b, new[] { pt(11, 6), pt(21, 6), pt(25, 26), pt(7, 26) });
                g.FillEllipse(Brushes.White, ox + 13.4f * k, oy + 11.4f * k, 5.2f * k, 5.2f * k);
                g.FillPolygon(Brushes.White, new[] { pt(14.7f, 16.4f), pt(17.3f, 16.4f), pt(18.1f, 22.6f), pt(13.9f, 22.6f) });
            }
            using (Font f = new Font("Segoe UI Semibold", 22F)) g.DrawString("Keystone", f, Brushes.White, 30, 140);
            using (Font f = new Font("Segoe UI", 10F)) using (SolidBrush b = new SolidBrush(Color.FromArgb(210, 240, 232)))
                g.DrawString("Your KeePass vault,\nmade simple.", f, b, 32, 186);
            using (Font f = new Font("Segoe UI", 8.5F)) using (SolidBrush b = new SolidBrush(Color.FromArgb(190, 225, 215)))
                g.DrawString("Version " + Core.Version, f, b, 32, 380);
        }
        static GraphicsPath Rounded(Rectangle r, int d)
        {
            GraphicsPath p = new GraphicsPath();
            p.AddArc(r.X, r.Y, d, d, 180, 90); p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90); p.AddArc(r.X, r.Bottom - d, d, d, 90, 90); p.CloseFigure();
            return p;
        }

        void BuildPages()
        {
            // ---- options page (install) / confirm page (uninstall)
            pageOptions = new Panel { Left = 210, Top = 0, Width = 430, Height = 360, BackColor = bg };
            if (!o.Uninstall)
            {
                pageOptions.Controls.Add(MakeLabel("Install Keystone", 40, 36, 360, 34, 18F, FontStyle.Bold, ink));
                pageOptions.Controls.Add(MakeLabel("Keystone opens your KeePass databases with a calmer, simpler interface. Everything stays on this computer — it makes no network connections.", 40, 78, 360, 62, 9.5F, FontStyle.Regular, ink2));
                pageOptions.Controls.Add(MakeLabel("Install to", 40, 150, 200, 20, 9F, FontStyle.Bold, ink2));
                dirBox = new TextBox { Left = 40, Top = 174, Width = 296, Text = o.InstallDir, BackColor = dark ? Color.FromArgb(37, 37, 35) : Color.White, ForeColor = ink, BorderStyle = BorderStyle.FixedSingle };
                Button browse = MakeButton("Browse…", false); browse.SetBounds(344, 172, 46, 28); browse.Text = "…";
                browse.Click += delegate
                {
                    using (FolderBrowserDialog d = new FolderBrowserDialog { Description = "Choose where to install Keystone", ShowNewFolderButton = true })
                    { if (d.ShowDialog(this) == DialogResult.OK) dirBox.Text = Path.Combine(d.SelectedPath, "Keystone"); }
                };
                pageOptions.Controls.AddRange(new Control[] { dirBox, browse });
                chkDesktop = MakeCheck("Create a desktop shortcut", 214, o.DesktopShortcut); chkDesktop.Left = 40; chkDesktop.Width = 360;
                chkAssoc = MakeCheck("Offer “Open with Keystone” for .kdbx files", 240, o.FileAssociation); chkAssoc.Left = 40; chkAssoc.Width = 360;
                pageOptions.Controls.AddRange(new Control[] { chkDesktop, chkAssoc });
                if (!Core.WebView2Present())
                {
                    Label warn = MakeLabel("The Microsoft Edge WebView2 Runtime wasn’t found. Keystone needs it; it ships with current Windows 10 and 11.", 40, 276, 270, 56, 8.5F, FontStyle.Regular, Color.FromArgb(180, 110, 0));
                    LinkLabel get = new LinkLabel { Text = "Get it from Microsoft", Left = 40, Top = 334, Width = 200, Height = 18, LinkColor = accent, BackColor = Color.Transparent, Font = new Font("Segoe UI", 8.5F) };
                    get.Click += delegate { try { Process.Start(new ProcessStartInfo("https://go.microsoft.com/fwlink/p/?LinkId=2124703") { UseShellExecute = true }); } catch (Exception) { } };
                    pageOptions.Controls.AddRange(new Control[] { warn, get });
                }
            }
            else
            {
                pageOptions.Controls.Add(MakeLabel("Remove Keystone?", 40, 36, 360, 34, 18F, FontStyle.Bold, ink));
                pageOptions.Controls.Add(MakeLabel("Keystone will be removed from this computer.\n\nYour password databases and key files are never touched — they stay exactly where they are.", 40, 82, 360, 100, 9.5F, FontStyle.Regular, ink2));
                chkPurge = MakeCheck("Also delete Keystone’s settings (remembered database, preferences)", 200, o.Purge); chkPurge.Left = 40; chkPurge.Width = 360; chkPurge.Height = 44;
                pageOptions.Controls.Add(chkPurge);
            }
            Controls.Add(pageOptions);

            // ---- progress page
            pageProgress = new Panel { Left = 210, Top = 0, Width = 430, Height = 360, BackColor = bg, Visible = false };
            pageProgress.Controls.Add(MakeLabel(o.Uninstall ? "Removing Keystone…" : "Installing Keystone…", 40, 36, 360, 34, 18F, FontStyle.Bold, ink));
            bar = new ProgressBar { Left = 40, Top = 130, Width = 350, Height = 10, Style = ProgressBarStyle.Continuous };
            stepLabel = MakeLabel("", 40, 150, 350, 22, 9.5F, FontStyle.Regular, ink2);
            pageProgress.Controls.AddRange(new Control[] { bar, stepLabel });
            Controls.Add(pageProgress);

            // ---- finish page
            pageFinish = new Panel { Left = 210, Top = 0, Width = 430, Height = 360, BackColor = bg, Visible = false };
            finishTitle = MakeLabel("", 40, 36, 370, 34, 18F, FontStyle.Bold, ink);
            finishText = MakeLabel("", 40, 82, 360, 120, 9.5F, FontStyle.Regular, ink2);
            chkLaunch = MakeCheck("Start Keystone now", 220, o.Launch); chkLaunch.Left = 40;
            pageFinish.Controls.AddRange(new Control[] { finishTitle, finishText, chkLaunch });
            Controls.Add(pageFinish);
        }

        void Show(Panel p) { pageOptions.Visible = pageProgress.Visible = pageFinish.Visible = false; p.Visible = true; }

        void OnPrimary()
        {
            if (btnPrimary.Text == "Finish" || btnPrimary.Text == "Close")
            {
                if (ok && !o.Uninstall && chkLaunch.Checked) LaunchApp();
                Close(); return;
            }
            if (!o.Uninstall)
            {
                string dir = dirBox.Text.Trim();
                if (dir.Length == 0 || !Path.IsPathRooted(dir)) { MessageBox.Show(this, "Please choose a full folder path to install into.", "Keystone Setup", MessageBoxButtons.OK, MessageBoxIcon.Information); return; }
                o.InstallDir = dir; o.DesktopShortcut = chkDesktop.Checked; o.FileAssociation = chkAssoc.Checked;
            }
            else o.Purge = chkPurge.Checked;
            Run();
        }

        void Run()
        {
            Show(pageProgress); working = true; btnPrimary.Enabled = false; btnCancel.Enabled = false;
            Action<int, string> report = delegate (int pct, string msg) { BeginInvoke(new Action(delegate { bar.Value = Math.Max(0, Math.Min(100, pct)); stepLabel.Text = msg; })); };
            Thread t = new Thread(delegate ()
            {
                string error = null;
                try { if (o.Uninstall) Core.Uninstall(o, report); else Core.Install(o, report); }
                catch (Exception ex) { error = ex.Message; Log.Write("FAILED: " + ex); }
                Thread.Sleep(350);
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
                finishText.Text = o.Uninstall ? "Thanks for trying it. Your databases were not touched."
                    : "Find Keystone in the Start menu" + (o.DesktopShortcut ? " or on your desktop" : "") + ".\n\nPlug in your USB drive and Keystone will find your database on its own.";
                chkLaunch.Visible = !o.Uninstall; btnPrimary.Text = "Finish";
            }
            else
            {
                finishTitle.Text = o.Uninstall ? "Couldn’t finish removing" : "Setup couldn’t finish";
                finishText.Text = error + "\n\nNothing else was changed. A log is at " + Path.Combine(Path.GetTempPath(), "Keystone-Setup.log");
                chkLaunch.Visible = false; btnPrimary.Text = "Close"; btnPrimary.BackColor = bg; btnPrimary.ForeColor = ink;
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
