/**
 * @file ModelArtifactLoader.ts
 * @module infrastructure/acoustic
 * @description Production-capable model artifact distribution, streaming downloader,
 * CacheStorage manager, and cryptographic SHA-256 integrity verifier.
 * 
 * Enforces strict Phase 12.2 constraints:
 * - Immutable commit-pinned URL
 * - Pre-execution SHA-256 integrity verification
 * - Explicit failure states on 404/403/CORS/Integrity failure
 * - STRICT REFUSAL of synthetic logits or silent fallbacks
 */

import { computeSha256Buffer } from '../crypto/Sha256Util.ts';

export const CERTIFIED_MODEL_SPEC = {
  modelId: 'quran-stt-int8',
  expectedSha256: '31755836528da336a6192121cd7bc82cb41752dddb65566fd000b89c8686da6b',
  expectedSizeBytes: 72705392,
  pinnedCommit: '51ec9bcddeaf1c480bbe39064a2a3b88bc2ff224',
  primaryUrl: 'https://huggingface.co/Saboorhsn/quran-stt-onnx/resolve/51ec9bcddeaf1c480bbe39064a2a3b88bc2ff224/quran-stt-int8.onnx',
  fallbackUrls: [
    './models/saboorhsn/quran-stt-int8.onnx',
    '/models/saboorhsn/quran-stt-int8.onnx',
  ],
  cacheName: 'aya-quran-models-v1',
};

export type ModelDownloadPhase =
  | 'IDLE'
  | 'CHECKING_CACHE'
  | 'DOWNLOADING'
  | 'VERIFYING_INTEGRITY'
  | 'READY'
  | 'FAILED';

export interface ModelDownloadProgress {
  phase: ModelDownloadPhase;
  bytesLoaded: number;
  totalBytes: number;
  percentage: number;
  speedBytesPerSec?: number;
  error?: string;
}

export interface ModelLoadResult {
  buffer: ArrayBuffer;
  source: 'CACHE' | 'NETWORK' | 'FILESYSTEM';
  sha256: string;
  byteLength: number;
  loadDurationMs: number;
}

export class ModelArtifactLoader {
  private inMemoryCache: ArrayBuffer | null = null;

  constructor(
    private readonly spec = CERTIFIED_MODEL_SPEC
  ) {}

  /**
   * Loads the certified ONNX model bytes with strict SHA-256 verification.
   * Checks CacheStorage -> Local/Remote Network -> Verifies Hash -> Stores in Cache.
   */
  public async loadModel(
    onProgress?: (progress: ModelDownloadProgress) => void
  ): Promise<ModelLoadResult> {
    const startTime = performance.now();

    // 1. Check in-memory cache first
    if (this.inMemoryCache) {
      onProgress?.({
        phase: 'READY',
        bytesLoaded: this.inMemoryCache.byteLength,
        totalBytes: this.inMemoryCache.byteLength,
        percentage: 100,
      });
      return {
        buffer: this.inMemoryCache,
        source: 'CACHE',
        sha256: this.spec.expectedSha256,
        byteLength: this.inMemoryCache.byteLength,
        loadDurationMs: performance.now() - startTime,
      };
    }

    // 2. Check Browser CacheStorage if available
    onProgress?.({
      phase: 'CHECKING_CACHE',
      bytesLoaded: 0,
      totalBytes: this.spec.expectedSizeBytes,
      percentage: 0,
    });

    const cachedBuffer = await this.checkCacheStorage();
    if (cachedBuffer) {
      onProgress?.({
        phase: 'VERIFYING_INTEGRITY',
        bytesLoaded: cachedBuffer.byteLength,
        totalBytes: cachedBuffer.byteLength,
        percentage: 95,
      });

      const hash = await computeSha256Buffer(cachedBuffer);
      if (hash.toLowerCase() === this.spec.expectedSha256.toLowerCase()) {
        this.inMemoryCache = cachedBuffer;
        onProgress?.({
          phase: 'READY',
          bytesLoaded: cachedBuffer.byteLength,
          totalBytes: cachedBuffer.byteLength,
          percentage: 100,
        });
        return {
          buffer: cachedBuffer,
          source: 'CACHE',
          sha256: hash,
          byteLength: cachedBuffer.byteLength,
          loadDurationMs: performance.now() - startTime,
        };
      } else {
        // Cache corrupted or tampered - purge it
        await this.purgeCacheStorage();
      }
    }

    // 3. Node environment filesystem check (for tests/server execution)
    const fsBuffer = await this.checkNodeFilesystem();
    if (fsBuffer) {
      onProgress?.({
        phase: 'VERIFYING_INTEGRITY',
        bytesLoaded: fsBuffer.byteLength,
        totalBytes: fsBuffer.byteLength,
        percentage: 95,
      });

      const hash = await computeSha256Buffer(fsBuffer);
      if (hash.toLowerCase() === this.spec.expectedSha256.toLowerCase()) {
        this.inMemoryCache = fsBuffer;
        onProgress?.({
          phase: 'READY',
          bytesLoaded: fsBuffer.byteLength,
          totalBytes: fsBuffer.byteLength,
          percentage: 100,
        });
        return {
          buffer: fsBuffer,
          source: 'FILESYSTEM',
          sha256: hash,
          byteLength: fsBuffer.byteLength,
          loadDurationMs: performance.now() - startTime,
        };
      } else {
        throw new Error(
          `MODEL_INTEGRITY_FAILURE: Local filesystem model failed SHA-256 verification. ` +
          `Expected ${this.spec.expectedSha256}, calculated ${hash}.`
        );
      }
    }

    // 4. Download from network (Primary URL, then Fallbacks)
    const candidateUrls = [this.spec.primaryUrl, ...this.spec.fallbackUrls];
    let downloadedBuffer: ArrayBuffer | null = null;
    let lastNetworkError: string = 'NO_URL_ATTEMPTED';

    for (const url of candidateUrls) {
      try {
        downloadedBuffer = await this.downloadWithProgress(url, onProgress);
        if (downloadedBuffer) break;
      } catch (err: any) {
        lastNetworkError = err?.message || String(err);
      }
    }

    if (!downloadedBuffer) {
      const errMessage = `MODEL_DOWNLOAD_FAILED: All candidate URLs failed. Last error: ${lastNetworkError}`;
      onProgress?.({
        phase: 'FAILED',
        bytesLoaded: 0,
        totalBytes: this.spec.expectedSizeBytes,
        percentage: 0,
        error: errMessage,
      });
      throw new Error(errMessage);
    }

    // 5. Mandatory Cryptographic SHA-256 Verification
    onProgress?.({
      phase: 'VERIFYING_INTEGRITY',
      bytesLoaded: downloadedBuffer.byteLength,
      totalBytes: downloadedBuffer.byteLength,
      percentage: 95,
    });

    const sha256 = await computeSha256Buffer(downloadedBuffer);
    if (sha256.toLowerCase() !== this.spec.expectedSha256.toLowerCase()) {
      const mismatchError =
        `MODEL_INTEGRITY_FAILURE: Downloaded model failed cryptographic verification! ` +
        `Expected ${this.spec.expectedSha256}, got ${sha256}. Refusing to load.`;
      onProgress?.({
        phase: 'FAILED',
        bytesLoaded: downloadedBuffer.byteLength,
        totalBytes: downloadedBuffer.byteLength,
        percentage: 0,
        error: mismatchError,
      });
      throw new Error(mismatchError);
    }

    // 6. Save to CacheStorage for instant offline subsequent loads
    await this.saveToCacheStorage(downloadedBuffer);
    this.inMemoryCache = downloadedBuffer;

    onProgress?.({
      phase: 'READY',
      bytesLoaded: downloadedBuffer.byteLength,
      totalBytes: downloadedBuffer.byteLength,
      percentage: 100,
    });

    return {
      buffer: downloadedBuffer,
      source: 'NETWORK',
      sha256,
      byteLength: downloadedBuffer.byteLength,
      loadDurationMs: performance.now() - startTime,
    };
  }

