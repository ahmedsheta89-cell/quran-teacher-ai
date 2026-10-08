/**
 * @file inference.worker.ts
 * @module infrastructure/workers
 * @description Dedicated Web Worker for Zipformer-CTC ONNX acoustic inference.
 * Offloads 72MB INT8 model inference, 99-tensor cache management, and Kaldi FBank DSP
 * from the browser main thread to maintain 60 FPS UI performance.
 */

import * as ort from 'onnxruntime-web';
import { KaldiFbankExtractor } from '../acoustic/KaldiFbankExtractor.ts';
import { AuditableCtcDecoder, RawCtcFrame } from '../../domain/recitation/AuditableCtcDecoder.ts';
import { ModelArtifactLoader, CERTIFIED_MODEL_SPEC } from '../acoustic/ModelArtifactLoader.ts';
import {
  InferenceWorkerRequest,
  InferenceWorkerResponse,
  InferenceFrameResult,
} from './inferenceWorkerProtocol.ts';

// Configure ONNX Web WASM runtime for universal web compatibility (single-threaded WASM doesn't require COOP/COEP)
if (typeof ort !== 'undefined' && ort.env) {
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';
}

// 251 Verified Quranic CTC Phoneme Vocabulary
const QURAN_CTC_TOKENS: string[] = [
  'ؙ', 'ء', 'ا', 'ب', 'ت', 'ث', 'ج', 'ح', 'خ', 'د', 'ذ', 'ر', 'ز', 'س', 'ش', 'ص', 'ض', 'ط', 'ظ', 'ع', 'غ', 'ـ', 'ف', 'ق', 'ك', 'ل', 'م', 'ن', 'ه', 'و', 'ي', 'ً', 'ٌ', 'ٍ', 'َ', 'ُ', 'ِ', 'ّ', 'ْ', 'ٓ', 'ٔ', 'ٕ', 'ٖ', 'ٗ', '٘', 'ٙ', 'ٚ', 'ٛ', 'ٜ', 'ٝ', 'ٞ', 'ٟ', '٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩', '٪', '٫', '٬', 'ٱ', 'ٲ', 'ٳ', 'ٴ', 'ٵ', 'ٶ', 'ٷ', 'ٸ', 'ٹ', 'ٺ', 'ٻ', 'ټ', 'ٽ', 'پ', 'ٿ', 'ڀ', 'ځ', 'ڂ', 'ڃ', 'ڄ', 'څ', 'چ', 'ڇ', 'ڈ', 'ډ', 'ڊ', 'ڋ', 'ڌ', 'ڍ', 'ڎ', 'ڏ', 'ڐ', 'ڑ', 'ڒ', 'ړ', 'ڔ', 'ڕ', 'ږ', 'ڗ', 'ژ', 'ڙ', 'ښ', 'ڛ', 'ڜ', 'ڝ', 'ڞ', 'ڟ', 'ڠ', 'ڡ', 'ڢ', 'ڣ', 'ڤ', 'ڥ', 'ڦ', 'ڧ', 'ڨ', 'ک', 'ڪ', 'ګ', 'ڬ', 'ڭ', 'ڮ', 'گ', 'ڰ', 'ڱ', 'ڲ', 'ڳ', 'ڴ', 'ڵ', 'ڶ', 'ڷ', 'ڸ', 'ڹ', 'ں', 'ڻ', 'ڼ', 'ڽ', 'ھ', 'ڿ', 'ۀ', 'ہ', 'ۂ', 'ۃ', 'ۄ', 'ۅ', 'ۆ', 'ۇ', 'ۈ', 'ۉ', 'ۊ', 'ۋ', 'ی', 'ۍ', 'ێ', 'ۏ', 'ې', 'ۑ', 'ے', 'ۓ', '۔', 'ە', 'ۖ', 'ۗ', 'ۘ', 'ۙ', 'ۚ', 'ۛ', 'ۜ', '۝', '۞', '۟', '۠', 'ۡ', 'ۢ', 'ۣ', 'ۤ', 'ۥ', 'ۦ', 'ۧ', 'ۨ', '۩', '۪', '۫', '۬', 'ۭ', 'ۮ', 'ۯ', '۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹', 'ۺ', 'ۻ', 'ۼ', '۽', '۾', 'ۿ', 'اَ', 'اِ', 'اُ', 'بَ', 'بِ', 'بُ', 'تَ', 'تِ', 'تُ', 'ثَ', 'ثِ', 'ثُ', 'جَ', 'جِ', 'جُ', 'حَ', 'حِ', 'حُ', 'خَ', 'خِ', 'خُ', 'دَ', 'دِ', 'دُ', 'ذَ', 'ذِ', 'ذُ', 'رَ', 'رِ', 'رُ', 'زَ', 'زِ', 'زُ', 'سَ', 'سِ', 'سُ', 'شَ', 'شِ', 'شُ', 'صَ', 'صِ', 'صُ', 'ضَ', 'ضِ', 'ضُ', 'طَ', 'طِ', 'طُ', 'ظَ', 'ظِ', 'ظُ', 'عَ', 'عِ', 'عُ', 'غَ', 'غِ', 'غُ', 'فَ', 'فِ', 'فُ', 'قَ', 'قِ', 'قُ', 'كَ', 'كِ', 'كُ', 'لَ', 'لِ', 'لُ', 'مَ', 'مِ', 'مُ', 'نَ', 'نِ', 'نُ', 'هَ', 'هِ', 'هُ', 'وَ', 'وِ', 'وُ', 'يَ', 'يِ', 'يُ', '<blank>'
];

