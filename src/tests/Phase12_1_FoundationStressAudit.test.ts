/**
 * @file Phase12_1_FoundationStressAudit.test.ts
 * @module tests
 * @description Official Vitest specification for Phase 12.1 — Audio Quality & Foundation Stress Audit.
 */

import { describe, it, expect } from 'vitest';
import { Phase12_1_AudioStressAuditRunner } from './Phase12_1_AudioStressAuditRunner.ts';

describe('PHASE 12.1 — AUDIO QUALITY OPTIMIZATION & FOUNDATION STRESS AUDIT', () => {
  const runner = new Phase12_1_AudioStressAuditRunner();

  it('1. Resampling Audit: verifies deterministic resampling to exactly 16kHz with anti-aliasing', () => {
    const results = runner.runResamplingAudit();
    expect(results.length).toBeGreaterThan(0);

    // Filter frequencies above 8kHz (Nyquist of 16kHz)
    const outOfBand = results.filter((r) => r.frequencyHz > 8000);
    // Bandlimited sinc must attenuate out-of-band frequencies without severe aliasing
    for (const row of outOfBand) {
      expect(row.sincAliasingDetected).toBe(false);
    }

    // In-band frequencies (< 8000Hz) must preserve amplitude
    const inBand = results.filter((r) => r.frequencyHz <= 5000);
    for (const row of inBand) {
      expect(row.sincAmpError).toBeLessThan(0.15); // < 15% amplitude deviation
    }
  }, 30000);

  it('2. Speech-like Transients: verifies consonant bursts and vowel formants are preserved', () => {
    const speechResults = runner.testSpeechLikeTransients();
    expect(speechResults.consonantBurstPreserved).toBe(true);
    expect(speechResults.vowelFormantsPreserved).toBe(true);
    expect(speechResults.silenceBoundarySharp).toBe(true);
  });

  it('3. Quality Gate Threshold Sensitivity: evaluates RMS, SNR, and Clipping behavior', () => {
    const sensitivityResults = runner.runThresholdSensitivityAudit();
    expect(sensitivityResults.length).toBe(13);

    // Verify sub-0.005 RMS is flagged as degraded/inconclusive, NOT MATCH
    const lowRms = sensitivityResults.filter((r) => r.param === 'RMS' && r.testedValue < 0.005);
    for (const row of lowRms) {
      expect(row.isUsable).toBe(false);
      expect(row.verdict).toBe('INCONCLUSIVE');
    }

    // Verify clipped audio is rejected
    const clipped = sensitivityResults.filter((r) => r.param === 'CLIPPING' && r.testedValue >= 0.995);
    for (const row of clipped) {
      expect(row.verdict).toBe('REJECTED');
    }
  });

  it('4. End-to-End Latency Audit: measures capture-to-evidence latency profile', () => {
    const latency = runner.runLatencyAudit(50);
    expect(latency.coldStartMs).toBeGreaterThan(0);
    expect(latency.p50Ms).toBeLessThan(150); // Under 150ms for local processing pipeline
    expect(latency.p95Ms).toBeLessThan(250);
    expect(latency.maxMs).toBeLessThan(500);
  });

  it('5. Streaming Isolation & Cancellation: ensures Session A never leaks to Session B', async () => {
    const streamRes = await runner.testSessionIsolationAndCancellation();
    expect(streamRes.sessionIsolationGuaranteed).toBe(true);
    expect(streamRes.canceledOperationNeverMatches).toBe(true);
  });

  it('6. Long Session Memory Stability: verifies bounded EventJournal and zero memory leaks', () => {
    const memRes = runner.testLongSessionStability(8000);
    expect(memRes.journalCapacityBounded).toBe(true);
    expect(memRes.leaksDetected).toBe(false);
    expect(memRes.heapGrowthMB).toBeLessThan(50); // Less than 50MB growth for 8,000 events
  });

  it('7. Evidence Provenance: absence of evidence strictly yields INCONCLUSIVE, never MATCH', () => {
    const adv = runner.testAdversarialEvidenceIntegrity();
    expect(adv.silenceYieldsNoMatch).toBe(true);
    expect(adv.noiseYieldsNoMatch).toBe(true);
    expect(adv.clippingYieldsNoMatch).toBe(true);
    expect(adv.emptyAudioYieldsNoMatch).toBe(true);
    expect(adv.partialRecitationYieldsNoMatch).toBe(true);
  });

  it('8. Network Privacy: verifies zero audio PCM uploaded over network', () => {
    const netRes = runner.testNetworkPrivacy();
    expect(netRes.zeroAudioExfiltrationObserved).toBe(true);
  });

  it('9. Architectural Decoupling: verifies future features can be added without core coupling', () => {
    const archRes = runner.testArchitecturalDecoupling();
    expect(archRes.canAddAnalyticsWithoutCoreCoupling).toBe(true);
  });
});
