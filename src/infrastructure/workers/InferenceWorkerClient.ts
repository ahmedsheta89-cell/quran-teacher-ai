/**
 * @file InferenceWorkerClient.ts
 * @module infrastructure/workers
 * @description Main-thread facade managing the ONNX Inference Web Worker.
 * Handles task IDs, session lifecycle, cancellation, transferables, and timeout guards.
 */

import {
  InferenceWorkerRequest,
  InferenceWorkerResponse,
  InferenceWorkerAction,
} from './inferenceWorkerProtocol.ts';
import { ModelDownloadProgress } from '../acoustic/ModelArtifactLoader.ts';

export class InferenceWorkerClient {
  private worker: Worker | null = null;
  private nextRequestId = 1;
  private currentSessionId: string | null = null;
  private isModelReady: boolean = false;
  private pendingRequests = new Map<
    string,
    {
      resolve: (res: InferenceWorkerResponse) => void;
      reject: (err: any) => void;
      timer: any;
      sessionId: string;
    }
  >();
  private progressCallback: ((progress: ModelDownloadProgress) => void) | null = null;

  constructor() {
    this.initWorker();
  }

  private initWorker(): void {
    if (typeof window !== 'undefined' && typeof Worker !== 'undefined') {
      try {
        this.worker = new Worker(
          new URL('./inference.worker.ts', import.meta.url),
          { type: 'module' }
        );
        this.worker.onmessage = this.handleMessage.bind(this);
        this.worker.onerror = this.handleError.bind(this);
      } catch (err) {
        console.warn('[InferenceWorkerClient] Web Worker unsupported or failed to instantiate:', err);
        this.worker = null;
      }
    }
  }

  public isAvailable(): boolean {
    return this.worker !== null;
  }

  public getModelReady(): boolean {
    return this.isModelReady;
  }

  private handleMessage(event: MessageEvent<InferenceWorkerResponse>): void {
    const res = event.data;

    // Handle intermediate download progress
    if (res.action === 'LOAD_MODEL' && res.payload?.downloadProgress && this.progressCallback) {
      this.progressCallback(res.payload.downloadProgress);
      return;
    }

    const pending = this.pendingRequests.get(res.requestId);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pendingRequests.delete(res.requestId);

    // Stale session guard: Discard response if session changed or was cancelled
    if (res.sessionId !== this.currentSessionId && res.action === 'INFER_CHUNK') {
      console.warn(`[InferenceWorkerClient] Discarded response for stale session: ${res.sessionId}`);
      return;
    }

    if (res.action === 'LOAD_MODEL' && res.success && res.payload?.modelReady) {
      this.isModelReady = true;
    }

    if (res.success) {
      pending.resolve(res);
    } else {
      pending.reject(new Error(res.error || `Worker action ${res.action} failed with code ${res.errorCode}`));
    }
  }

  private handleError(event: ErrorEvent): void {
    console.error('[InferenceWorkerClient] Fatal worker error:', event);
    for (const [id, req] of this.pendingRequests.entries()) {
      clearTimeout(req.timer);
      req.reject(new Error(`Worker fatal failure: ${event.message}`));
    }
    this.pendingRequests.clear();
  }

  /**
   * Initializes or loads the certified ONNX model weights in worker.
   */
  public async loadModel(
    modelBuffer?: ArrayBuffer,
    onProgress?: (progress: ModelDownloadProgress) => void
  ): Promise<InferenceWorkerResponse> {
    this.progressCallback = onProgress || null;
    return this.send(
      'LOAD_MODEL',
      'sys_model_init',
      { modelBuffer },
      120000 // 2-minute timeout for large download if on slow connection
    );
  }

  /**
   * Starts or resets an acoustic session for a specific Ayah recitation.
   */
  public async resetSession(sessionId: string): Promise<InferenceWorkerResponse> {
    this.currentSessionId = sessionId;
    return this.send('RESET_SESSION', sessionId, undefined, 5000);
  }

  /**
   * Feeds a streaming 16kHz audio chunk to the neural worker.
   */
  public async inferChunk(
    sessionId: string,
    audioPcm: Float32Array,
    flush: boolean = false
  ): Promise<InferenceWorkerResponse> {
    if (this.currentSessionId !== sessionId) {
      throw new Error(`SESSION_MISMATCH: Current active session is ${this.currentSessionId}, received ${sessionId}`);
    }

    return this.send(
      'INFER_CHUNK',
      sessionId,
      { audioPcm, flush },
      10000
    );
  }

  /**
   * Immediately cancels active inference and invalidates in-flight responses.
   */
  public async cancelSession(sessionId: string): Promise<void> {
    if (this.currentSessionId === sessionId) {
      this.currentSessionId = null;
    }

    // Cancel all local pending requests matching this sessionId
    for (const [id, req] of this.pendingRequests.entries()) {
      if (req.sessionId === sessionId) {
        clearTimeout(req.timer);
        req.reject(new Error('SESSION_CANCELLED: User cancelled or navigated away.'));
        this.pendingRequests.delete(id);
      }
    }

    if (this.worker) {
      const requestId = `cancel_${this.nextRequestId++}_${Date.now()}`;
      this.worker.postMessage({
        action: 'CANCEL_SESSION',
        requestId,
        sessionId,
      } as InferenceWorkerRequest);
    }
  }

  private send(
    action: InferenceWorkerAction,
    sessionId: string,
    payload?: InferenceWorkerRequest['payload'],
    timeoutMs = 10000
  ): Promise<InferenceWorkerResponse> {
    if (!this.worker) {
      return Promise.reject(new Error('WORKER_UNAVAILABLE: Inference worker is not running in this environment.'));
    }

    const requestId = `req_${this.nextRequestId++}_${Date.now()}`;
    const message: InferenceWorkerRequest = {
      action,
      requestId,
      sessionId,
      payload,
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Inference worker timeout after ${timeoutMs}ms for ${action}`));
      }, timeoutMs);

      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        timer,
        sessionId,
      });

      this.worker!.postMessage(message);
    });
  }

  public dispose(): void {
    if (this.worker) {
      this.worker.postMessage({
        action: 'DISPOSE',
        requestId: 'dispose',
        sessionId: this.currentSessionId || '',
      } as InferenceWorkerRequest);
      this.worker.terminate();
      this.worker = null;
    }
    this.isModelReady = false;
    this.currentSessionId = null;
    for (const [id, req] of this.pendingRequests.entries()) {
      clearTimeout(req.timer);
      req.reject(new Error('WORKER_DISPOSED'));
    }
    this.pendingRequests.clear();
  }
}