class InferenceWorkerState {
  public session: ort.InferenceSession | null = null;
  public kaldi = new KaldiFbankExtractor();
  public decoder = new AuditableCtcDecoder({
    blankId: 250,
    secondsPerFrame: 0.05,
    tokensVocab: QURAN_CTC_TOKENS,
  });
  public activeSessionId: string | null = null;
  public cancelledSessions = new Set<string>();
  public streamingStates: Record<string, ort.Tensor> | null = null;
  public processedLens: bigint = BigInt(0);
  public globalFrameIndex: number = 0;
  public chunkIndex: number = 0;
  public isBusy: boolean = false;
  public taskQueue: InferenceWorkerRequest[] = [];

  public initStates(): Record<string, ort.Tensor> {
    const key_dims = [
      [256, 128], [256, 128], [128, 128], [128, 128],
      [64, 128], [64, 128], [64, 128], [32, 256],
      [32, 256], [32, 256], [32, 256], [64, 128],
      [64, 128], [64, 128], [128, 128], [128, 128]
    ];
    const nonlin_dims = [
      [1, 256, 144], [1, 256, 144], [1, 128, 192], [1, 128, 192],
      [1, 64, 288], [1, 64, 288], [1, 64, 288], [1, 32, 384],
      [1, 32, 384], [1, 32, 384], [1, 32, 384], [1, 64, 288],
      [1, 64, 288], [1, 64, 288], [1, 128, 192], [1, 128, 192]
    ];
    const val_dims = [
      [256, 48], [256, 48], [128, 48], [128, 48],
      [64, 48], [64, 48], [64, 48], [32, 96],
      [32, 96], [32, 96], [32, 96], [64, 48],
      [64, 48], [64, 48], [128, 48], [128, 48]
    ];
    const conv_dims = [
      [192, 15], [192, 15], [256, 15], [256, 15],
      [384, 7], [384, 7], [384, 7], [512, 7],
      [512, 7], [512, 7], [512, 7], [384, 7],
      [384, 7], [384, 7], [256, 15], [256, 15]
    ];

    const states: Record<string, ort.Tensor> = {};
    for (let i = 0; i < 16; i++) {
      const [kd0, kd1] = key_dims[i];
      states[`cached_key_${i}`] = new ort.Tensor('float32', new Float32Array(kd0 * 1 * kd1), [kd0, 1, kd1]);

      const [nd0, nd1, nd2] = nonlin_dims[i];
      states[`cached_nonlin_attn_${i}`] = new ort.Tensor('float32', new Float32Array(nd0 * 1 * nd1 * nd2), [nd0, 1, nd1, nd2]);

      const [vd0, vd1] = val_dims[i];
      states[`cached_val1_${i}`] = new ort.Tensor('float32', new Float32Array(vd0 * 1 * vd1), [vd0, 1, vd1]);
      states[`cached_val2_${i}`] = new ort.Tensor('float32', new Float32Array(vd0 * 1 * vd1), [vd0, 1, vd1]);

      const [cd0, cd1] = conv_dims[i];
      states[`cached_conv1_${i}`] = new ort.Tensor('float32', new Float32Array(1 * cd0 * cd1), [1, cd0, cd1]);
      states[`cached_conv2_${i}`] = new ort.Tensor('float32', new Float32Array(1 * cd0 * cd1), [1, cd0, cd1]);
    }
    states['embed_states'] = new ort.Tensor('float32', new Float32Array(1 * 128 * 3 * 19), [1, 128, 3, 19]);
    return states;
  }

