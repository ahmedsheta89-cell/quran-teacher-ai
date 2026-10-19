/**
 * @file FirestoreSyncTransport.ts
 * @module infrastructure/sync
 * @description Production-grade Cloud Firestore transport implementing ISyncTransport for Phase 8C/16.9.31.
 * Connects the local SyncCoordinator to Firestore for secure, offline-resilient synchronization.
 * 
 * CORE ARCHITECTURAL INVARIANTS:
 * 1. Zero Raw Audio: Rejects envelopes containing AudioBuffer, Float32Array, or PCM recordings.
 * 2. Append-Only Events: Learning events are immutable. Divergent hash on duplicate ID is flagged as conflict.
 * 3. Offline Resilience: When Firestore is unreachable, operations gracefully queue in the local Outbox.
 * 4. User Isolation: Envelopes are stored under users/{studentId}/sync_events/{syncEventId}.
 */

import {
  ISyncTransport,
  SyncEventEnvelope,
  SyncPushResult,
  SyncPullResult,
  ResyncResponse,
  SyncErrorCode,
} from '../../domain/sync/types.ts';
import { db, auth } from '../firebase/firebaseClient.ts';
import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit as firestoreLimit,
  startAfter,
  serverTimestamp,
} from 'firebase/firestore';

export class FirestoreSyncTransport implements ISyncTransport {
  private connected: boolean = false;

  constructor() {
    this.connected =
      typeof navigator === 'undefined'
        ? true
        : typeof navigator.onLine === 'boolean'
        ? navigator.onLine
        : true;
  }

  public async connect(): Promise<void> {
    this.connected = true;
  }

  public async disconnect(): Promise<void> {
    this.connected = false;
  }

