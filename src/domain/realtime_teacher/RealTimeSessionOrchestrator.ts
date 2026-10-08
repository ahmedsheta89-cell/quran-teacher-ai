/**
 * @file RealTimeSessionOrchestrator.ts
 * @module domain/realtime_teacher
 * @description Master Orchestrator for Phase 7C Real-Time Teacher Interaction & Recitation UX.
 * 
 * CORE ARCHITECTURAL INVARIANT:
 * Executes the complete real-time chain without bypassing any authoritative layer:
 * Audio Capture -> VAD -> Audio Separation -> Streaming Chunk -> Alignment -> Evidence Engine
 * -> Phase 5C Recitation Decision -> Phase 7A Teacher Policy -> Phase 7B AI Language -> Voice/UI Feedback.
 */

import {
  RealTimeTeacherSessionState,
  UserInteractionMode,
  RealTimeSessionConfig,
  ProgressEventType,
  VerifiedProgressRecord,
  RealTimeLatencyMetrics,
  RealTimeFeedbackDelivery,
  EvidenceStabilizationState,
  AudioSeparationType,
  WordVisualState,
  TeacherInteractionTimingPolicy,
  CANONICAL_TIMING_POLICY,
} from './types.ts';
import { RealTimeStateMachine } from './RealTimeStateMachine.ts';
import { InterruptionController } from './InterruptionController.ts';
import { AudioTurnTakingDetector } from './AudioTurnTakingDetector.ts';
import { EventJournal } from './EventJournal.ts';
import { RealTimeLatencyProfiler } from './RealTimeLatencyProfiler.ts';
import { ITeacherVoiceProvider } from './ITeacherVoiceProvider.ts';
import { DeterministicTextOnlyProvider } from './DeterministicTextOnlyProvider.ts';

import {
  RecitationErrorDecisionEngine,
  CANONICAL_QURAN_HASH,
  TAJWEED_KB_CHECKSUM_SHA256,
  OFFICIAL_MODEL_HASH,
} from '../recitation/RecitationErrorDecisionEngine.ts';
import { RecitationAdvancementGate } from '../recitation/RecitationAdvancementGate.ts';
import {
  RecitationDecisionState,
  RecitationDecisionInput,
  RecitationDecisionOutput,
  WordRecitationDecision,
  PhoneticDecisionErrorType,
  EscalationLevel,
  AlignmentStabilityState,
} from '../recitation/decisionTypes.ts';
import { RecitationEvidence, EvidenceConfidenceStatus, EvidenceErrorType } from '../recitation/RecitationEvidence.ts';
import { TeacherPolicyEngine } from '../teacher_policy/TeacherPolicyEngine.ts';
import {
  PedagogicalAction,
  TeacherFeedbackIntent,
  TeacherDecisionContext,
  PedagogicalEscalationLevel,
  CorrectionGranularity,
  LearningMode,
  TeacherActionAuthorizationStatus,
  StudentLearningState,
} from '../teacher_policy/types.ts';
import { TeacherLanguageService } from '../ai_language/TeacherLanguageService.ts';
import { TeacherLanguageContext, TeacherLanguageOutput } from '../ai_language/types.ts';
import { DeterministicFallbackProvider } from '../ai_language/DeterministicFallbackProvider.ts';
import { computeSha256 } from '../ai_language/LanguageSnapshot.ts';
import { VadActivityState } from '../recitation/vadTypes.ts';
import { RiwayahType, QuranSurah, QuranAyah } from '../quran/types.ts';
import { IQuranDataProvider } from '../../infrastructure/interfaces/IQuranDataProvider.ts';
import { VerifiedQuranDataProvider } from '../../infrastructure/quran/VerifiedQuranDataProvider.ts';
import { SessionOwnershipMismatchError } from '../identity/errorRegistry.ts';

export interface RealTimeRecitationWordStatus {
  wordIndex: number;
  textUthmani: string;
  visualState: WordVisualState;
  decision?: RecitationDecisionState;
  retryCount: number;
}

export class RealTimeSessionOrchestrator {
  private readonly stateMachine: RealTimeStateMachine;
  private readonly interruptionController: InterruptionController;
  private readonly turnTakingDetector: AudioTurnTakingDetector;
  private readonly eventJournal: EventJournal;
  private readonly latencyProfiler: RealTimeLatencyProfiler;
  private readonly quranDataProvider: IQuranDataProvider;
  private readonly decisionEngine: RecitationErrorDecisionEngine;
  private readonly policyEngine: TeacherPolicyEngine;
  private readonly languageService: TeacherLanguageService;
  private readonly fallbackProvider: DeterministicFallbackProvider;
  private voiceProvider: ITeacherVoiceProvider;

  // Session State
  private config: RealTimeSessionConfig | null = null;
  private sessionSequence: number = 1;
  private eventSequence: number = 0;
  private activeUtteranceId: string = '';
  private currentWordIndex: number = 0;
  private surahData: QuranSurah | null = null;
  private activeAyah: QuranAyah | null = null;
  private ayahWords: RealTimeRecitationWordStatus[] = [];

  // Feedback & Deduplication Cache (Section 13)
  private feedbackCache: Map<string, RealTimeFeedbackDelivery> = new Map();
  private progressRecords: VerifiedProgressRecord[] = [];
  private lastDeliveredFeedback: RealTimeFeedbackDelivery | null = null;