  public extractNewStates(outputs: Record<string, ort.Tensor>): Record<string, ort.Tensor> {
    const states: Record<string, ort.Tensor> = {};
    for (let i = 0; i < 16; i++) {
      states[`cached_key_${i}`] = outputs[`new_cached_key_${i}`];
      states[`cached_nonlin_attn_${i}`] = outputs[`new_cached_nonlin_attn_${i}`];
      states[`cached_val1_${i}`] = outputs[`new_cached_val1_${i}`];
      states[`cached_val2_${i}`] = outputs[`new_cached_val2_${i}`];
      states[`cached_conv1_${i}`] = outputs[`new_cached_conv1_${i}`];
      states[`cached_conv2_${i}`] = outputs[`new_cached_conv2_${i}`];
    }
    states['embed_states'] = outputs['new_embed_states'];
    return states;
  }

  public resetSession(sessionId: string): void {
    this.activeSessionId = sessionId;
    this.streamingStates = this.initStates();
    this.processedLens = BigInt(0);
    this.globalFrameIndex = 0;
    this.chunkIndex = 0;
    this.decoder.reset();
  }
}

const workerState = new InferenceWorkerState();

self.onmessage = async (event: MessageEvent<InferenceWorkerRequest>) => {
  const req = event.data;

  // Immediate cancellation handling
  if (req.action === 'CANCEL_SESSION') {
    workerState.cancelledSessions.add(req.sessionId);
    // Purge queued tasks for this session
    workerState.taskQueue = workerState.taskQueue.filter((t) => t.sessionId !== req.sessionId);
    const resp: InferenceWorkerResponse = {
      action: 'CANCEL_SESSION',
      requestId: req.requestId,
      sessionId: req.sessionId,
      success: true,
      payload: { modelReady: workerState.session !== null },
    };
    self.postMessage(resp);
    return;
  }

  if (req.action === 'DISPOSE') {
    workerState.session = null;
    workerState.streamingStates = null;
    workerState.taskQueue = [];
    self.postMessage({
      action: 'DISPOSE',
      requestId: req.requestId,
      sessionId: req.sessionId,
      success: true,
    } as InferenceWorkerResponse);
    return;
  }

  // Queue tasks to guarantee serialization without state race conditions
  workerState.taskQueue.push(req);
  processNextTask();
};

async function processNextTask() {
  if (workerState.isBusy || workerState.taskQueue.length === 0) return;
  workerState.isBusy = true;
  const req = workerState.taskQueue.shift()!;

  try {
    // Check if session was cancelled while queued
    if (workerState.cancelledSessions.has(req.sessionId)) {
      const resp: InferenceWorkerResponse = {
        action: req.action,
        requestId: req.requestId,
        sessionId: req.sessionId,
        success: false,
        errorCode: 'SESSION_CANCELLED',
        error: 'Session was cancelled before task execution.',
      };
      self.postMessage(resp);
      return;
    }

    switch (req.action) {
      case 'LOAD_MODEL': {
        await handleLoadModel(req);
        break;
      }
      case 'RESET_SESSION': {
        workerState.resetSession(req.sessionId);
        self.postMessage({
          action: 'RESET_SESSION',
          requestId: req.requestId,
          sessionId: req.sessionId,
          success: true,
          payload: { modelReady: workerState.session !== null },
        } as InferenceWorkerResponse);
        break;
      }
      case 'INFER_CHUNK': {
        await handleInferChunk(req);
        break;
      }
    }
  } catch (err: any) {
    self.postMessage({
      action: req.action,
      requestId: req.requestId,
      sessionId: req.sessionId,
      success: false,
      errorCode: 'INFERENCE_ERROR',
      error: err?.message || String(err),
    } as InferenceWorkerResponse);
  } finally {
    workerState.isBusy = false;
    processNextTask();
  }
}

