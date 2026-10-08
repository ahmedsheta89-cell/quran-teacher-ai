/**
 * @file RecitationAdvancementGate.ts
 * @module domain/recitation
 * @description Authoritative Single Advancement Gate for Quran Recitation Progression (Phase 16.9R).
 * 
 * CORE SCIENTIFIC INVARIANT:
 * ABSENCE OF EVIDENCE = NO POSITIVE ACOUSTIC JUDGMENT.
 * 
 * ONLY EXPLICITLY VERIFIED RECITATION EVIDENCE MAY ADVANCE THE EXPECTED WORD.
 * 
 * Disallows:
 * - Substring matching where observed is a sub-token of expected (e.g. humming 'م' matching 'بسم')
 * - VAD-driven advancement
 * - Energy/timeout advancement
 * - Stale session advancement
 * - Partial/uncertain speech advancement
 * - Empty transcript advancement
 */

import { EvidenceErrorType, EvidenceConfidenceStatus } from './RecitationEvidence.ts';

export type AdvancementDecisionStatus =
  | 'VERIFIED_MATCH'
  | 'MISMATCH'
  | 'UNCERTAIN'
  | 'INSUFFICIENT_EVIDENCE'
  | 'NO_INPUT'
  | 'STALE_SESSION';

export interface AdvancementEvaluationRequest {
  sessionId: string;
  activeSessionId: string;
  expectedWordIndex: number;
  currentWordIndex: number;
  expectedToken: string;
  observedTokens: string[];
  acousticConfidence: number;
  snrDb?: number;
  isStudentSpeaking?: boolean;
}

export interface AdvancementEvaluationResult {
  canAdvance: boolean;
  status: AdvancementDecisionStatus;
  errorType: EvidenceErrorType;
  evidenceStatus: EvidenceConfidenceStatus;
  reason: string;
  normalizedExpected: string;
  normalizedObserved: string;
  similarityScore: number;
  feedbackMessageArabic: string;
}

/**
 * Normalizes Quranic Arabic text into a clean phonetic/graphemic base
 * for rigorous token-level comparison.
 */
