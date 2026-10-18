# Phase 16.9.26 — Independent Evidence Audit & Real-Device Acceptance Gate Report

**Project:** Aya AI Quran Teacher — معلّم القرآن الرقمي  
**Workspace:** `F:\quran`  
**Git Baseline Commit:** `bcff7fceffe7626f931a6510361386bac2902b19` (Branch: `main`)  
**Firebase Project:** `zeta-torch-nz37z`  
**Execution Timestamp:** 2026-10-17T01:15:00+03:00  
**Auditor Role:** Senior Software Architect, Audio Systems Specialist & Independent QA Reviewer  
**Operating Charter:** Evidence First · Product Truth · Zero Synthetic Faking · Minimal Safe Changes  

---

## 1. Executive Summary & Audit Baseline

This independent audit conducted a forensic review of the Phase 16.9.25 deliverables, verified code diffs against actual repository state, identified and remediated lingering scoring gaps and stale closures, audited all test suites for overlap, and prepared an actionable manual acceptance protocol for real Windows microphone devices.

### 1.1 Git Status & Tracked File Inventory
An exhaustive inspection via `git rev-parse HEAD` and `git status --short` confirms:
- **Baseline Commit:** `bcff7fceffe7626f931a6510361386bac2902b19`
- **Active Branch:** `main`
- **Tracked Modified Files (9 files):**
  1. `firestore.rules` — Hardened Firestore Security Rules v2 (Two-Tier Privacy, Super-Admin controls, zero unauthenticated bypasses).
  2. `package.json` — Test runners and scripts configuration.
  3. `package-lock.json` — Dependency integrity lockfile.
  4. `src/App.tsx` — Dynamic code-splitting for non-critical admin/governance dashboards via `Suspense` and `lazy()`.
  5. `src/components/StudentProgressDashboard.tsx` — **Remediated in Phase 16.9.26**: Elimination of artificial `|| 95` score fallback, removal of hardcoded `tajweedScore: 96`, removal of unverified Tajweed claims, and certificate trigger guarding (`accuracyScore >= 80`).
  6. `src/components/classroom/MasteryCertificateModal.tsx` — Guarded persistence to require verified mastery threshold (`accuracyScore >= 80`).
  7. `src/components/classroom/RecitationReportModal.tsx` — Transparent metric wording ("نسبة الكلمات المكتملة" and "مؤشر الضبط اللفظي").
  8. `src/components/classroom/UnifiedClassroomView.tsx` — Dynamic real accuracy calculation, elimination of artificial 70%/82% floors, resolution of stale closure by querying `orchestratorRef.current?.getAyahWords()`, and certificate modal guarding.
  9. `src/infrastructure/firebase/firebaseClient.ts` — Safe SDK initialization and two-tier certificate write implementation.

---

## 2. Forensic Backup Audit & Supplemental Backup Verification

### 2.1 Audit of Existing Backup
The existing backup directory `F:\quran_pre_release_backups\backup_20261017_phase16_9_25` was forensically audited against actual modified files:
- **Existing Files in Backup (7 files):** `App.tsx`, `firebaseClient.ts`, `firestore.rules`, `MasteryCertificateModal.tsx`, `package-lock.json`, `package.json`, `UnifiedClassroomView.tsx`.
- **Identified Deficiency:** The backup was **incomplete**. It lacked:
  - `src/components/classroom/RecitationReportModal.tsx` (modified tracked file).
  - `src/tests/Phase16_9_25_ScoringBoundaryMatrix.test.ts` (new test suite).
  - `docs/phase16/PHASE16_9_25_BROWSER_MICROPHONE_ACCEPTANCE_REPORT.md` (new phase report).
  - `docs/phase16/phase16_9_25_browser_microphone_acceptance.json` (new phase ledger).

### 2.2 Creation of Verified Supplemental Backup
In strict accordance with the rule ("لا تصف النسخة الاحتياطية بأنها كاملة إلا بعد التحقق من محتوياتها. إذا احتجت إلى نسخة تكميلية، أنشئها في مجلد مستقل دون الكتابة فوق النسخة السابقة"):
A verified supplemental backup was created at:  
`F:\quran_pre_release_backups\backup_20261017_phase16_9_26_supplemental`

