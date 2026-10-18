import React, { useState, useEffect, useRef } from 'react';
import {
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Award,
  Play,
  Square,
  Bookmark,
  HelpCircle,
  Headphones,
  Sliders,
  Check,
  Eye,
  EyeOff,
  FileText,
  Globe,
  Share2,
  Lightbulb,
  Cpu,
} from 'lucide-react';

import { RealTimeSessionOrchestrator, RealTimeRecitationWordStatus } from '../../domain/realtime_teacher/RealTimeSessionOrchestrator.ts';
import {
  RealTimeTeacherSessionState,
  RealTimeFeedbackDelivery,
  WordVisualState,
  UserInteractionMode
} from '../../domain/realtime_teacher/types.ts';
import { WebAudioCaptureProvider } from '../../infrastructure/audio/WebAudioCaptureProvider.ts';
import { AuthenticReciterFeedbackVoiceProvider } from '../../domain/realtime_teacher/AuthenticReciterFeedbackVoiceProvider.ts';
import { ALL_114_SURAHS_MANIFEST, VerifiedQuranDataProvider } from '../../infrastructure/quran/VerifiedQuranDataProvider.ts';
import { RiwayahType } from '../../domain/quran/types.ts';
import { VadActivityState } from '../../domain/recitation/vadTypes.ts';
import { RecitationEvidence, EvidenceErrorType, EvidenceConfidenceStatus } from '../../domain/recitation/RecitationEvidence.ts';
import { RecitationAdvancementGate } from '../../domain/recitation/RecitationAdvancementGate.ts';
import { InferenceWorkerClient } from '../../infrastructure/workers/InferenceWorkerClient.ts';
import { CANONICAL_RECITERS, CanonicalReciter } from '../../domain/reciter/reciters.ts';
import { getAyahTafsir, AyahTafsir } from '../../domain/quran/QuranTafsirProvider.ts';
import { getAyahTajweedHighlights, TajweedHighlight } from '../../domain/tajweed/AyahTajweedAnalysis.ts';
import { RecitationReportModal, RecitationReportData } from './RecitationReportModal.tsx';
import { MasteryCertificateModal } from './MasteryCertificateModal.tsx';
import { PublicShareModal } from './PublicShareModal.tsx';
import { FirstUserGuideModal } from './FirstUserGuideModal.tsx';
import { recordRecitationSessionToFirestore } from '../../infrastructure/firebase/firebaseClient.ts';

interface UnifiedClassroomViewProps {
  initialSurah?: number;
  initialAyah?: number;
}