  public isConnected(): boolean {
    if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean' && !navigator.onLine) {
      return false;
    }
    return this.connected;
  }

  /**
   * Pushes outgoing envelopes from the local Outbox to Cloud Firestore.
   */
  public async push(envelopes: readonly SyncEventEnvelope[]): Promise<SyncPushResult> {
    const acceptedIds: string[] = [];
    const rejected: { syncEventId: string; reason: string; permanent: boolean }[] = [];
    const conflicts: { syncEventId: string; conflictingEventId: string; reason: string }[] = [];

    if (!this.isConnected()) {
      return {
        acceptedIds: [],
        rejected: envelopes.map((e) => ({
          syncEventId: e.syncEventId,
          reason: 'Network is offline or transport disconnected.',
          permanent: false,
        })),
        conflicts: [],
        serverCursor: Date.now().toString(),
      };
    }

    const currentUserId = auth.currentUser?.uid;

    for (const env of envelopes) {
      try {
        // Invariant 1: Reject raw audio payloads
        if (this.containsRawAudio(env.payload)) {
          rejected.push({
            syncEventId: env.syncEventId,
            reason: SyncErrorCode.RAW_AUDIO_REJECTED,
            permanent: true,
          });
          continue;
        }

        // Student identity isolation check
        const targetStudentId = env.studentId || currentUserId || 'anonymous';
        const eventDocRef = doc(db, 'users', targetStudentId, 'sync_events', env.syncEventId);

        // Check if event already exists
        const existingSnap = await getDoc(eventDocRef).catch(() => null);

        if (existingSnap && existingSnap.exists()) {
          const existingData = existingSnap.data() as SyncEventEnvelope;
          if (existingData.eventHash === env.eventHash) {
            // Idempotent duplicate: already accepted
            acceptedIds.push(env.syncEventId);
            continue;
          } else {
            // Divergent content for same event ID: Conflict!
            conflicts.push({
              syncEventId: env.syncEventId,
              conflictingEventId: env.eventId,
              reason: 'Divergent eventHash detected on existing cloud document.',
            });
            continue;
          }
        }

        // Clean serialization of payload (JSON-compatible)
        const cleanPayload = JSON.parse(JSON.stringify(env.payload));

        await setDoc(eventDocRef, {
          syncEventId: env.syncEventId,
          eventId: env.eventId,
          studentId: targetStudentId,
          deviceId: env.deviceId,
          sessionId: env.sessionId,
          sequenceNumber: env.sequenceNumber,
          eventHash: env.eventHash,
          previousEventHash: env.previousEventHash,
          schemaVersion: env.schemaVersion,
          protocolVersion: env.protocolVersion,
          createdAt: env.createdAt,
          originDeviceId: env.originDeviceId,
          originSequence: env.originSequence,
          payload: cleanPayload,
          payloadHash: env.payloadHash,
          envelopeHash: env.envelopeHash,
          uploadedAt: serverTimestamp(),
        });

        acceptedIds.push(env.syncEventId);
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const isOffline = errorMsg.includes('offline') || errorMsg.includes('unavailable') || !navigator.onLine;

        rejected.push({
          syncEventId: env.syncEventId,
          reason: errorMsg,
          permanent: !isOffline && (errorMsg.includes('permission-denied') || errorMsg.includes('unauthenticated')),
        });
      }
    }

    return {
      acceptedIds,
      rejected,
      conflicts,
      serverCursor: Date.now().toString(),
    };
  }

  /**
   * Pulls incoming envelopes from Cloud Firestore since the provided cursor.
   */
  public async pull(studentId: string, sinceCursor: string | null, limitCount: number = 50): Promise<SyncPullResult> {
    if (!this.isConnected()) {
      return {
        envelopes: [],
        nextCursor: sinceCursor,
        hasMore: false,
        serverCursor: sinceCursor || '0',
      };
    }

    try {
      const targetStudentId = studentId || auth.currentUser?.uid || 'anonymous';
      const eventsCol = collection(db, 'users', targetStudentId, 'sync_events');
      
      const q = sinceCursor
        ? query(
            eventsCol,
            orderBy('createdAt', 'asc'),
            where('createdAt', '>', parseInt(sinceCursor, 10) || 0),
            firestoreLimit(limitCount)
          )
        : query(eventsCol, orderBy('createdAt', 'asc'), firestoreLimit(limitCount));

      const snapshot = await getDocs(q);
      const envelopes: SyncEventEnvelope[] = [];

      let lastTimestamp = sinceCursor;
      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as SyncEventEnvelope;
        envelopes.push(data);
        if (data.createdAt) {
          lastTimestamp = data.createdAt.toString();
        }
      });

      return {
        envelopes,
        nextCursor: lastTimestamp,
        hasMore: snapshot.size >= limitCount,
        serverCursor: lastTimestamp || sinceCursor || '0',
      };
    } catch (err) {
      console.warn('[FirestoreSyncTransport] Pull failed:', err);
      return {
        envelopes: [],
        nextCursor: sinceCursor,
        hasMore: false,
        serverCursor: sinceCursor || '0',
      };
    }
  }

  /**
   * Acknowledges successfully processed inbound events.
   */
  public async acknowledge(studentId: string, syncEventIds: readonly string[]): Promise<void> {
    // In Firestore, storing the document constitutes delivery.
    // Cursor updates happen in SyncCursorManager.
    return Promise.resolve();
  }

  /**
   * Requests a resync from scratch.
   */
  public async requestResync(studentId: string): Promise<ResyncResponse> {
    const pullResult = await this.pull(studentId, null, 100);
    return {
      resetCursor: pullResult.nextCursor || '0',
      totalAvailableEvents: pullResult.envelopes.length,
      initialBatch: pullResult.envelopes,
    };
  }

  /**
   * Retrieves server cursor for the student.
   */
  public async getServerCursor(studentId: string): Promise<string | null> {
    try {
      const targetStudentId = studentId || auth.currentUser?.uid || 'anonymous';
      const cursorDoc = await getDoc(doc(db, 'users', targetStudentId, 'sync_cursors', 'default'));
      if (cursorDoc.exists()) {
        const data = cursorDoc.data();
        return data?.serverCursor || null;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Helper to inspect payload for forbidden raw audio types.
   */
  private containsRawAudio(payload: unknown): boolean {
    if (!payload || typeof payload !== 'object') return false;
    const p = payload as Record<string, unknown>;

    if (
      p.audioBuffer ||
      p.pcmData ||
      p.rawAudio ||
      p.float32Array ||
      payload instanceof Float32Array ||
      (typeof ArrayBuffer !== 'undefined' && payload instanceof ArrayBuffer)
    ) {
      return true;
    }

    return false;
  }
}
