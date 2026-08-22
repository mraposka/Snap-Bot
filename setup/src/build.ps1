# SnapBot kurulum paketini yeniler.
#
# Ne zaman çalıştırmalı:
#   - Proje kodunu (bot.js, server.js, public/) değiştirdiğinde
#   - Installer.cs / Launcher.cs dosyalarını değiştirdiğinde
#
# Kullanım:  powershell -ExecutionPolicy Bypass -File setup\src\build.ps1

$ErrorActionPreference = "Stop"

$src     = Split-Path -Parent $MyInvocation.MyCommand.Path
$setup   = Split-Path -Parent $src
$project = Split-Path -Parent $setup
$csc     = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"

if (-not (Test-Path $csc)) { throw "csc.exe bulunamadı: $csc" }

Write-Host ""
Write-Host "SnapBot paketi yenileniyor" -ForegroundColor Cyan
Write-Host "  proje : $project"
Write-Host "  setup : $setup"
Write-Host ""

# 1) Exe'leri derle -----------------------------------------------------------
Write-Host "[1/2] Exe'ler derleniyor..." -ForegroundColor Cyan

& $csc /nologo /target:exe /platform:anycpu /optimize+ `
    /out:"$setup\SnapBot.exe" `
    /reference:System.dll /reference:System.Core.dll `
    "$src\Launcher.cs"
if ($LASTEXITCODE -ne 0) { throw "Launcher derlenemedi" }
Write-Host "  + SnapBot.exe" -ForegroundColor Green

& $csc /nologo /target:exe /platform:anycpu /optimize+ `
    /out:"$setup\SnapBot-Setup.exe" `
    /reference:System.dll /reference:System.Core.dll `
    /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll `
    "$src\Installer.cs"
if ($LASTEXITCODE -ne 0) { throw "Installer derlenemedi" }
Write-Host "  + SnapBot-Setup.exe" -ForegroundColor Green

# 2) Proje zip'ini güncelle ---------------------------------------------------
Write-Host ""
Write-Host "[2/2] Proje zip'i güncelleniyor..." -ForegroundColor Cyan

$staging = Join-Path $env:TEMP ("snapbot-pack-" + [guid]::NewGuid().ToString("N").Substring(0,8))
$root    = Join-Path $staging "Snap-Bot-master"
New-Item -ItemType Directory -Path $root -Force | Out-Null

# Uygulama için gereken dosyalar (kullanıcı verisi ve node_modules HARİÇ)
foreach ($f in @("bot.js", "server.js", "login.js", "package.json", "package-lock.json",
                 "README.md", ".env.example")) {
    $p = Join-Path $project $f
    if (Test-Path $p) { Copy-Item $p -Destination $root }
}
$pub = Join-Path $project "public"
if (Test-Path $pub) { Copy-Item $pub -Destination $root -Recurse }

$zip = Join-Path $setup "Snap-Bot-master.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($staging, $zip)
Remove-Item $staging -Recurse -Force

$kb = [math]::Round((Get-Item $zip).Length / 1KB, 1)
Write-Host "  + Snap-Bot-master.zip ($kb KB)" -ForegroundColor Green

Write-Host ""
Write-Host "Paket hazır. setup klasörünü başka makineye kopyalayabilirsin." -ForegroundColor Green
Write-Host ""