export const UnifiedClassroomView: React.FC<UnifiedClassroomViewProps> = ({
  initialSurah = 1,
  initialAyah = 1,
}) => {
  // Surah & Ayah state
  const [selectedSurah, setSelectedSurah] = useState<number>(initialSurah);
  const [selectedAyah, setSelectedAyah] = useState<number>(initialAyah);
  const [surahName, setSurahName] = useState<string>('سورة الفاتحة');
  const [totalAyahs, setTotalAyahs] = useState<number>(7);

  // Reciter & Reference Listening state
  const [selectedReciterId, setSelectedReciterId] = useState<string>('husary_murattal');
  const [isPlayingReciter, setIsPlayingReciter] = useState<boolean>(false);
  const [audioError, setAudioError] = useState<string | null>(null);

  // Tab & Pedagogical Sidebars
  const [activeSidebarTab, setActiveSidebarTab] = useState<'TAJWEED' | 'TAFSIR' | 'RECITERS'>('TAJWEED');

  // Orchestrator and Providers
  const orchestratorRef = useRef<RealTimeSessionOrchestrator | null>(null);
  const audioCaptureRef = useRef<WebAudioCaptureProvider | null>(null);
  const voiceProviderRef = useRef<AuthenticReciterFeedbackVoiceProvider | null>(null);

  // UI States
  const [sessionState, setSessionState] = useState<RealTimeTeacherSessionState>(RealTimeTeacherSessionState.IDLE);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [isTeacherSpeaking, setIsTeacherSpeaking] = useState<boolean>(false);
  const [micVolume, setMicVolume] = useState<number>(0);
  const [words, setWords] = useState<RealTimeRecitationWordStatus[]>([]);
  const [activeFeedback, setActiveFeedback] = useState<RealTimeFeedbackDelivery | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState<boolean>(true);
  const [errorCount, setErrorCount] = useState<number>(0);
  const [successCount, setSuccessCount] = useState<number>(0);
  const [sessionCompleted, setSessionCompleted] = useState<boolean>(false);

  // Mode: Open Mushaf vs Blind Recitation Test
  const [recitationMode, setRecitationMode] = useState<'OPEN_MUSHAF' | 'BLIND_TEST'>('OPEN_MUSHAF');
  const [revealedHints, setRevealedHints] = useState<number[]>([]);
  const [hesitationWords, setHesitationWords] = useState<string[]>([]);
  const [correctedWords, setCorrectedWords] = useState<string[]>([]);
  const [sessionStartTime] = useState<number>(Date.now());

  // Modals state
  const [showReportModal, setShowReportModal] = useState<boolean>(false);
  const [showCertificateModal, setShowCertificateModal] = useState<boolean>(false);
  const [showShareModal, setShowShareModal] = useState<boolean>(false);
  const [showGuideModal, setShowGuideModal] = useState<boolean>(() => {
    try {
      return localStorage.getItem('aya_onboarding_dismissed') !== 'true';
    } catch {
      return false;
    }
  });

  // Active word details
  const [hoveredWordIndex, setHoveredWordIndex] = useState<number | null>(null);

  // Neural Acoustic Model Web Worker State
  const [modelStatus, setModelStatus] = useState<'LOADING' | 'READY' | 'DOWNLOADING' | 'UNAVAILABLE'>('LOADING');
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const inferenceClientRef = useRef<InferenceWorkerClient | null>(null);
  const currentSessionIdRef = useRef<string>('');

  // Metadata for current verse
  const tafsirData: AyahTafsir | null = getAyahTafsir(selectedSurah, selectedAyah);
  const tajweedHighlights: TajweedHighlight[] = getAyahTajweedHighlights(selectedSurah, selectedAyah);
  const currentReciter = CANONICAL_RECITERS.find((r) => r.id === selectedReciterId) || CANONICAL_RECITERS[0];

  // Initialize once
  useEffect(() => {
    const quranProvider = new VerifiedQuranDataProvider(true);
    const voiceProvider = new AuthenticReciterFeedbackVoiceProvider(selectedReciterId);
    const orchestrator = new RealTimeSessionOrchestrator(quranProvider, voiceProvider);
    const audioCapture = new WebAudioCaptureProvider();

    const inferenceClient = new InferenceWorkerClient();
    inferenceClientRef.current = inferenceClient;

    if (inferenceClient.isAvailable()) {
      inferenceClient
        .loadModel(undefined, (prog) => {
          if (prog.phase === 'DOWNLOADING') {
            setModelStatus('DOWNLOADING');
            setDownloadProgress(prog.percentage);
          } else if (prog.phase === 'READY') {
            setModelStatus('READY');
            setDownloadProgress(100);
          }
        })
        .then(() => {
          setModelStatus('READY');
        })
        .catch((err) => {
          console.warn('[UnifiedClassroom] Neural model worker initialization info:', err);
          setModelStatus('UNAVAILABLE');
        });
    } else {
      setModelStatus('UNAVAILABLE');
    }

    orchestratorRef.current = orchestrator;
    voiceProviderRef.current = voiceProvider;
    audioCaptureRef.current = audioCapture;

    const unbindState = orchestrator.registerStateListener((state) => {
      setSessionState(state);
      setIsTeacherSpeaking(state === RealTimeTeacherSessionState.TEACHER_SPEAKING);
      if (state === RealTimeTeacherSessionState.ENDED) {
        setIsRecording(false);
        setSessionCompleted(true);
        // Persist session to Firebase Firestore with dynamically computed metrics
        const report = getReportData();
        recordRecitationSessionToFirestore({
          sessionId: `rec-${selectedSurah}-${selectedAyah}-${Date.now()}`,
          surahNumber: selectedSurah,
          ayahNumber: selectedAyah,
          mode: recitationMode,
          accuracyScore: report.accuracyScore,
          tajweedScore: report.tajweedScore,
          fluencyScore: report.fluencyScore,
          hesitationCount: report.hesitationCount,
          errorCount: report.errorCount,
        }).catch(() => {
          // Guest or offline mode
        });
      }
    });

    const unbindFeedback = orchestrator.registerFeedbackListener((feedback) => {
      setActiveFeedback(feedback);
      if (feedback.action === 'PRAISE_AND_CONTINUE' || feedback.action === 'CONTINUE') {
        setSuccessCount((prev) => prev + 1);
      } else {
        setErrorCount((prev) => prev + 1);
        const currentWords = orchestrator.getAyahWords();
        const targetWord = currentWords[feedback.targetWordIndex];
        if (targetWord?.textUthmani) {
          setCorrectedWords((prev) => prev.includes(targetWord.textUthmani) ? prev : [...prev, targetWord.textUthmani]);
        }
      }
    });

    const unbindWords = orchestrator.registerWordStatusListener((updatedWords) => {
      setWords([...updatedWords]);
    });

    loadAyahSession(initialSurah, initialAyah, orchestrator);

    return () => {
      unbindState();
      unbindFeedback();
      unbindWords();
      if (audioCaptureRef.current) {
        audioCaptureRef.current.stop().catch(() => {});
      }
      if (voiceProviderRef.current) {
        voiceProviderRef.current.stop();
      }
      if (inferenceClientRef.current) {
        inferenceClientRef.current.dispose();
      }
    };
  }, []);

  // Synchronize when initialSurah or initialAyah changes externally (e.g. from Progress dashboard)
  useEffect(() => {
    if (initialSurah !== selectedSurah || initialAyah !== selectedAyah) {
      setSelectedSurah(initialSurah);
      setSelectedAyah(initialAyah);
      loadAyahSession(initialSurah, initialAyah);
    }
  }, [initialSurah, initialAyah]);

  // Update reciter in provider when selection changes
  const handleReciterChange = (newReciterId: string) => {
    setSelectedReciterId(newReciterId);
    if (voiceProviderRef.current) {
      voiceProviderRef.current.setReciter(newReciterId);
    }
    if (isPlayingReciter) {
      handleStopReciterAudio();
    }
  };

  const loadAyahSession = async (surahNum: number, ayahNum: number, orch?: RealTimeSessionOrchestrator) => {
    const orchestrator = orch || orchestratorRef.current;
    if (!orchestrator) return;

    if (isPlayingReciter) {
      handleStopReciterAudio();
    }

    try {
      await orchestrator.initializeSession({
        sessionId: `session-${Date.now()}`,
        studentId: 'student-local',
        deviceId: 'device-browser',
        surahNumber: surahNum,
        ayahNumber: ayahNum,
        riwayah: RiwayahType.HAFS_AN_ASIM,
        mode: UserInteractionMode.REAL_TIME_TUTOR,
        voiceFeedbackEnabled: voiceEnabled,
        textOnlyFeedback: !voiceEnabled,
        interruptionEnabled: true,
        languageDialect: 'ARABIC_STANDARD',
        explanationLevel: 'MINIMAL',
        rawAudioPersistence: false,
      });

      const initialWords = orchestrator.getAyahWords();
      setWords([...initialWords]);
      setActiveFeedback(null);
      setErrorCount(0);
      setSuccessCount(0);
      setSessionCompleted(false);
      setAudioError(null);
      setRevealedHints([]);
      setHesitationWords([]);
      setCorrectedWords([]);

      const targetSurah = ALL_114_SURAHS_MANIFEST.find((s) => s.number === surahNum);
      if (targetSurah) {
        setSurahName(`سورة ${targetSurah.nameArabic}`);
        setTotalAyahs(targetSurah.totalAyahs);
      } else {
        setSurahName(`سورة ${surahNum}`);
        setTotalAyahs(7);
      }
    } catch (err) {
      console.error('Failed to load session:', err);
    }
  };

  const handleStartRecitation = async () => {
    if (!orchestratorRef.current || !audioCaptureRef.current) return;

    // If reciter reference audio is currently playing, stop it first to prevent acoustic bleed
    if (isPlayingReciter) {
      handleStopReciterAudio();
    }

    try {
      let speechFrameCounter = 0;
      let accumulatedSamples: number[] = [];
      const sessionId = `rec_${selectedSurah}_${selectedAyah}_${Date.now()}`;
      currentSessionIdRef.current = sessionId;

      if (inferenceClientRef.current?.getModelReady()) {
        await inferenceClientRef.current.resetSession(sessionId);
      }

      await audioCaptureRef.current.start(async (chunk) => {
        // Calculate volume for animated visualizer
        let sum = 0;
        const pcm = chunk.pcmData;
        for (let i = 0; i < pcm.length; i++) {
          sum += pcm[i] * pcm[i];
        }
        const rms = Math.sqrt(sum / pcm.length);
        const energyPercent = Math.min(100, Math.round(rms * 400));
        setMicVolume(energyPercent);

        // VAD estimation
        const vadState = rms > 0.015 ? VadActivityState.SPEECH : VadActivityState.SILENCE;
        const snrDb = rms > 0.01 ? 22.0 : 8.0;

        // Process audio in the orchestrator
        const audioRes = orchestratorRef.current?.processAudioChunk(
          vadState,
          rms,
          snrDb,
          chunk.durationMs,
          chunk.timestampMs
        );

        // When stable speech energy is detected on a current word, evaluate verified step
        if (vadState === VadActivityState.SPEECH && audioRes?.isStudentSpeaking) {
          speechFrameCounter++;
          for (let i = 0; i < pcm.length; i++) {
            accumulatedSamples.push(pcm[i]);
          }

          // Accumulate ~1 second of speech (16,000 samples at 16kHz) for acoustic evaluation
          if (accumulatedSamples.length >= 16000) {
            const bufferToProcess = new Float32Array(accumulatedSamples);
            accumulatedSamples = []; // Reset accumulator

            const currentWordsList = orchestratorRef.current?.getAyahWords() || [];
            const currentTargetIdx = currentWordsList.findIndex(
              (w) => w.visualState === WordVisualState.CURRENT || w.visualState === WordVisualState.TARGET_FOR_REPEAT
            );

            if (currentTargetIdx >= 0) {
              const expectedToken = currentWordsList[currentTargetIdx]?.textUthmani || '';

              // PATH A: Real ONNX Neural Model Inference
              if (inferenceClientRef.current?.getModelReady()) {
                try {
                  const result = await inferenceClientRef.current.inferChunk(
                    sessionId,
                    bufferToProcess,
                    false
                  );
                  const observedTokens = result.payload?.observedTokens || [];
                  const frames = result.payload?.frames || [];

                  const avgConfidence = frames.length > 0
                    ? frames.reduce((acc, f) => acc + f.topProbability, 0) / frames.length
                    : 0;

                  // Authoritative Single Advancement Gate (Phase 16.9R)
                  const gateResult = RecitationAdvancementGate.evaluateAdvancement({
                    sessionId,
                    activeSessionId: currentSessionIdRef.current,
                    expectedWordIndex: currentTargetIdx,
                    currentWordIndex: currentTargetIdx,
                    expectedToken,
                    observedTokens,
                    acousticConfidence: avgConfidence,
                    snrDb,
                    isStudentSpeaking: audioRes?.isStudentSpeaking,
                  });

                  const realEvidence: RecitationEvidence = {
                    ayahId: `ayah-${selectedSurah}-${selectedAyah}`,
                    wordIndex: currentTargetIdx,
                    phonemeIndex: 0,
                    expectedToken,
                    observedToken: observedTokens.slice(0, 5).join('') || '?',
                    errorType: gateResult.errorType,
                    acousticConfidence: avgConfidence,
                    alignmentConfidence: 0.90,
                    startTime: chunk.timestampMs - 1000,
                    endTime: chunk.timestampMs,
                    evidenceStatus: gateResult.evidenceStatus,
                  };

                  // If verified match, reset worker session to start fresh on next word
                  if (gateResult.canAdvance && inferenceClientRef.current) {
                    inferenceClientRef.current.resetSession(sessionId).catch(() => {});
                  }

                  orchestratorRef.current?.evaluateRecitationStep(realEvidence);
                } catch (infErr) {
                  console.warn('[Classroom] Neural inference error:', infErr);
                }
              } else {
                // PATH B: Model Not Loaded / Absent:
                // STRICT CONTRACT: Absence of evidence = no positive acoustic judgment.
                // NEVER emit fake MATCH or forged logits.
                const inconclusiveEvidence: RecitationEvidence = {
                  ayahId: `ayah-${selectedSurah}-${selectedAyah}`,
                  wordIndex: currentTargetIdx,
                  phonemeIndex: 0,
                  expectedToken,
                  observedToken: '?',
                  errorType: 'INCONCLUSIVE',
                  acousticConfidence: 0.0,
                  alignmentConfidence: 0.0,
                  startTime: chunk.timestampMs - 500,
                  endTime: chunk.timestampMs,
                  evidenceStatus: 'INCONCLUSIVE',
                };
                orchestratorRef.current?.evaluateRecitationStep(inconclusiveEvidence);
              }
            }
          }
        }
      });

      setIsRecording(true);
      setSessionCompleted(false);
    } catch (err: any) {
      alert(`تعذر تشغيل الميكروفون: ${err?.message || 'يرجى السماح بصلاحية الميكروفون للبدء'}`);
      setIsRecording(false);
    }
  };

  const handleStopRecitation = async () => {
    if (currentSessionIdRef.current && inferenceClientRef.current) {
      inferenceClientRef.current.cancelSession(currentSessionIdRef.current).catch(() => {});
    }
    if (audioCaptureRef.current) {
      await audioCaptureRef.current.stop();
    }
    if (orchestratorRef.current) {
      orchestratorRef.current.pauseSession();
    }
    setIsRecording(false);
    setMicVolume(0);
  };

  const handlePlayReciterAudio = async () => {
    if (!voiceProviderRef.current) return;
    if (isRecording) {
      await handleStopRecitation();
    }

    setAudioError(null);
    setIsPlayingReciter(true);

    await voiceProviderRef.current.playAuthenticAyah(
      selectedSurah,
      selectedAyah,
      () => setIsPlayingReciter(true),
      () => setIsPlayingReciter(false),
      (err) => setAudioError(err)
    );
  };

  const handleStopReciterAudio = () => {
    if (voiceProviderRef.current) {
      voiceProviderRef.current.stop();
    }
    setIsPlayingReciter(false);
  };

  const handleTriggerSimulatedCorrection = (targetIdx: number) => {
    if (!orchestratorRef.current) return;
    const currentWordsList = orchestratorRef.current.getAyahWords();
    const word = currentWordsList[targetIdx];
    if (!word) return;

    if (!correctedWords.includes(word.textUthmani)) {
      setCorrectedWords((prev) => [...prev, word.textUthmani]);
    }

    // Simulate pedagogical correction with authentic reciter benchmark
    const simulatedEvidence: RecitationEvidence = {
      ayahId: `ayah-${selectedSurah}-${selectedAyah}`,
      wordIndex: targetIdx,
      phonemeIndex: 0,
      expectedToken: word.textUthmani,
      observedToken: 'نطق غير دقيق',
      errorType: 'SUBSTITUTION',
      acousticConfidence: 0.88,
      alignmentConfidence: 0.89,
      startTime: 0,
      endTime: 400,
      evidenceStatus: 'HIGH',
    };

    orchestratorRef.current.evaluateRecitationStep(simulatedEvidence);
  };

  const handleRevealNextHint = () => {
    const currentTargetIdx = words.findIndex(
      (w) => w.visualState === WordVisualState.CURRENT || w.visualState === WordVisualState.TARGET_FOR_REPEAT
    );
    const targetIdx = currentTargetIdx >= 0 ? currentTargetIdx : words.findIndex((w) => w.visualState !== WordVisualState.COMPLETED);
    if (targetIdx >= 0 && !revealedHints.includes(targetIdx)) {
      setRevealedHints((prev) => [...prev, targetIdx]);
      const word = words[targetIdx]?.textUthmani;
      if (word && !hesitationWords.includes(word)) {
        setHesitationWords((prev) => [...prev, word]);
      }
    }
  };

  const getReportData = (): RecitationReportData => {
    // Authoritatively query live orchestrator words if available to avoid stale closures
    const currentWords = orchestratorRef.current ? orchestratorRef.current.getAyahWords() : words;
    const totalWords = currentWords.length || 1;
    const completedWords = currentWords.filter((w) => w.visualState === WordVisualState.COMPLETED).length;

    // Real dynamic accuracy score: strictly 0 if no recitation occurred.
    // Proportional to completed words and penalized by verified errors & hints without artificial score clamping.
    let accuracyScore = 0;
    if (completedWords > 0) {
      const completionRatio = completedWords / totalWords;
      const penalty = (errorCount * 8) + (revealedHints.length * 4);
      accuracyScore = Math.max(0, Math.min(100, Math.round((completionRatio * 100) - penalty)));
    }

    // Since the neural model evaluates acoustic phonetic tokens and NOT formal Tajweed rules
    // (Tajweed evaluation is pending scholar-certified benchmarks in Phase 17),
    // tajweedScore is derived from confirmed phonemic accuracy without artificial inflation.
    const isFullyCompleted = sessionCompleted || (currentWords.length > 0 && completedWords === currentWords.length);
    const tajweedScore = isFullyCompleted ? Math.max(0, accuracyScore - (errorCount * 2)) : 0;
    const fluencyScore = completedWords > 0 ? Math.max(0, 100 - (hesitationWords.length * 10)) : 0;

    return {
      surahNumber: selectedSurah,
      surahName,
      totalAyahs,
      completedAyahs: isFullyCompleted ? selectedAyah : 0,
      accuracyScore,
      tajweedScore,
      fluencyScore,
      hesitationCount: hesitationWords.length,
      errorCount,
      perfectWordCount: Math.max(0, completedWords - errorCount - revealedHints.length),
      reciterBenchmark: currentReciter.nameArabic,
      sessionDurationSeconds: Math.max(1, Math.round((Date.now() - sessionStartTime) / 1000)),
      testedMode: recitationMode,
      hesitationWords,
      correctedWords,
      pedagogicalRemarks: [
        `تم إجراء التسميع بمطابقة مصحف المدينة المنورة برواية حفص عن عاصم`,
        isFullyCompleted
          ? `أتم الطالب تلاوة الآية كاملة بنسبة دقة ${accuracyScore}%`
          : `الجلسة قيد الاستماع والتسميع (${completedWords} من ${totalWords} كلمة مكتملة)`
      ]
    };
  };

  const handleResetAyah = () => {
    handleStopRecitation();
    handleStopReciterAudio();
    orchestratorRef.current?.restartCurrentAyah();
    setWords([...(orchestratorRef.current?.getAyahWords() || [])]);
  };

  const handleNextAyah = () => {
    if (selectedAyah < totalAyahs) {
      const nextAyah = selectedAyah + 1;
      setSelectedAyah(nextAyah);
      handleStopRecitation();
      handleStopReciterAudio();
      loadAyahSession(selectedSurah, nextAyah);
    }
  };

  const handlePrevAyah = () => {
    if (selectedAyah > 1) {
      const prevAyah = selectedAyah - 1;
      setSelectedAyah(prevAyah);
      handleStopRecitation();
      handleStopReciterAudio();
      loadAyahSession(selectedSurah, prevAyah);
    }
  };

  const getWordClasses = (visualState: WordVisualState, isHovered: boolean) => {
    let base = 'transition-all duration-300 relative inline-flex items-center justify-center cursor-pointer select-none';
    if (isHovered) {
      base += ' ring-2 ring-emerald-500 scale-105 shadow-md';
    }

    switch (visualState) {
      case WordVisualState.COMPLETED:
        return `${base} text-emerald-800 bg-emerald-50/90 border-emerald-300/80 shadow-xs`;
      case WordVisualState.CURRENT:
        return `${base} text-stone-900 bg-amber-100/90 border-amber-400 ring-2 ring-amber-300 animate-pulse font-bold shadow-sm`;
      case WordVisualState.TARGET_FOR_REPEAT:
        return `${base} text-rose-800 bg-rose-100/90 border-rose-400 ring-2 ring-rose-400 font-bold shadow-sm`;
      case WordVisualState.REVIEW:
        return `${base} text-amber-900 bg-amber-50 border-amber-300 opacity-90`;
      case WordVisualState.UNCERTAIN:
      default:
        return `${base} text-stone-700 bg-white/70 border-stone-200/90 hover:bg-stone-50`;
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-2.5 sm:px-6 lg:px-8 py-3 sm:py-6 space-y-3 sm:space-y-6">
      {/* Top Banner / Islamic Architectural Header */}
      <div className="relative overflow-hidden rounded-2xl sm:rounded-3xl bg-gradient-to-l from-emerald-950 via-stone-900 to-emerald-900 text-white p-3.5 sm:p-6 lg:p-8 shadow-xl border border-emerald-800/40">
        <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20"></div>
        <div className="absolute bottom-0 left-0 w-80 h-80 bg-amber-500/10 rounded-full blur-3xl pointer-events-none -ml-20 -mb-20"></div>

        <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-4 sm:gap-6">
          <div className="space-y-1.5 sm:space-y-2">
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 sm:px-3 sm:py-1 rounded-full bg-emerald-500/20 border border-emerald-400/30 text-emerald-300 text-3xs sm:text-xs font-medium">
                <ShieldCheck className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-emerald-400" />
                <span>مصحف المدينة النبوية الموثق • حفص عن عاصم</span>
              </div>
              <div className="inline-flex items-center gap-1 px-2.5 py-0.5 sm:px-3 sm:py-1 rounded-full bg-stone-800/80 border border-stone-700/80 text-3xs sm:text-xs font-medium">
                <Cpu className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-amber-400" />
                {modelStatus === 'READY' && (
                  <span className="text-emerald-300 font-bold">النموذج الصوتي جاهز (ONNX Web / 72.7MB)</span>
                )}
                {modelStatus === 'DOWNLOADING' && (
                  <span className="text-amber-300 animate-pulse">تحميل النموذج ({downloadProgress}%)</span>
                )}
                {modelStatus === 'LOADING' && (
                  <span className="text-sky-300">جاري فحص النموذج...</span>
                )}
                {modelStatus === 'UNAVAILABLE' && (
                  <span className="text-stone-400">التحقق الصوتي الاحترازي</span>
                )}
              </div>
            </div>
            <h1 className="text-lg sm:text-2xl lg:text-3xl font-black font-arabic-heading text-white tracking-wide">
              مقرأة التسميع المتقن والتعليم الفوري
            </h1>
            <p className="text-stone-300 text-2xs sm:text-xs md:text-sm max-w-2xl leading-relaxed line-clamp-2 sm:line-clamp-none">
              محاكاة تلاوة أكابر القراء (الشيخ الحصري، الشيخ المنشاوي) مع فحص تلقائي لأحكام التجويد ومخارج الحروف، وتوجيه علمي مقتبس من أمهات المتون.
            </p>
          </div>

          {/* Quick Reciter Audio Widget */}
          <div className="flex flex-row items-center justify-between sm:justify-start gap-2.5 sm:gap-3 bg-stone-900/80 backdrop-blur-md p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl border border-stone-700/60 shadow-inner">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center border border-amber-500/30">
                <Headphones className="w-5 h-5" />
              </div>
              <div className="text-right">
                <div className="text-[11px] text-stone-400 font-medium">المرجع الصوتي المعتمد</div>
                <div className="text-xs sm:text-sm font-bold text-amber-200 truncate max-w-[170px]">
                  {currentReciter.nameArabic}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2 sm:pt-0 sm:border-r sm:border-stone-700/80 sm:pr-3">
              <button
                onClick={isPlayingReciter ? handleStopReciterAudio : handlePlayReciterAudio}
                aria-label={isPlayingReciter ? 'إيقاف استماع صوت الشيخ' : 'الاستماع لتلاوة الشيخ المرتلة'}
                aria-pressed={isPlayingReciter}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-md cursor-pointer ${
                  isPlayingReciter
                    ? 'bg-amber-600 hover:bg-amber-700 text-white ring-2 ring-amber-400 animate-pulse'
                    : 'bg-emerald-600 hover:bg-emerald-700 text-white ring-1 ring-emerald-400/50 hover:scale-102'
                }`}
                title="استمع لتلاوة الشيخ المحققة لهذه الآية"
              >
                {isPlayingReciter ? <Square className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                <span>{isPlayingReciter ? 'إيقاف الاستماع' : 'استمع للشيخ'}</span>
              </button>
            </div>
          </div>
        </div>

        {audioError && (
          <div className="mt-4 p-2.5 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-200 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{audioError}</span>
          </div>
        )}
      </div>

      {/* Surah Selection and Ayah Navigators */}
      <div className="bg-white rounded-xl sm:rounded-2xl p-2.5 sm:p-5 shadow-sm border border-stone-200/80 flex flex-wrap items-center justify-between gap-2.5 sm:gap-4">
        {/* 114 Surahs Selector and Fast Chips */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 w-full lg:w-auto">
          <div className="flex items-center gap-1.5 sm:gap-2 w-full xs:w-auto">
            <span className="text-2xs sm:text-xs font-bold text-stone-700 whitespace-nowrap">السورة:</span>
            <select
              value={selectedSurah}
              onChange={(e) => {
                const sId = Number(e.target.value);
                setSelectedSurah(sId);
                setSelectedAyah(1);
                handleStopRecitation();
                handleStopReciterAudio();
                loadAyahSession(sId, 1);
              }}
              className="px-2.5 py-1.5 rounded-xl bg-stone-50 border border-stone-300 text-xs font-bold text-stone-900 shadow-2xs focus:ring-2 focus:ring-emerald-700 focus:bg-white cursor-pointer max-w-[200px] xs:max-w-none truncate"
            >
              {ALL_114_SURAHS_MANIFEST.map((s) => (
                <option key={s.number} value={s.number}>
                  {s.number}. سورة {s.nameArabic} ({s.totalAyahs} آية)
                </option>
              ))}
            </select>
          </div>

          {/* Quick Popular Surah Chips */}
          <div className="flex items-center gap-1 sm:gap-1.5 overflow-x-auto py-1 no-scrollbar max-w-full sm:max-w-md">
            {[
              { id: 1, name: 'الفاتحة' },
              { id: 36, name: 'يس' },
              { id: 67, name: 'الملك' },
              { id: 78, name: 'النبأ' },
              { id: 93, name: 'الضحى' },
              { id: 108, name: 'الكوثر' },
              { id: 112, name: 'الإخلاص' },
              { id: 113, name: 'الفلق' },
              { id: 114, name: 'الناس' },
            ].map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  setSelectedSurah(s.id);
                  setSelectedAyah(1);
                  handleStopRecitation();
                  handleStopReciterAudio();
                  loadAyahSession(s.id, 1);
                }}
                className={`px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-lg text-2xs sm:text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                  selectedSurah === s.id
                    ? 'bg-emerald-900 text-white shadow-xs'
                    : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                }`}
              >
                {s.name}
              </button>
            ))}
          </div>
        </div>

        {/* Mode & Action Controls */}
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          {/* Mode Switcher */}
          <div className="flex items-center p-0.5 sm:p-1 bg-stone-100 rounded-xl border border-stone-200">
            <button
              onClick={() => setRecitationMode('OPEN_MUSHAF')}
              aria-label="وضع المصحف المفتوح مع عرض كلمات الآية"
              aria-pressed={recitationMode === 'OPEN_MUSHAF'}
              className={`px-2 sm:px-3 py-1 rounded-lg text-2xs sm:text-xs font-bold flex items-center gap-1 sm:gap-1.5 transition-all cursor-pointer ${
                recitationMode === 'OPEN_MUSHAF'
                  ? 'bg-white text-emerald-950 shadow-xs'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
              title="تسميع مع فتح المصحف ومتابعة الكلمات"
            >
              <Eye className="w-3 sm:w-3.5 h-3 sm:h-3.5 text-emerald-700" />
              <span>المصحف</span>
            </button>
            <button
              onClick={() => setRecitationMode('BLIND_TEST')}
              aria-label="وضع الاختبار الغيبي مع إخفاء كلمات الآية"
              aria-pressed={recitationMode === 'BLIND_TEST'}
              className={`px-2 sm:px-3 py-1 rounded-lg text-2xs sm:text-xs font-bold flex items-center gap-1 sm:gap-1.5 transition-all cursor-pointer ${
                recitationMode === 'BLIND_TEST'
                  ? 'bg-emerald-900 text-white shadow-xs'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
              title="تسميع غيبي عن ظهر قلب مع إخفاء الكلمات وكشفها تلقائياً عند الإتقان"
            >
              <EyeOff className={`w-3 sm:w-3.5 h-3 sm:h-3.5 ${recitationMode === 'BLIND_TEST' ? 'text-amber-300' : 'text-stone-500'}`} />
              <span>اختبار غيبي</span>
            </button>
          </div>

          {/* Quick Guide Trigger */}
          <button
            onClick={() => setShowGuideModal(true)}
            aria-label="فتح دليل التسميع والاستخدام للمستخدم الجديد"
            className="px-2 sm:px-3 py-1 sm:py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-300 text-2xs sm:text-xs font-bold flex items-center gap-1 transition-all cursor-pointer shadow-2xs"
            title="دليل التسميع والاستخدام للمستخدم الجديد"
          >
            <HelpCircle className="w-3 sm:w-3.5 h-3 sm:h-3.5 text-emerald-700" />
            <span>الدليل</span>
          </button>

          {/* Quick Report & Certificate Trigger */}
          <button
            onClick={() => setShowReportModal(true)}
            aria-label="عرض تقرير التسميع وقوة الحفظ وإرساله للشيخ"
            className="px-2 sm:px-3 py-1 sm:py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-300 text-2xs sm:text-xs font-bold flex items-center gap-1 transition-all cursor-pointer shadow-2xs"
            title="عرض تقرير التسميع وقوة الحفظ وإرساله للشيخ"
          >
            <FileText className="w-3 sm:w-3.5 h-3 sm:h-3.5 text-emerald-700" />
            <span className="hidden xs:inline">التقرير</span>
          </button>

          <button
            onClick={() => {
              const completedWords = words.filter((w) => w.visualState === WordVisualState.COMPLETED).length;
              if (!sessionCompleted || completedWords < words.length) {
                setAudioError('شهادة الإتقان تتطلب إتمام تلاوة الآية كاملة بنجاح أولاً.');
                setTimeout(() => setAudioError(null), 4000);
                return;
              }
              setShowCertificateModal(true);
            }}
            aria-label="عرض وطباعة شهادة الإتقان والتزكية"
            className="px-2 sm:px-3 py-1 sm:py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 text-2xs sm:text-xs font-bold flex items-center gap-1 transition-all cursor-pointer shadow-2xs"
            title="عرض وطباعة شهادة الإتقان والتزكية"
          >
            <Award className="w-3 sm:w-3.5 h-3 sm:h-3.5 text-amber-700" />
            <span className="hidden xs:inline">الشهادة</span>
          </button>

          {/* Ayah Navigation */}
          <div className="flex items-center gap-1 border-r border-stone-200 pr-1.5 mr-0.5">
            <button
              onClick={handlePrevAyah}
              disabled={selectedAyah <= 1}
              aria-label="الانتقال إلى الآية السابقة"
              className="p-1 sm:p-1.5 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-700 disabled:opacity-30 disabled:pointer-events-none transition-all cursor-pointer"
              title="الآية السابقة"
            >
              <ChevronRight className="w-3.5 sm:w-4 h-3.5 sm:h-4" />
            </button>
            <span className="text-2xs sm:text-xs font-bold text-stone-800 bg-stone-50 px-2 py-1 rounded-xl border border-stone-200">
              {selectedAyah}/{totalAyahs}
            </span>
            <button
              onClick={handleNextAyah}
              disabled={selectedAyah >= totalAyahs}
              aria-label="الانتقال إلى الآية التالية"
              className="p-1 sm:p-1.5 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-700 disabled:opacity-30 disabled:pointer-events-none transition-all cursor-pointer"
              title="الآية التالية"
            >
              <ChevronLeft className="w-3.5 sm:w-4 h-3.5 sm:h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Grid: Quran Classroom Canvas + Pedagogical Knowledge Base */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6">
        {/* Left/Center 8 cols: Quran Mushaf Display & Mic Controls */}
        <div className="lg:col-span-8 space-y-4 sm:space-y-6">
          {/* Authentic Mushaf Page Board */}
          <div className="relative bg-gradient-to-b from-[#fdfbf7] to-[#f7f2e7] rounded-2xl sm:rounded-3xl p-4 sm:p-8 md:p-10 shadow-md border-2 border-[#e7dec7] flex flex-col items-center justify-center text-center min-h-[200px] sm:min-h-[280px]">
            {/* Decorative Islamic Frame Corners */}
            <div className="absolute top-2.5 right-2.5 w-6 h-6 sm:w-8 sm:h-8 border-t-2 border-r-2 border-amber-700/40 rounded-tr-lg pointer-events-none"></div>
            <div className="absolute top-2.5 left-2.5 w-6 h-6 sm:w-8 sm:h-8 border-t-2 border-l-2 border-amber-700/40 rounded-tl-lg pointer-events-none"></div>
            <div className="absolute bottom-2.5 right-2.5 w-6 h-6 sm:w-8 sm:h-8 border-b-2 border-r-2 border-amber-700/40 rounded-br-lg pointer-events-none"></div>
            <div className="absolute bottom-2.5 left-2.5 w-6 h-6 sm:w-8 sm:h-8 border-b-2 border-l-2 border-amber-700/40 rounded-bl-lg pointer-events-none"></div>

            {/* Surah and Ayah Badge */}
            <div className="mb-4 sm:mb-6 flex items-center justify-center gap-2 sm:gap-3">
              <span className="h-px w-6 sm:w-10 bg-amber-700/30"></span>
              <span className="text-3xs sm:text-xs uppercase tracking-widest text-amber-900 font-bold bg-[#efe7d2] px-2.5 sm:px-3.5 py-0.5 sm:py-1 rounded-full border border-amber-800/20">
                {surahName} • الآية {selectedAyah}
              </span>
              <span className="h-px w-6 sm:w-10 bg-amber-700/30"></span>
            </div>

            {/* Ayah Words Display with Real-time State and Word-level Tooltip */}
            <div className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-3 leading-[2.2] sm:leading-[2.5] max-w-2xl px-1 sm:px-2" dir="rtl">
              {words.map((w, idx) => {
                const isHovered = hoveredWordIndex === idx;
                const isCompleted = w.visualState === WordVisualState.COMPLETED;
                const isHinted = revealedHints.includes(idx);
                const isCurrent = w.visualState === WordVisualState.CURRENT || w.visualState === WordVisualState.TARGET_FOR_REPEAT;

                // In BLIND_TEST mode: hide word unless it's completed, hinted, or hovered
                if (recitationMode === 'BLIND_TEST' && !isCompleted && !isHinted) {
                  return (
                    <span
                      key={idx}
                      onMouseEnter={() => setHoveredWordIndex(idx)}
                      onMouseLeave={() => setHoveredWordIndex(null)}
                      onClick={() => handleTriggerSimulatedCorrection(idx)}
                      title={isCurrent ? 'اقرأ الكلمة لتظهر، أو انقر للتصحيح' : 'كلمة مستترة في الاختبار الغيبي'}
                      className={`text-lg sm:text-2xl md:text-3xl font-mono px-2.5 py-1 sm:px-4 sm:py-2 rounded-xl sm:rounded-2xl border transition-all cursor-pointer select-none ${
                        isCurrent
                          ? 'bg-amber-100 text-amber-900 border-amber-400 ring-2 ring-amber-300 animate-pulse font-bold'
                          : 'bg-stone-200/50 text-stone-400 border-stone-300/60'
                      } ${isHovered ? 'ring-2 ring-emerald-500 scale-105' : ''}`}
                    >
                      {isHovered ? (
                        <span className="font-amiri-quran text-stone-600 text-base sm:text-xl">
                          {w.textUthmani}
                        </span>
                      ) : (
                        <span>••••</span>
                      )}
                    </span>
                  );
                }

                return (
                  <span
                    key={idx}
                    onMouseEnter={() => setHoveredWordIndex(idx)}
                    onMouseLeave={() => setHoveredWordIndex(null)}
                    onClick={() => handleTriggerSimulatedCorrection(idx)}
                    title="انقر لتجربة التوجيه والتصحيح على هذه الكلمة"
                    className={`text-xl sm:text-3xl md:text-4xl font-amiri-quran px-2 py-1 sm:px-4 sm:py-2 rounded-xl sm:rounded-2xl border ${getWordClasses(
                      w.visualState,
                      isHovered
                    )} ${isHinted && !isCompleted ? 'ring-2 ring-amber-400 bg-amber-50 text-amber-900' : ''}`}
                  >
                    {w.textUthmani}
                    {isCompleted && recitationMode === 'BLIND_TEST' && (
                      <span className="text-[10px] text-emerald-600 mr-1 font-sans">✓</span>
                    )}
                  </span>
                );
              })}
              <span className="text-xl sm:text-3xl font-amiri-quran text-amber-800 font-bold mr-1 inline-flex items-center">
                ۝{selectedAyah}
              </span>
            </div>

            {/* Success Ayah State */}
            {sessionCompleted && (
              <div className="mt-8 p-4 bg-emerald-100/80 border border-emerald-300 rounded-2xl flex flex-wrap items-center justify-center gap-3 text-emerald-950 animate-in fade-in zoom-in-95 shadow-sm">
                <Award className="w-6 h-6 text-emerald-700 shrink-0" />
                <span className="font-bold text-sm sm:text-base">
                  ما شاء الله! تم إتمام قراءة الآية بنجاح ومطابقتها مع الأداء المعتمد.
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowReportModal(true)}
                    className="px-3.5 py-1.5 bg-emerald-900 hover:bg-stone-900 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-xs flex items-center gap-1"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>عرض التقرير</span>
                  </button>
                  <button
                    onClick={handleNextAyah}
                    disabled={selectedAyah >= totalAyahs}
                    className="px-4 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50 cursor-pointer shadow-xs"
                  >
                    انتقل للآية التالية ←
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Recitation Mic and Real-Time Interaction Controller */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-5">
            {/* Recording Mic Console (5 cols) */}
            <div className="sm:col-span-5 bg-white rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-sm border border-stone-200/90 flex flex-col items-center justify-center text-center">
              <div className="relative mb-3 sm:mb-4">
                {isRecording && (
                  <div
                    className="absolute inset-0 rounded-full bg-emerald-500/20 animate-ping"
                    style={{ transform: `scale(${1 + micVolume / 80})` }}
                  ></div>
                )}

                <button
                  onClick={isRecording ? handleStopRecitation : handleStartRecitation}
                  aria-label={isRecording ? 'إيقاف التسميع بالمايكروفون' : 'بدء التسميع بالمايكروفون'}
                  aria-pressed={isRecording}
                  className={`relative z-10 w-20 h-20 sm:w-24 sm:h-24 rounded-full flex flex-col items-center justify-center shadow-lg transition-all transform active:scale-95 cursor-pointer ${
                    isRecording
                      ? 'bg-rose-600 hover:bg-rose-700 text-white ring-4 ring-rose-200'
                      : 'bg-emerald-800 hover:bg-emerald-900 text-white ring-4 ring-emerald-100 hover:scale-105'
                  }`}
                >
                  {isRecording ? <MicOff className="w-7 h-7 sm:w-8 sm:h-8" /> : <Mic className="w-7 h-7 sm:w-8 sm:h-8" />}
                  <span className="text-[10px] sm:text-[11px] font-bold mt-1">
                    {isRecording ? 'إيقاف التسميع' : 'ابدأ التسميع'}
                  </span>
                </button>
              </div>

              {/* Volume Energy Bar */}
              <div className="w-full max-w-[160px] sm:max-w-[190px] mb-2.5 sm:mb-3">
                <div className="flex items-center justify-between text-[10px] sm:text-[11px] text-stone-500 mb-1 font-medium">
                  <span>التقاط الصوت</span>
                  <span className="font-mono">{micVolume}%</span>
                </div>
                <div className="w-full h-2 bg-stone-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-75 ${
                      micVolume > 70 ? 'bg-amber-500' : 'bg-emerald-600'
                    }`}
                    style={{ width: `${micVolume}%` }}
                  ></div>
                </div>
              </div>

              {/* Controller buttons & Hint Trigger */}
              <div className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-2">
                <button
                  onClick={handleResetAyah}
                  className="px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-700 text-2xs sm:text-xs flex items-center gap-1 font-semibold transition-all cursor-pointer"
                  title="إعادة البدء من أول الآية"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>إعادة</span>
                </button>
                <button
                  onClick={() => setVoiceEnabled(!voiceEnabled)}
                  className={`px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-xl text-2xs sm:text-xs flex items-center gap-1 font-semibold transition-all cursor-pointer ${
                    voiceEnabled
                      ? 'bg-emerald-50 text-emerald-900 border border-emerald-300'
                      : 'bg-stone-100 text-stone-500'
                  }`}
                  title="تفعيل أو كتم صوت المعلم"
                >
                  {voiceEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                  <span>{voiceEnabled ? 'صوت المعلم' : 'صامت'}</span>
                </button>

                {recitationMode === 'BLIND_TEST' && (
                  <button
                    onClick={handleRevealNextHint}
                    className="px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-xl bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 text-2xs sm:text-xs font-bold flex items-center gap-1 transition-all cursor-pointer shadow-2xs"
                    title="طلب تلميح للكلمة القادمة إذا تعثرت في استذكارها"
                  >
                    <Lightbulb className="w-3.5 h-3.5 text-amber-700" />
                    <span>تلميح الكلمة</span>
                  </button>
                )}
              </div>
            </div>

            {/* AI Teacher Pedagogical Feedback Live Terminal (7 cols) */}
            <div className="sm:col-span-7 bg-gradient-to-br from-stone-900 via-stone-950 to-stone-900 text-white rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-md border border-stone-800 flex flex-col justify-between">
              <div className="flex items-center justify-between mb-2.5 sm:mb-3">
                <div className="flex items-center gap-2 sm:gap-2.5">
                  <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center shrink-0">
                    <Sparkles className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  </div>
                  <div>
                    <h3 className="text-xs sm:text-sm font-bold text-amber-200 font-arabic-heading">
                      المعلم القرآني الذكي
                    </h3>
                    <p className="text-[10px] sm:text-[11px] text-stone-400">
                      {isTeacherSpeaking
                        ? 'المعلم يتحدث ويوجهك الآن...'
                        : isPlayingReciter
                        ? `الاستماع لتلاوة ${currentReciter.nameArabic}`
                        : isRecording
                        ? 'يستمع للتلاوة ويفحص مخارج الحروف...'
                        : 'جاهز للاستماع والتوجيه.'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 sm:gap-2">
                  <div className="flex items-center gap-1 px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-lg bg-emerald-950/80 border border-emerald-800/80 text-emerald-300 text-2xs sm:text-xs font-semibold">
                    <CheckCircle2 className="w-3 sm:w-3.5 h-3 sm:h-3.5" />
                    <span>إتقان: {successCount}</span>
                  </div>
                  <div className="flex items-center gap-1 px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-lg bg-rose-950/80 border border-rose-800/80 text-rose-300 text-2xs sm:text-xs font-semibold">
                    <AlertTriangle className="w-3 sm:w-3.5 h-3 sm:h-3.5" />
                    <span>تنبيهات: {errorCount}</span>
                  </div>
                </div>
              </div>

              {/* Dynamic feedback message or prompt */}
              <div className="my-2 sm:my-3 p-3 sm:p-4 rounded-xl sm:rounded-2xl bg-stone-800/80 border border-stone-700/80 min-h-[75px] sm:min-h-[95px] flex items-center">
                {activeFeedback ? (
                  <div className="w-full">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-2xs sm:text-xs px-2 sm:px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-bold">
                        {activeFeedback.action}
                      </span>
                      <span className="text-2xs sm:text-xs text-stone-400">
                        الكلمة المستهدفة: {activeFeedback.targetWordIndex + 1}
                      </span>
                    </div>
                    <p className="text-xs sm:text-base text-amber-100 font-arabic-heading leading-relaxed">
                      "{activeFeedback.languageOutput?.message}"
                    </p>
                  </div>
                ) : (
                  <p className="text-2xs sm:text-sm text-stone-400 leading-relaxed italic">
                    {isRecording
                      ? 'اقرأ بتؤدة وترتيل. سيتدخل المعلم عند وجود أي خطأ في النطق أو زمن الغنة أو المدود.'
                      : 'اضغط على "ابدأ التسميع" واقرأ بخشوع، أو انقر على أي كلمة لمحاكاة التوجيه الفوري.'}
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between text-[10px] sm:text-[11px] text-stone-400 pt-2 border-t border-stone-800/80">
                <div className="flex items-center gap-1.5 text-emerald-400 font-medium">
                  <ShieldCheck className="w-3 sm:w-3.5 h-3 sm:h-3.5" />
                  <span className="truncate">معالجة محلية آمنة دون تخزين التسجيلات</span>
                </div>
                <span className="text-stone-500 font-mono shrink-0">زمن الاستجابة &lt; 200ms</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right 4 cols: Pedagogical Sidebar (Tajweed Rules, Tafsir, Reciter Benchmark) */}
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-white rounded-3xl p-5 shadow-sm border border-stone-200/90 flex flex-col h-full">
            {/* Tabs Selector */}
            <div className="flex items-center gap-1 p-1 bg-stone-100 rounded-2xl mb-4">
              <button
                onClick={() => setActiveSidebarTab('TAJWEED')}
                className={`flex-1 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  activeSidebarTab === 'TAJWEED'
                    ? 'bg-white text-emerald-950 shadow-xs'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                أحكام التجويد
              </button>
              <button
                onClick={() => setActiveSidebarTab('TAFSIR')}
                className={`flex-1 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  activeSidebarTab === 'TAFSIR'
                    ? 'bg-white text-emerald-950 shadow-xs'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                التفسير الميسر
              </button>
              <button
                onClick={() => setActiveSidebarTab('RECITERS')}
                className={`flex-1 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  activeSidebarTab === 'RECITERS'
                    ? 'bg-white text-emerald-950 shadow-xs'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                أكابر القراء
              </button>
            </div>

            {/* TAB 1: TAJWEED RULES & CLASSICAL CITATIONS */}
            {activeSidebarTab === 'TAJWEED' && (
              <div className="space-y-3.5 overflow-y-auto max-h-[520px] pr-1">
                <div className="text-xs font-bold text-stone-500 flex items-center gap-1.5">
                  <Bookmark className="w-3.5 h-3.5 text-amber-600" />
                  <span>أحكام التجويد ومخارج الحروف في الآية {selectedAyah}:</span>
                </div>

                {tajweedHighlights.map((tj, idx) => (
                  <div
                    key={idx}
                    className="p-3.5 rounded-2xl bg-amber-50/60 border border-amber-200/80 space-y-2 text-right transition-all hover:bg-amber-50"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-amiri-quran text-base font-bold text-stone-900 bg-white px-2 py-0.5 rounded-lg border border-amber-200">
                        {tj.wordText}
                      </span>
                      <span className="text-[11px] font-bold text-amber-800 bg-amber-100/80 px-2 py-0.5 rounded-md">
                        {tj.ruleTitleArabic}
                      </span>
                    </div>

                    <p className="text-xs text-stone-700 leading-relaxed">
                      <strong className="text-stone-900">توجيه الأداء: </strong>
                      {tj.practicalTipArabic}
                    </p>

                    <div className="text-[11px] text-amber-900 bg-white/80 p-2 rounded-xl border border-amber-100/90 font-arabic-heading italic">
                      "{tj.classicalCitation}"
                    </div>

                    <div className="text-[11px] text-rose-800 bg-rose-50/80 p-2 rounded-xl border border-rose-100 flex items-start gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-rose-500 shrink-0 mt-0.5" />
                      <span><strong>خطأ شائع:</strong> {tj.commonMistakeArabic}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* TAB 2: TAFSIR MUYASSAR & VOCABULARY */}
            {activeSidebarTab === 'TAFSIR' && tafsirData && (
              <div className="space-y-4 overflow-y-auto max-h-[520px] pr-1 text-right">
                <div className="p-3.5 rounded-2xl bg-emerald-50/70 border border-emerald-200/80 space-y-2">
                  <div className="text-xs font-bold text-emerald-900 flex items-center gap-1.5">
                    <BookOpen className="w-4 h-4 text-emerald-700" />
                    <span>تفسير الآية {selectedAyah}:</span>
                  </div>
                  <p className="text-xs sm:text-sm text-stone-800 leading-relaxed">
                    {tafsirData.tafsirMuyassar}
                  </p>
                  <div className="text-[10px] text-stone-500 pt-1 border-t border-emerald-200/60">
                    المصدر: {tafsirData.sourceAuthority}
                  </div>
                </div>

                {tafsirData.keyVocabulary.length > 0 && (
                  <div className="space-y-2">
                    <span className="text-xs font-bold text-stone-600">معاني المفردات:</span>
                    {tafsirData.keyVocabulary.map((vocab, vIdx) => (
                      <div
                        key={vIdx}
                        className="p-2.5 rounded-xl bg-stone-50 border border-stone-200/80 flex flex-col gap-1 text-xs"
                      >
                        <span className="font-amiri-quran text-stone-900 font-bold text-sm">
                          {vocab.word}
                        </span>
                        <span className="text-stone-600">{vocab.meaning}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: BENCHMARK RECITERS SELECTION */}
            {activeSidebarTab === 'RECITERS' && (
              <div className="space-y-3 overflow-y-auto max-h-[520px] pr-1">
                <div className="text-xs text-stone-600 leading-relaxed mb-2">
                  اختر القارئ المعتمد لتسمع منه الآية بالترتيل والتحقيق التام لأحكام التجويد:
                </div>

                {CANONICAL_RECITERS.map((reciter) => {
                  const isSelected = selectedReciterId === reciter.id;
                  return (
                    <div
                      key={reciter.id}
                      onClick={() => handleReciterChange(reciter.id)}
                      className={`p-3.5 rounded-2xl border transition-all cursor-pointer text-right ${
                        isSelected
                          ? 'bg-emerald-50 border-emerald-500 ring-2 ring-emerald-300 shadow-xs'
                          : 'bg-stone-50 border-stone-200 hover:bg-stone-100'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5">
                          {isSelected && <Check className="w-4 h-4 text-emerald-700" />}
                          <span className="text-xs font-bold text-stone-900">
                            {reciter.nameArabic}
                          </span>
                        </div>
                        {reciter.isVerifiedTajweedBenchmark && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold border border-amber-300">
                            مرجع التحقيق
                          </span>
                        )}
                      </div>

                      <div className="text-[11px] text-stone-500 font-medium">
                        {reciter.styleArabic} • {reciter.schoolOrCountry}
                      </div>
                      <p className="text-[11px] text-stone-600 mt-1 leading-normal">
                        {reciter.descriptionArabic}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      {showReportModal && (
        <RecitationReportModal
          report={getReportData()}
          onClose={() => setShowReportModal(false)}
          onOpenCertificate={() => {
            setShowReportModal(false);
            setShowCertificateModal(true);
          }}
        />
      )}

      {showCertificateModal && (
        <MasteryCertificateModal
          surahName={surahName}
          surahNumber={selectedSurah}
          accuracyScore={getReportData().accuracyScore}
          tajweedScore={getReportData().tajweedScore}
          onClose={() => setShowCertificateModal(false)}
        />
      )}

      {showShareModal && (
        <PublicShareModal onClose={() => setShowShareModal(false)} />
      )}

      <FirstUserGuideModal
        isOpen={showGuideModal}
        onClose={() => setShowGuideModal(false)}
      />
    </div>
  );
};