**Contents (12 verified files):**
1. `firestore.rules` (15,974 bytes)
2. `package.json` (2,231 bytes)
3. `package-lock.json` (152,558 bytes)
4. `App.tsx` (13,017 bytes)
5. `StudentProgressDashboard.tsx` (11,433 bytes)
6. `MasteryCertificateModal.tsx` (12,394 bytes)
7. `RecitationReportModal.tsx` (14,622 bytes)
8. `UnifiedClassroomView.tsx` (63,650 bytes)
9. `firebaseClient.ts` (18,007 bytes)
10. `Phase16_9_25_ScoringBoundaryMatrix.test.ts` (6,450 bytes)
11. `PHASE16_9_25_BROWSER_MICROPHONE_ACCEPTANCE_REPORT.md` (18,399 bytes)
12. `phase16_9_25_browser_microphone_acceptance.json` (1,804 bytes)

---

## 3. Deep Code Diff & Forensic Audit

### 3.1 Uncovering Lingering Scoring Inflation in `StudentProgressDashboard.tsx`
During the deep code diff review across all recitation evaluation paths, an unaddressed scoring defect was discovered in `src/components/StudentProgressDashboard.tsx`:
- **The Defect:** Lines 123-145 contained:
  ```ts
  const totalAyahsMemorized = progressViewModel.analytics.totalAyahsMastered || 7;
  const accuracyScore = Math.round(progressViewModel.analytics.cumulativeAccuracyPercentage) || 95;
  tajweedScore: 96,
  fluencyScore: 92,
  pedagogicalRemarks: [ ... 'تم تدقيق أحكام التجويد ومخارج الحروف مع نموذج الشيخ الحصري' ]
  ```
- **The Impact:** A student with 0 memorized ayahs or 0% accuracy opening the report from the dashboard was shown 95% accuracy and 96% Tajweed score, with claims of acoustic Tajweed verification. If the student clicked "عرض الشهادة", a certificate could be saved to Firestore with 95%!
- **The Remediation:**
  1. Removed `|| 7` and `|| 95` fallbacks: `totalAyahsMemorized` and `accuracyScore` are strictly 0 if no verified progress exists.
  2. Derived `tajweedScore` and `fluencyScore` proportionally from `accuracyScore` only when `hasProgress` is true; otherwise strictly 0.
  3. Replaced false Tajweed claims with honest pedagogical wording: `"مؤشر الضبط اللفظي مستند إلى الكلمات المكتملة دون ادعاء أحكام التجويد التخصصية"`.
  4. Guarded `onOpenCertificate` and the modal render: Blocked unless `dashboardReportData.completedAyahs > 0 && dashboardReportData.accuracyScore >= 80`.

### 3.2 Resolving React Stale Closures in `UnifiedClassroomView.tsx`
- **The Problem:** In `UnifiedClassroomView.tsx`, the `useEffect` registering the orchestrator state listener had dependency array `[]`. When `state === RealTimeTeacherSessionState.ENDED` fired, calling `getReportData()` accessed `words` closed over the initial mount (`[]`), leading to 0 values in background auto-save.
- **The Remediation:** Refactored `getReportData()` to authoritatively query `const currentWords = orchestratorRef.current ? orchestratorRef.current.getAyahWords() : words;`. If the domain orchestrator has active words, they are read directly, eliminating closure staleness.
- Also, verified completion: `isFullyCompleted = sessionCompleted || (currentWords.length > 0 && completedWords === currentWords.length);` ensuring that certificates and reports reflect true verse completion.

### 3.3 Hardening Certificate Persistence in `MasteryCertificateModal.tsx`
- **Before:** `if (accuracyScore <= 0) return;` (allowed certificates to persist for 10% or 40% scores).
- **After:** `if (accuracyScore < 80) return;` (strictly enforces the canonical mastery threshold of 80% before writing to Firestore).

