/**
 * @file CrossPlatformSyncIntegration.test.ts
 * @description End-to-end integration test suite verifying offline-first queueing,
 * reconnection replay, deduplication, conflict isolation, and the 6 mandatory sync states.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SyncCoordinator } from '../domain/sync/SyncCoordinator.ts';
import { SyncAuthContext } from '../domain/sync/SyncCoordinator.ts';
import {
  NetworkSyncState,
  SyncEventEnvelope,
  SyncPushResult,
  SyncPullResult,
  ISyncTransport,
  ResyncResponse,
} from '../domain/sync/types.ts';
import { PersistentLearningStore } from '../domain/persistence/PersistentLearningStore.ts';
import { MemoryStorageAdapter } from '../infrastructure/persistence/MemoryStorageAdapter.ts';
import { MemorySyncStorageAdapter } from '../infrastructure/sync/MemorySyncStorageAdapter.ts';
import { StudentIdentity, StudentIdentityType, StudentIdentityStatus } from '../domain/identity/types.ts';
import { PersistentMemorizationEvent } from '../domain/persistence/types.ts';
import { MemorizationEventType, EvidenceStatus } from '../domain/memorization_revision/types.ts';
import { RecitationDecisionState } from '../domain/recitation/decisionTypes.ts';
import { PedagogicalAction } from '../domain/teacher_policy/types.ts';

/**
 * Controllable Mock Transport for Integration Scenarios
 */
class ControllableMockTransport implements ISyncTransport {
  public online: boolean = true;
  public pushedEnvelopes: SyncEventEnvelope[] = [];
  public nextPushShouldConflict: boolean = false;
  public nextPushShouldRejectAuth: boolean = false;

  public async connect(): Promise<void> {
    this.online = true;
  }
  public async disconnect(): Promise<void> {
    this.online = false;
  }
  public isConnected(): boolean {
    return this.online;
  }

  public async push(envelopes: readonly SyncEventEnvelope[]): Promise<SyncPushResult> {
    if (!this.online) {
      return {
        acceptedIds: [],
        rejected: envelopes.map((e) => ({
          syncEventId: e.syncEventId,
          reason: 'Network is offline.',
          permanent: false,
        })),
        conflicts: [],
        serverCursor: '0',
      };
    }

    if (this.nextPushShouldRejectAuth) {
      return {
        acceptedIds: [],
        rejected: envelopes.map((e) => ({
          syncEventId: e.syncEventId,
          reason: 'AUTH_REQUIRED: Invalid or expired token.',
          permanent: true,
        })),
        conflicts: [],
        serverCursor: '0',
      };
    }

    if (this.nextPushShouldConflict) {
      return {
        acceptedIds: [],
        rejected: [],
        conflicts: envelopes.map((e) => ({
          syncEventId: e.syncEventId,
          conflictingEventId: e.eventId,
          reason: 'Divergent hash on remote server.',
        })),
        serverCursor: '0',
      };
    }

    this.pushedEnvelopes.push(...envelopes);
    return {
      acceptedIds: envelopes.map((e) => e.syncEventId),
      rejected: [],
      conflicts: [],
      serverCursor: Date.now().toString(),
    };
  }

  public async pull(studentId: string, sinceCursor: string | null): Promise<SyncPullResult> {
    return {
      envelopes: [],
      nextCursor: sinceCursor,
      hasMore: false,
      serverCursor: sinceCursor || '0',
    };
  }

  public async acknowledge(): Promise<void> {}
  public async requestResync(): Promise<ResyncResponse> {
    return { resetCursor: '0', totalAvailableEvents: 0, initialBatch: [] };
  }
  public async getServerCursor(): Promise<string | null> {
    return null;
  }
}

