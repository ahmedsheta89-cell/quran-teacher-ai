# PowerShell Automated Verification for Windows Desktop Package and Offline Runtime (PHASE 16.9.32)
$ErrorActionPreference = "Stop"

Write-Host "=========================================================="
Write-Host "PHASE 16.9.32: Windows Offline Runtime, Security & Setup Acceptance"
Write-Host "=========================================================="

$projectDir = "F:\quran"
$binExe = "$projectDir\windows\bin\AyaQuranTeacher.exe"
$setupExe = "$projectDir\windows\installer\AyaQuranTeacher-Setup.exe"
$portableZip = "$projectDir\windows\portable\AyaQuranTeacher-v3.2.0-windows-x64.zip"
$portableDir = "$projectDir\windows\portable\AyaQuranTeacher-v3.2.0-windows-x64"
$expectedOnnxBytes = 72705392

# ------------------------------------------------------------
# GATE 1: Verify Portable Package Completeness and Hashes
# ------------------------------------------------------------
Write-Host "`n[STEP 1] Auditing Portable Package Structure..."
if (-not (Test-Path $portableZip)) { throw "Portable zip archive missing: $portableZip" }
if (-not (Test-Path "$portableDir\AyaQuranTeacher.exe")) { throw "Portable executable missing" }
if (-not (Test-Path "$portableDir\dist\index.html")) { throw "Portable index.html missing" }

$portableOnnx = "$portableDir\dist\models\saboorhsn\quran-stt-int8.onnx"
if (-not (Test-Path $portableOnnx)) { throw "Portable ONNX model missing: $portableOnnx" }
$portableOnnxBytes = (Get-Item $portableOnnx).Length
if ($portableOnnxBytes -ne $expectedOnnxBytes) {
    throw "Portable ONNX model size mismatch: expected $expectedOnnxBytes, got $portableOnnxBytes"
}

$zipSize = (Get-Item $portableZip).Length
Write-Host "  -> [OK] Portable ZIP Archive Verified: $zipSize bytes"
Write-Host "  -> [OK] Embedded ONNX Speech Model Verified: $portableOnnxBytes bytes"

# ------------------------------------------------------------
# GATE 2: Test Silent Installation via Setup Installer
# ------------------------------------------------------------
Write-Host "`n[STEP 2] Executing Silent Setup Installer..."
if (-not (Test-Path $setupExe)) { throw "Setup installer missing: $setupExe" }

$installDir = "$env:LOCALAPPDATA\Programs\AyaQuranTeacher"
# Run installer silently
$setupProc = Start-Process -FilePath $setupExe -ArgumentList "/silent" -Wait -PassThru
if ($setupProc.ExitCode -ne 0) {
    throw "Setup installer exited with error code: $($setupProc.ExitCode)"
}

$installedExe = "$installDir\AyaQuranTeacher.exe"
$installedHtml = "$installDir\dist\index.html"
$installedOnnx = "$installDir\dist\models\saboorhsn\quran-stt-int8.onnx"
$installedUninst = "$installDir\Uninstall.cmd"

if (-not (Test-Path $installedExe)) { throw "Installed binary missing: $installedExe" }
if (-not (Test-Path $installedHtml)) { throw "Installed HTML missing: $installedHtml" }
if (-not (Test-Path $installedOnnx)) { throw "Installed ONNX model missing: $installedOnnx" }
if (-not (Test-Path $installedUninst)) { throw "Uninstaller script missing: $installedUninst" }

$installedOnnxBytes = (Get-Item $installedOnnx).Length
if ($installedOnnxBytes -ne $expectedOnnxBytes) {
    throw "Installed ONNX model size mismatch: expected $expectedOnnxBytes, got $installedOnnxBytes"
}

# Verify Shortcuts & Registry
$desktopLnk = "$env:USERPROFILE\Desktop\Aya Quran Teacher.lnk"
if (-not (Test-Path $desktopLnk)) { throw "Desktop shortcut missing: $desktopLnk" }
$regPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\AyaQuranTeacher"
if (-not (Test-Path $regPath)) { throw "Add/Remove Programs registry entry missing: $regPath" }

