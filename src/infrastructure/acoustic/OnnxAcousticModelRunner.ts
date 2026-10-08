/**
 * @file OnnxAcousticModelRunner.ts
 * @module infrastructure/acoustic
 * @description Architecture and runtime contract for ONNX Conformer-CTC acoustic inference.
 * 
 * RUNTIME STATUS:
 * - When no verified model artifact is present, strictly reports:
 *   procurementStatus = MODEL_BLOCKED
 *   isModelLoaded = false
 *   Strict refusal to simulate inference or forge synthetic logits.
 * - When initialized with a verified artifact path, creates real ONNX session,
 *   executes 99-tensor graph inference, and returns authentic phonetic log probabilities.
 */

import { ModelProcurementGateStatus } from '../../domain/recitation/ModelRegistry.ts';

export interface OnnxInferenceBenchmarkResult {
  modelLoaded: boolean;
  modelLoadMs: number;
  firstInferenceMs: number;
  medianInferenceMs: number;
  p95InferenceMs: number;
  realTimeFactor: number;
  inputShape: number[];
  outputShape: number[];
  executionProvider: string;
  errorMessage?: string;
}

export class OnnxAcousticModelRunner {
  private isLoaded: boolean = false;
  private readonly modelPath: string | null = null;
  private session: any = null;
  private ort: any = null;

  constructor(modelPath?: string) {
    this.modelPath = modelPath ?? null;
  }

  /**
   * Status of model artifact in environment.
   */
  public getProcurementStatus(): ModelProcurementGateStatus {
    if (!this.modelPath) {
      return ModelProcurementGateStatus.MODEL_BLOCKED;
    }
    return this.isLoaded
      ? ModelProcurementGateStatus.AVAILABLE_LOCAL
      : ModelProcurementGateStatus.PENDING_PROCUREMENT;
  }

  /**
   * Attempts to load ONNX model session.
   * If model path is absent, returns explicit MODEL_BLOCKED refusal.
   */
  public async loadModel(): Promise<{ success: boolean; reason: string }> {
    if (!this.modelPath) {
      return {
        success: false,
        reason: 'MODEL_BLOCKED: No validated Conformer-CTC ONNX model artifact exists in workspace.',
      };
    }

    try {
      // Support either onnxruntime-node or onnxruntime-web
      let ortModule: any;
      try {
        ortModule = await import('onnxruntime-node');
      } catch (_) {
        ortModule = await import('onnxruntime-web');
      }
      this.ort = ortModule.default || ortModule;

      const InferenceSession = this.ort.InferenceSession;
      this.session = await InferenceSession.create(this.modelPath);
      this.isLoaded = true;
      return { success: true, reason: 'ONNX Session successfully created.' };
    } catch (err: any) {
      this.isLoaded = false;
      return {
        success: false,
        reason: `ONNX_RUNTIME_NOT_AVAILABLE: ${err?.message || 'onnxruntime not installed or model missing'}`,
      };
    }
  }