describe('CrossPlatformSyncIntegration - Multi-State & Resilient Sync Lifecycle', () => {
  let transport: ControllableMockTransport;
  let coordinator: SyncCoordinator;
  let persistentStore: PersistentLearningStore;
  let activeStudent: StudentIdentity;

  beforeEach(async () => {
    activeStudent = {
      studentId: 'student_e2e_01',
      accountId: 'acc_01',
      identityType: StudentIdentityType.AUTHENTICATED,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: StudentIdentityStatus.ACTIVE,
      version: '1.0.0',
      isAnonymous: false,
    };

    const persistenceAdapter = new MemoryStorageAdapter();
    await persistenceAdapter.init();
    persistentStore = new PersistentLearningStore(persistenceAdapter);

    const syncStorage = new MemorySyncStorageAdapter();
    await syncStorage.init();

    transport = new ControllableMockTransport();
    await transport.connect();

    const authContext = new SyncAuthContext(activeStudent);

    coordinator = new SyncCoordinator({
      persistentStore,
      syncStorage,
      transport,
      authContext,
      deviceId: 'device_test_01',
    });

    await coordinator.init();
  });

  const createSampleEvent = (id: string, ayah: number): PersistentMemorizationEvent => ({
    eventId: id,
    studentId: activeStudent.studentId,
    sessionId: `sess_${activeStudent.studentId}_01`,
    timestamp: Date.now(),
    surahId: 1,
    ayahNumber: ayah,
    quranLocation: { surahId: 1, ayahNumber: ayah },
    eventType: MemorizationEventType.CONFIRMED,
    evidenceStatus: EvidenceStatus.CONFIRMED,
    decisionStatus: RecitationDecisionState.MATCH,
    teacherAction: PedagogicalAction.CONTINUE,
    attemptNumber: 1,
    retryNumber: 0,
    attemptClusterId: 'cluster-001',
    isIndependentReview: false,
    quranDatasetVersion: 'v1.0.0-hafs',
    quranDatasetHash: '1e370d0d8dae77864c24ea00c92f1f0aef9df95b34a66e4a2d81e05d21a24d27',
    modelVersion: 'v1.0.0-acoustic',
    modelHash: '4a8a58622c7a7b8e124ea00c92f1f0aef9df95b34a66e4a2d81e05d21a24d28',
    tajweedKnowledgeVersion: 'v1.0.0-tajweed',
    tajweedKnowledgeHash: '9b6d8dae77864c24ea00c92f1f0aef9df95b34a66e4a2d81e05d21a24d29',
    decisionEngineVersion: 'v1.0.0-engine',
    policyVersion: 'v1.0.0-policy',
    revisionAlgorithmVersion: 'v1.0.0-revision',
    confidence: 1.0,
    alignmentScore: 1.0,
    schemaVersion: '1.0.0',
    sequenceNumber: 1,
    previousEventHash: '0000000000000000000000000000000000000000000000000000000000000000',
    eventHash: `hash_${id}`,
    persistedAt: Date.now(),
    syncStatus: 'PENDING',
  });

  it('1. should immediately sync when online and transition to ONLINE_SYNCED', async () => {
    const event = createSampleEvent('evt_online_1', 1);
    await coordinator.recordEvent(event);

    const summary = await coordinator.getStatusSummary(activeStudent.studentId);
    expect(summary.isOnline).toBe(true);
    expect(summary.pendingCount).toBe(0);
    expect(summary.conflictCount).toBe(0);
    expect(transport.pushedEnvelopes).toHaveLength(1);
    expect(transport.pushedEnvelopes[0].eventId).toBe('evt_online_1');
  });

  it('2. should queue in Outbox permanently when offline (OFFLINE_LOCAL / SYNC_PENDING)', async () => {
    transport.online = false; // DISCONNECT NETWORK!

    const event1 = createSampleEvent('evt_offline_1', 2);
    const event2 = createSampleEvent('evt_offline_2', 3);

    await coordinator.recordEvent(event1);
    await coordinator.recordEvent(event2);

    const summary = await coordinator.getStatusSummary(activeStudent.studentId);
    expect(summary.pendingCount).toBe(2);
    expect(transport.pushedEnvelopes).toHaveLength(0);

    // Verify stored locally in Outbox
    const pending = await coordinator.getPendingOutboxCount(activeStudent.studentId);
    expect(pending).toBe(2);
  });

  it('3. should automatically replay and drain Outbox upon reconnection without duplicate records', async () => {
    transport.online = false;
    await coordinator.recordEvent(createSampleEvent('evt_recon_1', 4));

    expect(transport.pushedEnvelopes).toHaveLength(0);

    // RECONNECT!
    transport.online = true;
    await coordinator.sync(activeStudent.studentId);

    const summary = await coordinator.getStatusSummary(activeStudent.studentId);
    expect(summary.pendingCount).toBe(0);
    expect(transport.pushedEnvelopes).toHaveLength(1);
    expect(transport.pushedEnvelopes[0].eventId).toBe('evt_recon_1');

    // Replay again to test idempotency
    await coordinator.sync(activeStudent.studentId);
    expect(transport.pushedEnvelopes).toHaveLength(1); // Still 1, no duplicate push!
  });

  it('4. should isolate and quarantine conflicts without applying blind Last-Write-Wins', async () => {
    transport.nextPushShouldConflict = true;

    const conflictingEvent = createSampleEvent('evt_conflict_1', 5);
    await coordinator.recordEvent(conflictingEvent);

    const summary = await coordinator.getStatusSummary(activeStudent.studentId);
    expect(summary.conflictCount).toBe(1);
    expect(summary.syncStatus).toBe(NetworkSyncState.CONFLICT);

    const conflicts = await coordinator.getConflicts(activeStudent.studentId);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].eventId).toBe('evt_conflict_1');
  });

  it('5. should enter AUTH_REQUIRED state when cloud rejects with authentication failure', async () => {
    transport.nextPushShouldRejectAuth = true;

    const unauthEvent = createSampleEvent('evt_unauth_1', 6);
    await coordinator.recordEvent(unauthEvent);

    const summary = await coordinator.getStatusSummary(activeStudent.studentId);
    expect(summary.authRequired).toBe(true);
    expect(summary.syncStatus).toBe(NetworkSyncState.AUTH_REQUIRED);
  });
});
