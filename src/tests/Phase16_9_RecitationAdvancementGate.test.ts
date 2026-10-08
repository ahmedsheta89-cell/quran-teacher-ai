import { describe, it, expect } from 'vitest';
import {
  RecitationAdvancementGate,
  AdvancementEvaluationRequest,
  normalizeQuranicArabic,
  isHummingOrNoise,
  calculateStringSimilarity,
} from '../domain/recitation/RecitationAdvancementGate.ts';

describe('PHASE 16.9R: Recitation Advancement Gate & False-Positive Elimination', () => {
  const baseRequest: AdvancementEvaluationRequest = {
    sessionId: 'session-100',
    activeSessionId: 'session-100',
    expectedWordIndex: 0,
    currentWordIndex: 0,
    expectedToken: 'بِسْمِ',
    observedTokens: ['ب', 'س', 'م'],
    acousticConfidence: 0.95,
    snrDb: 22.0,
    isStudentSpeaking: true,
  };

  describe('1. Normalization & Utility Verification', () => {
    it('normalizes Quranic diacritics, dagger alif, waqf marks, and alif variants', () => {
      expect(normalizeQuranicArabic('بِسْمِ')).toBe('بسم');
      expect(normalizeQuranicArabic('ٱللَّهِ')).toBe('الله');
      expect(normalizeQuranicArabic('ٱلرَّحْمَٰنِ')).toBe('الرحمن');
      expect(normalizeQuranicArabic('ٱلرَّحِيمِ')).toBe('الرحيم');
      expect(normalizeQuranicArabic('إِيَّاكَ')).toBe('اياك');
    });

    it('identifies humming, throat sounds, and sub-lexical noises', () => {
      expect(isHummingOrNoise(['م'], 'م')).toBe(true);
      expect(isHummingOrNoise(['م', 'م'], 'مم')).toBe(true);
      expect(isHummingOrNoise(['م', 'م', 'م'], 'ممم')).toBe(true);
      expect(isHummingOrNoise(['ن'], 'ن')).toBe(true);
      expect(isHummingOrNoise(['ه'], 'ه')).toBe(true);
      expect(isHummingOrNoise([], '')).toBe(true);
      // Valid words are NOT humming
      expect(isHummingOrNoise(['ب', 'س', 'م'], 'بسم')).toBe(false);
      expect(isHummingOrNoise(['ا', 'ل', 'ل', 'ه'], 'الله')).toBe(false);
    });
  });

  describe('2. Test Matrix: False-Positive Prevention (Cases A - H)', () => {
    // 1. Wrong Arabic word -> NO ADVANCE
    it('1. Wrong Arabic word: rejects unrelated Arabic words', () => {
      const res = RecitationAdvancementGate.evaluateAdvancement({
        ...baseRequest,
        expectedToken: 'بِسْمِ',
        observedTokens: ['ا', 'ل', 'ح', 'م', 'د'], // "الحمد"
      });
      expect(res.canAdvance).toBe(false);
      expect(res.status).toBe('MISMATCH');
      expect(res.errorType).toBe('SUBSTITUTION');
    });

    // 2. English speech -> NO ADVANCE
    it('2. English speech: rejects English or non-Arabic input', () => {
      const res = RecitationAdvancementGate.evaluateAdvancement({
        ...baseRequest,
        expectedToken: 'اللَّهِ',
        observedTokens: ['h', 'e', 'l', 'l', 'o'],
      });
      expect(res.canAdvance).toBe(false);
      expect(res.status).toBe('NO_INPUT');
    });

    // 3. Humming -> NO ADVANCE (Original Reported Bug)
    it('3. Humming: rejects humming "مممم" on "بِسْمِ"', () => {
      const res = RecitationAdvancementGate.evaluateAdvancement({
        ...baseRequest,
        expectedToken: 'بِسْمِ',
        observedTokens: ['م', 'م', 'م'],
      });
      expect(res.canAdvance).toBe(false);
      expect(res.status).toBe('INSUFFICIENT_EVIDENCE');
      expect(res.errorType).toBe('INCONCLUSIVE');
    });

    it('3b. Humming: rejects single nasal character "م" on "الرَّحْمَٰنِ"', () => {
      const res = RecitationAdvancementGate.evaluateAdvancement({
        ...baseRequest,
        expectedToken: 'الرَّحْمَٰنِ',
        observedTokens: ['م'],
      });
      expect(res.canAdvance).toBe(false);
      expect(res.status).toBe('INSUFFICIENT_EVIDENCE');
    });

    // 4. Random syllables -> NO ADVANCE
    it('4. Random syllables: rejects arbitrary disjoint letters "لا" on "بِسْمِ"', () => {
      const res = RecitationAdvancementGate.evaluateAdvancement({
        ...baseRequest,
        expectedToken: 'بِسْمِ',
        observedTokens: ['ل', 'ا'],
      });
      expect(res.canAdvance).toBe(false);
      expect(res.status).toBe('MISMATCH');
    });

    // 5. Silence -> NO ADVANCE
    it('5. Silence: rejects empty token array', () => {
      const res = RecitationAdvancementGate.evaluateAdvancement({
        ...baseRequest,
        observedTokens: [],
      });
      expect(res.canAdvance).toBe(false);
      expect(res.status).toBe('NO_INPUT');
    });

    // 6. Noise -> NO ADVANCE
    it('6. Noise: rejects isolated diacritics or non-phonemic symbols', () => {
      const res = RecitationAdvancementGate.evaluateAdvancement({
        ...baseRequest,
        observedTokens: ['\u064E'], // Fatha alone
      });
      expect(res.canAdvance).toBe(false);
      expect(res.status).toBe('NO_INPUT');
    });

    // 7. Empty transcript -> NO ADVANCE
    it('7. Empty transcript: rejects empty whitespace tokens', () => {
      const res = RecitationAdvancementGate.evaluateAdvancement({
        ...baseRequest,
        observedTokens: ['   '],
      });
      expect(res.canAdvance).toBe(false);
      expect(res.status).toBe('NO_INPUT');
    });

    // 8. Low acoustic confidence -> NO ADVANCE (Case H)
    it('8. Low acoustic confidence: rejects matches when confidence < 0.65', () => {
      const res = RecitationAdvancementGate.evaluateAdvancement({
        ...baseRequest,
        expectedToken: 'بِسْمِ',
        observedTokens: ['ب', 'س', 'م'],
        acousticConfidence: 0.40, // Below threshold
      });
      expect(res.canAdvance).toBe(false);
      expect(res.status).toBe('UNCERTAIN');
      expect(res.errorType).toBe('INCONCLUSIVE');
    });

    // 9. Stale Session -> NO ADVANCE
    it('9. Stale Session: rejects result if sessionId does not match activeSessionId', () => {
      const res = RecitationAdvancementGate.evaluateAdvancement({
        ...baseRequest,
        sessionId: 'old-session-099',
        activeSessionId: 'active-session-100',
        observedTokens: ['ب', 'س', 'م'],
      });
      expect(res.canAdvance).toBe(false);
      expect(res.status).toBe('STALE_SESSION');
    });

    // 10. Cursor Mismatch -> NO ADVANCE
    it('10. Cursor Mismatch: rejects result if expectedWordIndex != currentWordIndex', () => {
      const res = RecitationAdvancementGate.evaluateAdvancement({
        ...baseRequest,
        expectedWordIndex: 0,
        currentWordIndex: 1, // Cursor has already moved
        observedTokens: ['ب', 'س', 'م'],
      });
      expect(res.canAdvance).toBe(false);
      expect(res.status).toBe('STALE_SESSION');
    });

    // 11. Substring of expected token: PROHIBITED from matching
    it('11. Substring Guard: prevents "ل" from matching "اللَّهِ"', () => {
      const res = RecitationAdvancementGate.evaluateAdvancement({
        ...baseRequest,
        expectedToken: 'اللَّهِ',
        observedTokens: ['ل'],
      });
      expect(res.canAdvance).toBe(false);
    });

    // 12. Correct verified result -> EXACTLY ONE ADVANCE
    it('12. Correct verified word: permits advancement on clean match', () => {
      const res = RecitationAdvancementGate.evaluateAdvancement({
        ...baseRequest,
        expectedToken: 'بِسْمِ',
        observedTokens: ['ب', 'س', 'م'],
        acousticConfidence: 0.92,
      });
      expect(res.canAdvance).toBe(true);
      expect(res.status).toBe('VERIFIED_MATCH');
      expect(res.errorType).toBe('MATCH');
    });

    // 13. Continuous recitation: permits advancement when expected word is a discrete token in phrase
    it('13. Continuous speech: detects discrete expected word within recited phrase', () => {
      const res = RecitationAdvancementGate.evaluateAdvancement({
        ...baseRequest,
        expectedToken: 'اللَّهِ',
        observedTokens: ['ب', 'س', 'م', ' ', 'ا', 'ل', 'ل', 'ه'],
        acousticConfidence: 0.90,
      });
      expect(res.canAdvance).toBe(true);
      expect(res.status).toBe('VERIFIED_MATCH');
    });
  });

  describe('3. Invariant Properties (Section 13)', () => {
    it('INVARIANT: currentWord may increase ONLY IF decision == VERIFIED_MATCH', () => {
      const testCases: { name: string; req: AdvancementEvaluationRequest; expectedAdvance: boolean }[] = [
        { name: 'Humming', req: { ...baseRequest, observedTokens: ['م'] }, expectedAdvance: false },
        { name: 'Silence', req: { ...baseRequest, observedTokens: [] }, expectedAdvance: false },
        { name: 'Noise', req: { ...baseRequest, observedTokens: ['\u0652'] }, expectedAdvance: false },
        { name: 'Substitution', req: { ...baseRequest, observedTokens: ['ق', 'ل'] }, expectedAdvance: false },
        { name: 'Low Confidence', req: { ...baseRequest, observedTokens: ['ب', 'س', 'م'], acousticConfidence: 0.3 }, expectedAdvance: false },
        { name: 'Stale Session', req: { ...baseRequest, sessionId: 'stale', observedTokens: ['ب', 'س', 'م'] }, expectedAdvance: false },
        { name: 'Valid Word', req: { ...baseRequest, observedTokens: ['ب', 'س', 'م'] }, expectedAdvance: true },
      ];

      for (const tc of testCases) {
        const res = RecitationAdvancementGate.evaluateAdvancement(tc.req);
        if (!tc.expectedAdvance) {
          expect(res.canAdvance, `Failed for case: ${tc.name}`).toBe(false);
          expect(res.status, `Failed status for case: ${tc.name}`).not.toBe('VERIFIED_MATCH');
        } else {
          expect(res.canAdvance, `Failed for case: ${tc.name}`).toBe(true);
          expect(res.status, `Failed status for case: ${tc.name}`).toBe('VERIFIED_MATCH');
        }
      }
    });
  });
});