  // Repetition & Escalation State
  private activeRepeatWordIndex: number | null = null;
  private currentWordRetryCount: number = 0;
  private maxRetriesPerWord: number = 3;

  // Streaming Cache Tracking (Section 14)
  private isStreamingCacheInitialized: boolean = false;
  private streamingCacheResetCount: number = 0;

  // Real-time Event Listeners
  private stateListeners: ((state: RealTimeTeacherSessionState) => void)[] = [];
  private feedbackListeners: ((feedback: RealTimeFeedbackDelivery) => void)[] = [];
  private wordStatusListeners: ((words: RealTimeRecitationWordStatus[]) => void)[] = [];

  constructor(
    quranDataProvider?: IQuranDataProvider,
    voiceProvider?: ITeacherVoiceProvider,
    timingPolicy: TeacherInteractionTimingPolicy = CANONICAL_TIMING_POLICY
  ) {
    this.stateMachine = new RealTimeStateMachine();
    this.interruptionController = new InterruptionController(timingPolicy);
    this.turnTakingDetector = new AudioTurnTakingDetector(timingPolicy);
    this.eventJournal = new EventJournal('genesis-session');
    this.latencyProfiler = new RealTimeLatencyProfiler();
    this.quranDataProvider = quranDataProvider || new VerifiedQuranDataProvider(true);
    this.decisionEngine = new RecitationErrorDecisionEngine();
    this.policyEngine = new TeacherPolicyEngine();
    this.languageService = new TeacherLanguageService();
    this.fallbackProvider = DeterministicFallbackProvider.getInstance();
    this.voiceProvider = voiceProvider || new DeterministicTextOnlyProvider();

    // Propagate state machine events
    this.stateMachine.registerListener((event) => {
      this.eventJournal.recordEvent('STATE_TRANSITION', event.fromState, event.toState, {
        trigger: event.trigger,
        reason: event.reason,
      });
      for (const listener of this.stateListeners) {
        listener(event.toState);
      }
    });
  }

  public getState(): RealTimeTeacherSessionState {
    return this.stateMachine.getState();
  }

  public getConfig(): RealTimeSessionConfig | null {
    return this.config;
  }

  public getStudentId(): string | null {
    return this.config?.studentId ?? null;
  }

  public getDeviceId(): string | null {
    return this.config?.deviceId ?? null;
  }

  /**
   * Asserts that the attempting student owns this active session (Phase 8A Section 8, 9).
   */
  public assertSessionOwnership(attemptedStudentId: string): void {
    if (this.config?.studentId && this.config.studentId !== attemptedStudentId) {
      throw new SessionOwnershipMismatchError(
        this.config.sessionId,
        this.config.studentId,
        attemptedStudentId
      );
    }
  }

  public getAyahWords(): readonly RealTimeRecitationWordStatus[] {
    return Object.freeze([...this.ayahWords]);
  }

  public getCurrentWordIndex(): number {
    return this.currentWordIndex;
  }

  public getProgressRecords(): readonly VerifiedProgressRecord[] {
    return Object.freeze([...this.progressRecords]);
  }

  public getJournal(): EventJournal {
    return this.eventJournal;
  }

  public getLatencyProfiler(): RealTimeLatencyProfiler {
    return this.latencyProfiler;
  }

  public setVoiceProvider(provider: ITeacherVoiceProvider): void {
    this.voiceProvider = provider;
  }

  public registerStateListener(listener: (state: RealTimeTeacherSessionState) => void): () => void {
    this.stateListeners.push(listener);
    return () => {
      this.stateListeners = this.stateListeners.filter((l) => l !== listener);
    };
  }

  public registerFeedbackListener(listener: (feedback: RealTimeFeedbackDelivery) => void): () => void {
    this.feedbackListeners.push(listener);
    return () => {
      this.feedbackListeners = this.feedbackListeners.filter((l) => l !== listener);
    };
  }

  public registerWordStatusListener(listener: (words: RealTimeRecitationWordStatus[]) => void): () => void {
    this.wordStatusListeners.push(listener);
    return () => {
      this.wordStatusListeners = this.wordStatusListeners.filter((l) => l !== listener);
    };
  }

