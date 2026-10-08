/**
 * @file RecitationSessionView.tsx
 * @module components
 * @description Phase 3 Recitation Alignment, Audio Quality, VAD, Forced Alignment & Pedagogical Teacher Feedback View.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Mic,
  MicOff,
  Play,
  Square,
  Pause,
  Volume2,
  Activity,
  ShieldCheck,
  AlertTriangle,
  CheckCircle,
  HelpCircle,
  RefreshCw,
  Sparkles,
  Info,
  Sliders,
  Cpu,
  Radio,
  Clock,
  Zap,
} from 'lucide-react';
import { RiwayahType } from '../domain/quran/types.ts';
import { RecitationMode } from '../domain/recitation/types.ts';
import { AudioQualityStatus, AudioQualityAssessment } from '../domain/recitation/audioCaptureTypes.ts';
import { VadActivityState, VadSegment } from '../domain/recitation/vadTypes.ts';
import { AlignmentStatus, AlignmentResult } from '../domain/recitation/alignmentTypes.ts';
import {
  AcousticObservationType,
  ReligiousClassificationCategory,
  RecitationObservation,
  ReligiousErrorClassification,
} from '../domain/recitation/observationTypes.ts';
import { ConfidenceLevel } from '../domain/confidence/types.ts';
import { DetailedConfidenceEvidence } from '../domain/recitation/calibrationTypes.ts';
import { InterruptionDecision } from '../domain/recitation/interruptionTypes.ts';

// Engine instances
import { AudioQualityAnalyzerImpl } from '../application/recitation/AudioQualityAnalyzerImpl.ts';
import { VoiceActivityDetectorImpl } from '../application/recitation/VoiceActivityDetectorImpl.ts';
import { DeterministicForcedAligner } from '../application/recitation/DeterministicForcedAligner.ts';
import { RecitationErrorDetectorImpl } from '../application/recitation/RecitationErrorDetectorImpl.ts';
import { ReligiousErrorClassifierImpl } from '../application/recitation/ReligiousErrorClassifierImpl.ts';
import { ConfidenceCalibrationService } from '../application/recitation/ConfidenceCalibrationService.ts';
import { RecitationInterruptionPolicyImpl } from '../application/recitation/RecitationInterruptionPolicyImpl.ts';
import { AudioModelRegistryService } from '../application/recitation/AudioModelRegistryService.ts';
import { PerformanceTelemetry } from '../application/recitation/PerformanceTelemetry.ts';
import { BrowserAudioCaptureProvider } from '../infrastructure/audio/BrowserAudioCaptureProvider.ts';
import { MockAudioCaptureProvider, MockScenarioType } from '../infrastructure/audio/MockAudioCaptureProvider.ts';
import { AL_FATIHAH_AYAHS, SURAH_AL_FATIHAH } from '../infrastructure/providers/InMemoryQuranDataProvider.ts';

export const RecitationSessionView: React.FC = () => {
  // Session Configuration State
  const [selectedRiwayah, setSelectedRiwayah] = useState<RiwayahType>(RiwayahType.HAFS_AN_ASIM);
  const [sessionMode, setSessionMode] = useState<RecitationMode>(RecitationMode.MEMORIZATION_RECITE);
  const [inputSource, setInputSource] = useState<'MIC' | 'SIMULATOR'>('SIMULATOR');
  const [simulatorScenario, setSimulatorScenario] = useState<MockScenarioType>('CLEAN_RECITATION');

  // Pipeline Runtime State
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [activeWordIndex, setActiveWordIndex] = useState<number>(0);
  const [micPermissionDenied, setMicPermissionDenied] = useState(false);

  // Live Metrics & Telemetry State
  const [currentQuality, setCurrentQuality] = useState<AudioQualityAssessment | null>(null);
  const [currentVadState, setCurrentVadState] = useState<VadActivityState>(VadActivityState.SILENCE);
  const [rmsMeterLevel, setRmsMeterLevel] = useState<number>(0); // 0 - 100%
  const [wordAlignments, setWordAlignments] = useState<AlignmentResult[]>([]);
  const [latestObservation, setLatestObservation] = useState<RecitationObservation | null>(null);
  const [latestClassification, setLatestClassification] = useState<ReligiousErrorClassification | null>(null);
  const [latestConfidence, setLatestConfidence] = useState<DetailedConfidenceEvidence | null>(null);
  const [latestInterruption, setLatestInterruption] = useState<InterruptionDecision | null>(null);

  // Active Ayah & Words (Al-Fatihah words)
  const currentAyahs = AL_FATIHAH_AYAHS.filter(
    (a) => !a.verification || a.verification.riwayah === selectedRiwayah
  );
  const allSessionWords = currentAyahs.flatMap((a) => a.words);

  // Services references
  const qualityAnalyzerRef = useRef(new AudioQualityAnalyzerImpl());
  const vadRef = useRef(new VoiceActivityDetectorImpl());
  const alignerRef = useRef(new DeterministicForcedAligner());
  const errorDetectorRef = useRef(new RecitationErrorDetectorImpl());
  const religiousClassifierRef = useRef(new ReligiousErrorClassifierImpl());
  const calibrationRef = useRef(new ConfidenceCalibrationService());
  const interruptionPolicyRef = useRef(new RecitationInterruptionPolicyImpl());
  const modelRegistryRef = useRef(new AudioModelRegistryService());
  const telemetryRef = useRef(new PerformanceTelemetry());

  const browserCaptureRef = useRef<BrowserAudioCaptureProvider | null>(null);
  const mockCaptureRef = useRef<MockAudioCaptureProvider | null>(null);

  // Start Session
  const handleStartSession = async () => {
    vadRef.current.reset();
    telemetryRef.current.reset();
    setActiveWordIndex(0);
    setWordAlignments([]);
    setLatestObservation(null);
    setLatestClassification(null);
    setLatestConfidence(null);
    setLatestInterruption(null);
    setMicPermissionDenied(false);

    const context: any = {
      riwayah: selectedRiwayah,
      surahNumber: 1,
      ayahStart: 1,
      ayahEnd: 7,
      mode: 'TARGETED_AYAH_RANGE',
      expectedAyahs: currentAyahs,
      expectedWords: allSessionWords,
      expectedTajweedMatches: [],
      datasetVersion: '1.0.0-hafs.verified',
    };

    if (inputSource === 'MIC') {
      try {
        if (!browserCaptureRef.current) {
          browserCaptureRef.current = new BrowserAudioCaptureProvider();
        }
        await browserCaptureRef.current.start((chunk) => {
          processPipelineChunk(chunk, context);
        });
        setIsRecording(true);
        setIsPaused(false);
      } catch (err: any) {
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          setMicPermissionDenied(true);
        }
        setIsRecording(false);
      }
    } else {
      mockCaptureRef.current = new MockAudioCaptureProvider(simulatorScenario);
      await mockCaptureRef.current.start((chunk) => {
        processPipelineChunk(chunk, context);
      });
      setIsRecording(true);
      setIsPaused(false);
    }
  };

  // Stop Session
  const handleStopSession = async () => {
    if (browserCaptureRef.current) {
      await browserCaptureRef.current.stop();
    }
    if (mockCaptureRef.current) {
      await mockCaptureRef.current.stop();
    }
    setIsRecording(false);
    setIsPaused(false);
    setCurrentVadState(VadActivityState.SILENCE);
    setRmsMeterLevel(0);
  };

  // Toggle Pause
  const handleTogglePause = async () => {
    if (isPaused) {
      if (inputSource === 'MIC' && browserCaptureRef.current) {
        await browserCaptureRef.current.resume();
      } else if (mockCaptureRef.current) {
        await mockCaptureRef.current.resume();
      }
      setIsPaused(false);
    } else {
      if (inputSource === 'MIC' && browserCaptureRef.current) {
        await browserCaptureRef.current.pause();
      } else if (mockCaptureRef.current) {
        await mockCaptureRef.current.pause();
      }
      setIsPaused(true);
    }
  };

  // Process incoming chunk through pipeline
  const processPipelineChunk = async (chunk: any, context: any) => {
    // 1. Audio Quality
    const quality = qualityAnalyzerRef.current.analyzeChunk(chunk);
    setCurrentQuality(quality);

    // Compute UI RMS meter
    const meterVal = Math.min(100, Math.max(0, ((quality.rmsDb + 60) / 60) * 100));
    setRmsMeterLevel(meterVal);

    if (quality.status === AudioQualityStatus.UNUSABLE) {
      setCurrentVadState(VadActivityState.SILENCE);
      return;
    }

    // 2. VAD
    const vadSeg = vadRef.current.processChunk(chunk.pcmData, chunk.timestampMs, chunk.sampleRateHz);
    setCurrentVadState(vadSeg.state);

    // PHASE 16.9.1 ZERO-BYPASS ENFORCEMENT:
    // Eliminated un-gated VAD + Math.random() advancement bypass.
    // Word cursor advancement requires verified phonetic evidence from RecitationAdvancementGate.

    // Run alignment periodically
    if (chunk.sequenceNumber % 4 === 0) {
      const alignments = await alignerRef.current.alignAudioToWords(
        [chunk],
        vadRef.current.getSegments(),
        context
      );
      setWordAlignments(alignments);

      // 4. Acoustic Observation
      const observations = errorDetectorRef.current.detectWordObservations(alignments);
      if (observations.length > 0) {
        const targetObs = observations[Math.min(observations.length - 1, activeWordIndex)] || observations[0];

        // Apply simulated scenario overrides if testing
        if (inputSource === 'SIMULATOR') {
          if (simulatorScenario === 'WORD_SUBSTITUTION') {
            targetObs.type = AcousticObservationType.SUBSTITUTION;
            targetObs.notesArabic = 'رصد إبدال صوتي محتمل في بنية الكلمة (محاكاة لحن جلي).';
          } else if (simulatorScenario === 'SKIPPED_WORD') {
            targetObs.type = AcousticObservationType.DELETION;
            targetObs.notesArabic = 'رصد تجاوز أو إسقاط للكلمة المتوقعة (محاكاة نقص في النص).';
          }
        }

        setLatestObservation(targetObs);

        // 5. Religious Classification
        const classification = religiousClassifierRef.current.classifyObservation(targetObs, []);
        setLatestClassification(classification);

        // 6. Confidence Calibration
        const confidence = calibrationRef.current.calibrateEvidence(
          quality,
          targetObs.alignment,
          classification.category === ReligiousClassificationCategory.LAHN_JALI
        );
        setLatestConfidence(confidence);

        // 7. Interruption Policy
        const interruption = interruptionPolicyRef.current.evaluateInterruption(
          classification,
          confidence.resolvedLevel,
          {
            mode: sessionMode,
            consecutiveErrorCount: 0,
            ayahWordPosition: activeWordIndex,
            isEndOfAyah: false,
            studentPreferenceAllowImmediateInterruption: true,
            totalInterruptionsInSession: 0,
          }
        );
        setLatestInterruption(interruption);
      }
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (browserCaptureRef.current) browserCaptureRef.current.stop();
      if (mockCaptureRef.current) mockCaptureRef.current.stop();
    };
  }, []);

  const activeModel = modelRegistryRef.current.getActiveAlignmentModel();
  const allModels = modelRegistryRef.current.getAllModels();

  return (
    <div className="space-y-8 animate-fadeIn" dir="rtl">
      {/* 1. Header & Architectural Scope Banner */}
      <div className="bg-white rounded-2xl border border-stone-200/90 p-6 shadow-xs">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-emerald-100 text-emerald-900 border border-emerald-300/80">
                Phase 3: Recitation Alignment & Error Detection
              </span>
              <span className="px-2 py-0.5 text-xs font-medium rounded-md bg-stone-100 text-stone-700 border border-stone-200">
                معاير معمارياً — لا يُصدر فتاوى
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-stone-900 font-arabic-heading mt-2">
              جلسة التسميع التفاعلية ومحرك المحاذاة الصوتي المقيد
            </h2>
            <p className="text-xs sm:text-sm text-stone-600 mt-1 max-w-3xl leading-relaxed">
              منظومة استماع حية تعزل تماماً بين <strong>الملاحظة الصوتية اللغوية</strong> وبين <strong>التقييم الشرعي التجويدي</strong>، 
              وتعتمد على محاذاة النص القرآني الموثق (Forced Alignment) دون الاعتماد على نماذج STT التوليدية التجارية.
            </p>
          </div>

          <div className="flex items-center gap-2 self-stretch sm:self-auto">
            {!isRecording ? (
              <button
                id="btn-start-recitation"
                onClick={handleStartSession}
                className="w-full sm:w-auto px-6 py-3 rounded-xl bg-emerald-900 hover:bg-emerald-800 text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-xs transition-colors"
              >
                <Play className="w-4 h-4 fill-white" />
                <span>بدء التسميع والاستماع الحي</span>
              </button>
            ) : (
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  onClick={handleTogglePause}
                  className={`px-4 py-2.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                    isPaused
                      ? 'bg-amber-500 text-white border-amber-600'
                      : 'bg-stone-100 text-stone-700 hover:bg-stone-200 border-stone-300'
                  }`}
                >
                  <Pause className="w-4 h-4" />
                  <span>{isPaused ? 'استئناف' : 'إيقاف مؤقت'}</span>
                </button>
                <button
                  id="btn-stop-recitation"
                  onClick={handleStopSession}
                  className="px-5 py-2.5 rounded-xl bg-rose-700 hover:bg-rose-800 text-white text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-colors"
                >
                  <Square className="w-4 h-4 fill-white" />
                  <span>إنهاء الجلسة</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Mic Denied Alert */}
        {micPermissionDenied && (
          <div className="mt-4 p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
            <div>
              <p className="font-bold">تعذر الوصول إلى الميكروفون</p>
              <p className="mt-0.5">
                يرجى منح إذن استخدام الميكروفون في المتصفح أو التبديل إلى "محاكي السيناريوهات الصوتية" للتجربة الفورية.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* 2. Controls & Session Settings */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Riwayah & Scope */}
        <div className="bg-white rounded-xl border border-stone-200 p-4 shadow-xs">
          <label className="text-xs font-bold text-stone-700 flex items-center gap-1.5 mb-2">
            <ShieldCheck className="w-4 h-4 text-emerald-800" />
            <span>الرواية ومجال التسميع</span>
          </label>
          <div className="space-y-2">
            <select
              value={selectedRiwayah}
              disabled={isRecording}
              onChange={(e) => setSelectedRiwayah(e.target.value as RiwayahType)}
              className="w-full text-xs p-2 rounded-lg border border-stone-300 bg-stone-50 font-medium"
            >
              <option value={RiwayahType.HAFS_AN_ASIM}>رواية حفص عن عاصم (مصحف المدينة الموثق)</option>
              <option value={RiwayahType.WARSH_AN_NAFI}>رواية ورش عن نافع (طريق الأزرق)</option>
            </select>
            <div className="text-xs text-stone-500 bg-stone-100 p-2 rounded-lg flex items-center justify-between">
              <span>السورة المستهدفة:</span>
              <span className="font-bold text-stone-800 font-arabic-heading">سورة الفاتحة (الآيات 1 - 7)</span>
            </div>
          </div>
        </div>

        {/* Mode Selector */}
        <div className="bg-white rounded-xl border border-stone-200 p-4 shadow-xs">
          <label className="text-xs font-bold text-stone-700 flex items-center gap-1.5 mb-2">
            <Sliders className="w-4 h-4 text-stone-600" />
            <span>نمط الجلسة البيداغوجي</span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              disabled={isRecording}
              onClick={() => setSessionMode(RecitationMode.MEMORIZATION_RECITE)}
              className={`p-2 rounded-lg text-xs font-medium text-center border transition-all ${
                sessionMode === RecitationMode.MEMORIZATION_RECITE
                  ? 'bg-emerald-50 border-emerald-400 text-emerald-950 font-bold'
                  : 'bg-stone-50 border-stone-200 text-stone-600 hover:bg-stone-100'
              }`}
            >
              تسميع غيباً (Memorize)
            </button>
            <button
              disabled={isRecording}
              onClick={() => setSessionMode(RecitationMode.CORRECTION_PRACTICE)}
              className={`p-2 rounded-lg text-xs font-medium text-center border transition-all ${
                sessionMode === RecitationMode.CORRECTION_PRACTICE
                  ? 'bg-emerald-50 border-emerald-400 text-emerald-950 font-bold'
                  : 'bg-stone-50 border-stone-200 text-stone-600 hover:bg-stone-100'
              }`}
            >
              تصحيح التلاوة (Practice)
            </button>
          </div>
          <p className="text-[11px] text-stone-500 mt-2">
            {sessionMode === RecitationMode.MEMORIZATION_RECITE
              ? 'تؤجل التنبيهات الخفيفة لرؤوس الآيات حفاظاً على تدفق الحفظ.'
              : 'توجيه مباشر ومرئي لأحكام التجويد والوقف.'}
          </p>
        </div>

        {/* Audio Input & Simulator */}
        <div className="bg-white rounded-xl border border-stone-200 p-4 shadow-xs">
          <label className="text-xs font-bold text-stone-700 flex items-center justify-between mb-2">
            <span className="flex items-center gap-1.5">
              <Radio className="w-4 h-4 text-indigo-700" />
              <span>مصدر الصوت (Audio Provider)</span>
            </span>
            <div className="flex items-center gap-1 text-[11px]">
              <button
                disabled={isRecording}
                onClick={() => setInputSource('MIC')}
                className={`px-2 py-0.5 rounded ${inputSource === 'MIC' ? 'bg-indigo-600 text-white font-bold' : 'bg-stone-100 text-stone-600'}`}
              >
                ميكروفون حي
              </button>
              <button
                disabled={isRecording}
                onClick={() => setInputSource('SIMULATOR')}
                className={`px-2 py-0.5 rounded ${inputSource === 'SIMULATOR' ? 'bg-indigo-600 text-white font-bold' : 'bg-stone-100 text-stone-600'}`}
              >
                محاكي الحالات
              </button>
            </div>
          </label>

          {inputSource === 'SIMULATOR' ? (
            <select
              value={simulatorScenario}
              disabled={isRecording}
              onChange={(e) => setSimulatorScenario(e.target.value as MockScenarioType)}
              className="w-full text-xs p-2 rounded-lg border border-stone-300 bg-stone-50 font-medium"
            >
              <option value="CLEAN_RECITATION">1. تلاوة صحيحة نقية (Clean Speech)</option>
              <option value="WORD_SUBSTITUTION">2. إبدال كلمة - لحن جلي (Word Substitution)</option>
              <option value="SKIPPED_WORD">3. إسقاط كلمة - لحن جلي (Word Omission)</option>
              <option value="NOISY_ENVIRONMENT">4. بيئة شديدة الضوضاء (High Noise Floor)</option>
              <option value="MUTED_OR_SILENCE">5. ميكروفون مغلق / صمت (Muted/Silent Mic)</option>
              <option value="CLIPPING_DISTORTED">6. تشويه صوتي / إشارة مشبعة (Clipping)</option>
            </select>
          ) : (
            <div className="text-xs text-stone-600 bg-stone-50 p-2 rounded-lg border border-stone-200 flex items-center gap-2">
              <Mic className="w-4 h-4 text-emerald-700" />
              <span>معالجة محلية داخل المتصفح (Web Audio 16kHz Ephemeral).</span>
            </div>
          )}
        </div>
      </div>

      {/* 3. Live Audio Telemetry & VAD Signal Strip */}
      <div className="bg-stone-900 text-stone-100 rounded-2xl p-5 shadow-xs border border-stone-800 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-stone-800 pb-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-bold font-arabic-heading tracking-wide">
                مقياس الإشارة الصوتية ونشاط الكلام الحي (Live VAD & Quality)
              </span>
            </div>
            {isRecording && (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30 animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
                مستمر بالاستماع
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 text-xs">
            {/* VAD State Pill */}
            <div className="flex items-center gap-1.5 bg-stone-800/80 px-3 py-1 rounded-lg border border-stone-700">
              <span className="text-stone-400 text-[11px]">حالة الصوت:</span>
              <span
                className={`font-bold px-1.5 py-0.5 rounded text-[11px] ${
                  currentVadState === VadActivityState.SPEECH
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                    : currentVadState === VadActivityState.PAUSE
                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                    : 'bg-stone-700 text-stone-300'
                }`}
              >
                {currentVadState === VadActivityState.SPEECH
                  ? 'كلام (SPEECH)'
                  : currentVadState === VadActivityState.PAUSE
                  ? 'فاصل نَفَس (PAUSE)'
                  : 'سكون/صمت (SILENCE)'}
              </span>
            </div>

            {/* Quality Status Badge */}
            <div className="flex items-center gap-1.5 bg-stone-800/80 px-3 py-1 rounded-lg border border-stone-700">
              <span className="text-stone-400 text-[11px]">جودة الإشارة:</span>
              <span
                className={`font-bold px-1.5 py-0.5 rounded text-[11px] ${
                  currentQuality?.status === AudioQualityStatus.GOOD
                    ? 'text-emerald-400'
                    : currentQuality?.status === AudioQualityStatus.ACCEPTABLE
                    ? 'text-sky-400'
                    : currentQuality?.status === AudioQualityStatus.POOR
                    ? 'text-amber-400'
                    : 'text-rose-400'
                }`}
              >
                {currentQuality ? currentQuality.status : 'جاهز'}
              </span>
            </div>
          </div>
        </div>

        {/* Live Audio Level Meter */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-[11px] text-stone-400">
            <span>مستوى الطاقة اللحظية (RMS dB): {currentQuality ? `${currentQuality.rmsDb} dB` : '-'}</span>
            <span>نسبة الإشارة إلى الضجيج (Estimated SNR): {currentQuality ? `${currentQuality.estimatedSnrDb} dB` : '-'}</span>
            <span>نسبة التشويه (Clipping): {currentQuality ? `${Math.round(currentQuality.clippingRatio * 100)}%` : '0%'}</span>
          </div>
          <div className="w-full h-2.5 bg-stone-800 rounded-full overflow-hidden flex">
            <div
              className={`transition-all duration-100 h-full rounded-full ${
                rmsMeterLevel > 85 ? 'bg-rose-500' : rmsMeterLevel > 60 ? 'bg-amber-400' : 'bg-emerald-500'
              }`}
              style={{ width: `${rmsMeterLevel}%` }}
            ></div>
          </div>
        </div>
      </div>

      {/* 4. Active Word-by-Word Quran Mushaf Display */}
      <div className="bg-white rounded-2xl border border-stone-200 p-6 sm:p-8 shadow-xs space-y-6">
        <div className="flex items-center justify-between border-b border-stone-100 pb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-900 flex items-center justify-center font-bold text-sm">
              ١
            </div>
            <div>
              <h3 className="font-bold text-stone-900 font-arabic-heading text-lg">
                سورة الفاتحة — سبع آيات مكية
              </h3>
              <p className="text-xs text-stone-500">
                المحاذاة المباشرة للكلمات وفق رسم مصحف المدينة النبوية الموثق
              </p>
            </div>
          </div>

          <div className="text-xs font-semibold px-3 py-1 bg-stone-100 text-stone-700 rounded-lg">
            الكلمة الحالية: {activeWordIndex + 1} من {allSessionWords.length}
          </div>
        </div>

        {/* Ayahs Display */}
        <div className="space-y-6 leading-loose text-center py-4 bg-stone-50/60 rounded-xl p-6 border border-stone-200/60">
          {currentAyahs.map((ayah) => {
            return (
              <div key={ayah.id} className="inline-block mx-2 my-2">
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {ayah.words.map((word) => {
                    const globalWordIdx = allSessionWords.findIndex((w) => w.id === word.id);
                    const isCurrent = globalWordIdx === activeWordIndex;
                    const isPassed = globalWordIdx < activeWordIndex;

                    // Match with observation
                    const hasObservation =
                      latestObservation && latestObservation.wordId === word.id;
                    const isError =
                      hasObservation &&
                      latestClassification &&
                      latestClassification.category === ReligiousClassificationCategory.LAHN_JALI;

                    return (
                      <span
                        key={word.id}
                        className={`inline-block px-2.5 py-1.5 rounded-xl font-arabic-quran text-xl sm:text-2xl transition-all cursor-default ${
                          isError
                            ? 'bg-rose-100 text-rose-950 border-2 border-rose-400 shadow-xs'
                            : isCurrent
                            ? 'bg-emerald-900 text-white shadow-md scale-105 ring-2 ring-emerald-600/50'
                            : isPassed
                            ? 'bg-emerald-50/80 text-emerald-900 border border-emerald-200/60'
                            : 'text-stone-800 hover:bg-stone-200/40'
                        }`}
                      >
                        {word.textUthmani}
                      </span>
                    );
                  })}
                  {/* Ayah End Symbol */}
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-emerald-700/60 text-emerald-900 font-bold text-xs bg-emerald-50/50 mx-1">
                    {ayah.ayahNumber}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 5. Islamic Pedagogical Teacher Feedback Card */}
      {latestClassification && latestClassification.category !== ReligiousClassificationCategory.NO_ERROR && (
        <div
          className={`rounded-2xl p-6 border transition-all animate-fadeIn ${
            latestClassification.category === ReligiousClassificationCategory.LAHN_JALI
              ? 'bg-rose-50/90 border-rose-200 text-rose-950'
              : latestClassification.category === ReligiousClassificationCategory.LAHN_KHAFI
              ? 'bg-amber-50/90 border-amber-200 text-amber-950'
              : 'bg-stone-50 border-stone-200 text-stone-900'
          }`}
        >
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-rose-200/60 pb-3">
            <div className="flex items-center gap-3">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold ${
                  latestClassification.category === ReligiousClassificationCategory.LAHN_JALI
                    ? 'bg-rose-600 text-white'
                    : 'bg-amber-600 text-white'
                }`}
              >
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <span className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-white/80 border border-rose-200">
                  {latestClassification.ruleNameArabic}
                </span>
                <h4 className="text-base sm:text-lg font-bold font-arabic-heading mt-1">
                  توجيه المعلم التربوي اللطيف (Pedagogical Feedback)
                </h4>
              </div>
            </div>

            {/* Traceable Confidence Badge */}
            {latestConfidence && (
              <div className="bg-white px-3 py-1.5 rounded-xl border border-stone-200 text-xs shadow-2xs">
                <span className="text-stone-500">مستوى الثقة المعايرة: </span>
                <span className="font-bold text-emerald-800">
                  [{latestConfidence.resolvedLevel}] ({Math.round(latestConfidence.finalCalibratedScore * 100)}%)
                </span>
              </div>
            )}
          </div>

          <div className="mt-4 space-y-3">
            <div className="text-sm font-medium leading-relaxed bg-white/70 p-4 rounded-xl border border-rose-200/50">
              <p className="text-stone-800 font-semibold">{latestClassification.pedagogicalTipArabic}</p>
              <p className="text-xs text-stone-600 mt-1">{latestClassification.descriptionArabic}</p>
            </div>

            {/* Evidence Traceability List */}
            {latestConfidence && latestConfidence.evidenceFactorsArabic.length > 0 && (
              <div className="text-xs text-stone-600 space-y-1 bg-white/50 p-3 rounded-lg border border-stone-200">
                <div className="font-bold text-stone-700 flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5 text-stone-500" />
                  <span>عوامل الدليل الصوتي والمحاذاة المبرهنة (Traceable Evidence):</span>
                </div>
                <ul className="list-disc list-inside space-y-0.5 pr-2">
                  {latestConfidence.evidenceFactorsArabic.map((factor, idx) => (
                    <li key={idx}>{factor}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 6. Audio Model Governance & Pipeline Telemetry Inspector */}
      <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-xs space-y-6">
        <div className="flex items-center justify-between border-b border-stone-100 pb-3">
          <div className="flex items-center gap-2">
            <Cpu className="w-5 h-5 text-indigo-700" />
            <h3 className="font-bold text-stone-900 font-arabic-heading text-base">
              حوكمة النماذج الصوتية والمصفوفة المعيارية (Audio Model Registry)
            </h3>
          </div>
          <span className="text-xs text-stone-500">
            مبدأ الشفافية العلمية: أي نموذج لم يتم قياسه معيارياً يبقى محظوراً
          </span>
        </div>

        {/* Model Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {allModels.map((model) => {
            const isCertified = model.benchmarkStatus === 'BENCHMARKED_CERTIFIED';
            return (
              <div
                key={model.modelId}
                className={`p-4 rounded-xl border text-xs space-y-2.5 ${
                  isCertified ? 'bg-emerald-50/50 border-emerald-300' : 'bg-stone-50 border-stone-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`px-2 py-0.5 rounded font-bold text-[10px] ${
                      isCertified
                        ? 'bg-emerald-200/80 text-emerald-950'
                        : 'bg-amber-100 text-amber-900'
                    }`}
                  >
                    {model.benchmarkStatus}
                  </span>
                  <span className="text-[10px] text-stone-400">{model.version}</span>
                </div>
                <div className="font-bold text-stone-900">{model.nameArabic}</div>
                <div className="text-[11px] text-stone-600 line-clamp-2">{model.notesArabic}</div>
                <div className="pt-2 border-t border-stone-200/60 flex items-center justify-between text-[10px] text-stone-500">
                  <span>الكمون: ~{model.averageInferenceLatencyMs}ms</span>
                  <span>RTF: {model.realTimeFactor}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Scientific Phonetic Analyzers Status (Madd, Ghunnah, Articulation) */}
        <div className="p-4 rounded-xl bg-stone-100/70 border border-stone-200 text-xs space-y-2">
          <div className="font-bold text-stone-800 flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-800" />
            <span>حالة المحللات الصوتية الفرعية (Sub-Phonetic Analyzers):</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
            <div className="bg-white p-3 rounded-lg border border-stone-200">
              <div className="flex justify-between items-center">
                <span className="font-bold text-stone-800">محلل أزمنة المدود</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 font-bold">EXPERIMENTAL</span>
              </div>
              <p className="text-[11px] text-stone-500 mt-1">محسوب بنسب السرعة والحركات (±25% سماحية).</p>
            </div>

            <div className="bg-white p-3 rounded-lg border border-stone-200">
              <div className="flex justify-between items-center">
                <span className="font-bold text-stone-800">محلل رنين الغنة</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-stone-200 text-stone-700 font-bold">NOT_AVAILABLE</span>
              </div>
              <p className="text-[11px] text-stone-500 mt-1">لا يعرض نسباً وهمية لغياب نموذج الرنين الأنفي.</p>
            </div>

            <div className="bg-white p-3 rounded-lg border border-stone-200">
              <div className="flex justify-between items-center">
                <span className="font-bold text-stone-800">محلل مخارج وصفات الحروف</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 font-bold">NOT_IMPLEMENTED</span>
              </div>
              <p className="text-[11px] text-stone-500 mt-1">محظور تفعيله قبل اعتماد معجم صوتي مرجعي مع الشيوخ.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