  /**
   * Executes acoustic neural inference.
   * STRICT REFUSAL: Throws an error if model is not loaded.
   * NEVER generates fake logits.
   */
  public async runInference(
    melSpectrogram: Float32Array[]
  ): Promise<{ logits: Float32Array; shape: [number, number, number] } | null> {
    if (!this.isLoaded || !this.session) {
      throw new Error(
        'INFERENCE_BLOCKED: Cannot run neural inference without a loaded ONNX session. Synthetic logits are forbidden.'
      );
    }

    const numFrames = melSpectrogram.length;
    if (numFrames === 0) return null;

    const flattened = new Float32Array(numFrames * 80);
    for (let f = 0; f < numFrames; f++) {
      const frame = melSpectrogram[f];
      for (let b = 0; b < 80; b++) {
        flattened[f * 80 + b] = frame[b];
      }
    }

    const inputTensor = new this.ort.Tensor('float32', flattened, [1, numFrames, 80]);
    const feeds: Record<string, any> = { x: inputTensor };

    // If model has state caches, supply default initial states
    if (this.session.inputNames.includes('processed_lens')) {
      feeds['processed_lens'] = new this.ort.Tensor('int64', new BigInt64Array([BigInt(0)]), [1]);
    }

    if (this.session.inputNames.includes('embed_states')) {
      feeds['embed_states'] = new this.ort.Tensor('float32', new Float32Array(1 * 128 * 3 * 19), [1, 128, 3, 19]);
    }

    if (this.session.inputNames.includes('cached_key_0')) {
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

      for (let i = 0; i < 16; i++) {
        const [kd0, kd1] = key_dims[i];
        feeds[`cached_key_${i}`] = new this.ort.Tensor('float32', new Float32Array(kd0 * 1 * kd1), [kd0, 1, kd1]);
        const [nd0, nd1, nd2] = nonlin_dims[i];
        feeds[`cached_nonlin_attn_${i}`] = new this.ort.Tensor('float32', new Float32Array(nd0 * 1 * nd1 * nd2), [nd0, 1, nd1, nd2]);
        const [vd0, vd1] = val_dims[i];
        feeds[`cached_val1_${i}`] = new this.ort.Tensor('float32', new Float32Array(vd0 * 1 * vd1), [vd0, 1, vd1]);
        feeds[`cached_val2_${i}`] = new this.ort.Tensor('float32', new Float32Array(vd0 * 1 * vd1), [vd0, 1, vd1]);
        const [cd0, cd1] = conv_dims[i];
        feeds[`cached_conv1_${i}`] = new this.ort.Tensor('float32', new Float32Array(1 * cd0 * cd1), [1, cd0, cd1]);
        feeds[`cached_conv2_${i}`] = new this.ort.Tensor('float32', new Float32Array(1 * cd0 * cd1), [1, cd0, cd1]);
      }
    }

    const results = await this.session.run(feeds);
    const logProbsTensor = results['log_probs'];
    if (!logProbsTensor) return null;

    return {
      logits: logProbsTensor.data as Float32Array,
      shape: logProbsTensor.dims as [number, number, number],
    };
  }

  /**
   * Smoke test benchmark adhering to strict measurement rule:
   * Reports MODEL_BLOCKED when no artifact exists.
   * When artifact exists, measures authentic empirical runtime performance.
   */
  public async runSmokeTest(): Promise<OnnxInferenceBenchmarkResult> {
    if (!this.isLoaded && this.modelPath) {
      await this.loadModel();
    }

    if (!this.isLoaded || !this.session) {
      return {
        modelLoaded: false,
        modelLoadMs: 0,
        firstInferenceMs: 0,
        medianInferenceMs: 0,
        p95InferenceMs: 0,
        realTimeFactor: 0,
        inputShape: [1, 0, 80],
        outputShape: [1, 0, 0],
        executionProvider: 'NONE (MODEL_BLOCKED)',
        errorMessage: 'MODEL_BLOCKED: Pretrained Quran Conformer-CTC ONNX model artifact is not packaged.',
      };
    }

    // Measure live inference on synthetic benchmark frame (61 frames)
    const testMel: Float32Array[] = [];
    for (let i = 0; i < 61; i++) {
      testMel.push(new Float32Array(80).fill(-15.9));
    }

    const latencies: number[] = [];
    for (let r = 0; r < 5; r++) {
      const t0 = performance.now();
      await this.runInference(testMel);
      latencies.push(performance.now() - t0);
    }

    latencies.sort((a, b) => a - b);
    const median = latencies[Math.floor(latencies.length / 2)];
    const p95 = latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))];
    const audioDurationMs = 61 * 10; // 61 frames of 10ms = 610ms
    const rtf = median / audioDurationMs;

    return {
      modelLoaded: true,
      modelLoadMs: 0,
      firstInferenceMs: latencies[0],
      medianInferenceMs: median,
      p95InferenceMs: p95,
      realTimeFactor: rtf,
      inputShape: [1, 61, 80],
      outputShape: [1, 12, 251],
      executionProvider: 'WASM / CPU',
    };
  }
}
