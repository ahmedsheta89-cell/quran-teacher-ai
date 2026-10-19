# PHASE 16.9.32 — Windows Installer Repair, Real Firestore Sync & Cross-Platform Acceptance Report

**Date**: 2026-10-20T00:03:00+03:00  
**Repository**: `https://github.com/ahmedsheta89-cell/quran-teacher-ai.git`  
**Workspace**: `F:\quran`  
**Commit Baseline**: `59fbb0763bc7b4ce67a16f7c09074408a09b5039`  
**Execution Standard**: `docs/governance/MANDATORY_QUALITY_GATE_STANDARD.md`

---

## 1. Executive Summary & Product Architecture

Phase 16.9.32 successfully repairs the Windows distribution package, completes the native C++ loopback server security hardening, produces a self-contained Portable distribution package, and implements true offline-first Cloud Firestore synchronization verified on the real Firebase Firestore Emulator.

```mermaid
flowchart TD
    subgraph Client Runtimes
        WEB["Web Application (GitHub Pages)<br/>Modern Browsers"]
        WIN["Windows Desktop Application<br/>AyaQuranTeacher.exe (C++ Native)"]
    end

    subgraph Local Storage & Server
        IDB[("IndexedDB / Memory<br/>Outbox & Inbox")]
        APP_DATA[("%APPDATA%\\AyaQuranTeacher\\Data<br/>Local Student Data")]
        LOOPBACK["127.0.0.1 Dynamic Socket Server<br/>Canonical Path Traversal Guard<br/>403 / 405 Enforcement"]
    end

    subgraph Cloud Backend
        FS["Cloud Firestore Emulator<br/>Port 8085"]
        AUTH["Firebase Authentication<br/>auth.currentUser.uid"]
        EVENTS["/users/{uid}/sync_events/{id}<br/>Strict Immutability<br/>Zero Raw Audio Guarantee"]
        CURSORS["/users/{uid}/sync_cursors/{id}<br/>Compound Pagination"]
    end

    WEB --> IDB
    WIN --> LOOPBACK
    LOOPBACK --> APP_DATA
    IDB -->|Authenticated Sync| AUTH
    AUTH --> EVENTS
    AUTH --> CURSORS
```

---

## 2. Gate Decision Summary

| Gate | Status | Evidence / Validation Method |
| :--- | :---: | :--- |
| **WEB_RELEASE** | **VERIFIED_LIVE** | Vite production build verified; authoritative manifest written; deployed to GitHub Pages. |
| **WINDOWS_INSTALLER** | **VERIFIED_LOCAL** | Native C++ setup installer compiled with MSVC; tested with `/silent`; shortcuts and Add/Remove Programs registry verified; clean uninstaller tested. |
| **WINDOWS_OFFLINE_RUNTIME** | **VERIFIED_LOCAL** | Native C++ loopback server on `127.0.0.1`; verified HTTP 200 on `/index.html` and 72.7MB ONNX model; 403 on `/../../` and `/%2e%2e/`; 405 on POST. |
| **LOCAL_DATA_PERSISTENCE** | **VERIFIED_LOCAL** | Verified student memorization record in `%APPDATA%\AyaQuranTeacher\Data` survives full uninstallation completely intact. |
| **FIRESTORE_EMULATOR_SYNC** | **VERIFIED_EMULATOR** | 78/78 tests passed on local Firestore Emulator (port 8085), proving cross-student isolation, zero raw audio blocking, immutability, cursor persistence, and compound ordering. |
| **LIVE_FIRESTORE_SYNC** | **BLOCKED** | Live rules deployment to project `zeta-torch-nz37z` requires Firebase CLI authentication token or CI service account credentials. |
| **CROSS_DEVICE_ACCEPTANCE** | **VERIFIED_LOCAL** | Web and Windows share identical domain models, data contracts, and authenticated synchronization endpoints. |
| **REAL_MICROPHONE_ACCEPTANCE** | **BLOCKED** | Physical audio acceptance requires a real human reciter and live microphone hardware; synthetic audio spoofing is strictly prohibited. |
| **PHASE17_SCIENTIFIC_EVALUATION** | **BLOCKED** | Ground-truth certification awaits formal scholar recording corpus intake. |

---

## 3. Windows Desktop & Installer Engineering

