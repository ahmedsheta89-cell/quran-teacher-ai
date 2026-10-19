/**
 * @file SyncCoordinator.ts
 * @module domain/sync
 * @description Master Offline-First Sync Coordinator for Phase 8C.
 * 
 * CORE RESPONSIBILITIES (Section 34):
 * 1. Read Outbox -> Validate ownership -> Send pending events via ISyncTransport -> Process ACKs.
 * 2. Pull remote events -> Deduplicate via Inbox -> Cryptographic validation -> Persist to IPersistentLearningStore.
 * 3. Transactional synchronization: Event persistence + Inbox deduplication + Cursor advancement.
 * 4. Conflict Quarantine: Conflicting immutable records are quarantined without crashing local operations.
 * 5. Offline Queue: Uninterrupted local learning when network is offline; automatically queues to outbox.
 * 6. Provider-Neutral: Communicates strictly through ISyncTransport.
 * 7. Identity & Auth Boundaries: Integrates with Phase 8A; blocks unauthorized cross-student synchronization.
 * 8. Zero Raw Audio Invariant: Strictly rejects any raw audio buffers or mic captures.
 * 9. Non-AI Conflict Resolution: No LLM/Gemini intervention in sync, conflict resolution, or history.
 */

import { IPersistentLearningStore, PersistentMemorizationEvent } from '../persistence/types.ts';
import { AuthenticationGuard } from '../identity/AuthenticationGuard.ts';
import { StudentCapability, StudentIdentity } from '../identity/types.ts';
import {
  ISyncStorageAdapter,
  ISyncTransport,
  NetworkSyncState,
  OutboxStatus,
  SyncConflictRecord,
  SyncEventEnvelope,
  SyncStatusSummary,
  ConflictStatus,
} from './types.ts';
import { OutboxManager } from './OutboxManager.ts';
import { InboxManager } from './InboxManager.ts';
import { SyncCursorManager } from './SyncCursorManager.ts';
import { SyncEnvelopeSerializer } from './SyncEnvelopeSerializer.ts';
import {
  AuthRequiredError,
  SyncOwnershipMismatchError,
  TransportFailureError,
} from './errorRegistry.ts';

export interface ISyncAuthContext {
  assertCanAccessStudent(studentId: string): void;
  getCurrentIdentity?(): StudentIdentity | null;
}

export class SyncAuthContext implements ISyncAuthContext {
  private identity: StudentIdentity | null;

  constructor(identity: StudentIdentity | null) {
    this.identity = identity;
  }

  public setIdentity(identity: StudentIdentity | null): void {
    this.identity = identity;
  }

  public getCurrentIdentity(): StudentIdentity | null {
    return this.identity;
  }

  public assertCanAccessStudent(studentId: string): void {
    AuthenticationGuard.assertAuthorizedOwnership(
      this.identity,
      StudentCapability.WRITE_OWN_PROGRESS,
      studentId,
      'STUDENT_SYNC'
    );
  }
}

export interface SyncCoordinatorOptions {
  readonly persistentStore: IPersistentLearningStore;
  readonly syncStorage: ISyncStorageAdapter;
  readonly transport: ISyncTransport;
  readonly authGuard?: ISyncAuthContext | any;
  readonly authContext?: ISyncAuthContext;
  readonly deviceId: string;
  readonly batchSize?: number;
  readonly maxRetries?: number;
  readonly onStatusChange?: (status: SyncStatusSummary) => void;
}

export class SyncCoordinator {
  private readonly store: IPersistentLearningStore;
  private readonly syncStorage: ISyncStorageAdapter;
  private readonly transport: ISyncTransport;
  private readonly authContext: ISyncAuthContext;
  private readonly deviceId: string;
  private readonly batchSize: number;
  private readonly maxRetries: number;
  private readonly onStatusChange?: (status: SyncStatusSummary) => void;

  private readonly outboxManager: OutboxManager;
  private readonly inboxManager: InboxManager;
  private readonly cursorManager: SyncCursorManager;

