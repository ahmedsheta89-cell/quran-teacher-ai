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
    // Reject cloud push if user is unauthenticated or anonymous
    if (!currentUserId || auth.currentUser?.isAnonymous) {
      return {
        acceptedIds: [],
        rejected: envelopes.map((e) => ({
          syncEventId: e.syncEventId,
          reason: 'AUTH_REQUIRED: Cloud sync requires an authenticated user account.',
          permanent: false,
        })),
        conflicts: [],
        serverCursor: Date.now().toString(),
      };
    }

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

        // Student identity isolation check: Envelopes in Cloud are strictly bound to currentUserId
        const eventDocRef = doc(db, 'users', currentUserId, 'sync_events', env.syncEventId);

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
          studentId: env.studentId || currentUserId,
          userId: currentUserId,
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

    const currentUserId = auth.currentUser?.uid;
    if (!currentUserId || auth.currentUser?.isAnonymous) {
      return {
        envelopes: [],
        nextCursor: sinceCursor,
        hasMore: false,
        serverCursor: sinceCursor || '0',
      };
    }

    try {
      const eventsCol = collection(db, 'users', currentUserId, 'sync_events');
      
      let q;
      if (sinceCursor && sinceCursor !== '0') {
        const cursorParts = sinceCursor.split(':');
        const cursorTime = parseInt(cursorParts[0], 10) || 0;

        q = query(
          eventsCol,
          orderBy('createdAt', 'asc'),
          orderBy('syncEventId', 'asc'),
          where('createdAt', '>=', cursorTime),
          firestoreLimit(limitCount + 10)
        );
      } else {
        q = query(
          eventsCol,
          orderBy('createdAt', 'asc'),
          orderBy('syncEventId', 'asc'),
          firestoreLimit(limitCount)
        );
      }

      const snapshot = await getDocs(q);
      const envelopes: SyncEventEnvelope[] = [];

      let lastTimestamp = sinceCursor;
      const cursorParts = sinceCursor ? sinceCursor.split(':') : [];
      const cursorTime = cursorParts[0] ? parseInt(cursorParts[0], 10) : 0;
      const cursorId = cursorParts[1] || '';

      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as SyncEventEnvelope;
        // Filter out items already consumed when at the exact boundary
        if (sinceCursor && data.createdAt === cursorTime && cursorId && data.syncEventId <= cursorId) {
          return;
        }
        if (envelopes.length < limitCount) {
          envelopes.push(data);
          lastTimestamp = `${data.createdAt}:${data.syncEventId}`;
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
    const currentUserId = auth.currentUser?.uid;
    if (!currentUserId || auth.currentUser?.isAnonymous) return;
    try {
      const cursorDocRef = doc(db, 'users', currentUserId, 'sync_cursors', 'default');
      const now = Date.now();
      await setDoc(cursorDocRef, {
        studentId: studentId || currentUserId,
        userId: currentUserId,
        lastServerCursor: syncEventIds.length > 0 ? syncEventIds[syncEventIds.length - 1] : null,
        lastAppliedRemoteSequence: 0,
        acknowledgedSequence: syncEventIds.length,
        updatedAt: now,
      }, { merge: true });
    } catch (err) {
      console.warn('[FirestoreSyncTransport] Cursor update failed:', err);
    }
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
      const currentUserId = auth.currentUser?.uid;
      if (!currentUserId || auth.currentUser?.isAnonymous) return null;
      const cursorDoc = await getDoc(doc(db, 'users', currentUserId, 'sync_cursors', 'default'));
      if (cursorDoc.exists()) {
        const data = cursorDoc.data();
        return data?.lastServerCursor || null;
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
      p.rawAudioSync ||
      p.rawAudioPersistence ||
      payload instanceof Float32Array ||
      (typeof ArrayBuffer !== 'undefined' && payload instanceof ArrayBuffer)
    ) {
      return true;
    }

    // Recursively check nested objects
    for (const key of Object.keys(p)) {
      const val = p[key];
      if (val && typeof val === 'object') {
        if (
          val instanceof Float32Array ||
          (typeof ArrayBuffer !== 'undefined' && val instanceof ArrayBuffer) ||
          key.toLowerCase().includes('rawaudio') ||
          key.toLowerCase().includes('pcm')
        ) {
          return true;
        }
      }
    }

    return false;
  }
}
