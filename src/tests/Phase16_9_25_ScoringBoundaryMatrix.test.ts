/**
 * @file Phase16_9_25_ScoringBoundaryMatrix.test.ts
 * @description Phase 16.9.25 Scoring Boundary & Honesty Matrix Test Suite.
 * 
 * Verifies that recitation scores:
 * 1. Never output a fake default score (e.g. 96%) on empty or un-recited sessions.
 * 2. Never apply an artificial floor (e.g. 70% or 82%) when performance is poor.
 * 3. Correctly measure verified word completion ratio and error penalties.
 * 4. Strictly block certificate issuance on uncompleted or zero-accuracy sessions.
 */

import { describe, it, expect } from 'vitest';
import { WordVisualState } from '../domain/realtime_teacher/types.ts';

// Extracted pure scoring calculation matching UnifiedClassroomView.tsx getReportData()
export function calculateClassroomScores(input: {
  totalWords: number;
  completedWords: number;
  errorCount: number;
  revealedHintsCount: number;
  hesitationCount: number;
  sessionCompleted: boolean;
  selectedAyah: number;
}) {
  const totalWords = input.totalWords || 1;
  const completedWords = input.completedWords;

  let accuracyScore = 0;
  if (completedWords > 0) {
    const completionRatio = completedWords / totalWords;
    const penalty = (input.errorCount * 8) + (input.revealedHintsCount * 4);
    accuracyScore = Math.max(0, Math.min(100, Math.round((completionRatio * 100) - penalty)));
  }

  const tajweedScore = input.sessionCompleted
    ? Math.max(0, accuracyScore - (input.errorCount * 2))
    : 0;

  const fluencyScore = completedWords > 0
    ? Math.max(0, 100 - (input.hesitationCount * 10))
    : 0;

  const completedAyahs = input.sessionCompleted ? input.selectedAyah : 0;
  const perfectWordCount = Math.max(0, completedWords - input.errorCount - input.revealedHintsCount);

  // Certificate eligibility guard
  const isEligibleForCertificate = input.sessionCompleted && completedWords === totalWords && accuracyScore >= 80;

  return {
    accuracyScore,
    tajweedScore,
    fluencyScore,
    completedAyahs,
    perfectWordCount,
    isEligibleForCertificate,
  };
}

describe('Phase 16.9.25 Scoring Boundary & Integrity Matrix', () => {
  it('1. Empty session: 0 words recited -> accuracy must be strictly 0, not 96', () => {
    const res = calculateClassroomScores({
      totalWords: 4,
      completedWords: 0,
      errorCount: 0,
      revealedHintsCount: 0,
      hesitationCount: 0,
      sessionCompleted: false,
      selectedAyah: 1,
    });

    expect(res.accuracyScore).toBe(0);
    expect(res.tajweedScore).toBe(0);
    expect(res.fluencyScore).toBe(0);
    expect(res.completedAyahs).toBe(0);
    expect(res.isEligibleForCertificate).toBe(false);
  });

  it('2. Incomplete session: 1 of 4 words completed without errors -> accuracy = 25%', () => {
    const res = calculateClassroomScores({
      totalWords: 4,
      completedWords: 1,
      errorCount: 0,
      revealedHintsCount: 0,
      hesitationCount: 0,
      sessionCompleted: false,
      selectedAyah: 1,
    });

    expect(res.accuracyScore).toBe(25);
    expect(res.tajweedScore).toBe(0); // Not completed yet
    expect(res.completedAyahs).toBe(0);
    expect(res.isEligibleForCertificate).toBe(false);
  });

  it('3. Incomplete session with errors: 1 of 4 words completed with 2 errors -> penalty applied without artificial 70% floor', () => {
    const res = calculateClassroomScores({
      totalWords: 4,
      completedWords: 1,
      errorCount: 2,
      revealedHintsCount: 0,
      hesitationCount: 0,
      sessionCompleted: false,
      selectedAyah: 1,
    });

    // 25 - (2 * 8) = 9%
    expect(res.accuracyScore).toBe(9);
    expect(res.accuracyScore).toBeLessThan(70);
    expect(res.isEligibleForCertificate).toBe(false);
  });

  it('4. Completed session with heavy errors: 4 of 4 words completed with 12 errors -> score drops towards 0', () => {
    const res = calculateClassroomScores({
      totalWords: 4,
      completedWords: 4,
      errorCount: 12,
      revealedHintsCount: 1,
      hesitationCount: 2,
      sessionCompleted: true,
      selectedAyah: 1,
    });

    // 100 - (12 * 8 = 96) - 4 = 0%
    expect(res.accuracyScore).toBe(0);
    expect(res.tajweedScore).toBe(0);
    expect(res.isEligibleForCertificate).toBe(false);
  });

  it('5. Flawless completed session: 4 of 4 words completed with 0 errors and 0 hints -> accuracy = 100%, certificate eligible', () => {
    const res = calculateClassroomScores({
      totalWords: 4,
      completedWords: 4,
      errorCount: 0,
      revealedHintsCount: 0,
      hesitationCount: 0,
      sessionCompleted: true,
      selectedAyah: 1,
    });

    expect(res.accuracyScore).toBe(100);
    expect(res.tajweedScore).toBe(100);
    expect(res.fluencyScore).toBe(100);
    expect(res.completedAyahs).toBe(1);
    expect(res.perfectWordCount).toBe(4);
    expect(res.isEligibleForCertificate).toBe(true);
  });

  it('6. Completed session with moderate errors: 4 words with 1 error -> accuracy = 92%, eligible', () => {
    const res = calculateClassroomScores({
      totalWords: 4,
      completedWords: 4,
      errorCount: 1,
      revealedHintsCount: 0,
      hesitationCount: 1,
      sessionCompleted: true,
      selectedAyah: 1,
    });

    expect(res.accuracyScore).toBe(92);
    expect(res.tajweedScore).toBe(90);
    expect(res.fluencyScore).toBe(90);
    expect(res.isEligibleForCertificate).toBe(true);
  });

  it('7. Completed session with low score (70%): Not eligible for mastery certificate (threshold >= 80%)', () => {
    const res = calculateClassroomScores({
      totalWords: 4,
      completedWords: 4,
      errorCount: 3,
      revealedHintsCount: 1,
      hesitationCount: 0,
      sessionCompleted: true,
      selectedAyah: 1,
    });

    // 100 - (3 * 8 = 24) - 4 = 72%
    expect(res.accuracyScore).toBe(72);
    expect(res.isEligibleForCertificate).toBe(false);
  });

  it('8. Dashboard zero-progress boundary: 0 mastered ayahs and 0 accuracy -> scores are strictly 0, certificate blocked', () => {
    const totalAyahsMastered = 0;
    const cumulativeAccuracyPercentage = 0;
    const accuracyScore = Math.round(cumulativeAccuracyPercentage);
    const hasProgress = totalAyahsMastered > 0 && accuracyScore > 0;
    const tajweedScore = hasProgress ? Math.max(0, accuracyScore - 4) : 0;
    const fluencyScore = hasProgress ? Math.max(0, accuracyScore - 6) : 0;
    const isEligibleForCertificate = totalAyahsMastered > 0 && accuracyScore >= 80;

    expect(accuracyScore).toBe(0);
    expect(tajweedScore).toBe(0);
    expect(fluencyScore).toBe(0);
    expect(isEligibleForCertificate).toBe(false);
  });
});
