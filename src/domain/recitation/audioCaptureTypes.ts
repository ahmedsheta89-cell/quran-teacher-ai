/**
 * @file audioCaptureTypes.ts
 * @module domain/recitation
 * @description Audio capture contracts, stream metadata, and signal quality metrics.
 */

export interface AudioStreamMetadata {
  sampleRateHz: number;
  channels: number;
  channelCount?: number;
  requestedSampleRate?: number;
  actualTrackSampleRate?: number;
  audioContextSampleRate?: number;
  targetSampleRate?: number;
  bitDepth?: number;
  durationMs: number;
  timestampMs: number;
  deviceId?: string;
  deviceLabel?: string;
  isMuted: boolean;
}

export interface AudioChunk {
  sequenceNumber: number;
  sessionId: string;
  timestampMs: number;
  durationMs: number;
  pcmData: Float32Array;
  sampleRateHz: number;
  channels: number;
  isFinal: boolean;
}

export enum AudioCaptureState {
  UNINITIALIZED = 'UNINITIALIZED',
  REQUESTING_PERMISSION = 'REQUESTING_PERMISSION',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  INITIALIZED = 'INITIALIZED',
  RECORDING = 'RECORDING',
  PAUSED = 'PAUSED',
  STOPPED = 'STOPPED',
  ERROR = 'ERROR',
}

export interface IAudioCaptureProvider {
  getState(): AudioCaptureState;
  getMetadata(): AudioStreamMetadata | null;
  start(onChunk: (chunk: AudioChunk) => void): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
  cancel(): Promise<void>;
  registerStateListener(listener: (state: AudioCaptureState) => void): () => void;
}

export enum AudioQualityStatus {
  GOOD = 'GOOD',
  ACCEPTABLE = 'ACCEPTABLE',
  POOR = 'POOR',
  UNUSABLE = 'UNUSABLE',
}

export enum AudioQualityIssue {
  CLIPPING_DETECTED = 'CLIPPING_DETECTED',
  SIGNAL_TOO_LOW = 'SIGNAL_TOO_LOW',
  EXCESSIVE_NOISE = 'EXCESSIVE_NOISE',
  SAMPLE_RATE_INSUFFICIENT = 'SAMPLE_RATE_INSUFFICIENT',
  DISCONTINUITY_OR_DROPPED_FRAMES = 'DISCONTINUITY_OR_DROPPED_FRAMES',
  MICROPHONE_MUTED = 'MICROPHONE_MUTED',
}

export interface AudioQualityAssessment {
  status: AudioQualityStatus;
  isUsableForAlignment: boolean;
  rmsDb: number;
  peakAmplitude: number;
  clippingRatio: number;
  silenceRatio: number;
  estimatedSnrDb: number;
  issues: AudioQualityIssue[];
  recommendationArabic: string;
  evaluatedAt: string;
}

export interface IAudioQualityAnalyzer {
  analyzeChunk(chunk: AudioChunk): AudioQualityAssessment;
  analyzeSession(chunks: AudioChunk[]): AudioQualityAssessment;
}
