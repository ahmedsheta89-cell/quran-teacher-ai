/**
 * @file SyncContext.tsx
 * @module context
 * @description React Context and Provider for Phase 8C Offline-First Synchronization.
 * Connects the SyncCoordinator to UI components and manages live status updates.
 */

import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react';
import { SyncCoordinator, SyncAuthContext } from '../domain/sync/SyncCoordinator.ts';
import { NetworkSyncState, SyncStatusSummary, SyncConflictRecord } from '../domain/sync/types.ts';
import { PersistentLearningStore } from '../domain/persistence/PersistentLearningStore.ts';
import { IndexedDBStorageAdapter } from '../infrastructure/persistence/IndexedDBStorageAdapter.ts';
import { MemoryStorageAdapter } from '../infrastructure/persistence/MemoryStorageAdapter.ts';
import { IndexedDBSyncStorageAdapter } from '../infrastructure/sync/IndexedDBSyncStorageAdapter.ts';
import { MemorySyncStorageAdapter } from '../infrastructure/sync/MemorySyncStorageAdapter.ts';
import { InMemorySyncTransport } from '../infrastructure/sync/InMemorySyncTransport.ts';
import { FirestoreSyncTransport } from '../infrastructure/sync/FirestoreSyncTransport.ts';
import { ISyncTransport } from '../domain/sync/types.ts';
import { StudentIdentity, StudentIdentityType, StudentIdentityStatus } from '../domain/identity/types.ts';
import { PersistentMemorizationEvent } from '../domain/persistence/types.ts';

interface SyncContextValue {
  coordinator: SyncCoordinator | null;
  persistentStore: PersistentLearningStore | null;
  summary: SyncStatusSummary;
  isReady: boolean;
  activeStudent: StudentIdentity;
  conflicts: SyncConflictRecord[];
  syncNow: () => Promise<void>;
  recordEvent: (event: PersistentMemorizationEvent) => Promise<void>;
  resolveConflict: (conflictId: string, choice: 'LOCAL_WINS' | 'REMOTE_WINS' | 'MANUAL_SPLIT', notes?: string) => Promise<void>;
  setStudent: (student: StudentIdentity) => void;
}

const DEFAULT_SUMMARY: SyncStatusSummary = {
  syncStatus: NetworkSyncState.ONLINE,
  pendingCount: 0,
  inFlightCount: 0,
  lastSuccessfulSync: null,
  conflictCount: 0,
  authRequired: false,
  isOnline: true,
  deviceId: 'web_client_default',
};

const DEFAULT_ANONYMOUS_STUDENT: StudentIdentity = {
  studentId: 'student_anon_default_01',
  accountId: 'acc_anon_01',
  identityType: StudentIdentityType.ANONYMOUS_LOCAL,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  status: StudentIdentityStatus.ACTIVE,
  version: '1.0.0',
  isAnonymous: true,
};

const SyncContext = createContext<SyncContextValue | null>(null);