async function handleLoadModel(req: InferenceWorkerRequest) {
  try {
    let modelBuffer = req.payload?.modelBuffer;

    if (!modelBuffer) {
      const loader = new ModelArtifactLoader();
      const loadResult = await loader.loadModel((prog) => {
        // Send intermediate download progress to UI
        self.postMessage({
          action: 'LOAD_MODEL',
          requestId: req.requestId,
          sessionId: req.sessionId,
          success: true,
          payload: { downloadProgress: prog },
        } as InferenceWorkerResponse);
      });
      modelBuffer = loadResult.buffer;
    }

    const InferenceSession = ort.InferenceSession;
    workerState.session = await InferenceSession.create(modelBuffer, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });

    // Validate 99 input / 99 output contract
    const inCount = workerState.session.inputNames.length;
    const outCount = workerState.session.outputNames.length;
    if (inCount !== 99 || outCount !== 99) {
      throw new Error(`MODEL_CONTRACT_VIOLATION: Expected 99 inputs & 99 outputs, found ${inCount} in / ${outCount} out`);
    }

    workerState.resetSession(req.sessionId);

    self.postMessage({
      action: 'LOAD_MODEL',
      requestId: req.requestId,
      sessionId: req.sessionId,
      success: true,
      payload: {
        modelReady: true,
        executionProvider: 'wasm',
      },
    } as InferenceWorkerResponse);
  } catch (err: any) {
    self.postMessage({
      action: 'LOAD_MODEL',
      requestId: req.requestId,
      sessionId: req.sessionId,
      success: false,
      errorCode: err.message?.includes('INTEGRITY') ? 'MODEL_INTEGRITY_FAILURE' : 'INFERENCE_ERROR',
      error: err.message || 'Failed to initialize ONNX session',
    } as InferenceWorkerResponse);
  }
}