  private state: NetworkSyncState = NetworkSyncState.OFFLINE;
  private lastSuccessfulSync: number | null = null;
  private isSyncing: boolean = false;

  constructor(options: SyncCoordinatorOptions) {
    this.store = options.persistentStore;
    this.syncStorage = options.syncStorage;
    this.transport = options.transport;
    this.deviceId = options.deviceId;
    this.batchSize = options.batchSize || 50;
    this.maxRetries = options.maxRetries || 5;
    this.onStatusChange = options.onStatusChange;

    const rawAuth = options.authContext || options.authGuard;
    if (rawAuth && typeof rawAuth.assertCanAccessStudent === 'function') {
      this.authContext = rawAuth;
    } else {
      this.authContext = new SyncAuthContext(null);
    }

    this.outboxManager = new OutboxManager(this.syncStorage);
    this.inboxManager = new InboxManager(this.syncStorage);
    this.cursorManager = new SyncCursorManager(this.syncStorage);

    // Initial state reflection
    if (this.transport.isConnected()) {
      this.state = NetworkSyncState.ONLINE;
    }
  }

  public async init(): Promise<void> {
    await this.syncStorage.init();
    if (this.transport.isConnected()) {
      this.state = NetworkSyncState.ONLINE;
    } else {
      this.state = NetworkSyncState.OFFLINE;
    }
    this.notifyStatusChange();
  }

  public getOutboxManager(): OutboxManager {
    return this.outboxManager;
  }

  public getInboxManager(): InboxManager {
    return this.inboxManager;
  }

  public getCursorManager(): SyncCursorManager {
    return this.cursorManager;
  }

  public getState(): NetworkSyncState {
    return this.state;
  }

  public getLastSuccessfulSync(): number | null {
    return this.lastSuccessfulSync;
  }

  /**
   * Section 44: Minimal UI/Diagnostic status summary.
   */
  public async getStatusSummary(studentId: string): Promise<SyncStatusSummary> {
    const pendingCount = await this.outboxManager.getOutboxCount(studentId, OutboxStatus.PENDING);
    const inFlightCount = await this.outboxManager.getOutboxCount(studentId, OutboxStatus.IN_FLIGHT);
    const conflicts = await this.inboxManager.getConflicts(studentId, ConflictStatus.OPEN);

    let authReq = false;
    try {
      this.authContext.assertCanAccessStudent(studentId);
    } catch {
      authReq = true;
    }

    if (this.state === NetworkSyncState.AUTH_REQUIRED) {
      authReq = true;
    }

    return {
      syncStatus: this.state,
      pendingCount,
      inFlightCount,
      lastSuccessfulSync: this.lastSuccessfulSync,
      conflictCount: conflicts.length,
      authRequired: authReq,
      isOnline: this.transport.isConnected(),
      deviceId: this.deviceId,
    };
  }

  private notifyStatusChange(summary?: SyncStatusSummary): void {
    if (this.onStatusChange && summary) {
      this.onStatusChange(summary);
    }
  }

  /**
   * Section 20 & 21: Record a locally generated learning event.
   * If online and authenticated, attempts sync; if offline, enqueues safely into Outbox.
   */
  public async recordEvent(event: PersistentMemorizationEvent): Promise<void> {
    // 1. Verify caller has ownership over the event's studentId
    this.authContext.assertCanAccessStudent(event.studentId);

    // 2. Section 29: Invariant check - Zero raw audio
    SyncEnvelopeSerializer.assertNoAudioSync(event, 'SyncCoordinator.recordEvent');

    // 3. Queue into durable Outbox
    await this.outboxManager.enqueueEvent(event, this.deviceId);

    // 4. If connected, attempt eager flush
    if (this.transport.isConnected()) {
      try {
        await this.sync(event.studentId);
      } catch (err) {
        // Safe offline tolerance: error in sync flush does not abort local persistence
        console.warn('[SyncCoordinator] Eager sync attempt failed, queued in outbox:', err);
      }
    } else {
      this.state = NetworkSyncState.OFFLINE;
    }
  }

