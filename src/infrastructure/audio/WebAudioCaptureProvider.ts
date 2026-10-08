/**
 * @file WebAudioCaptureProvider.ts
 * @module infrastructure/audio
 * @description Real in-browser microphone capture using HTML5 MediaDevices & Web Audio API.
 * Strict Privacy: All audio stays in volatile memory; zero permanent local persistence.
 */

import {
  AudioCaptureState,
  AudioChunk,
  AudioStreamMetadata,
  IAudioCaptureProvider,
} from '../../domain/recitation/audioCaptureTypes.ts';
import { resamplePcmTo16k } from './resampling/AudioResampler.ts';

export class WebAudioCaptureProvider implements IAudioCaptureProvider {
  private state: AudioCaptureState = AudioCaptureState.UNINITIALIZED;
  private metadata: AudioStreamMetadata | null = null;
  private listeners: ((state: AudioCaptureState) => void)[] = [];

  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;

  private sequenceCounter = 0;
  private startTimestampMs = 0;
  private onChunkCallback: ((chunk: AudioChunk) => void) | null = null;

  getState(): AudioCaptureState {
    return this.state;
  }

  getMetadata(): AudioStreamMetadata | null {
    return this.metadata;
  }

  registerStateListener(listener: (state: AudioCaptureState) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private setState(newState: AudioCaptureState): void {
    this.state = newState;
    this.listeners.forEach((l) => l(newState));
  }

  async start(onChunk: (chunk: AudioChunk) => void): Promise<void> {
    if (this.state === AudioCaptureState.RECORDING) return;

    this.onChunkCallback = onChunk;
    this.setState(AudioCaptureState.REQUESTING_PERMISSION);

    try {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        throw new Error('المتصفح الحالي لا يدعم واجهة التقاط الصوت (MediaDevices API).');
      }

      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      const audioTrack = this.mediaStream.getAudioTracks()[0];
      const settings = audioTrack.getSettings ? audioTrack.getSettings() : {};

      const AudioCtxClass =
        window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioCtxClass();

      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      const sampleRate = this.audioContext.sampleRate;
      this.metadata = {
        sampleRateHz: 16000,
        channels: 1,
        channelCount: 1,
        requestedSampleRate: 16000,
        actualTrackSampleRate: settings.sampleRate || sampleRate,
        audioContextSampleRate: sampleRate,
        targetSampleRate: 16000,
        bitDepth: 16,
        durationMs: 0,
        timestampMs: Date.now(),
        deviceId: settings.deviceId,
        deviceLabel: audioTrack.label || 'الميكروفون الافتراضي',
        isMuted: !audioTrack.enabled,
      };

      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
      // 4096 buffer size gives ~85ms chunks at 48kHz, ~250ms at 16kHz
      const bufferSize = 4096;
      this.processorNode = this.audioContext.createScriptProcessor(bufferSize, 1, 1);

      this.sequenceCounter = 0;
      this.startTimestampMs = Date.now();

      this.processorNode.onaudioprocess = (e: AudioProcessingEvent) => {
        if (this.state !== AudioCaptureState.RECORDING) return;

        const inputBuffer = e.inputBuffer.getChannelData(0);
        // Resample deterministic to 16kHz if hardware sampleRate !== 16000
        const pcmData =
          sampleRate === 16000
            ? new Float32Array(inputBuffer)
            : resamplePcmTo16k(inputBuffer, sampleRate, 'BANDLIMITED_SINC');

        const durationMs = Math.round((pcmData.length / 16000) * 1000);
        const timestampMs = Date.now() - this.startTimestampMs;

        this.sequenceCounter++;

        const chunk: AudioChunk = {
          sequenceNumber: this.sequenceCounter,
          sessionId: `live-mic-${this.startTimestampMs}`,
          timestampMs,
          durationMs,
          pcmData,
          sampleRateHz: 16000,
          channels: 1,
          isFinal: false,
        };

        if (this.onChunkCallback) {
          this.onChunkCallback(chunk);
        }
      };

      this.sourceNode.connect(this.processorNode);
      this.processorNode.connect(this.audioContext.destination);

      this.setState(AudioCaptureState.INITIALIZED);
      this.setState(AudioCaptureState.RECORDING);
    } catch (err: any) {
      console.error('[WebAudioCaptureProvider] Failed to acquire microphone:', err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        this.setState(AudioCaptureState.PERMISSION_DENIED);
      } else {
        this.setState(AudioCaptureState.ERROR);
      }
      throw err;
    }
  }

  async pause(): Promise<void> {
    if (this.state === AudioCaptureState.RECORDING) {
      if (this.audioContext && this.audioContext.state === 'running') {
        await this.audioContext.suspend();
      }
      this.setState(AudioCaptureState.PAUSED);
    }
  }

  async resume(): Promise<void> {
    if (this.state === AudioCaptureState.PAUSED) {
      if (this.audioContext && this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      this.setState(AudioCaptureState.RECORDING);
    }
  }

  async stop(): Promise<void> {
    this.cleanupNodes();
    this.setState(AudioCaptureState.STOPPED);
  }

  async cancel(): Promise<void> {
    this.cleanupNodes();
    this.sequenceCounter = 0;
    this.startTimestampMs = 0;
    this.onChunkCallback = null;
    this.setState(AudioCaptureState.UNINITIALIZED);
  }

  private cleanupNodes(): void {
    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode.onaudioprocess = null;
      this.processorNode = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
  }
}
