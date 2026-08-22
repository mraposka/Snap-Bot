// SnapBot Başlatıcı (masaüstüne kopyalanır)
// Sunucuyu başlatır, panel hazır olunca tarayıcıda açar.
// Bu pencere kapatılınca sunucu da kapanır.
using System;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Text;

class Launcher
{
    static Process server;

    static int Main(string[] args)
    {
        try { Console.OutputEncoding = Encoding.UTF8; } catch { }
        Console.Title = "SnapBot";

        string install = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SnapBot");
        string appDir = Path.Combine(install, "app");
        string nodeExe = Path.Combine(install, "node", "node.exe");

        Console.WriteLine();
        Console.WriteLine("  SnapBot başlatılıyor...");
        Console.WriteLine();

        if (!File.Exists(Path.Combine(appDir, "server.js")))
            return Fail("Uygulama bulunamadı: " + appDir + "\n  Önce SnapBot-Setup.exe ile kurulumu çalıştır.");

        if (!File.Exists(nodeExe))
        {
            nodeExe = FindInPath("node.exe");
            if (nodeExe == null)
                return Fail("Node.js bulunamadı.\n  Önce SnapBot-Setup.exe ile kurulumu çalıştır.");
        }

        int port = FreePort(3000);

        var psi = new ProcessStartInfo(nodeExe, "server.js")
        {
            WorkingDirectory = appDir,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };
        psi.EnvironmentVariables["PORT"] = port.ToString();
        // Alt süreçler (Puppeteer vb.) `node` komutunu bulabilsin
        psi.EnvironmentVariables["PATH"] =
            Path.GetDirectoryName(nodeExe) + ";" + (Environment.GetEnvironmentVariable("PATH") ?? "");

        server = new Process { StartInfo = psi };
        server.OutputDataReceived += (s, e) => { if (e.Data != null) Console.WriteLine("  " + e.Data); };
        server.ErrorDataReceived += (s, e) => { if (e.Data != null) Console.WriteLine("  " + e.Data); };

        // Bu pencere kapanırsa sunucuyu da kapat
        AppDomain.CurrentDomain.ProcessExit += (s, e) => Stop();
        Console.CancelKeyPress += (s, e) => { Stop(); Environment.Exit(0); };

        server.Start();
        server.BeginOutputReadLine();
        server.BeginErrorReadLine();

        string url = "http://localhost:" + port;
        if (WaitForPort(port, 40000))
        {
            Console.WriteLine();
            Console.ForegroundColor = ConsoleColor.Green;
            Console.WriteLine("  Panel hazır: " + url);
            Console.ResetColor();
            Console.WriteLine("  Tarayıcı açılıyor...");
            Console.WriteLine();
            Console.WriteLine("  (Bu pencereyi kapatırsan SnapBot durur.)");
            Console.WriteLine();
            try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch { }
        }
        else
        {
            Console.ForegroundColor = ConsoleColor.Yellow;
            Console.WriteLine("  Sunucu beklenenden yavaş açıldı. Tarayıcıdan dene: " + url);
            Console.ResetColor();
        }

        server.WaitForExit();
        Stop();
        return 0;
    }

    static void Stop()
    {
        try { if (server != null && !server.HasExited) KillTree(server.Id); } catch { }
    }

    // Node ve alt süreçlerini (Chrome dahil) topluca kapat
    static void KillTree(int pid)
    {
        try
        {
            Process.Start(new ProcessStartInfo("taskkill.exe", "/PID " + pid + " /T /F")
            { UseShellExecute = false, CreateNoWindow = true }).WaitForExit(10000);
        }
        catch { }
    }

    static int FreePort(int start)
    {
        for (int p = start; p < start + 50; p++) if (!InUse(p)) return p;
        return start;
    }

    static bool InUse(int port)
    {
        try
        {
            using (var c = new TcpClient())
            {
                var ar = c.BeginConnect("127.0.0.1", port, null, null);
                bool ok = ar.AsyncWaitHandle.WaitOne(250);
                if (ok) { try { c.EndConnect(ar); return true; } catch { return false; } }
                return false;
            }
        }
        catch { return false; }
    }

    static bool WaitForPort(int port, int timeoutMs)
    {
        var sw = Stopwatch.StartNew();
        while (sw.ElapsedMilliseconds < timeoutMs)
        {
            if (InUse(port)) return true;
            if (server != null && server.HasExited) return false;
            System.Threading.Thread.Sleep(400);
        }
        return false;
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

    static int Fail(string msg)
    {
        Console.ForegroundColor = ConsoleColor.Red;
        Console.WriteLine("  HATA: " + msg);
        Console.ResetColor();
        Console.WriteLine();
        Console.Write("  Kapatmak için Enter'a bas...");
        Console.ReadLine();
        return 1;
    }
}