Write-Host "  -> [OK] Installation directory verified at: $installDir"
Write-Host "  -> [OK] Desktop shortcut verified: $desktopLnk"
Write-Host "  -> [OK] Add/Remove Programs registry verified"

# ------------------------------------------------------------
# GATE 3: Start Loopback Server & Security Protocol Tests
# ------------------------------------------------------------
Write-Host "`n[STEP 3] Launching AyaQuranTeacher.exe & Testing HTTP / Security Rules..."
$serverProc = Start-Process -FilePath $installedExe -PassThru

# Give it up to 5 seconds to bind to an available port
$boundPort = 0
for ($i = 0; $i -lt 50; $i++) {
    Start-Sleep -Milliseconds 100
    $connections = Get-NetTCPConnection -OwningProcess $serverProc.Id -State Listen -ErrorAction SilentlyContinue
    if ($connections) {
        $boundPort = $connections[0].LocalPort
        break
    }
}

if ($boundPort -eq 0) {
    Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
    throw "Failed to detect listening TCP port for PID $($serverProc.Id)"
}

Write-Host "  -> [OK] C++ Loopback Server listening on 127.0.0.1:$boundPort"

function Send-RawHttpRequest {
    param([string]$ip, [int]$port, [string]$rawRequest)
    $client = New-Object System.Net.Sockets.TcpClient($ip, $port)
    $stream = $client.GetStream()
    $writer = New-Object System.IO.StreamWriter($stream, [System.Text.Encoding]::ASCII)
    $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::ASCII)
    $writer.Write($rawRequest)
    $writer.Flush()
    $responseLine = $reader.ReadLine()
    $client.Close()
    return $responseLine
}

try {
    # 3.1 Test Root Index Serving (200 OK)
    $rootRes = Invoke-WebRequest -Uri "http://127.0.0.1:$boundPort/" -UseBasicParsing -TimeoutSec 5
    if ($rootRes.StatusCode -ne 200 -or -not ($rootRes.Content -match "quran|html|Aya")) {
        throw "Root HTTP 200 verification failed: status $($rootRes.StatusCode)"
    }
    Write-Host "  -> [OK] HTTP GET / -> 200 OK (HTML Payload: $($rootRes.RawContentLength) bytes)"

    # 3.2 Test ONNX Model Serving (200 OK with correct byte size)
    $modelUrl = "http://127.0.0.1:$boundPort/models/saboorhsn/quran-stt-int8.onnx"
    $headRes = Invoke-WebRequest -Uri $modelUrl -Method Head -UseBasicParsing -TimeoutSec 5
    $contentLen = [int64]$headRes.Headers["Content-Length"]
    if ($headRes.StatusCode -ne 200 -or $contentLen -ne $expectedOnnxBytes) {
        throw "Model endpoint HEAD verification failed: expected $expectedOnnxBytes bytes, got $contentLen"
    }
    Write-Host "  -> [OK] HTTP HEAD /models/.../quran-stt-int8.onnx -> 200 OK (Exact: $contentLen bytes)"

    # 3.3 Test Path Traversal Protection (403 Forbidden via raw socket to bypass client URI normalization)
    $rawTraversal = "GET /../../windows/src/AyaQuranTeacher.cpp HTTP/1.1`r`nHost: 127.0.0.1`r`nConnection: close`r`n`r`n"
    $traversalLine = Send-RawHttpRequest -ip "127.0.0.1" -port $boundPort -rawRequest $rawTraversal
    if ($traversalLine -notmatch "403 Forbidden") {
        throw "Path traversal security check failed! Expected 403 Forbidden, got '$traversalLine'"
    }
    Write-Host "  -> [OK] HTTP GET /../../ (Raw Path Traversal) -> 403 Forbidden (Security Defense Active)"

    # 3.4 Test Encoded Traversal (%2e%2e -> 403 Forbidden)
    $rawEncoded = "GET /%2e%2e/%2e%2e/windows/src/AyaQuranTeacher.cpp HTTP/1.1`r`nHost: 127.0.0.1`r`nConnection: close`r`n`r`n"
    $encodedLine = Send-RawHttpRequest -ip "127.0.0.1" -port $boundPort -rawRequest $rawEncoded
    if ($encodedLine -notmatch "403 Forbidden") {
        throw "Encoded traversal security check failed! Expected 403 Forbidden, got '$encodedLine'"
    }
    Write-Host "  -> [OK] HTTP GET /%2e%2e/ (Encoded Traversal) -> 403 Forbidden (Security Defense Active)"

    # 3.5 Test HTTP Method Restriction (405 Method Not Allowed on POST)
    $rawPost = "POST / HTTP/1.1`r`nHost: 127.0.0.1`r`nContent-Length: 0`r`nConnection: close`r`n`r`n"
    $postLine = Send-RawHttpRequest -ip "127.0.0.1" -port $boundPort -rawRequest $rawPost
    if ($postLine -notmatch "405 Method Not Allowed") {
        throw "HTTP Method check failed! Expected 405 Method Not Allowed, got '$postLine'"
    }
    Write-Host "  -> [OK] HTTP POST / -> 405 Method Not Allowed (Security Defense Active)"

} finally {
    # Terminate server process and any spawned Edge window
    Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
    Get-Process -Name "msedge" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match "AyaQuranTeacher" } | Stop-Process -Force -ErrorAction SilentlyContinue
}

