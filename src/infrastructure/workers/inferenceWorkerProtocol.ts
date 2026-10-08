/**
 * @file inferenceWorkerProtocol.ts
 * @module infrastructure/workers
 * @description Type-safe message contracts for off-main-thread neural inference Web Worker.
 * Enforces tagged requests, session lifecycle, cancellation, and serialized execution.
 */

import { ModelDownloadProgress } from '../acoustic/ModelArtifactLoader.ts';

export type InferenceWorkerAction =
  | 'LOAD_MODEL'
  | 'RESET_SESSION'
  | 'INFER_CHUNK'
  | 'CANCEL_SESSION'
  | 'DISPOSE';

export interface InferenceWorkerRequest {
  action: InferenceWorkerAction;
  requestId: string;
  sessionId: string;
  payload?: {
    modelBuffer?: ArrayBuffer;
    audioPcm?: Float32Array; // 16kHz mono PCM
    flush?: boolean;
    surahNumber?: number;
    ayahNumber?: number;
  };
}

export interface InferenceFrameResult {
  topTokenId: number;
  topTokenSymbol?: string;
  topProbability: number;
  margin: number;
  globalFrameIndex: number;
}

export interface InferenceWorkerResponse {
  action: InferenceWorkerAction;
  requestId: string;
  sessionId: string;
  success: boolean;
  error?: string;
  errorCode?:
    | 'MODEL_NOT_LOADED'
    | 'MODEL_INTEGRITY_FAILURE'
    | 'SESSION_CANCELLED'
    | 'STALE_REQUEST'
    | 'INFERENCE_ERROR'
    | 'NETWORK_ERROR';
  payload?: {
    modelReady?: boolean;
    executionProvider?: string;
    downloadProgress?: ModelDownloadProgress;
    frames?: InferenceFrameResult[];
    observedTokens?: string[];
    inferenceDurationMs?: number;
    totalFramesProcessed?: number;
  };
}