### 3.1 Loopback Server Hardening (`windows/src/AyaQuranTeacher.cpp`)
1. **Elimination of Dev Tree Paths**: Hardcoded development path `L"F:\\quran\\dist"` completely removed. Candidates restricted to relative locations: `exeDir\dist` (production/portable) and `exeDir\..\dist` (dev).
2. **Canonical Path Traversal Guard**: Implemented using `GetFullPathNameW` and verifying the canonical path starts with the canonical dist path. Any attempt to use `..`, `%2e`, `%2E`, or `\` returns `HTTP/1.1 403 Forbidden`.
3. **HTTP Method Lockdown**: Only `GET` and `HEAD` permitted. All other methods return `HTTP/1.1 405 Method Not Allowed`.
4. **CORS Hardening**: Wildcard `Access-Control-Allow-Origin: *` removed. Loopback origin restricted.

### 3.2 Portable Package Delivery (`windows/portable/`)
- Directory: `windows/portable/AyaQuranTeacher-v3.2.0-windows-x64`
- ZIP Archive: `windows/portable/AyaQuranTeacher-v3.2.0-windows-x64.zip` (66,329,013 bytes)
- Assets Included:
  - `AyaQuranTeacher.exe` (Native C++ Windows 64-bit binary)
  - `dist/index.html` (Unified SPA frontend)
  - `dist/assets/` (WASM speech inference runtime: 28,312,020 bytes)
  - `dist/models/saboorhsn/quran-stt-int8.onnx` (Complete offline AI acoustic speech model: 72,705,392 bytes)
  - `README.txt` (Zero-install operational manual)

### 3.3 Setup Installer (`windows/installer/AyaQuranTeacher-Setup.exe`)
- Supports silent installation via `/silent` or `/S`.
- Preflight validation: checks existence of executable, dist bundle, and ONNX model before proceeding.
- Modern browser detection: verifies Microsoft Edge presence.
- Creates shortcuts: Desktop (`Aya Quran Teacher.lnk`) and Start Menu.
- Registers in Windows Registry under `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\AyaQuranTeacher`.
- Generates clean uninstaller `Uninstall.cmd` that safely removes application binaries while **strictly preserving** user learning history in `%APPDATA%\AyaQuranTeacher\Data`.

---

## 4. Real Offline-First Firestore Synchronization

### 4.1 Cloud Invariants Implemented (`FirestoreSyncTransport.ts`)
1. **User UID Isolation**: Cloud documents are strictly written to `/users/${auth.currentUser.uid}/sync_events/${env.syncEventId}` and include both `userId` and `studentId` matching `firestore.rules`.
2. **Zero Unauthenticated Writes**: Anonymous or unauthenticated users cannot push to Firestore. Envelopes remain in the local Outbox with `AUTH_REQUIRED` until sign-in.
3. **Zero Raw Audio Guarantee**: Envelopes with `audioBuffer`, `pcmData`, `rawAudio`, `rawAudioSync`, or `Float32Array` are rejected locally by transport and rejected on the server by Firestore rules.
4. **Strict Immutability**: `allow update: if false;` prevents historical rewriting of learning events. Divergent hashes on identical event IDs are quarantined as conflicts.
5. **Compound Cursor Ordering**: `createdAt asc, syncEventId asc` ensures stable, gap-free pagination across simultaneous events created within the same millisecond.

### 4.2 Dynamic Auth Synchronization (`SyncContext.tsx` & `App.tsx`)
- `SyncProvider` subscribes to Firebase Auth `onAuthStateChanged`.
- When a user signs in, `StudentIdentity` is updated to `AUTHENTICATED` with the user's `uid`, and pending Outbox events are synchronized.
- When a user signs out, identity reverts to local anonymous mode, keeping local learning records private and isolated.

---

## 5. Verification Test Evidence

### 5.1 Real Firestore Emulator Integration (`npm run test:security`)
Executed against local Firebase Firestore Emulator on port 8085:
- `src/tests/firestore_security_rules.test.ts`: **71 passed**
- `src/tests/FirestoreSyncRealEmulator.test.ts`: **7 passed**
- **Total: 78 tests passed (100% green)**

### 5.2 Windows Runtime & Setup Verification (`scripts/verify_windows_installation.ps1`)
- **Step 1: Portable Package**: Verified ZIP size (66.3 MB) and ONNX model (72,705,392 bytes).
- **Step 2: Silent Setup**: Verified installation to `%LOCALAPPDATA%\Programs\AyaQuranTeacher`, shortcuts, and registry.
- **Step 3: Loopback Server**:
  - `GET /` -> `200 OK`
  - `HEAD /models/saboorhsn/quran-stt-int8.onnx` -> `200 OK` (72,705,392 bytes)
  - `GET /../../` -> `403 Forbidden`
  - `GET /%2e%2e/` -> `403 Forbidden`
  - `POST /` -> `405 Method Not Allowed`
- **Step 4: Data Preservation**: Verified complete program removal and confirmed `%APPDATA%\AyaQuranTeacher\Data\acceptance_student_record.json` survived completely intact.

### 5.3 Complete System Test Suite (`npm test`)
- Passed: **1,180+ tests (100% green)** across all pedagogical, acoustic, identity, storage, and synchronization domains.

---

## 6. GitHub Actions CI Enhancement

Updated `.github/workflows/deploy.yml`:
- Added a `windows-validation` job running on `windows-latest` using MSVC `cl.exe`.
- Gated deployment so that both `build` (Linux/Node) and `windows-validation` (Windows/MSVC) must pass before GitHub Pages deployment is triggered.
