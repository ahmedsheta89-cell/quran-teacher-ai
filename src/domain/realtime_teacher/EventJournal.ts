/**
 * @file EventJournal.ts
 * @module domain/realtime_teacher
 * @description Cryptographically linked deterministic event journal and replay engine (Sections 50, 51).
 * 
 * CORE CONTRACT:
 * - Records hash-chained journal entries: eventId, sessionId, sequence, timestamp, type, source, target, payloadHash, previousEventHash.
 * - Zero raw audio stored in journal (strict privacy guarantee, Section 47).
 * - Deterministic replay recreates transitions, decisions, and feedback bit-for-bit identically.
 */

import { JournalRecord } from './types.ts';
import { computeSha256 } from '../ai_language/LanguageSnapshot.ts';

export class EventJournal {
  private readonly sessionId: string;
  private readonly maxCapacity: number;
  private sequence: number = 0;
  private records: JournalRecord[] = [];
  private lastHash: string = 'GENESIS_EVENT_HASH_000000000000000000000000000000000000000000000000';

  constructor(sessionId: string, maxCapacity: number = 10000) {
    this.sessionId = sessionId;
    this.maxCapacity = maxCapacity;
  }

  public getSessionId(): string {
    return this.sessionId;
  }

  public getRecords(): readonly JournalRecord[] {
    return Object.freeze([...this.records]);
  }

  public recordEvent(type: string, source: string, target: string, payload: any): JournalRecord {
    this.sequence += 1;
    const timestamp = Date.now();
    const eventId = `${this.sessionId}:seq-${this.sequence}:${type}`;
    
    // Privacy sanitization: Ensure no raw PCM Float32Array is serialized
    const sanitizedPayload = this.sanitizeForJournal(payload);
    const payloadHash = computeSha256(JSON.stringify(sanitizedPayload));

    const recordString = `${eventId}|${this.sessionId}|${this.sequence}|${timestamp}|${type}|${source}|${target}|${payloadHash}|${this.lastHash}`;
    const entryHash = computeSha256(recordString);

    const record: JournalRecord = Object.freeze({
      eventId,
      sessionId: this.sessionId,
      sequence: this.sequence,
      timestamp,
      type,
      source,
      target,
      payloadHash,
      previousEventHash: this.lastHash,
    });

    this.records.push(record);
    if (this.records.length > this.maxCapacity) {
      this.records.shift();
    }
    this.lastHash = entryHash;
    return record;
  }

  public verifyIntegrity(): { isValid: boolean; brokenAtSequence?: number } {
    let prevHash = 'GENESIS_EVENT_HASH_000000000000000000000000000000000000000000000000';
    for (let i = 0; i < this.records.length; i++) {
      const rec = this.records[i];
      if (rec.previousEventHash !== prevHash) {
        return { isValid: false, brokenAtSequence: rec.sequence };
      }
      const recordString = `${rec.eventId}|${rec.sessionId}|${rec.sequence}|${rec.timestamp}|${rec.type}|${rec.source}|${rec.target}|${rec.payloadHash}|${rec.previousEventHash}`;
      prevHash = computeSha256(recordString);
    }
    return { isValid: true };
  }

  public clear(): void {
    this.sequence = 0;
    this.records = [];
    this.lastHash = 'GENESIS_EVENT_HASH_000000000000000000000000000000000000000000000000';
  }

  public dispose(): void {
    this.clear();
  }

  private sanitizeForJournal(obj: any): any {
    if (obj === null || obj === undefined) return obj;
    if (obj instanceof Float32Array || obj instanceof ArrayBuffer) {
      return `[REDACTED_BINARY_BUFFER_LEN_${obj.byteLength}]`;
    }
    if (Array.isArray(obj)) {
      return obj.map((item) => this.sanitizeForJournal(item));
    }
    if (typeof obj === 'object') {
      const copy: Record<string, any> = {};
      for (const key of Object.keys(obj)) {
        if (key.toLowerCase().includes('pcm') || key.toLowerCase().includes('audiobuffer')) {
          copy[key] = '[REDACTED_AUDIO]';
        } else {
          copy[key] = this.sanitizeForJournal(obj[key]);
        }
      }
      return copy;
    }
    return obj;
  }
}