  /**
   * Section 34: Execute full bidirectional synchronization cycle for a student.
   */
  public async sync(studentId: string): Promise<{ pushed: number; pulled: number; conflicts: number }> {
    if (this.isSyncing) {
      return { pushed: 0, pulled: 0, conflicts: 0 };
    }

    // 1. Identity & Auth Check (Section 24)
    try {
      this.authContext.assertCanAccessStudent(studentId);
    } catch (err) {
      this.state = NetworkSyncState.AUTH_REQUIRED;
      throw new AuthRequiredError(studentId, (err as Error).message);
    }

    // 2. Connectivity Check (Section 21)
    if (!this.transport.isConnected()) {
      this.state = NetworkSyncState.OFFLINE;
      throw new TransportFailureError('Transport is disconnected. Synchronization deferred.');
    }

    this.isSyncing = true;
    this.state = NetworkSyncState.SYNCING;

    let pushedCount = 0;
    let pulledCount = 0;
    let conflictCount = 0;

    try {
      // 3. Push Outbox Events
      const pushResult = await this.pushOutbox(studentId);
      pushedCount = pushResult.pushed;
      conflictCount += pushResult.conflicts;

      // 4. Pull Inbound Events
      const pullResult = await this.pullInbound(studentId);
      pulledCount = pullResult.pulled;
      conflictCount += pullResult.conflicts;

      this.lastSuccessfulSync = Date.now();
      if (pushResult.authRequired) {
        this.state = NetworkSyncState.AUTH_REQUIRED;
      } else if (conflictCount > 0) {
        this.state = NetworkSyncState.CONFLICT;
      } else {
        this.state = NetworkSyncState.ONLINE;
      }

      const summary = await this.getStatusSummary(studentId);
      this.notifyStatusChange(summary);

      return { pushed: pushedCount, pulled: pulledCount, conflicts: conflictCount };
    } catch (error) {
      if (error instanceof TransportFailureError) {
        this.state = NetworkSyncState.OFFLINE;
        // Revert any in-flight outbox items back to PENDING so they can retry
        await this.outboxManager.revertInFlightToPending(studentId);
      } else {
        this.state = NetworkSyncState.DEGRADED;
      }
      throw error;
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Sub-routine: Push pending Outbox items to ISyncTransport.
   */
  private async pushOutbox(studentId: string): Promise<{ pushed: number; conflicts: number; authRequired: boolean }> {
    let totalPushed = 0;
    let totalConflicts = 0;
    let authRequired = false;

    while (true) {
      const pending = await this.outboxManager.getPendingBatch(studentId, this.batchSize);
      if (pending.length === 0) {
        break;
      }

      const outboxIds = pending.map((p) => p.outboxId);
      await this.outboxManager.markInFlight(outboxIds);

      const envelopes = pending.map((p) => p.envelope);

      try {
        const result = await this.transport.push(envelopes);

        // 1. Process accepted envelopes
        if (result.acceptedIds.length > 0) {
          const acceptedOutboxIds = pending
            .filter((p) => result.acceptedIds.includes(p.envelope.syncEventId))
            .map((p) => p.outboxId);

          await this.outboxManager.markAcknowledged(acceptedOutboxIds);

          // Advance cursor acknowledged sequence
          const maxSeq = Math.max(
            0,
            ...pending
              .filter((p) => acceptedOutboxIds.includes(p.outboxId))
              .map((p) => p.envelope.sequenceNumber)
          );
          if (maxSeq > 0) {
            await this.cursorManager.advanceAcknowledgedSequence(studentId, maxSeq);
          }
        }

        // 2. Process rejections
        for (const rej of result.rejected) {
          if (
            rej.reason.includes('AUTH_REQUIRED') ||
            rej.reason.includes('Invalid or expired token') ||
            rej.reason.includes('Unauthorized') ||
            rej.reason.includes('Unauthenticated')
          ) {
            authRequired = true;
          }
          const matching = pending.find((p) => p.envelope.syncEventId === rej.syncEventId);
          if (matching) {
            await this.outboxManager.markRejected(matching.outboxId, rej.reason, rej.permanent);
          }
        }

        // 3. Process remote conflicts
        for (const conf of result.conflicts) {
          totalConflicts++;
          const matching = pending.find((p) => p.envelope.syncEventId === conf.syncEventId);
          if (matching) {
            await this.inboxManager.quarantineConflict({
              studentId,
              eventId: matching.eventId,
              localHash: matching.payloadHash,
              remoteHash: 'REMOTE_CONFLICT',
              reason: conf.reason,
              localEnvelope: matching.envelope,
            });
            await this.outboxManager.markRejected(matching.outboxId, conf.reason, true);
          }
        }

        totalPushed += result.acceptedIds.length;

        if (result.rejected.length > 0 || result.conflicts.length > 0 || result.acceptedIds.length === 0) {
          break;
        }
      } catch (err) {
        // Revert in-flight back to pending for retry
        await this.outboxManager.revertInFlightToPending(studentId);
        throw err;
      }
    }

    return { pushed: totalPushed, conflicts: totalConflicts, authRequired };
  }

  /**
   * Sub-routine: Pull inbound items from ISyncTransport and apply to local store.
   */
  private async pullInbound(studentId: string): Promise<{ pulled: number; conflicts: number }> {
    const cursor = await this.cursorManager.getCursor(studentId);
    const pullResult = await this.transport.pull(studentId, cursor.lastServerCursor, this.batchSize);

    if (pullResult.envelopes.length === 0) {
      return { pulled: 0, conflicts: 0 };
    }

    // Sort incoming envelopes deterministically (Section 13)
    const sortedEnvelopes = [...pullResult.envelopes].sort(SyncEnvelopeSerializer.compareSyncEnvelopes);

    let appliedCount = 0;
    let conflictCount = 0;
    let maxRemoteSeq = cursor.lastAppliedRemoteSequence;

    for (const env of sortedEnvelopes) {
      // Security Validation (Section 27)
      if (env.studentId !== studentId) {
        throw new SyncOwnershipMismatchError(env.studentId, studentId);
      }

      // Validate envelope cryptographic binding
      SyncEnvelopeSerializer.validateEnvelope(env);

      // Inbound Deduplication Check (Section 9 & 14)
      const dedupCheck = await this.inboxManager.checkInboundEvent(studentId, env.eventId, env.eventHash);

      if (dedupCheck.status === 'IDENTICAL_DUPLICATE') {
        // Already safely processed: skip idempotently
        continue;
      }

      if (dedupCheck.status === 'CONFLICTING_DUPLICATE') {
        // Section 14: Immutable event conflict! Quarantine.
        await this.inboxManager.quarantineConflict({
          studentId,
          eventId: env.eventId,
          localHash: dedupCheck.existingRecord?.eventHash || 'UNKNOWN',
          remoteHash: env.eventHash,
          reason: `Immutable conflict detected: eventId '${env.eventId}' already exists with divergent hash.`,
          remoteEnvelope: env,
        });
        conflictCount++;
        continue;
      }

      // Check if local persistent store already has this event
      const localEvents = await this.store.getEventsByStudent(studentId);
      const existingLocal = localEvents.find((e: PersistentMemorizationEvent) => e.eventId === env.eventId);

      if (existingLocal) {
        if (existingLocal.eventHash !== env.eventHash) {
          // Local store conflict!
          await this.inboxManager.quarantineConflict({
            studentId,
            eventId: env.eventId,
            localHash: existingLocal.eventHash,
            remoteHash: env.eventHash,
            reason: `Local store conflict: event '${env.eventId}' has different hash in store.`,
            remoteEnvelope: env,
          });
          conflictCount++;
          continue;
        } else {
          // Existing event with identical hash - mark processed in inbox
          await this.inboxManager.markProcessed({
            syncEventId: env.syncEventId,
            eventId: env.eventId,
            studentId: env.studentId,
            originDeviceId: env.originDeviceId,
            eventHash: env.eventHash,
          });
          continue;
        }
      }

      // Section 35: Transactional application to local store
      const eventToPersist: PersistentMemorizationEvent = {
        ...env.payload,
        syncStatus: 'SYNCED',
      };

      // Append to local append-only store
      await this.store.appendEvent(eventToPersist);

      // Mark processed in Inbox
      await this.inboxManager.markProcessed({
        syncEventId: env.syncEventId,
        eventId: env.eventId,
        studentId: env.studentId,
        originDeviceId: env.originDeviceId,
        eventHash: env.eventHash,
      });

      maxRemoteSeq = Math.max(maxRemoteSeq, env.sequenceNumber);
      appliedCount++;
    }

    // Acknowledge receipt of pulled events
    const processedIds = sortedEnvelopes.map((e) => e.syncEventId);
    await this.transport.acknowledge(studentId, processedIds);

    // Section 10 & 35: Advance remote cursor transactionally after events are safely persisted
    if (pullResult.nextCursor || pullResult.serverCursor) {
      await this.cursorManager.advanceRemoteCursor({
        studentId,
        serverCursor: pullResult.nextCursor || pullResult.serverCursor,
        appliedRemoteSequence: maxRemoteSeq,
      });
    }

    return { pulled: appliedCount, conflicts: conflictCount };
  }

  /**
   * Section 37: Deterministic Resync workflow.
   */
  public async resync(studentId: string): Promise<{ applied: number; conflicts: number }> {
    this.authContext.assertCanAccessStudent(studentId);

    // Reset cursor to 0
    await this.cursorManager.resetCursor(studentId, '0');

    // Run sync cycle from genesis
    const res = await this.sync(studentId);
    return { applied: res.pulled, conflicts: res.conflicts };
  }

  /**
   * Section 26: Preserves identity migration from anonymous -> authenticated.
   */
  public async handleIdentityMigration(sourceStudentId: string, targetStudentId: string): Promise<void> {
    // 1. Rekey pending outbox records
    await this.outboxManager.rekeyStudent(sourceStudentId, targetStudentId);

    // 2. Clear anonymous cursor & inbox
    await this.cursorManager.deleteCursor(sourceStudentId);
    await this.inboxManager.clearInbox(sourceStudentId);
  }

  /**
   * Helper: Get pending outbox count for a student.
   */
  public async getPendingOutboxCount(studentId: string): Promise<number> {
    return this.outboxManager.getOutboxCount(studentId, OutboxStatus.PENDING);
  }

  /**
   * Section 38: List quarantined conflicts.
   */
  public async getConflicts(studentId: string): Promise<SyncConflictRecord[]> {
    return this.inboxManager.getConflicts(studentId);
  }

  /**
   * Section 38: Manually resolves a quarantined conflict without AI/LLM intervention.
   */
  public async resolveConflict(
    conflictId: string,
    choice: 'LOCAL_WINS' | 'REMOTE_WINS' | 'MANUAL_SPLIT',
    notes?: string
  ): Promise<void> {
    await this.inboxManager.resolveConflict(conflictId, choice, notes);
  }

  /**
   * Section 39: Data export extension including sync metadata.
   */
  public async exportSyncMetadata(studentId: string): Promise<Record<string, unknown>> {
    const cursor = await this.cursorManager.getCursor(studentId);
    const outbox = await this.outboxManager.getPendingBatch(studentId, 1000);
    const conflicts = await this.inboxManager.getConflicts(studentId);

    return {
      deviceId: this.deviceId,
      cursor,
      outboxCount: outbox.length,
      conflictCount: conflicts.length,
      conflicts,
      exportedAt: Date.now(),
    };
  }
}