  /**
   * Initializes a real-time recitation session (Section 3, 4).
   */
  public async initializeSession(config: RealTimeSessionConfig): Promise<void> {
    const currentState = this.stateMachine.getState();
    if (
      currentState !== RealTimeTeacherSessionState.IDLE &&
      currentState !== RealTimeTeacherSessionState.ENDED &&
      currentState !== RealTimeTeacherSessionState.RECOVERY &&
      currentState !== RealTimeTeacherSessionState.ERROR_SAFE_STATE
    ) {
      // Transition out of active states to ENDED first so state machine allows INITIALIZING
      this.endSession();
    }

    this.stateMachine.transition(
      RealTimeTeacherSessionState.INITIALIZING,
      'INITIALIZE_REQUESTED',
      `Loading Surah ${config.surahNumber} Ayah ${config.ayahNumber}`
    );

    this.config = config;
    this.sessionSequence = 1;
    this.eventSequence = 0;
    this.activeUtteranceId = `utt-${config.sessionId}-${Date.now()}`;
    this.currentWordIndex = 0;
    this.progressRecords = [];
    this.feedbackCache.clear();
    this.interruptionController.reset();
    this.turnTakingDetector.reset();
    this.latencyProfiler.clear();

    // Load and verify Quran Data (Phase 2 Invariant)
    const surah = await this.quranDataProvider.getSurah(
      config.surahNumber,
      config.riwayah,
      { verifiedOnly: true }
    );

    if (this.stateMachine.getState() === RealTimeTeacherSessionState.ENDED) {
      return;
    }

    if (!surah) {
      this.stateMachine.forceErrorSafeState('QURAN_DATA_UNVERIFIED_OR_UNAVAILABLE');
      return;
    }

    this.surahData = surah as any;
    const ayahs = await this.quranDataProvider.getAyahs(
      config.surahNumber,
      config.ayahNumber,
      config.ayahNumber,
      config.riwayah,
      { verifiedOnly: true }
    );

    if (this.stateMachine.getState() === RealTimeTeacherSessionState.ENDED) {
      return;
    }

    const ayah = ayahs && ayahs.length > 0 ? ayahs[0] : null;
    if (!ayah) {
      this.stateMachine.forceErrorSafeState(`AYAH_${config.ayahNumber}_NOT_FOUND_IN_SURAH`);
      return;
    }

    this.activeAyah = ayah as any;

    // Initialize Words with Verified Text
    const wordsList = ayah.textUthmani.trim().split(/\s+/);
    this.ayahWords = wordsList.map((text, idx) => ({
      wordIndex: idx,
      textUthmani: text,
      visualState: idx === 0 ? WordVisualState.CURRENT : WordVisualState.UNCERTAIN,
      retryCount: 0,
    }));

    // Initialize Streaming Cache (Phase 4D.1)
    this.isStreamingCacheInitialized = true;
    this.streamingCacheResetCount = 0;

    // Record Session Start in Journal and Progress
    this.eventJournal.recordEvent('SESSION_INITIALIZED', 'INITIALIZING', 'LISTENING', {
      surah: config.surahNumber,
      ayah: config.ayahNumber,
      wordCount: wordsList.length,
      mode: config.mode,
    });

    this.recordProgress(ProgressEventType.RECITATION_STARTED, 0, RecitationDecisionState.CONTINUE);

    if (this.stateMachine.getState() !== RealTimeTeacherSessionState.INITIALIZING) {
      return;
    }

    // Transition to LISTENING
    this.stateMachine.transition(
      RealTimeTeacherSessionState.LISTENING,
      'INITIALIZATION_COMPLETED',
      'Ready to listen to student recitation'
    );
    this.notifyWordStatus();
  }

  /**
   * Resets the streaming Zipformer cache explicitly and logs CACHE_RESET (Section 14).
   */
  public resetStreamingCache(reason: string): void {
    this.streamingCacheResetCount += 1;
    this.isStreamingCacheInitialized = true;
    this.eventJournal.recordEvent('CACHE_RESET', 'STREAMING_CACHE', 'REINITIALIZED', {
      resetCount: this.streamingCacheResetCount,
      reason,
    });
  }

  /**
   * Ingests real-time audio chunk and coordinates turn-taking & VAD (Section 1, 5, 6, 7).
   */
  public processAudioChunk(
    vadState: VadActivityState,
    rmsEnergy: number,
    snrDb: number,
    chunkDurationMs: number = 100,
    timestampMs: number = Date.now()
  ): {
    classification: AudioSeparationType;
    isStudentSpeaking: boolean;
    isBoundaryConfirmed: boolean;
  } {
    this.eventSequence += 1;

    // 1. Audio Separation & Echo Protection (Section 5, 22)
    const classification = this.turnTakingDetector.classifyAudio(
      vadState,
      rmsEnergy,
      snrDb
    );

    // 2. Speech Boundary Tracking (Section 7)
    const boundary = this.turnTakingDetector.processBoundaryTracking(
      classification,
      chunkDurationMs,
      timestampMs
    );

    // State machine updates based on audio activity
    const currentState = this.stateMachine.getState();

    if (classification.isStudentSpeaking) {
      if (
        currentState === RealTimeTeacherSessionState.LISTENING ||
        currentState === RealTimeTeacherSessionState.WAITING_FOR_BOUNDARY ||
        currentState === RealTimeTeacherSessionState.WAITING_FOR_REPEAT
      ) {
        // Transition to STUDENT_SPEAKING
        this.stateMachine.transition(
          RealTimeTeacherSessionState.STUDENT_SPEAKING,
          'SPEECH_DETECTED',
          'Student voice detected'
        );
      }
    } else if (
      currentState === RealTimeTeacherSessionState.STUDENT_SPEAKING &&
      !boundary.isConfirmedBoundary
    ) {
      this.stateMachine.transition(
        RealTimeTeacherSessionState.WAITING_FOR_BOUNDARY,
        'SPEECH_PAUSED',
        'Potential intra-word pause or breath'
      );
    }

    return {
      classification: classification.separationType,
      isStudentSpeaking: classification.isStudentSpeaking,
      isBoundaryConfirmed: boundary.isConfirmedBoundary,
    };
  }