  /**
   * Streams model bytes from a URL with progress telemetry.
   */
  private async downloadWithProgress(
    url: string,
    onProgress?: (progress: ModelDownloadProgress) => void
  ): Promise<ArrayBuffer> {
    const response = await fetch(url, {
      method: 'GET',
      mode: 'cors',
    });

    if (!response.ok) {
      throw new Error(`HTTP_${response.status}: Failed to fetch model from ${url}`);
    }

    const contentLengthHeader = response.headers.get('content-length');
    const totalBytes = contentLengthHeader
      ? parseInt(contentLengthHeader, 10)
      : this.spec.expectedSizeBytes;

    if (!response.body) {
      // Fallback if ReadableStream not supported
      const buf = await response.arrayBuffer();
      return buf;
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytesLoaded = 0;
    const downloadStart = performance.now();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      if (value) {
        chunks.push(value);
        bytesLoaded += value.byteLength;
        const elapsedSec = (performance.now() - downloadStart) / 1000;
        const speedBytesPerSec = elapsedSec > 0 ? bytesLoaded / elapsedSec : 0;
        const percentage = totalBytes > 0 ? Math.min(94, Math.round((bytesLoaded / totalBytes) * 94)) : 0;

        onProgress?.({
          phase: 'DOWNLOADING',
          bytesLoaded,
          totalBytes,
          percentage,
          speedBytesPerSec,
        });
      }
    }

    // Concatenate chunks
    const resultBuffer = new Uint8Array(bytesLoaded);
    let offset = 0;
    for (const chunk of chunks) {
      resultBuffer.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return resultBuffer.buffer;
  }

  private async checkCacheStorage(): Promise<ArrayBuffer | null> {
    if (typeof caches === 'undefined') return null;
    try {
      const cache = await caches.open(this.spec.cacheName);
      const matched = await cache.match(this.spec.primaryUrl);
      if (matched) {
        return await matched.arrayBuffer();
      }
    } catch (_) {
      // Cache storage blocked or unavailable
    }
    return null;
  }

  private async saveToCacheStorage(buffer: ArrayBuffer): Promise<void> {
    if (typeof caches === 'undefined') return;
    try {
      const cache = await caches.open(this.spec.cacheName);
      const response = new Response(buffer.slice(0), {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': buffer.byteLength.toString(),
          'X-Model-Sha256': this.spec.expectedSha256,
        },
      });
      await cache.put(this.spec.primaryUrl, response);
    } catch (_) {
      // Storage quota or private browsing restriction
    }
  }

  public async purgeCacheStorage(): Promise<void> {
    this.inMemoryCache = null;
    if (typeof caches === 'undefined') return;
    try {
      await caches.delete(this.spec.cacheName);
    } catch (_) {}
  }

  private async checkNodeFilesystem(): Promise<ArrayBuffer | null> {
    if (typeof process === 'undefined' || !process.versions?.node) return null;
    try {
      const fs = await import('fs');
      const path = await import('path');
      const localPaths = [
        path.resolve('models/saboorhsn/quran-stt-int8.onnx'),
        path.resolve('public/models/saboorhsn/quran-stt-int8.onnx'),
      ];
      for (const p of localPaths) {
        if (fs.existsSync(p)) {
          const buf = fs.readFileSync(p);
          return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        }
      }
    } catch (_) {}
    return null;
  }
}