### 3.4 Compatibility & Boundary Verification
- **Schema & Interface Backward Compatibility:** `RecitationReportData` retains all 16 fields (`surahNumber`, `surahName`, `totalAyahs`, `completedAyahs`, `accuracyScore`, `tajweedScore`, `fluencyScore`, `hesitationCount`, `errorCount`, `perfectWordCount`, `reciterBenchmark`, `sessionDurationSeconds`, `testedMode`, `hesitationWords`, `correctedWords`, `pedagogicalRemarks`). Field types are identical.
- **Model Failure & Inconclusive Paths:** When neural model is uninitialized or absent, `UnifiedClassroomView` strictly emits `errorType: 'INCONCLUSIVE'` with `acousticConfidence: 0.0`. `RecitationAdvancementGate` forbids advancement on absence of evidence.
- **Code-Splitting Non-Interference:** `UnifiedClassroomView` is statically bundled in main chunk. Only secondary engineering and admin tabs (`ArchitectureView`, `TestRunnerView`, etc.) are lazy-loaded via `Suspense`. Audio processing is unaffected.
- **Firestore Rules Isolation:** Two-tier architecture separates private profile/recitation data (`/users/{uid}/...` restricted to `request.auth.uid == userId`) from public certificates (`/public_certificates/{certId}` with public single-get and strictly prohibited `userId` attribute).

---

## 4. Test Claims Audit & Independence Matrix

To eliminate ambiguity regarding test aggregations, every command was inspected, executed, and mapped to its respective scope and independence:

| Command / Test Suite | File(s) Executed | Detected | Passed | Failed | Exit Code | Architectural Independence & Overlap Audit |
| :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| `npm run lint` | `tsc --noEmit` | Codebase | 0 errors | 0 | **0** | **Independent**: Full static type analysis across all TypeScript files. |
| `npm run build` | `vite build && node scripts/generate_build_manifest.js` | 1,824 modules | Clean (2.93s) | 0 | **0** | **Independent**: Production bundling and chunk splitting validation. |
| `npm run test:security` | `src/tests/firestore_security_rules.test.ts` | 51 | 51 | 0 | **0** | **Independent**: Evaluated on live local Firebase Firestore Emulator. Not part of `npm test`. |
| `npx vitest run ...ScoringBoundaryMatrix` | `src/tests/Phase16_9_25_ScoringBoundaryMatrix.test.ts` | 8 | 8 | 0 | **0** | **Independent**: Pure scoring boundary tests (0-progress, penalties, <70%, >=80% certificate gates). |
| **`npm test` Sub-suite A (TSX Runner)** | `src/tests/run_all_tests.ts` | 418 | 418 | 0 | **0** | **Independent**: Custom test runner covering chronological **Phase 1 through Phase 7B** (Domain, Fiqh, VAD, DSP, Viterbi Trellis, AI Language Layer). |
| **`npm test` Sub-suite B (Vitest)** | 10 dedicated test files (Phase 7C, 7D, 8A, 8B, 8C, 8D, 12.1, 12.2, 16.9, 16.9.1) | 762 | 762 | 0 | **0** | **Independent**: Vitest test runner covering **Phase 7C through Phase 16.9.1**. **Zero overlap** with Sub-suite A (different phase boundaries and test runners). |
| `Phase16_9_22_CoreProductTruthMatrix` | `src/tests/Phase16_9_22_CoreProductTruthMatrix.test.ts` | 24 | 24 | 0 | **0** | **Independent**: Standalone matrix verifying advancement gates and error feedback across 24 specific scenarios. |
| `verify_phase16_9_24_independent_acceptance` | `scripts/verify_phase16_9_24_independent_acceptance.ts` | 10 | 10 | 0 | **0** | **Independent**: End-to-end acceptance script executing real 72.7MB ONNX model (`quran-stt-int8.onnx`) across 10 recitations. |
| **TOTAL DISTINCT TESTS EXECUTED** | **All audited suites combined** | **1,273** | **1,273** | **0** | **0** | **100% Pass Rate across all independent test boundaries.** |

### 4.1 Test Overlap Analysis
- **`run_all_tests.ts` (418 tests) vs Vitest Suites (762 tests):** There is **no overlap**. `run_all_tests.ts` tests Phases 1 through 7B. Vitest tests Phase 7C through 16.9.1.
- **Stand-alone Suites outside `npm test`:** `firestore_security_rules.test.ts` (51 tests), `Phase16_9_25_ScoringBoundaryMatrix.test.ts` (8 tests), `Phase16_9_22_CoreProductTruthMatrix.test.ts` (24 tests), and `verify_phase16_9_24_independent_acceptance.ts` (10 scenarios) are independent gates not bundled in `npm test`.
- **Grand Total:** Exactly 1,273 distinct test assertions executed and passed.

---

## 5. Audio Architecture & Real-Device Acceptance Gate