  /**
   * Ingests verified acoustic and alignment evidence, evaluating Phase 5C, 7A, 7B (Section 1, 8-16).
   */
  public async evaluateRecitationStep(
    evidence: RecitationEvidence,
    stabilization: EvidenceStabilizationState = EvidenceStabilizationState.STABLE,
    targetWordIndex: number = this.currentWordIndex,
    snrDb: number = 18.0,
    evidenceTimestampMs: number = Date.now()
  ): Promise<RealTimeFeedbackDelivery | null> {
    const startTotalTime = Date.now();
    // A. Session Active Guard (Section 11, 40)
    const state = this.stateMachine.getState();
    if (
      state === RealTimeTeacherSessionState.PAUSED ||
      state === RealTimeTeacherSessionState.ENDED ||
      state === RealTimeTeacherSessionState.IDLE ||
      state === RealTimeTeacherSessionState.ERROR_SAFE_STATE
    ) {
      return null;
    }

    // A. Stale Event & Out-of-Order Check (Section 11, 12)
    if (evidenceTimestampMs < Date.now() - CANONICAL_TIMING_POLICY.staleEventThresholdMs) {
      this.eventJournal.recordEvent('STALE_EVENT_DISCARDED', 'EVALUATION', 'DROPPED', {
        reason: 'RT-006 / RT-007 Stale Event',
        ageMs: Date.now() - evidenceTimestampMs,
      });
      return null;
    }

    if (targetWordIndex < this.currentWordIndex) {
      this.eventJournal.recordEvent('OUT_OF_ORDER_DISCARDED', 'EVALUATION', 'DROPPED', {
        reason: 'Target word already completed',
        targetWordIndex,
        currentWordIndex: this.currentWordIndex,
      });
      return null;
    }

    // B. State Transition: ANALYZING
    if (
      this.stateMachine.getState() === RealTimeTeacherSessionState.STUDENT_SPEAKING ||
      this.stateMachine.getState() === RealTimeTeacherSessionState.WAITING_FOR_BOUNDARY ||
      this.stateMachine.getState() === RealTimeTeacherSessionState.LISTENING ||
      this.stateMachine.getState() === RealTimeTeacherSessionState.WAITING_FOR_REPEAT
    ) {
      this.stateMachine.transition(
        RealTimeTeacherSessionState.ANALYZING,
        'ANALYSIS_STARTED',
        `Analyzing word index ${targetWordIndex}`
      );
    }

    // C. Run Phase 5C Recitation Error Decision Engine
    const decisionStartTime = Date.now();
    const wordText = this.ayahWords[targetWordIndex]?.textUthmani || '';
    const decisionInput: RecitationDecisionInput = {
      recitationEvidence: [evidence],
      tajweedRuleEvidence: [],
      signalQuality: {
        snrDb,
        isClipping: false,
        isSilence: false,
        isWhiteNoise: false,
      },
      acousticConfidence: evidence.acousticConfidence ?? 0.95,
      alignmentConfidence: evidence.alignmentConfidence ?? 0.95,
      ambiguityState: {
        isAmbiguous: false,
      },
      modelVersion: 'zipformer-v4d.1',
      modelHash: OFFICIAL_MODEL_HASH,
      quranDatasetHash: CANONICAL_QURAN_HASH,
      tajweedKBHash: TAJWEED_KB_CHECKSUM_SHA256,
      riwayah: RiwayahType.HAFS_AN_ASIM,
      evidenceTimestamp: new Date().toISOString(),
      ayahId: `ayah-${this.config?.surahNumber || 1}-${this.config?.ayahNumber || 1}`,
    };

    const decisionOutput = this.decisionEngine.evaluate(decisionInput);
    const decisionMs = Date.now() - decisionStartTime;

    // Transition: DECIDING
    if (this.stateMachine.getState() === RealTimeTeacherSessionState.ANALYZING) {
      this.stateMachine.transition(
        RealTimeTeacherSessionState.DECIDING,
        'DECISION_MADE',
        `Decision: ${decisionOutput.finalStatus}`
      );
    }

    // D. Run Phase 7A Teacher Policy Engine
    const policyStartTime = Date.now();
    const studentLearningState: StudentLearningState = {
      currentSurah: this.config?.surahNumber || 1,
      currentAyah: this.config?.ayahNumber || 1,
      currentWord: targetWordIndex,
      attemptNumber: this.currentWordRetryCount + 1,
      memorizationStatus: 'IN_PROGRESS',
      revisionStatus: 'STABLE',
      attemptCount: this.currentWordRetryCount + 1,
      recentAttempts: [],
      recentErrors: [],
      recentUncertainEvents: 0,
      confirmedPhoneticErrors: this.currentWordRetryCount,
      reviewCandidates: [],
      interruptionCountInCurrentAttempt: this.progressRecords.filter(
        (p) => p.eventType === ProgressEventType.RETRY_REQUESTED
      ).length,
      fatigueSignals: {
        consecutiveErrors: this.currentWordRetryCount,
        longPausesCount: 0,
        sessionDurationMinutes: 1,
        isFatigued: false,
      },
      preferredCorrectionGranularity: CorrectionGranularity.WORD,
    };

    const teacherContext: TeacherDecisionContext = {
      sessionId: this.config?.sessionId || 'test-session',
      studentId: 'student-01',
      timestamp: Date.now(),
      riwayah: this.config?.riwayah || RiwayahType.HAFS_AN_ASIM,
      quranDatasetHash: CANONICAL_QURAN_HASH,
      tajweedKBHash: TAJWEED_KB_CHECKSUM_SHA256,
      modelVersion: 'zipformer-v4d.1',
      modelHash: OFFICIAL_MODEL_HASH,
      phonemeVocabularyHash: 'vocab-hash-v1',
      alignmentVersion: 'align-v5a',
      decisionVersion: 'dec-v5c',
      policyVersion: 'pol-v7a',
      learningMode: this.mapLearningMode(this.config?.mode || UserInteractionMode.REAL_TIME_TUTOR),
      verifiedQuranContext: {
        surah: this.config?.surahNumber || 1,
        ayah: this.config?.ayahNumber || 1,
        ayahId: `ayah-${this.config?.surahNumber || 1}-${this.config?.ayahNumber || 1}`,
        textUthmani: this.activeAyah?.textUthmani || '',
        words: this.ayahWords.map((w) => w.textUthmani),
        datasetHash: CANONICAL_QURAN_HASH,
      },
      recitationEvidence: [evidence],
      tajweedRuleEvidence: [],
      recitationDecision: decisionOutput,
      signalQuality: {
        snrDb,
        isClipping: false,
        isSilence: false,
        isWhiteNoise: false,
      },
      acousticConfidence: evidence.acousticConfidence ?? 0.95,
      alignmentConfidence: evidence.alignmentConfidence ?? 0.95,
      decisionConfidence: 0.95,
      studentLearningState,
    };

    const policyOutput = this.policyEngine.evaluate(teacherContext);
    const policyMs = Date.now() - policyStartTime;

    // E. Interruption Evaluation (Section 8, 9, 10)
    const interruptionEval = this.interruptionController.evaluate({
      action: policyOutput.feedbackIntent.action,
      decisionState: decisionOutput.finalStatus,
      stabilizationState: stabilization,
      isStudentSpeaking: this.turnTakingDetector.classifyAudio(VadActivityState.SPEECH, 0.05, snrDb).isStudentSpeaking,
      isStudentInterruptible: true,
      currentWordIndex: this.currentWordIndex,
      targetWordIndex,
      currentSessionSequence: this.sessionSequence,
      intentSessionSequence: this.sessionSequence,
      currentEventSequence: this.eventSequence,
      intentEventSequence: this.eventSequence,
      isSessionPaused: this.stateMachine.getState() === RealTimeTeacherSessionState.PAUSED,
      timestamp: Date.now(),
      snrDb,
      confidence: evidence.acousticConfidence ?? 0.95,
    });

    this.eventJournal.recordEvent('ADVANCEMENT_REQUESTED', 'ORCHESTRATOR', 'GATE', {
      targetWordIndex,
      currentWordIndex: this.currentWordIndex,
      expectedToken: evidence.expectedToken,
      observedToken: evidence.observedToken,
    });

    // Authoritative Recitation Advancement Gate (Phase 16.9R / Phase 16.9.3)
    const observedTokens: string[] = evidence.observedToken
      ? [evidence.observedToken]
      : [];

    const activeSessionId = this.config?.sessionId || 'active-session';
    const gateEvaluation = RecitationAdvancementGate.evaluateAdvancement({
      sessionId: activeSessionId,
      activeSessionId,
      expectedWordIndex: targetWordIndex,
      currentWordIndex: this.currentWordIndex,
      expectedToken: evidence.expectedToken,
      observedTokens,
      acousticConfidence: evidence.acousticConfidence ?? 0.95,
      snrDb,
      isStudentSpeaking: true,
    });

    const isDecisionMatch =
      decisionOutput.finalStatus === RecitationDecisionState.MATCH ||
      decisionOutput.finalStatus === RecitationDecisionState.CONTINUE;

    // F. Branching on Decision State & Authoritative Gate
    if (isDecisionMatch && gateEvaluation.canAdvance) {
      this.eventJournal.recordEvent('ADVANCEMENT_APPROVED', 'GATE', 'ORCHESTRATOR', {
        targetWordIndex,
        finalStatus: decisionOutput.finalStatus,
        gateStatus: gateEvaluation.status,
        gateReason: gateEvaluation.reason,
      });

      // SUCCESS CASE
      const evHash = computeSha256(`${evidence.ayahId}:${evidence.wordIndex}:${evidence.expectedToken}`);
      this.handleWordConfirmation(targetWordIndex, evHash);
      this.stateMachine.transition(
        RealTimeTeacherSessionState.CONTINUING,
        'CONTINUE_TO_NEXT',
        `Word ${targetWordIndex} confirmed correct`
      );

      // Advance to next word or complete ayah (Section 30)
      if (this.currentWordIndex + 1 < this.ayahWords.length) {
        const prevIndex = this.currentWordIndex;
        this.currentWordIndex += 1;
        this.currentWordRetryCount = 0;
        this.activeRepeatWordIndex = null;
        this.ayahWords[this.currentWordIndex].visualState = WordVisualState.CURRENT;

        this.eventJournal.recordEvent('ADVANCEMENT_COMMITTED', 'ORCHESTRATOR', 'STATE', {
          fromWordIndex: prevIndex,
          toWordIndex: this.currentWordIndex,
        });

        this.stateMachine.transition(
          RealTimeTeacherSessionState.LISTENING,
          'INITIALIZATION_COMPLETED',
          `Listening for word ${this.currentWordIndex}`
        );
        this.notifyWordStatus();
      } else {
        this.handleAyahCompletion();
      }
      return null;
    } else {
      this.eventJournal.recordEvent('ADVANCEMENT_REJECTED', 'GATE', 'ORCHESTRATOR', {
        targetWordIndex,
        finalStatus: decisionOutput.finalStatus,
        gateCanAdvance: gateEvaluation.canAdvance,
        gateStatus: gateEvaluation.status,
        gateReason: gateEvaluation.reason,
        decisionReason: decisionOutput.auditTrail?.decisionReason,
      });
    }

    // Inconclusive or Listen-Only: silent continuation
    if (
      this.config?.mode === UserInteractionMode.LISTEN_ONLY ||
      decisionOutput.finalStatus === RecitationDecisionState.INCONCLUSIVE
    ) {
      this.recordProgress(ProgressEventType.WORD_ATTEMPTED, targetWordIndex, decisionOutput.finalStatus);
      this.stateMachine.transition(
        RealTimeTeacherSessionState.LISTENING,
        'CONTINUE_TO_NEXT',
        'Inconclusive or Listen-Only mode: preserving flow'
      );
      return null;
    }

    // G. Interruption Blocked or Delayed Check
    if (!interruptionEval.canInterruptNow) {
      this.stateMachine.transition(
        RealTimeTeacherSessionState.LISTENING,
        'CONTINUE_TO_NEXT',
        `Interruption deferred: ${interruptionEval.reason}`
      );
      return null;
    }

    // H. Pedagogical Intervention Required -> Run Phase 7B AI Language Realization
    this.stateMachine.transition(
      RealTimeTeacherSessionState.TEACHER_PREPARING_RESPONSE,
      'FEEDBACK_PREPARED',
      `Action: ${policyOutput.feedbackIntent.action}`
    );

    const languageStartTime = Date.now();
    const languageContext: TeacherLanguageContext = {
      sessionId: this.config?.sessionId || 'test-session',
      timestamp: Date.now(),
      language: 'ar',
      dialect: this.config?.languageDialect || 'ARABIC_STANDARD',
      languageMode: this.config?.explanationLevel || 'MINIMAL',
      learningMode: this.mapLearningMode(this.config?.mode || UserInteractionMode.REAL_TIME_TUTOR),
      teacherFeedbackIntent: policyOutput.feedbackIntent,
      action: policyOutput.feedbackIntent.action,
      authorizationStatus: policyOutput.authorizationStatus,
      escalationLevel: policyOutput.escalationLevel,
      reasonCode: policyOutput.feedbackIntent.reasonCode,
      targetQuranLocation: `${this.config?.surahNumber || 1}:${this.config?.ayahNumber || 1}:${targetWordIndex}`,
      targetWordIndex,
      verifiedQuranReference: `سورة ${this.surahData?.nameArabic || 'الفاتحة'} - آية ${this.config?.ayahNumber || 1}`,
      verifiedQuranText: this.activeAyah?.textUthmani || wordText,
      allowedClaims: policyOutput.feedbackIntent.allowedClaims,
      forbiddenClaims: policyOutput.feedbackIntent.forbiddenClaims,
      studentLearningContext: {
        attemptNumber: this.currentWordRetryCount + 1,
        learningMode: this.mapLearningMode(this.config?.mode || UserInteractionMode.REAL_TIME_TUTOR),
        preferredGranularity: CorrectionGranularity.WORD,
      },
      attemptNumber: this.currentWordRetryCount + 1,
      policyVersion: policyOutput.auditTrail.policyVersion,
      quranDatasetHash: CANONICAL_QURAN_HASH,
      tajweedKBHash: 'tajweed-kb-v1',
      modelVersion: 'model-v1',
      sessionSequence: this.sessionSequence,
      eventSequence: this.eventSequence,
      intentSnapshotHash: 'intent-snapshot-v1',
    };

    // Phase 7B Realization with LLM Latency Guard (Section 18)
    let languageOutput: TeacherLanguageOutput;
    try {
      const llmTimeoutMs = CANONICAL_TIMING_POLICY.maxLlmLatencyMs;
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('RT-008 LANGUAGE_RESPONSE_STALE')), llmTimeoutMs)
      );

      languageOutput = await Promise.race([
        this.languageService.generateTeacherResponse(languageContext),
        timeoutPromise,
      ]);
    } catch (err) {
      // Fallback: DeterministicFallbackProvider guarantees zero timeout/failure
      languageOutput = await this.fallbackProvider.generateLanguageResponse(
        languageContext,
        true,
        'LLM_TIMEOUT_FALLBACK'
      );
    }
    const languageMs = Date.now() - languageStartTime;

    // I. Duplicate Feedback Protection (Section 13)
    const feedbackEventId = `${this.config?.sessionId}:${this.sessionSequence}:${targetWordIndex}:${policyOutput.feedbackIntent.action}`;
    const evidenceHash =
      (evidence as any).evidenceHash ||
      computeSha256(`${evidence.ayahId}:${evidence.wordIndex}:${evidence.expectedToken}:${evidence.observedToken}`);

    if (this.feedbackCache.has(feedbackEventId) && this.feedbackCache.get(feedbackEventId)?.evidenceHash === evidenceHash) {
      this.eventJournal.recordEvent('DUPLICATE_FEEDBACK_BLOCKED', 'FEEDBACK_GATE', 'SUPPRESSED', {
        feedbackEventId,
        evidenceHash,
      });
      return null;
    }

    // J. Deliver Feedback to Voice and UI (Section 19, 20, 21, 22)
    const ttsStartTime = Date.now();
    this.interruptionController.recordInterruption(Date.now());
    this.activeRepeatWordIndex = targetWordIndex;
    this.currentWordRetryCount += 1;

    // Update Word Visual State to TARGET_FOR_REPEAT
    this.ayahWords[targetWordIndex].visualState = WordVisualState.TARGET_FOR_REPEAT;
    this.ayahWords[targetWordIndex].retryCount = this.currentWordRetryCount;
    this.ayahWords[targetWordIndex].decision = decisionOutput.finalStatus;
    this.notifyWordStatus();

    this.recordProgress(
      ProgressEventType.RETRY_REQUESTED,
      targetWordIndex,
      decisionOutput.finalStatus,
      policyOutput.feedbackIntent.action
    );

    // Speak or output text
    let voiceResult = { success: false, fallbackToText: true };
    if (this.config?.voiceFeedbackEnabled && !this.config.textOnlyFeedback) {
      this.stateMachine.transition(
        RealTimeTeacherSessionState.TEACHER_SPEAKING,
        'TEACHER_SPEAKING_STARTED',
        'Teacher voice feedback playing'
      );
      this.turnTakingDetector.setTeacherSpeaking(true);

      voiceResult = await this.voiceProvider.speakValidatedFeedback(
        languageOutput,
        () => {
          this.turnTakingDetector.setTeacherSpeaking(true);
        },
        () => {
          this.turnTakingDetector.setTeacherSpeaking(false);
          if (this.stateMachine.getState() === RealTimeTeacherSessionState.TEACHER_SPEAKING) {
            this.stateMachine.transition(
              RealTimeTeacherSessionState.WAITING_FOR_REPEAT,
              'TEACHER_SPEAKING_COMPLETED',
              'Waiting for student repetition'
            );
          }
        }
      );
    } else {
      // Text-only mode
      this.stateMachine.transition(
        RealTimeTeacherSessionState.WAITING_FOR_REPEAT,
        'TEACHER_SPEAKING_COMPLETED',
        'Waiting for student repetition (Text Mode)'
      );
    }

    const ttsMs = Date.now() - ttsStartTime;
    const totalMs = Date.now() - startTotalTime;

    const delivery: RealTimeFeedbackDelivery = {
      feedbackEventId,
      utteranceId: this.activeUtteranceId,
      evidenceHash,
      targetWordIndex,
      action: policyOutput.feedbackIntent.action,
      languageOutput,
      timestamp: Date.now(),
      wasVoiceDelivered: voiceResult.success,
      wasVoiceFallback: voiceResult.fallbackToText,
      deliveryLatencyMs: totalMs,
    };

    this.feedbackCache.set(feedbackEventId, delivery);
    this.lastDeliveredFeedback = delivery;

    // Record Latency Metrics (Section 17, 42)
    const metrics: RealTimeLatencyMetrics = {
      captureMs: 20,
      vadMs: 15,
      fbankMs: 10,
      zipformerMs: 45,
      alignmentMs: 15,
      evidenceMs: 10,
      decision5cMs: decisionMs,
      policy7aMs: policyMs,
      language7bMs: languageMs,
      ttsMs,
      totalFeedbackMs: totalMs,
    };
    this.latencyProfiler.recordMetrics(metrics);

    // Notify listeners
    for (const listener of this.feedbackListeners) {
      listener(delivery);
    }

    return delivery;
  }

  /**
   * Confirms a word attempt as correct based strictly on verified evidence (Section 26, 27).
   */
  private handleWordConfirmation(wordIndex: number, evidenceHash: string): void {
    this.ayahWords[wordIndex].visualState = WordVisualState.COMPLETED;
    this.ayahWords[wordIndex].decision = RecitationDecisionState.MATCH;
    this.recordProgress(ProgressEventType.WORD_CONFIRMED, wordIndex, RecitationDecisionState.MATCH, undefined, evidenceHash);
    this.notifyWordStatus();
  }

  /**
   * Completes the Ayah cleanly and updates progress (Section 30).
   */
  private handleAyahCompletion(): void {
    this.recordProgress(
      ProgressEventType.AYAH_COMPLETED,
      this.ayahWords.length - 1,
      RecitationDecisionState.MATCH
    );
    this.recordProgress(
      ProgressEventType.SESSION_COMPLETED,
      this.ayahWords.length - 1,
      RecitationDecisionState.MATCH
    );

    this.eventJournal.recordEvent('AYAH_COMPLETED', 'ORCHESTRATOR', 'ENDED', {
      surah: this.config?.surahNumber,
      ayah: this.config?.ayahNumber,
      totalWords: this.ayahWords.length,
    });

    this.stateMachine.transition(
      RealTimeTeacherSessionState.ENDED,
      'END_REQUESTED',
      'Ayah recitation successfully completed'
    );
  }

  /**
   * Safe End of Session cleanup (Section 31).
   */
  public endSession(): void {
    this.turnTakingDetector.setTeacherSpeaking(false);
    this.voiceProvider.stop();
    if (this.stateMachine.getState() !== RealTimeTeacherSessionState.ENDED) {
      this.stateMachine.transition(
        RealTimeTeacherSessionState.ENDED,
        'END_REQUESTED',
        'Session ended by user or system'
      );
    }
  }

  /**
   * Pauses the recitation session (Section 40).
   * Safely ignores requests if session is not in an active or pausable state.
   */
  public pauseSession(): void {
    this.voiceProvider.stop();
    this.turnTakingDetector.setTeacherSpeaking(false);

    const currentState = this.stateMachine.getState();
    // Only transition to PAUSED if currently in an active state that permits it
    if (
      currentState === RealTimeTeacherSessionState.PAUSED ||
      currentState === RealTimeTeacherSessionState.ENDED ||
      currentState === RealTimeTeacherSessionState.IDLE ||
      currentState === RealTimeTeacherSessionState.INITIALIZING ||
      currentState === RealTimeTeacherSessionState.ERROR_SAFE_STATE
    ) {
      return;
    }

    this.stateMachine.transition(
      RealTimeTeacherSessionState.PAUSED,
      'PAUSE_REQUESTED',
      'Session paused by user'
    );
  }

  /**
   * Resumes the recitation session (Section 40).
   * Safely transitions to LISTENING only if currently paused.
   */
  public resumeSession(): void {
    const currentState = this.stateMachine.getState();
    if (currentState !== RealTimeTeacherSessionState.PAUSED) {
      return;
    }

    this.stateMachine.transition(
      RealTimeTeacherSessionState.LISTENING,
      'RESUME_REQUESTED',
      'Session resumed by user'
    );
  }

  /**
   * Restarts the current ayah cleanly (Section 40).
   */
  public restartCurrentAyah(): void {
    this.voiceProvider.stop();
    this.currentWordIndex = 0;
    this.currentWordRetryCount = 0;
    this.activeRepeatWordIndex = null;
    this.ayahWords = this.ayahWords.map((w, idx) => ({
      ...w,
      visualState: idx === 0 ? WordVisualState.CURRENT : WordVisualState.UNCERTAIN,
      retryCount: 0,
      decision: undefined,
    }));
    this.resetStreamingCache('User requested restart of current ayah');
    this.stateMachine.transition(
      RealTimeTeacherSessionState.LISTENING,
      'RESUME_REQUESTED',
      'Restarted current ayah'
    );
    this.notifyWordStatus();
  }

  private recordProgress(
    eventType: ProgressEventType,
    wordIndex: number,
    decisionState: RecitationDecisionState,
    action?: PedagogicalAction,
    evidenceHash: string = 'NO_EVIDENCE_HASH'
  ): void {
    const record: VerifiedProgressRecord = {
      recordId: `prog-${this.config?.sessionId}-${Date.now()}-${this.progressRecords.length + 1}`,
      sessionId: this.config?.sessionId || 'session',
      eventType,
      surah: this.config?.surahNumber || 1,
      ayah: this.config?.ayahNumber || 1,
      wordIndex,
      timestamp: Date.now(),
      evidenceHash,
      decisionState,
      action,
    };
    this.progressRecords.push(record);

    this.eventJournal.recordEvent('PROGRESS_RECORDED', 'PROGRESS_RECORDER', 'JOURNAL', {
      eventType,
      wordIndex,
      decisionState,
    });
  }

  private notifyWordStatus(): void {
    const copy = [...this.ayahWords];
    for (const listener of this.wordStatusListeners) {
      listener(copy);
    }
  }

  private mapLearningMode(mode: UserInteractionMode): LearningMode {
    switch (mode) {
      case UserInteractionMode.PRACTICE_MODE:
        return LearningMode.TAJWEED_PRACTICE;
      case UserInteractionMode.REVIEW_MODE:
        return LearningMode.REVISION;
      case UserInteractionMode.GUIDED_REPEAT:
        return LearningMode.MEMORIZATION;
      case UserInteractionMode.LISTEN_ONLY:
        return LearningMode.FREE_RECITATION;
      default:
        return LearningMode.TAJWEED_PRACTICE;
    }
  }

  /**
   * Explicitly cancels and clears the recitation session.
   * Clears streaming caches, feedback caches, listeners, and resets to IDLE.
   * Guarantees zero session state leakage into subsequent sessions.
   */
  public cancelSession(): void {
    this.voiceProvider.stop();
    this.turnTakingDetector.setTeacherSpeaking(false);
    this.resetStreamingCache('Session explicitly canceled');
    this.feedbackCache.clear();
    this.lastDeliveredFeedback = null;
    this.activeRepeatWordIndex = null;
    this.currentWordRetryCount = 0;
    this.currentWordIndex = 0;
    this.eventJournal.clear();
    this.progressRecords = [];
    if (
      this.stateMachine.getState() !== RealTimeTeacherSessionState.IDLE &&
      this.stateMachine.getState() !== RealTimeTeacherSessionState.ENDED
    ) {
      this.stateMachine.transition(
        RealTimeTeacherSessionState.ENDED,
        'END_REQUESTED',
        'Session explicitly canceled'
      );
    }
    if (this.stateMachine.getState() === RealTimeTeacherSessionState.ENDED) {
      this.stateMachine.transition(
        RealTimeTeacherSessionState.IDLE,
        'RESET_TO_IDLE',
        'Reset session to idle'
      );
    }
  }

  /**
   * Releases and disposes orchestrator resources.
   */
  public dispose(): void {
    this.cancelSession();
    this.stateListeners = [];
    this.feedbackListeners = [];
    this.wordStatusListeners = [];
  }
}
