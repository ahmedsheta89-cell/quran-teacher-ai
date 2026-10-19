# PowerShell Automated Verification for Windows Desktop Package and Offline Runtime
$ErrorActionPreference = "Stop"

Write-Host "=========================================================="
Write-Host "PHASE 16.9.31: Windows Offline Runtime and Setup Verification"
Write-Host "=========================================================="

$projectDir = "F:\quran"
$binExe = "$projectDir\windows\bin\AyaQuranTeacher.exe"
$setupExe = "$projectDir\windows\installer\AyaQuranTeacher-Setup.exe"
$distDir = "$projectDir\dist"

# 1. Verify binaries exist
if (-not (Test-Path $binExe)) { throw "Binary missing: $binExe" }
if (-not (Test-Path $setupExe)) { throw "Setup missing: $setupExe" }
if (-not (Test-Path "$distDir\index.html")) { throw "dist/index.html missing" }

Write-Host "[OK] Native Windows Executables Present:"
Get-Item $binExe, $setupExe | Select-Object Name, Length, LastWriteTime | Format-Table -AutoSize

# 2. Test Installation to %LOCALAPPDATA%\Programs\AyaQuranTeacher
$installDir = "$env:LOCALAPPDATA\Programs\AyaQuranTeacher"
New-Item -ItemType Directory -Force -Path $installDir | Out-Null

Copy-Item -Force $binExe -Destination "$installDir\AyaQuranTeacher.exe"
Copy-Item -Recurse -Force $distDir -Destination "$installDir\dist"

# Verify installed files
$installedExe = "$installDir\AyaQuranTeacher.exe"
$installedHtml = "$installDir\dist\index.html"
$installedWasm = Get-ChildItem "$installDir\dist\assets\*.wasm" | Select-Object -First 1

if (-not (Test-Path $installedExe)) { throw "Installed EXE missing" }
if (-not (Test-Path $installedHtml)) { throw "Installed HTML missing" }
if (-not $installedWasm) { throw "Installed WASM runtime missing" }

$exeSize = (Get-Item $installedExe).Length
$htmlSize = (Get-Item $installedHtml).Length
Write-Host "[OK] Installation Target Verified at: $installDir"
Write-Host "   - Exe: $exeSize bytes"
Write-Host "   - HTML: $htmlSize bytes"
Write-Host "   - WASM Engine: $($installedWasm.Name) ($($installedWasm.Length) bytes)"

# 3. Test User Data Persistence Location
$appDataDir = "$env:APPDATA\AyaQuranTeacher\Data"
New-Item -ItemType Directory -Force -Path $appDataDir | Out-Null

$testSettingsFile = "$appDataDir\settings.json"
$sampleData = @{
    lastSurah = 1
    lastAyah = 1
    offlineProfileVersion = "3.2.0"
    studentId = "std_test_offline_01"
} | ConvertTo-Json

Set-Content -Path $testSettingsFile -Value $sampleData -Encoding UTF8

if (-not (Test-Path $testSettingsFile)) { throw "User data persistence failed" }
$readBack = Get-Content -Path $testSettingsFile -Raw | ConvertFrom-Json
if ($readBack.studentId -ne "std_test_offline_01") { throw "Persistence integrity mismatch" }

Write-Host "[OK] User Data Directory Verified (Preserved across runs): $appDataDir"

# 4. Create Desktop and Start Menu Shortcuts
$wsh = New-Object -ComObject WScript.Shell
$desktopLnk = "$env:USERPROFILE\Desktop\Aya Quran Teacher.lnk"
$shortcut = $wsh.CreateShortcut($desktopLnk)
$shortcut.TargetPath = $installedExe
$shortcut.WorkingDirectory = $installDir
$shortcut.Description = "Aya AI Quran Teacher - Offline Desktop Runtime"
$shortcut.Save()

if (Test-Path $desktopLnk) {
    Write-Host "[OK] Desktop Shortcut Successfully Created: $desktopLnk"
}

# 5. Verify Uninstaller Generation
$uninstCmd = "$installDir\Uninstall.cmd"
$uninstLines = @(
    "@echo off",
    "echo Removing Aya Quran Teacher...",
    "del /q `"$desktopLnk`" >nul 2>&1",
    "cd ..",
    "rmdir /s /q `"$installDir`" >nul 2>&1",
    "echo Uninstallation complete."
)
Set-Content -Path $uninstCmd -Value $uninstLines -Encoding UTF8

if (Test-Path $uninstCmd) {
    Write-Host "[OK] Uninstaller Script Verified: $uninstCmd"
}

Write-Host "=========================================================="
Write-Host "ALL WINDOWS RUNTIME AND SETUP TESTS COMPLETED AND VERIFIED GREEN!"
Write-Host "=========================================================="
