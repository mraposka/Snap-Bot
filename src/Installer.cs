// SnapBot Kurulum
// Yönetici izni GEREKTİRMEZ: her şey %LOCALAPPDATA%\SnapBot altına kurulur.
//   1) Node.js kur (standalone zip -> MSI -> winget sırasıyla)
//   2) Proje zip'ini aç
//   3) npm install (Puppeteer + Chromium indirir, internet gerekir)
//   4) Masaüstüne SnapBot.exe koy
using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;

class Installer
{
    static string SetupDir;
    static string InstallDir;
    static string NodeDir;
    static string AppDir;

    static void Main(string[] args)
    {
        try { Console.OutputEncoding = Encoding.UTF8; } catch { }
        Console.Title = "SnapBot Kurulum";

        SetupDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
        InstallDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SnapBot");
        NodeDir = Path.Combine(InstallDir, "node");
        AppDir = Path.Combine(InstallDir, "app");

        Header();

        try
        {
            Step(1, "Node.js hazırlanıyor");
            string nodeExe = EnsureNode();
            Ok("Node.js hazır: " + Run(nodeExe, "-v", null, 15000).Trim());

            Step(2, "Uygulama dosyaları açılıyor");
            ExtractApp();
            Ok("Uygulama klasörü: " + AppDir);

            Step(3, "Kütüphaneler kuruluyor (npm install)");
            Info("Bu adım Chromium indirir, birkaç dakika sürebilir. İnternet gerekir.");
            NpmInstall(nodeExe);
            Ok("Kütüphaneler kuruldu.");

            Step(4, "Masaüstü kısayolu oluşturuluyor");
            string desktopExe = CopyLauncher();
            Ok("Oluşturuldu: " + desktopExe);

            Console.WriteLine();
            Line('=');
            Console.ForegroundColor = ConsoleColor.Green;
            Console.WriteLine("  KURULUM TAMAMLANDI");
            Console.ResetColor();
            Console.WriteLine();
            Console.WriteLine("  Masaüstündeki \"SnapBot\" simgesine çift tıklayarak başlatabilirsin.");
            Console.WriteLine("  Panel tarayıcıda açılacak:  http://localhost:3000");
            Line('=');
            Console.WriteLine();
            Console.Write("Şimdi başlatmak ister misin? (E/H): ");
            var k = Console.ReadLine();
            if (k != null && (k.Trim().ToLower() == "e" || k.Trim().ToLower() == "evet"))
                Process.Start(new ProcessStartInfo(desktopExe) { UseShellExecute = true });
        }
        catch (Exception ex)
        {
            Console.WriteLine();
            Console.ForegroundColor = ConsoleColor.Red;
            Console.WriteLine("KURULUM BAŞARISIZ");
            Console.WriteLine(ex.Message);
            Console.ResetColor();
            Console.WriteLine();
            Console.WriteLine("Yardım için bu ekranın görüntüsünü al.");
            Console.Write("Kapatmak için Enter'a bas...");
            Console.ReadLine();
            Environment.Exit(1);
        }
    }

    // ---------------------------------------------------------------- Node ---
    static string EnsureNode()
    {
        // 1) Daha önce buraya kurulmuş mu?
        string local = Path.Combine(NodeDir, "node.exe");
        if (File.Exists(local)) { Info("Node zaten kurulu (yerel)."); return local; }

        // 2) Sistemde yeterli sürüm var mı? (18+)
        string sys = FindInPath("node.exe");
        if (sys != null)
        {
            try
            {
                string v = Run(sys, "-v", null, 15000).Trim().TrimStart('v');
                int major = int.Parse(v.Split('.')[0]);
                if (major >= 18) { Info("Sistemde Node " + v + " bulundu, o kullanılacak."); return sys; }
                Info("Sistemdeki Node çok eski (" + v + "), yenisi kurulacak.");
            }
            catch { }
        }

        // 3) Standalone zip (yönetici izni gerekmez — tercih edilen yol)
        string zip = FirstFile("node-*-win-x64.zip");
        if (zip != null)
        {
            Info("Node standalone paketten kuruluyor...");
            ExtractStripRoot(zip, NodeDir);
            if (File.Exists(local)) return local;
            Info("Standalone açılamadı, MSI denenecek.");
        }

        // 4) MSI (yönetici izni isteyebilir)
        string msi = FirstFile("node-*-x64.msi");
        if (msi != null)
        {
            Info("Node MSI ile kuruluyor (yönetici onayı isteyebilir)...");
            Run("msiexec.exe", "/i \"" + msi + "\" /passive /norestart", null, 600000);
            string found = FindInPath("node.exe") ?? ProgramFilesNode();
            if (found != null) return found;
            Info("MSI ile kurulamadı, winget denenecek.");
        }

        // 5) winget (son çare, internet gerekir)
        Info("Node winget ile kuruluyor...");
        try
        {
            Run("winget.exe",
                "install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements",
                null, 900000);
        }
        catch { }
        string w = FindInPath("node.exe") ?? ProgramFilesNode();
        if (w != null) return w;

        throw new Exception(
            "Node.js kurulamadı.\n" +
            "setup klasöründe node-*-win-x64.zip veya node-*-x64.msi dosyası olduğundan emin ol,\n" +
            "ya da https://nodejs.org adresinden Node.js LTS kurup bu kurulumu tekrar çalıştır.");
    }

