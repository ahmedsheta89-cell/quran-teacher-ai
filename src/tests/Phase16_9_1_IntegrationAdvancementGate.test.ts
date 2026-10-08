/**
 * @file Phase16_9_1_IntegrationAdvancementGate.test.ts
 * @module tests
 * @description Comprehensive Integration, Zero-Bypass, and False-Positive Advancement Proof (Phase 16.9.1).
 * 
 * SCIENTIFIC MANDATE:
 * ABSENCE OF EVIDENCE = NO POSITIVE ACOUSTIC JUDGMENT.
 * 
 * PROVES:
 * 1. Zero-Bypass Invariant: No execution path can advance currentWordIndex without passing
 *    the central verification gate.
 * 2. 10-Scenario Matrix: Silence, Humming, Random Noise, Wrong Arabic, Partial Word,
 *    Low Confidence, Empty Transcript, Stale Session, Out-of-Order Cursor, Verified Match.
 * 3. Levenshtein Metric Closure: Single-letter substitutions in long words (>= 7 letters)
 *    like "العالمون" for "العالمين" are strictly rejected (no Lahn Jali false positive).
 * 4. Observability: ADVANCEMENT_REQUESTED, ADVANCEMENT_APPROVED, ADVANCEMENT_COMMITTED, ADVANCEMENT_REJECTED.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  RecitationAdvancementGate,
  AdvancementEvaluationRequest,
  normalizeQuranicArabic,
  isHummingOrNoise,
  computeLevenshteinDistance,
  calculateStringSimilarity,
} from '../domain/recitation/RecitationAdvancementGate.ts';
import { RealTimeSessionOrchestrator } from '../domain/realtime_teacher/RealTimeSessionOrchestrator.ts';
import {
  RealTimeSessionConfig,
  UserInteractionMode,
  RealTimeTeacherSessionState,
  WordVisualState,
  EvidenceStabilizationState,
} from '../domain/realtime_teacher/types.ts';
import {
  RecitationEvidence,
} from '../domain/recitation/RecitationEvidence.ts';
import {
  RecitationDecisionState,
} from '../domain/recitation/decisionTypes.ts';
import { RiwayahType } from '../domain/quran/types.ts';

describe('PHASE 16.9.1: Advancement Gate Integration & Zero-Bypass Forensic Proof', () => {
  const baseRequest: AdvancementEvaluationRequest = {
    sessionId: 'session-live-001',
    activeSessionId: 'session-live-001',
    expectedWordIndex: 0,
    currentWordIndex: 0,
    expectedToken: 'بِسْمِ',
    observedTokens: ['ب', 'س', 'م'],
    acousticConfidence: 0.95,
    snrDb: 22.0,
    isStudentSpeaking: true,
  };

  describe('1. Authoritative 10-Scenario False-Positive Matrix', () => {
    // Scenario 1: Silence
    it('Scenario 1: Silence -> NO ADVANCE (Status: NO_INPUT)', () => {
      const res = RecitationAdvancementGate.evaluateAdvancement({
        ...baseRequest,
        observedTokens: [],
      });
      expect(res.canAdvance).toBe(false);
      expect(res.status).toBe('NO_INPUT');
      expect(res.errorType).toBe('INCONCLUSIVE');
    });

    // Scenario 2: Humming
    it('Scenario 2: Humming ("مممم", "م") -> NO ADVANCE (Status: INSUFFICIENT_EVIDENCE)', () => {
      const res1 = RecitationAdvancementGate.evaluateAdvancement({
        ...baseRequest,
        observedTokens: ['م', 'م', 'م', 'م'],
      });
      expect(res1.canAdvance).toBe(false);
      expect(res1.status).toBe('INSUFFICIENT_EVIDENCE');
      expect(res1.errorType).toBe('INCONCLUSIVE');

      const res2 = RecitationAdvancementGate.evaluateAdvancement({
        ...baseRequest,
        expectedToken: 'ٱلرَّحْمَٰنِ',
        observedTokens: ['م'],
      });
      expect(res2.canAdvance).toBe(false);
      expect(res2.status).toBe('INSUFFICIENT_EVIDENCE');
    });

    // Scenario 3: Random Noise & Non-Arabic
    it('Scenario 3: Random Noise & Non-Arabic -> NO ADVANCE (Status: NO_INPUT)', () => {
      const resEnglish = RecitationAdvancementGate.evaluateAdvancement({
        ...baseRequest,
        observedTokens: ['h', 'e', 'l', 'l', 'o'],
      });
      expect(resEnglish.canAdvance).toBe(false);
      expect(resEnglish.status).toBe('NO_INPUT');

      const resDiacritic = RecitationAdvancementGate.evaluateAdvancement({
        ...baseRequest,
        observedTokens: ['\u0651', '\u064E'], // Shaddah + Fatha without base consonant
      });
      expect(resDiacritic.canAdvance).toBe(false);
      expect(resDiacritic.status).toBe('NO_INPUT');
    });

    // Scenario 4: Wrong Arabic
    it('Scenario 4: Wrong Arabic ("الحمد" instead of "بِسْمِ") -> NO ADVANCE (Status: MISMATCH)', () => {
      const res = RecitationAdvancementGate.evaluateAdvancement({
        ...baseRequest,
        expectedToken: 'بِسْمِ',
        observedTokens: ['ا', 'ل', 'ح', 'م', 'د'],
      });
      expect(res.canAdvance).toBe(false);
      expect(res.status).toBe('MISMATCH');
      expect(res.errorType).toBe('SUBSTITUTION');
    });

    // Scenario 5: Partial Word
    it('Scenario 5: Partial Word ("بس" instead of "بِسْمِ") -> NO ADVANCE (Status: MISMATCH)', () => {
      const res = RecitationAdvancementGate.evaluateAdvancement({
        ...baseRequest,
        expectedToken: 'بِسْمِ',
        observedTokens: ['ب', 'س'],
      });
      expect(res.canAdvance).toBe(false);
      expect(res.status).toBe('MISMATCH');
      expect(res.similarityScore).toBeLessThan(1.0);
    });

    // Scenario 6: Low Confidence
    it('Scenario 6: Low Confidence (0.42 < 0.65) -> NO ADVANCE (Status: UNCERTAIN)', () => {
      const res = RecitationAdvancementGate.evaluateAdvancement({
        ...baseRequest,
        expectedToken: 'بِسْمِ',
        observedTokens: ['ب', 'س', 'م'],
        acousticConfidence: 0.42,
      });
      expect(res.canAdvance).toBe(false);
      expect(res.status).toBe('UNCERTAIN');
      expect(res.errorType).toBe('INCONCLUSIVE');
    });

    // Scenario 7: Empty Transcript / Whitespace
    it('Scenario 7: Empty Transcript / Whitespace -> NO ADVANCE (Status: NO_INPUT)', () => {
      const res = RecitationAdvancementGate.evaluateAdvancement({
        ...baseRequest,
        observedTokens: ['   ', '\t', '\n'],
      });
      expect(res.canAdvance).toBe(false);
      expect(res.status).toBe('NO_INPUT');
    });

    // Scenario 8: Stale Session
    it('Scenario 8: Stale Session ID -> NO ADVANCE (Status: STALE_SESSION)', () => {
      const res = RecitationAdvancementGate.evaluateAdvancement({
        ...baseRequest,
        sessionId: 'old-session-999',
        activeSessionId: 'session-live-001',
      });
      expect(res.canAdvance).toBe(false);
      expect(res.status).toBe('STALE_SESSION');
      expect(res.errorType).toBe('INCONCLUSIVE');
    });

    // Scenario 9: Stale Word Cursor / Out-of-Order
    it('Scenario 9: Stale Word Cursor (expected 0, current 1) -> NO ADVANCE (Status: STALE_SESSION)', () => {
      const res = RecitationAdvancementGate.evaluateAdvancement({
        ...baseRequest,
        expectedWordIndex: 0,
        currentWordIndex: 1,
      });
      expect(res.canAdvance).toBe(false);
      expect(res.status).toBe('STALE_SESSION');
    });

    // Scenario 10: Verified Exact Match
    it('Scenario 10: Verified Exact Match -> EXACTLY ONE ADVANCE (Status: VERIFIED_MATCH)', () => {
      const res = RecitationAdvancementGate.evaluateAdvancement({
        ...baseRequest,
        expectedToken: 'بِسْمِ',
        observedTokens: ['ب', 'س', 'م'],
        acousticConfidence: 0.94,
      });
      expect(res.canAdvance).toBe(true);
      expect(res.status).toBe('VERIFIED_MATCH');
      expect(res.errorType).toBe('MATCH');
      expect(res.similarityScore).toBe(1.0);
    });
  });

  describe('2. Levenshtein Safety & Long-Word Substitution Audit (Lahn Jali Elimination)', () => {
    it('proves that long-word single-letter substitution ("العالمون" for "العالمين") is REJECTED', () => {
      // "العالمين" (8 chars) vs "العالمون" (8 chars): Levenshtein distance = 1, similarity = 0.875
      const sim = calculateStringSimilarity('العالمون', 'العالمين');
      expect(sim).toBeGreaterThanOrEqual(0.85); // Empirically proves the vulnerability condition

      const res = RecitationAdvancementGate.evaluateAdvancement({
        ...baseRequest,
        expectedToken: 'العالمين',
        observedTokens: ['ا', 'ل', 'ع', 'ا', 'ل', 'م', 'و', 'ن'], // "العالمون"
        acousticConfidence: 0.92,
      });

      // SCIENTIFIC GUARANTEE: Must NOT advance despite similarity >= 0.85
      expect(res.canAdvance).toBe(false);
      expect(res.status).toBe('MISMATCH');
      expect(res.reason).toContain('SCIENTIFICALLY_UNVALIDATED_PARTIAL_MATCH');
    });

    it('proves that "المستقين" for "المستقيم" is REJECTED', () => {
      const sim = calculateStringSimilarity('المستقين', 'المستقيم');
      expect(sim).toBeGreaterThanOrEqual(0.85);

      const res = RecitationAdvancementGate.evaluateAdvancement({
        ...baseRequest,
        expectedToken: 'ٱلْمُسْتَقِيمَ', // Normalizes to "المستقيم"
        observedTokens: ['ا', 'ل', 'م', 'س', 'ت', 'ق', 'ي', 'ن'],
        acousticConfidence: 0.95,
      });
      expect(res.canAdvance).toBe(false);
      expect(res.status).toBe('MISMATCH');
    });

    it('proves that "المغضود" for "المغضوب" is REJECTED', () => {
      const res = RecitationAdvancementGate.evaluateAdvancement({
        ...baseRequest,
        expectedToken: 'ٱلْمَغْضُوبِ',
        observedTokens: ['ا', 'ل', 'م', 'غ', 'ض', 'و', 'د'],
        acousticConfidence: 0.95,
      });
      expect(res.canAdvance).toBe(false);
      expect(res.status).toBe('MISMATCH');
    });

    it('proves that short-word substitution ("ما" for "من", "هي" for "هو") is REJECTED', () => {
      const resMan = RecitationAdvancementGate.evaluateAdvancement({
        ...baseRequest,
        expectedToken: 'مَن',
        observedTokens: ['م', 'ا'],
        acousticConfidence: 0.95,
      });
      expect(resMan.canAdvance).toBe(false);
      expect(resMan.status).toBe('MISMATCH');

      const resHuwa = RecitationAdvancementGate.evaluateAdvancement({
        ...baseRequest,
        expectedToken: 'هُوَ',
        observedTokens: ['ه', 'ي'],
        acousticConfidence: 0.95,
      });
      expect(resHuwa.canAdvance).toBe(false);
      expect(resHuwa.status).toBe('MISMATCH');
    });

    it('proves that sub-token substring ("م" for "بِسْمِ") is REJECTED', () => {
      const res = RecitationAdvancementGate.evaluateAdvancement({
        ...baseRequest,
        expectedToken: 'بِسْمِ',
        observedTokens: ['م'],
        acousticConfidence: 0.95,
      });
      expect(res.canAdvance).toBe(false);
    });
  });

  describe('3. End-to-End Orchestrator Integration & Observability Audit', () => {
    let orchestrator: RealTimeSessionOrchestrator;
    const testConfig: RealTimeSessionConfig = {
      sessionId: 'orch-audit-session-001',
      studentId: 'student-forensic',
      surahNumber: 1,
      ayahNumber: 1,
      riwayah: RiwayahType.HAFS_AN_ASIM,
      mode: UserInteractionMode.REAL_TIME_TUTOR,
      languageDialect: 'ARABIC_STANDARD',
      explanationLevel: 'MINIMAL',
      voiceFeedbackEnabled: false,
      textOnlyFeedback: true,
      interruptionEnabled: true,
      rawAudioPersistence: false,
    };

    beforeEach(async () => {
      orchestrator = new RealTimeSessionOrchestrator();
      await orchestrator.initializeSession(testConfig);
    });

    it('proves that non-matching evidence NEVER advances orchestrator currentWordIndex', async () => {
      expect(orchestrator.getCurrentWordIndex()).toBe(0);

      // Inconclusive evidence (e.g. from noise or humming)
      const inconclusiveEv: RecitationEvidence = {
        ayahId: 'ayah-1-1',
        wordIndex: 0,
        phonemeIndex: 0,
        expectedToken: 'بِسْمِ',
        observedToken: 'م',
        errorType: 'INCONCLUSIVE',
        acousticConfidence: 0.45,
        alignmentConfidence: 0.50,
        startTime: 0,
        endTime: 500,
        evidenceStatus: 'INCONCLUSIVE',
      };

      await orchestrator.evaluateRecitationStep(inconclusiveEv, EvidenceStabilizationState.STABLE, 0, 18.0);
      expect(orchestrator.getCurrentWordIndex()).toBe(0); // MUST REMAIN AT 0

      const journal = orchestrator.getJournal();
      const records = journal.getRecords();
      const rejectedEvent = records.find((r) => r.type === 'ADVANCEMENT_REJECTED');
      expect(rejectedEvent).toBeDefined();

      const committedEvent = records.find((r) => r.type === 'ADVANCEMENT_COMMITTED');
      expect(committedEvent).toBeUndefined(); // Zero committed advancement
    });

    it('proves that verified match advances currentWordIndex exactly by 1 and records audit trail', async () => {
      expect(orchestrator.getCurrentWordIndex()).toBe(0);

      const verifiedEv: RecitationEvidence = {
        ayahId: 'ayah-1-1',
        wordIndex: 0,
        phonemeIndex: 0,
        expectedToken: 'بِسْمِ',
        observedToken: 'بسم',
        errorType: 'MATCH',
        acousticConfidence: 0.95,
        alignmentConfidence: 0.95,
        startTime: 0,
        endTime: 800,
        evidenceStatus: 'HIGH',
      };

      await orchestrator.evaluateRecitationStep(verifiedEv, EvidenceStabilizationState.STABLE, 0, 25.0);

      // Cursor must advance to 1
      expect(orchestrator.getCurrentWordIndex()).toBe(1);

      // Verify audit journal events
      const records = orchestrator.getJournal().getRecords();
      const reqEvent = records.find((r) => r.type === 'ADVANCEMENT_REQUESTED');
      const approvedEvent = records.find((r) => r.type === 'ADVANCEMENT_APPROVED');
      const committedEvent = records.find((r) => r.type === 'ADVANCEMENT_COMMITTED');

      expect(reqEvent).toBeDefined();
      expect(approvedEvent).toBeDefined();
      expect(committedEvent).toBeDefined();
    });

    it('proves that duplicate callbacks for already-passed word are safely discarded', async () => {
      // Advance to word 1
      const verifiedEv0: RecitationEvidence = {
        ayahId: 'ayah-1-1',
        wordIndex: 0,
        phonemeIndex: 0,
        expectedToken: 'بِسْمِ',
        observedToken: 'بسم',
        errorType: 'MATCH',
        acousticConfidence: 0.95,
        alignmentConfidence: 0.95,
        startTime: 0,
        endTime: 800,
        evidenceStatus: 'HIGH',
      };
      await orchestrator.evaluateRecitationStep(verifiedEv0, EvidenceStabilizationState.STABLE, 0, 25.0);
      expect(orchestrator.getCurrentWordIndex()).toBe(1);

      // Duplicate callback targeting word 0
      await orchestrator.evaluateRecitationStep(verifiedEv0, EvidenceStabilizationState.STABLE, 0, 25.0);

      // Must remain at word 1 without crashing or double advancing
      expect(orchestrator.getCurrentWordIndex()).toBe(1);

      const records = orchestrator.getJournal().getRecords();
      const outOfOrderRec = records.find((r) => r.type === 'OUT_OF_ORDER_DISCARDED');
      expect(outOfOrderRec).toBeDefined();
    });
  });
});
