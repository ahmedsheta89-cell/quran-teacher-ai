/**
 * @file BrowserAudioCaptureProvider.ts
 * @module infrastructure/audio
 * @description Real-time Web Audio API capture provider with microphone lifecycle management.
 * Enforces privacy: Audio is processed ephemerally in memory and never persisted permanently.
 */

import {
  IAudioCaptureProvider,
  AudioCaptureState,
  AudioStreamMetadata,
  AudioChunk,
} from '../../domain/recitation/audioCaptureTypes.ts';
import { resamplePcmTo16k } from './resampling/AudioResampler.ts';

export class BrowserAudioCaptureProvider implements IAudioCaptureProvider {
  private state: AudioCaptureState = AudioCaptureState.UNINITIALIZED;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private listeners: ((state: AudioCaptureState) => void)[] = [];
  private sequenceNumber = 0;
  private sessionId = 'session-init';
  private onChunkCallback: ((chunk: AudioChunk) => void) | null = null;
  private currentMetadata: AudioStreamMetadata | null = null;

  getState(): AudioCaptureState {
    return this.state;
  }

  getMetadata(): AudioStreamMetadata | null {
    return this.currentMetadata;
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
    this.onChunkCallback = onChunk;
    this.sequenceNumber = 0;
    this.sessionId = `session-rec-${Date.now()}`;
    this.setState(AudioCaptureState.REQUESTING_PERMISSION);

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Web Audio API getUserMedia is not supported in this browser environment.');
      }

      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: false, // Let raw signal through for accurate Tajweed acoustic evaluation
          autoGainControl: false,
        },
        video: false,
      });

      const audioTrack = this.mediaStream.getAudioTracks()[0];
      const settings = audioTrack.getSettings ? audioTrack.getSettings() : {};

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioCtx({ sampleRate: 16000 });

      const contextSampleRate = this.audioContext.sampleRate;
      this.currentMetadata = {
        sampleRateHz: 16000,
        channels: 1,
        channelCount: 1,
        requestedSampleRate: 16000,
        actualTrackSampleRate: settings.sampleRate || contextSampleRate,
        audioContextSampleRate: contextSampleRate,
        targetSampleRate: 16000,
        bitDepth: 16,
        durationMs: 0,
        timestampMs: Date.now(),
        deviceId: settings.deviceId,
        deviceLabel: audioTrack.label || 'Default Microphone',
        isMuted: !audioTrack.enabled,
      };

      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
      // Use buffer size of 2048 samples (~128ms chunks at 16kHz)
      this.processorNode = this.audioContext.createScriptProcessor(2048, 1, 1);

      this.processorNode.onaudioprocess = (e) => {
        if (this.state !== AudioCaptureState.RECORDING) return;

        const inputBuffer = e.inputBuffer.getChannelData(0);
        const pcmCopy =
          contextSampleRate === 16000
            ? new Float32Array(inputBuffer)
            : resamplePcmTo16k(inputBuffer, contextSampleRate, 'BANDLIMITED_SINC');

        const chunkDurationMs = (pcmCopy.length / 16000) * 1000;
        const chunk: AudioChunk = {
          sequenceNumber: this.sequenceNumber++,
          sessionId: this.sessionId,
          timestampMs: Date.now(),
          durationMs: chunkDurationMs,
          pcmData: pcmCopy,
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

      this.setState(AudioCaptureState.RECORDING);
    } catch (err: any) {
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
    if (this.processorNode && this.sourceNode) {
      this.sourceNode.disconnect();
      this.processorNode.disconnect();
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      await this.audioContext.close();
      this.audioContext = null;
    }

    this.setState(AudioCaptureState.STOPPED);
  }

  async cancel(): Promise<void> {
    await this.stop();
    this.onChunkCallback = null;
  }
}