export const SyncProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeStudent, setActiveStudent] = useState<StudentIdentity>(DEFAULT_ANONYMOUS_STUDENT);
  const [coordinator, setCoordinator] = useState<SyncCoordinator | null>(null);
  const [persistentStore, setPersistentStore] = useState<PersistentLearningStore | null>(null);
  const [summary, setSummary] = useState<SyncStatusSummary>(DEFAULT_SUMMARY);
  const [conflicts, setConflicts] = useState<SyncConflictRecord[]>([]);
  const [isReady, setIsReady] = useState<boolean>(false);

  // Initialize store and sync coordinator
  useEffect(() => {
    let isCancelled = false;

    async function init() {
      try {
        const hasIndexedDB = typeof globalThis !== 'undefined' && 'indexedDB' in globalThis;
        
        // 1. Persistence store (Phase 8B)
        const persistenceAdapter = hasIndexedDB
          ? new IndexedDBStorageAdapter()
          : new MemoryStorageAdapter();
        await persistenceAdapter.init();
        const pStore = new PersistentLearningStore(persistenceAdapter);

        // 2. Sync storage adapter (Phase 8C)
        const syncStorage = hasIndexedDB
          ? new IndexedDBSyncStorageAdapter()
          : new MemorySyncStorageAdapter();
        await syncStorage.init();

        // 3. Sync transport: Real Firestore sync with graceful fallback
        let transport: ISyncTransport;
        try {
          transport = new FirestoreSyncTransport();
          await transport.connect();
        } catch {
          transport = new InMemorySyncTransport();
          await transport.connect();
        }

        // 4. Device ID
        let deviceId = 'web_client_dev_01';
        try {
          const stored = localStorage.getItem('quran_teacher_device_id');
          if (stored) {
            deviceId = stored;
          } else {
            deviceId = `dev_${Math.random().toString(36).substring(2, 11)}`;
            localStorage.setItem('quran_teacher_device_id', deviceId);
          }
        } catch {
          // localStorage unavailable
        }

        // 5. Auth Context
        const authCtx = new SyncAuthContext(activeStudent);

        // 6. Sync Coordinator
        const coord = new SyncCoordinator({
          persistentStore: pStore,
          syncStorage,
          transport,
          authContext: authCtx,
          deviceId,
          onStatusChange: (newSummary) => {
            if (!isCancelled) {
              setSummary(newSummary);
            }
          },
        });

        await coord.init();

        if (!isCancelled) {
          setPersistentStore(pStore);
          setCoordinator(coord);
          setIsReady(true);
          const currentSummary = await coord.getStatusSummary(activeStudent.studentId);
          setSummary(currentSummary);
          const currentConflicts = await coord.getConflicts(activeStudent.studentId);
          setConflicts(currentConflicts);
        }
      } catch (err) {
        console.error('Failed to initialize SyncCoordinator:', err);
      }
    }

    init();

    return () => {
      isCancelled = true;
    };
  }, []);

  // Refresh conflicts and summary
  const refreshStatus = useCallback(async () => {
    if (!coordinator) return;
    try {
      const s = await coordinator.getStatusSummary(activeStudent.studentId);
      setSummary(s);
      const c = await coordinator.getConflicts(activeStudent.studentId);
      setConflicts(c);
    } catch (err) {
      console.error('Error refreshing sync status:', err);
    }
  }, [coordinator, activeStudent.studentId]);

  // Automatic reconnection sync
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = () => {
      setSummary((prev) => ({ ...prev, isOnline: true }));
      if (coordinator) {
        coordinator.sync(activeStudent.studentId).then(refreshStatus).catch(() => {});
      }
    };

    const handleOffline = () => {
      setSummary((prev) => ({
        ...prev,
        isOnline: false,
        syncStatus: NetworkSyncState.OFFLINE,
      }));
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [coordinator, activeStudent.studentId, refreshStatus]);

  const syncNow = useCallback(async () => {
    if (!coordinator) return;
    try {
      await coordinator.sync(activeStudent.studentId);
      await refreshStatus();
    } catch (err) {
      console.error('Manual sync failed:', err);
      await refreshStatus();
    }
  }, [coordinator, activeStudent.studentId, refreshStatus]);

  const recordEvent = useCallback(
    async (event: PersistentMemorizationEvent) => {
      if (!coordinator) return;
      await coordinator.recordEvent(event);
      await refreshStatus();
    },
    [coordinator, refreshStatus]
  );

  const resolveConflict = useCallback(
    async (
      conflictId: string,
      choice: 'LOCAL_WINS' | 'REMOTE_WINS' | 'MANUAL_SPLIT',
      notes?: string
    ) => {
      if (!coordinator) return;
      await coordinator.resolveConflict(conflictId, choice, notes);
      await refreshStatus();
    },
    [coordinator, refreshStatus]
  );

  const value = useMemo<SyncContextValue>(
    () => ({
      coordinator,
      persistentStore,
      summary,
      isReady,
      activeStudent,
      conflicts,
      syncNow,
      recordEvent,
      resolveConflict,
      setStudent: setActiveStudent,
    }),
    [
      coordinator,
      persistentStore,
      summary,
      isReady,
      activeStudent,
      conflicts,
      syncNow,
      recordEvent,
      resolveConflict,
    ]
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
};

export function useSync(): SyncContextValue {
  const context = useContext(SyncContext);
  if (!context) {
    throw new Error('useSync must be used within a SyncProvider');
  }
  return context;
}

export function useOptionalSync(): SyncContextValue | null {
  return useContext(SyncContext);
}