    static string ProgramFilesNode()
    {
        foreach (var b in new[] {
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86) })
        {
            string p = Path.Combine(b, "nodejs", "node.exe");
            if (File.Exists(p)) return p;
        }
        return null;
    }

    // ----------------------------------------------------------------- App ---
    static void ExtractApp()
    {
        string zip = FirstFile("*.zip", "node-");
        if (zip == null)
            throw new Exception("Proje zip dosyası bulunamadı.\nsetup klasörüne GitHub'dan indirdiğin proje zip'ini koy.");

        if (Directory.Exists(AppDir))
        {
            // Kullanıcı verisini koru: data/ ve sessions/ klasörlerine dokunma
            foreach (var d in Directory.GetDirectories(AppDir))
            {
                string name = Path.GetFileName(d);
                if (name == "data" || name == "sessions" || name == "node_modules") continue;
                TryDelete(() => Directory.Delete(d, true));
            }
            foreach (var f in Directory.GetFiles(AppDir)) TryDelete(() => File.Delete(f));
        }
        ExtractStripRoot(zip, AppDir);

        if (!File.Exists(Path.Combine(AppDir, "server.js")))
            throw new Exception("Proje zip'i beklenen dosyaları içermiyor (server.js yok).");
    }

    static void NpmInstall(string nodeExe)
    {
        // ÖNEMLİ: Bazı paketlerin kurulum sonrası betiği (ör. Puppeteer) `node`
        // komutunu PATH üzerinden çağırır. Taşınabilir Node kullanıldığında PATH'te
        // olmadığı için kurulum çökerdi; bu yüzden Node klasörünü PATH'e ekliyoruz.
        string nodeDir = Path.GetDirectoryName(nodeExe);

        string cli = Path.Combine(nodeDir, "node_modules", "npm", "bin", "npm-cli.js");
        if (!File.Exists(cli))
        {
            string alt = Path.Combine(NodeDir, "node_modules", "npm", "bin", "npm-cli.js");
            cli = File.Exists(alt) ? alt : null;
        }

        int code;
        if (cli != null)
            code = RunLive(nodeExe, "\"" + cli + "\" install --no-audit --no-fund", AppDir, nodeDir);
        else
            code = RunLive("cmd.exe", "/c npm install --no-audit --no-fund", AppDir, nodeDir);

        if (code != 0)
            throw new Exception("npm install başarısız oldu (kod " + code + ").\nİnternet bağlantını kontrol edip kurulumu tekrar çalıştır.");
    }

    static string CopyLauncher()
    {
        string src = Path.Combine(SetupDir, "SnapBot.exe");
        if (!File.Exists(src))
            throw new Exception("SnapBot.exe setup klasöründe bulunamadı.");

        string dst = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "SnapBot.exe");
        File.Copy(src, dst, true);

        // Başlat menüsüne de bir kopya koy
        try
        {
            string sm = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.Programs), "SnapBot");
            Directory.CreateDirectory(sm);
            File.Copy(src, Path.Combine(sm, "SnapBot.exe"), true);
        }
        catch { }

        return dst;
    }

    // ------------------------------------------------------------ Yardımcı ---
    static string FirstFile(string pattern, string excludePrefix = null)
    {
        var files = Directory.GetFiles(SetupDir, pattern)
            .Where(f => excludePrefix == null ||
                        !Path.GetFileName(f).StartsWith(excludePrefix, StringComparison.OrdinalIgnoreCase))
            .OrderBy(f => f).ToArray();
        return files.Length > 0 ? files[0] : null;
    }

    // Zip'i açar ama tek kök klasörü atlar (node-v24.../  ya da Snap-Bot-master/)
    static void ExtractStripRoot(string zipPath, string target)
    {
        Directory.CreateDirectory(target);
        using (var zip = ZipFile.OpenRead(zipPath))
        {
            string root = null;
            var names = zip.Entries.Select(e => e.FullName.Replace('\\', '/')).ToList();
            var tops = names.Select(n => n.Split('/')[0]).Distinct().ToList();
            if (tops.Count == 1) root = tops[0] + "/";

            int total = zip.Entries.Count, done = 0, lastPct = -1;
            foreach (var entry in zip.Entries)
            {
                string rel = entry.FullName.Replace('\\', '/');
                if (root != null && rel.StartsWith(root)) rel = rel.Substring(root.Length);
                done++;
                if (rel.Length == 0) continue;

                string outPath = Path.Combine(target, rel.Replace('/', '\\'));
                if (rel.EndsWith("/")) { Directory.CreateDirectory(outPath); continue; }

                Directory.CreateDirectory(Path.GetDirectoryName(outPath));
                entry.ExtractToFile(outPath, true);

                int pct = (int)((done / (double)total) * 100);
                if (pct != lastPct && pct % 10 == 0) { Console.Write("  " + pct + "%\r"); lastPct = pct; }
            }
            Console.Write("        \r");
        }
    }

    static string FindInPath(string exe)
    {
        string path = Environment.GetEnvironmentVariable("PATH") ?? "";
        foreach (var dir in path.Split(';'))
        {
            if (dir.Trim().Length == 0) continue;
            try { string p = Path.Combine(dir.Trim(), exe); if (File.Exists(p)) return p; } catch { }
        }
        return null;
    }

    static string Run(string exe, string args, string cwd, int timeoutMs)
    {
        var psi = new ProcessStartInfo(exe, args)
        {
            UseShellExecute = false, RedirectStandardOutput = true,
            RedirectStandardError = true, CreateNoWindow = true,
        };
        if (cwd != null) psi.WorkingDirectory = cwd;
        using (var p = Process.Start(psi))
        {
            string o = p.StandardOutput.ReadToEnd();
            p.StandardError.ReadToEnd();
            p.WaitForExit(timeoutMs);
            return o;
        }
    }

    // Çıktıyı canlı gösterir (npm install uzun sürdüğü için).
    // pathPrepend: alt süreçlerin `node` komutunu bulabilmesi için PATH'in başına eklenir.
    static int RunLive(string exe, string args, string cwd, string pathPrepend = null)
    {
        var psi = new ProcessStartInfo(exe, args)
        {
            UseShellExecute = false, RedirectStandardOutput = true,
            RedirectStandardError = true, CreateNoWindow = true, WorkingDirectory = cwd,
        };
        if (pathPrepend != null)
        {
            string cur = Environment.GetEnvironmentVariable("PATH") ?? "";
            psi.EnvironmentVariables["PATH"] = pathPrepend + ";" + cur;
        }
        using (var p = new Process())
        {
            p.StartInfo = psi;
            p.OutputDataReceived += (s, e) => { if (e.Data != null) Console.WriteLine("  " + e.Data); };
            p.ErrorDataReceived += (s, e) => { if (e.Data != null) Console.WriteLine("  " + e.Data); };
            p.Start();
            p.BeginOutputReadLine();
            p.BeginErrorReadLine();
            p.WaitForExit();
            return p.ExitCode;
        }
    }

    static void TryDelete(Action a) { try { a(); } catch { } }

    // -------------------------------------------------------------- Görsel ---
    static void Header()
    {
        Console.WriteLine();
        Line('=');
        Console.WriteLine("   SnapBot Kurulum");
        Console.WriteLine("   Kurulum yeri: " + InstallDir);
        Line('=');
        Console.WriteLine();
    }
    static void Line(char c) { Console.WriteLine(new string(c, 64)); }
    static void Step(int n, string t)
    {
        Console.WriteLine();
        Console.ForegroundColor = ConsoleColor.Cyan;
        Console.WriteLine("[" + n + "/4] " + t);
        Console.ResetColor();
    }
    static void Ok(string t)
    {
        Console.ForegroundColor = ConsoleColor.Green;
        Console.WriteLine("  + " + t);
        Console.ResetColor();
    }
    static void Info(string t) { Console.WriteLine("  - " + t); }
}