export function normalizeQuranicArabic(text: string): string {
  if (!text) return '';
  return text
    // Remove Quranic pause marks, sajdah, rub, hizb signs (\u06D6-\u06ED)
    .replace(/[\u06D6-\u06ED]/g, '')
    // Remove standard Arabic tashkeel / harakat (\u064B-\u065F)
    .replace(/[\u064B-\u065F]/g, '')
    // Remove dagger alif (\u0670)
    .replace(/\u0670/g, '')
    // Remove tatweel (\u0640)
    .replace(/\u0640/g, '')
    // Unify Alif variants to bare Alif
    .replace(/[إأآٱ]/g, 'ا')
    // Unify Alif Maqsura to Yaa
    .replace(/ى/g, 'ي')
    // Unify Taa Marbuta to Haa
    .replace(/ة/g, 'ه')
    // Remove non-Arabic letters and symbols, preserve spaces
    .replace(/[^\u0621-\u063A\u0641-\u064A\s]/g, '')
    // Collapse multi-spaces and trim
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Detects whether the decoded tokens represent humming, throat clearing,
 * or non-lexical vocal acoustic energy.
 */
export function isHummingOrNoise(tokens: string[], normalizedStr: string): boolean {
  if (!normalizedStr || normalizedStr.length === 0) return true;
  // Repetitive nasal/throat phonemes (e.g. "م", "مم", "ممم", "ن", "هـ", "اه")
  if (/^[منهء\s]+$/.test(normalizedStr) && normalizedStr.length <= 4) return true;
  // Single isolated character is never a valid Quranic word recitation
  if (normalizedStr.length <= 1) return true;
  return false;
}

/**
 * Computes Levenshtein distance between two normalized strings.
 */
export function computeLevenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

/**
 * Calculates normalized similarity ratio in range [0.0, 1.0].
 */
export function calculateStringSimilarity(a: string, b: string): number {
  if (a === b) return 1.0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1.0;
  const dist = computeLevenshteinDistance(a, b);
  return Math.max(0.0, 1.0 - dist / maxLen);
}

export class RecitationAdvancementGate {
  private static readonly MIN_CONFIDENCE_THRESHOLD = 0.65;
  private static readonly MIN_SIMILARITY_MATCH = 0.85;

  /**
   * The Single Authoritative Advancement Evaluation Gate.
   * Returns whether the expected word cursor may advance, with forensic justification.
   */
  public static evaluateAdvancement(
    req: AdvancementEvaluationRequest
  ): AdvancementEvaluationResult {
    const normalizedExpected = normalizeQuranicArabic(req.expectedToken);
    const observedRaw = (req.observedTokens || []).join('');
    const normalizedObserved = normalizeQuranicArabic(observedRaw);

    // 1. Session and Request Sequence Guard (Section 8)
    if (req.sessionId !== req.activeSessionId) {
      return {
        canAdvance: false,
        status: 'STALE_SESSION',
        errorType: 'INCONCLUSIVE',
        evidenceStatus: 'INCONCLUSIVE',
        reason: `STALE_SESSION: Request sessionId (${req.sessionId}) does not match activeSessionId (${req.activeSessionId})`,
        normalizedExpected,
        normalizedObserved,
        similarityScore: 0.0,
        feedbackMessageArabic: 'تم تجاهل النتيجة بسبب بدء جلسة تسجيل جديدة.',
      };
    }

    if (req.expectedWordIndex !== req.currentWordIndex) {
      return {
        canAdvance: false,
        status: 'STALE_SESSION',
        errorType: 'INCONCLUSIVE',
        evidenceStatus: 'INCONCLUSIVE',
        reason: `CURSOR_MISMATCH: Expected word index (${req.expectedWordIndex}) != currentWordIndex (${req.currentWordIndex})`,
        normalizedExpected,
        normalizedObserved,
        similarityScore: 0.0,
        feedbackMessageArabic: 'تم تجاوز الكلمة السابقة بالفعل.',
      };
    }

    // 2. Empty Input / Silence Guard (Case C)
    if (!req.observedTokens || req.observedTokens.length === 0 || normalizedObserved.length === 0) {
      return {
        canAdvance: false,
        status: 'NO_INPUT',
        errorType: 'INCONCLUSIVE',
        evidenceStatus: 'INCONCLUSIVE',
        reason: 'NO_INPUT: Zero observed speech tokens decoded from audio frame',
        normalizedExpected,
        normalizedObserved,
        similarityScore: 0.0,
        feedbackMessageArabic: 'لم يتم رصد صوت واضح. تفضل بالقراءة.',
      };
    }

    // 3. Humming and Noise Guard (Case B, Case D)
    if (isHummingOrNoise(req.observedTokens, normalizedObserved)) {
      return {
        canAdvance: false,
        status: 'INSUFFICIENT_EVIDENCE',
        errorType: 'INCONCLUSIVE',
        evidenceStatus: 'INCONCLUSIVE',
        reason: `HUMMING_OR_NOISE_REJECTED: Observed string '${normalizedObserved}' classified as vocal humming or sub-lexical noise`,
        normalizedExpected,
        normalizedObserved,
        similarityScore: 0.0,
        feedbackMessageArabic: 'لم أتحقق من نطق الكلمة بوضوح. اقرأ بتؤدة وترتيل.',
      };
    }

    // 4. Acoustic Confidence Guard (Case H)
    if (req.acousticConfidence < RecitationAdvancementGate.MIN_CONFIDENCE_THRESHOLD) {
      return {
        canAdvance: false,
        status: 'UNCERTAIN',
        errorType: 'INCONCLUSIVE',
        evidenceStatus: 'INCONCLUSIVE',
        reason: `LOW_CONFIDENCE: Acoustic confidence ${req.acousticConfidence.toFixed(2)} < threshold ${RecitationAdvancementGate.MIN_CONFIDENCE_THRESHOLD}`,
        normalizedExpected,
        normalizedObserved,
        similarityScore: 0.0,
        feedbackMessageArabic: 'الصوت غير واضح تماماً. أعد القراءة بهدوء.',
      };
    }

    // 5. Explicit Lexical Matching Gate
    // STRICT RULE: Bidirectional substring matching is FORBIDDEN.
    // 'normalizedExpected.includes(normalizedObserved)' MUST NEVER declare a match!
    
    // Check A: Exact normalized match
    if (normalizedObserved === normalizedExpected) {
      return {
        canAdvance: true,
        status: 'VERIFIED_MATCH',
        errorType: 'MATCH',
        evidenceStatus: req.acousticConfidence >= 0.80 ? 'HIGH' : 'MEDIUM',
        reason: 'EXACT_NORMALIZED_MATCH: Observed tokens precisely match expected word',
        normalizedExpected,
        normalizedObserved,
        similarityScore: 1.0,
        feedbackMessageArabic: 'أحسنت! قراءة متقنة.',
      };
    }

    // Check B: Discrete full-word presence in multi-word continuous utterance
    const observedWords = normalizedObserved.split(/\s+/).filter((w) => w.length > 0);
    const hasExactDiscreteWord = observedWords.some((w) => w === normalizedExpected);

    if (hasExactDiscreteWord) {
      return {
        canAdvance: true,
        status: 'VERIFIED_MATCH',
        errorType: 'MATCH',
        evidenceStatus: req.acousticConfidence >= 0.80 ? 'HIGH' : 'MEDIUM',
        reason: 'DISCRETE_FULL_WORD_MATCH: Expected word identified as discrete token in phrase',
        normalizedExpected,
        normalizedObserved,
        similarityScore: 1.0,
        feedbackMessageArabic: 'أحسنت! تم التحقق من الكلمة.',
      };
    }

    // Check C: Approximate similarity check (Levenshtein >= 0.85)
    // CRITICAL SCIENTIFIC SAFETY AUDIT:
    // For words with >= 7 letters (e.g. "العالمين", "المستقيم", "المغضوب"), a single-letter
    // substitution yields similarity >= 0.857. In Quranic recitation, single-letter
    // substitution is an invalid recitation (Lahn Jali / لحن جلي) such as "العالمون" vs "العالمين".
    // Therefore, approximate similarity CANNOT advance the word cursor without exact ground-truth verification.
    let bestSimilarity = 0.0;
    let bestMatchedWord = '';

    for (const word of observedWords) {
      if (word.length >= 2 && normalizedExpected.length >= 2) {
        const sim = calculateStringSimilarity(word, normalizedExpected);
        if (sim > bestSimilarity) {
          bestSimilarity = sim;
          bestMatchedWord = word;
        }
      }
    }

    if (
      bestSimilarity >= RecitationAdvancementGate.MIN_SIMILARITY_MATCH &&
      Math.abs(bestMatchedWord.length - normalizedExpected.length) <= 1
    ) {
      return {
        canAdvance: false,
        status: 'MISMATCH',
        errorType: 'SUBSTITUTION',
        evidenceStatus: 'MEDIUM',
        reason: `SCIENTIFICALLY_UNVALIDATED_PARTIAL_MATCH: Approximate similarity (${bestSimilarity.toFixed(2)}) for '${bestMatchedWord}' vs '${normalizedExpected}' cannot advance without exact phonetic confirmation`,
        normalizedExpected,
        normalizedObserved,
        similarityScore: bestSimilarity,
        feedbackMessageArabic: `تنبيه: نطق مقارب ولكن غير مطابق تماماً للكلمة («${req.expectedToken}»). أعد نطقها بدقة.`,
      };
    }

    // 6. Explicit Mismatch (Case A, Case E)
    return {
      canAdvance: false,
      status: 'MISMATCH',
      errorType: 'SUBSTITUTION',
      evidenceStatus: 'MEDIUM',
      reason: `MISMATCH: Observed '${normalizedObserved}' does not match expected '${normalizedExpected}' (best sim: ${bestSimilarity.toFixed(2)})`,
      normalizedExpected,
      normalizedObserved,
      similarityScore: bestSimilarity,
      feedbackMessageArabic: `لم تتطابق القراءة مع الكلمة المطلوبة («${req.expectedToken}»). حاول مرة أخرى.`,
    };
  }
}