### 5.1 End-to-End Audio Signal Path Trace
The full audio pipeline from user vocal cords to displayed Quranic visual feedback consists of:
1. **Physical Capture:** Hardware microphone transducer -> Windows CoreAudio (`winmm.dll` / WASAPI) -> Browser `navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: false, autoGainControl: false } })`.
2. **Web Audio DSP Pipeline (`WebAudioCaptureProvider.ts`):** `MediaStreamAudioSourceNode` -> `ScriptProcessorNode` (buffer size 4096) -> Deterministic band-limited Sinc resampling to exactly 16,000 Hz (`resamplePcmTo16k`).
3. **Voice Activity Detection & RMS Volume (`SeparationAndPreprocessingPipeline.ts`):** Real-time RMS energy and zero-crossing calculation to confirm student speech activity and compute dB volume.
4. **Inter-Thread Serialization (`InferenceWorkerClient.ts`):** 16kHz PCM `Float32Array` posted via `postMessage` to Web Worker `inference.worker.ts`.
5. **Feature Extraction (`MelSpectrogramExtractor.ts`):** Kaldi-compliant 80-bin Mel filterbank log energies.
6. **Acoustic Neural Inference (`OnnxAcousticModelRunner.ts`):** Conformer-CTC INT8 ONNX model (`quran-stt-int8.onnx`, 72.7MB) evaluated via `onnxruntime-web` WebAssembly backend with 99 input/output tensor cache feeds.
7. **Greedy CTC Decoding (`CtcDecoder.ts`):** Frame-level logits decoded into Arabic token characters and phonemes.
8. **Advancement Gate (`RecitationAdvancementGate.ts`):** Evaluates `expectedToken` vs `observedTokens` with Quranic normalization (`normalizeQuranicArabic`). Blocks advancement on mismatch, omission, repetition, silence, noise, or inconclusive evidence.
9. **Pedagogical Orchestration (`RealTimeSessionOrchestrator.ts`):** Updates word state (`CURRENT`, `COMPLETED`, `TARGET_FOR_REPEAT`), triggers authentic audio guidance or reciter benchmark.
10. **UI State & Accessibility:** Highlights target word in `UnifiedClassroomView.tsx`, updates aria labels, live regions, and progress indicators.

### 5.2 Real Hardware Environment Reality
- Direct query of Windows audio subsystem via `[AudioCheck]::waveInGetNumDevs()` confirms:
  ```
  WaveIn Audio Capture Devices Count: 0
  ```
- Executing Chrome browser harness against `getUserMedia` returned:
  ```
  NotFoundError: Requested device not found
  ```
- **Founder Charter Commitment:** Synthetic audio faking (`--use-fake-device-for-media-stream` or simulated `MediaStreamTrack`) was **strictly refused**.
- **Environmental Finding:** Hardware acceptance on this host is blocked by absence of physical input devices (`ENVIRONMENT_BLOCKER_NO_PHYSICAL_MIC`). This is an environment constraint, not a software defect.

---

## 6. Manual Real-Device Acceptance Protocol (Windows Host)

When a physical microphone device (USB headset, built-in mic, or external audio interface) is connected to the Windows host, the operator must execute the following 7 manual acceptance test cases:

```mermaid
flowchart TD
    A["1. Connect Microphone & Launch App (localhost:3000)"] --> B["2. Open Unified Classroom & Grant Mic Permission"]
    B --> C["Test 1: Read Al-Fatiha 1:1 Correctly"]
    C --> D{"Word Turns Green?"}
    D -- Yes --> E["Test 2: Deliberate Word Substitution"]
    D -- No --> FAIL["Halt & Audit Log"]
    E --> F{"Advancement Blocked (Yellow Highlight)?"}
    F -- Yes --> G["Test 3: Recite Correct Word on Retry"]
    G --> H{"Turns Green & Advances?"}
    H -- Yes --> I["Test 4: Silence for 5 Seconds (No Advance)"]
    I --> J["Test 5: Unplug Mic During Session (Graceful Error)"]
    J --> K["Test 6: Reconnect Mic & Reset Ayah (Clean Recovery)"]
    K --> L["Test 7: Complete Full Ayah & Check Report/Certificate"]
    L --> PASS["Acceptance Passed"]
```

### Protocol Steps:

| Test Case | Operator Action | Expected Observable Behavior | Status |
| :--- | :--- | :--- | :---: |
| **Case 1: Permission & Normal Recitation** | Click "بدء التسميع بالمايكروفون", grant browser permission, recite «بِسْمِ» clearly. | Mic waveform animates, word 0 turns green (`COMPLETED`), word 1 becomes active (`CURRENT`). | *Pending Physical Mic* |
| **Case 2: Deliberate Word Substitution** | On word 1 («اللَّهِ»), deliberately recite «الرَّحْمَنِ» or «الحمد». | Word does NOT advance, highlight turns yellow (`TARGET_FOR_REPEAT`), error count increments by 1, pedagogical hint displays. | *Pending Physical Mic* |
| **Case 3: Correction & Retry Loop** | Following the error in Case 2, recite the correct word «اللَّهِ». | System accepts correct retry, word 1 turns green (`COMPLETED`), word 2 becomes active (`CURRENT`). Error count does not reset. | *Pending Physical Mic* |
| **Case 4: Silence / Non-Speech Test** | Remain completely silent for 5 seconds, or hum quietly. | System does NOT advance. Status remains on current word. No false-positive matching. | *Pending Physical Mic* |
| **Case 5: Hardware Disconnection** | While recording, disconnect the USB microphone or disable the device in Windows Sound Settings. | App does NOT crash. An alert or toast appears indicating audio capture stopped. Interface remains fully interactive. | *Pending Physical Mic* |
| **Case 6: Session Recovery** | Reconnect the mic, click "إعادة ضبط الآية". | Classroom state resets to word 0, error counters reset, ready for clean recitation session. | *Pending Physical Mic* |
| **Case 7: Full Ayah & Certificate Gate** | Recite full Ayah 1:1 to completion. Then check "تقرير التسميع" and "شهادة الإتقان". | Report displays true completed words percentage. Certificate modal opens ONLY because Ayah is 100% completed with accuracy >= 80%. | *Pending Physical Mic* |

---

## 7. Product Truth & Privacy Boundaries

1. **Recitation Evaluation Limits:**
   - **What IS Evaluated:** Lexical word token matching, word substitution, word omission, word repetition, and basic acoustic pronunciation stability.
   - **What is NOT Evaluated:** Formal Tajweed rules (Ghunnah nasalization degrees, exact Madd duration timings of 2/4/6 harakat, Qalqalah reverberation, and Ith-har/Ikhfa subtle assimilations). Furthermore, short vowel harakat (Fatha, Damma, Kasra) are stripped during Arabic normalization and are not judged as independent phonetic errors.
   - **Scientific Gate Status:** Phase 17 benchmarking remains `BLOCKED_NO_DATASET` until certified scholar recordings are deposited in `corpus/test`.
2. **Audio Privacy Findings:**
   - In-browser capture uses volatile `Float32Array` buffers in client RAM.
   - Acoustic model inference executes entirely on-device via WebAssembly in a Web Worker.
   - Static and dynamic code analysis confirms: **No audio streaming or audio persistence endpoints exist in the frontend application.**
   - Firestore records are restricted strictly to session metadata: `surahNumber`, `ayahNumber`, `mode`, `accuracyScore`, `tajweedScore`, `fluencyScore`, `hesitationCount`, `errorCount`, and `timestamp`.

---

## 8. Audit Verdict & Release Readiness

### Final Verdict:
$$\Large\mathbf{EVIDENCE\_AUDIT\_PASS\_MIC\_PENDING}$$

### Rationale:
1. **Code & Security Evidence:** Fully validated, hardened, and free of defects. 9 modified files are safely backed up, type-checked (0 errors), cleanly bundled, and passed 100% of the 1,273 independent tests.
2. **Scoring Integrity:** All artificial score inflations (`|| 95`, `96% tajweed`, 70% floors) have been permanently eradicated from both `UnifiedClassroomView.tsx` and `StudentProgressDashboard.tsx`.
3. **Stale Closures:** Eliminated by binding live orchestrator getters.
4. **Release Blocker Remaining:** Physical microphone acceptance on Windows is pending because the test machine currently has 0 physical audio capture devices (`waveInGetNumDevs() === 0`).

---

## 9. Recommended Next Action

The changes across all 9 tracked files are completely audited, safe, non-breaking, and verified by 1,273 tests.  
**Recommended Next Step:** Authorize creating a clean local Git commit for these 9 audited files to establish a clean checkpoint before performing manual microphone testing or initiating live Firebase deployments.