async function handleInferChunk(req: InferenceWorkerRequest) {
  if (!workerState.session) {
    self.postMessage({
      action: 'INFER_CHUNK',
      requestId: req.requestId,
      sessionId: req.sessionId,
      success: false,
      errorCode: 'MODEL_NOT_LOADED',
      error: 'Cannot run inference without a loaded ONNX session.',
    } as InferenceWorkerResponse);
    return;
  }

  // Stale session check
  if (workerState.activeSessionId && workerState.activeSessionId !== req.sessionId) {
    self.postMessage({
      action: 'INFER_CHUNK',
      requestId: req.requestId,
      sessionId: req.sessionId,
      success: false,
      errorCode: 'STALE_REQUEST',
      error: 'Discarded inference chunk from previous or stale session.',
    } as InferenceWorkerResponse);
    return;
  }

  const pcm = req.payload?.audioPcm;
  if (!pcm || pcm.length === 0) {
    self.postMessage({
      action: 'INFER_CHUNK',
      requestId: req.requestId,
      sessionId: req.sessionId,
      success: true,
      payload: { frames: [], observedTokens: [] },
    } as InferenceWorkerResponse);
    return;
  }

  const tStart = performance.now();

  // 1. Extract Kaldi 80-bin FBank
  const frames = workerState.kaldi.extract(pcm);
  const numFrames = frames.length;
  if (numFrames === 0) {
    self.postMessage({
      action: 'INFER_CHUNK',
      requestId: req.requestId,
      sessionId: req.sessionId,
      success: true,
      payload: { frames: [], observedTokens: [] },
    } as InferenceWorkerResponse);
    return;
  }

  // 2. Stream chunking with fixed T=61 frames
  const chunkFrames = 61;
  const rawCtcFrames: RawCtcFrame[] = [];
  const frameResults: InferenceFrameResult[] = [];

  if (!workerState.streamingStates) {
    workerState.streamingStates = workerState.initStates();
  }

  const flush = req.payload?.flush ?? false;
  const totalFramesToProcess = flush ? numFrames + chunkFrames : numFrames;

  for (let offset = 0; offset < totalFramesToProcess; offset += chunkFrames) {
    // Check if session cancelled during iteration
    if (workerState.cancelledSessions.has(req.sessionId)) {
      self.postMessage({
        action: 'INFER_CHUNK',
        requestId: req.requestId,
        sessionId: req.sessionId,
        success: false,
        errorCode: 'SESSION_CANCELLED',
        error: 'Inference cancelled mid-stream',
      } as InferenceWorkerResponse);
      return;
    }

    const chunk = new Float32Array(chunkFrames * 80);
    for (let f = 0; f < chunkFrames; f++) {
      const frameIdx = offset + f;
      if (frameIdx < numFrames) {
        const m = frames[frameIdx];
        for (let b = 0; b < 80; b++) {
          chunk[f * 80 + b] = m[b];
        }
      } else {
        for (let b = 0; b < 80; b++) {
          chunk[f * 80 + b] = -15.9; // Kaldi log floor padding
        }
      }
    }

    const feeds: Record<string, ort.Tensor> = {};
    feeds['x'] = new ort.Tensor('float32', chunk, [1, chunkFrames, 80]);
    for (const [k, v] of Object.entries(workerState.streamingStates)) {
      feeds[k] = v;
    }
    feeds['processed_lens'] = new ort.Tensor('int64', new BigInt64Array([workerState.processedLens]), [1]);

    const outputs = await workerState.session.run(feeds);
    workerState.streamingStates = workerState.extractNewStates(outputs);
    workerState.processedLens += BigInt(chunkFrames);

    const logProbsTensor = outputs['log_probs'];
    const logProbsData = logProbsTensor.data as Float32Array;
    const dims = logProbsTensor.dims;
    const T = dims[1];
    const V = dims[2];

    for (let t = 0; t < T; t++) {
      let maxVal = -Infinity;
      let secVal = -Infinity;
      let maxIdx = 0;

      for (let v = 0; v < V; v++) {
        const val = logProbsData[t * V + v];
        if (val > maxVal) {
          secVal = maxVal;
          maxVal = val;
          maxIdx = v;
        } else if (val > secVal) {
          secVal = val;
        }
      }

      const topProb = Math.exp(maxVal);
      const secProb = secVal > -Infinity ? Math.exp(secVal) : 0;
      const margin = topProb - secProb;

      const rawFrame: RawCtcFrame = {
        topTokenId: maxIdx,
        topProbability: topProb,
        secondProbability: secProb,
        margin,
        globalFrameIndex: workerState.globalFrameIndex,
        sourceChunkIndex: workerState.chunkIndex,
      };
      rawCtcFrames.push(rawFrame);

      frameResults.push({
        topTokenId: maxIdx,
        topTokenSymbol: QURAN_CTC_TOKENS[maxIdx] || '<unk>',
        topProbability: topProb,
        margin,
        globalFrameIndex: workerState.globalFrameIndex,
      });

      workerState.globalFrameIndex++;
    }
    workerState.chunkIndex++;
  }

  // Decode frames through CTC Decoder
  workerState.decoder.decodeChunk(rawCtcFrames, 0, flush);
  const observedTokens = workerState.decoder.getAllObservedTokens();

  const durationMs = performance.now() - tStart;

  self.postMessage({
    action: 'INFER_CHUNK',
    requestId: req.requestId,
    sessionId: req.sessionId,
    success: true,
    payload: {
      frames: frameResults,
      observedTokens: observedTokens.map((t) => t.token),
      inferenceDurationMs: durationMs,
      totalFramesProcessed: workerState.globalFrameIndex,
    },
  } as InferenceWorkerResponse);
}
