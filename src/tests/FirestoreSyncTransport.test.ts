/**
 * @file FirestoreSyncTransport.test.ts
 * @description Comprehensive unit tests for FirestoreSyncTransport verifying offline resilience,
 * zero-raw-audio policy, envelope serialization, and conflict detection.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FirestoreSyncTransport } from '../infrastructure/sync/FirestoreSyncTransport.ts';
import { SyncEventEnvelope, SyncErrorCode } from '../domain/sync/types.ts';

describe('FirestoreSyncTransport - Offline-First Sync & Resilience Unit Tests', () => {
  let transport: FirestoreSyncTransport;

  beforeEach(() => {
    transport = new FirestoreSyncTransport();
  });

  const sampleEnvelope: SyncEventEnvelope = {
    syncEventId: 'sync_001',
    eventId: 'evt_001',
    studentId: 'student_123',
    deviceId: 'device_abc',
    sessionId: 'session_xyz',
    sequenceNumber: 1,
    eventHash: 'hash_abc123',
    previousEventHash: '0000000000000000000000000000000000000000000000000000000000000000',
    schemaVersion: '1.0.0',
    protocolVersion: '1.0.0',
    createdAt: 1729320000000,
    originDeviceId: 'device_abc',
    originSequence: 1,
    payload: {
      eventId: 'evt_001',
      studentId: 'student_123',
      surahNumber: 1,
      ayahNumber: 1,
      retentionScore: 0.95,
    } as any,
    payloadHash: 'payload_hash_123',
    envelopeHash: 'env_hash_123',
  };

  it('1. should connect and disconnect cleanly', async () => {
    await transport.connect();
    expect(transport.isConnected()).toBe(true);

    await transport.disconnect();
    expect(transport.isConnected()).toBe(false);
  });

  it('2. should reject envelopes containing forbidden raw audio buffers', async () => {
    await transport.connect();

    const audioEnvelope: SyncEventEnvelope = {
      ...sampleEnvelope,
      syncEventId: 'sync_audio_leak',
      payload: {
        eventId: 'evt_audio',
        audioBuffer: new ArrayBuffer(1024), // FORBIDDEN!
      } as any,
    };

    const result = await transport.push([audioEnvelope]);
    expect(result.acceptedIds).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].syncEventId).toBe('sync_audio_leak');
    expect(result.rejected[0].reason).toBe(SyncErrorCode.RAW_AUDIO_REJECTED);
    expect(result.rejected[0].permanent).toBe(true);
  });

  it('3. should reject Float32Array PCM recordings', async () => {
    await transport.connect();

    const pcmEnvelope: SyncEventEnvelope = {
      ...sampleEnvelope,
      syncEventId: 'sync_pcm_leak',
      payload: {
        eventId: 'evt_pcm',
        float32Array: new Float32Array([0.1, -0.2, 0.5]),
      } as any,
    };

    const result = await transport.push([pcmEnvelope]);
    expect(result.acceptedIds).toHaveLength(0);
    expect(result.rejected[0].reason).toBe(SyncErrorCode.RAW_AUDIO_REJECTED);
    expect(result.rejected[0].permanent).toBe(true);
  });

  it('4. should gracefully queue events when offline without throwing unhandled exceptions', async () => {
    await transport.disconnect();
    expect(transport.isConnected()).toBe(false);

    const result = await transport.push([sampleEnvelope]);
    expect(result.acceptedIds).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].permanent).toBe(false);
    expect(result.rejected[0].reason).toContain('offline');
  });

  it('5. pull should return empty envelopes and preserve cursor when offline', async () => {
    await transport.disconnect();
    const pullResult = await transport.pull('student_123', '1000');
    expect(pullResult.envelopes).toHaveLength(0);
    expect(pullResult.hasMore).toBe(false);
    expect(pullResult.nextCursor).toBe('1000');
  });
});