# ------------------------------------------------------------
# GATE 4: Test Local Data Persistence Invariant Across Uninstall
# ------------------------------------------------------------
Write-Host "`n[STEP 4] Verifying Local User Data Preservation Invariant..."
$appDataDir = "$env:APPDATA\AyaQuranTeacher\Data"
New-Item -ItemType Directory -Force -Path $appDataDir | Out-Null
$testRecordFile = "$appDataDir\acceptance_student_record.json"
$recordData = @{
    studentId = "std_preservation_007"
    surahsMemorized = @(1, 112, 113, 114)
    lastRevision = (Get-Date).ToString("o")
    retentionScore = 99.4
} | ConvertTo-Json
Set-Content -Path $testRecordFile -Value $recordData -Encoding UTF8

# Execute Uninstaller
Write-Host "  -> Running uninstallation script: $installedUninst"
cmd.exe /c "call `"$installedUninst`""

# Verify program removal (wait up to 5 seconds for directory cleanup)
$removed = $false
for ($i = 0; $i -lt 50; $i++) {
    Start-Sleep -Milliseconds 100
    if (-not (Test-Path $installedExe)) {
        $removed = $true
        break
    }
}
if (-not $removed) { throw "Uninstallation failed: binary still exists at $installedExe" }
if (Test-Path $desktopLnk) { throw "Uninstallation failed: desktop shortcut still exists" }
if (Test-Path $regPath) { throw "Uninstallation failed: registry entry still exists" }
Write-Host "  -> [OK] Program files, shortcuts, and registry entries cleanly removed."

# CRITICAL INVARIANT: Verify user data was NOT wiped
if (-not (Test-Path $testRecordFile)) {
    throw "DATA LOSS VIOLATION: %APPDATA%\AyaQuranTeacher\Data was wiped during uninstall!"
}
$preservedData = Get-Content -Path $testRecordFile -Raw | ConvertFrom-Json
if ($preservedData.studentId -ne "std_preservation_007") {
    throw "Data corruption detected in preserved user file!"
}
Write-Host "  -> [OK] CRITICAL INVARIANT CONFIRMED: Student data in %APPDATA%\AyaQuranTeacher\Data preserved intact!"
Remove-Item -Force $testRecordFile

Write-Host "`n=========================================================="
Write-Host "ALL PHASE 16.9.32 WINDOWS RUNTIME & INSTALLER GATES PASSED (100% VERIFIED)!"
Write-Host "=========================================================="
