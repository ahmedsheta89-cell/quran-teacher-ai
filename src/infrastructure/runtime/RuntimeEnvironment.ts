/**
 * @file RuntimeEnvironment.ts
 * @module infrastructure/runtime
 * @description Unified cross-platform runtime environment detector and capability negotiator
 * for Aya AI Quran Teacher (Browser, PWA, and Windows Desktop).
 */

export type PlatformType = 'WINDOWS_DESKTOP' | 'WEB_PWA' | 'WEB_BROWSER';

export interface RuntimeCapabilities {
  readonly platform: PlatformType;
  readonly isWindowsDesktop: boolean;
  readonly isStandalonePWA: boolean;
  readonly isWebBrowser: boolean;
  readonly hasIndexedDB: boolean;
  readonly hasServiceWorker: boolean;
  readonly hasWebAssembly: boolean;
  readonly hasAudioContext: boolean;
  readonly hasMediaDevices: boolean;
  readonly isOnline: boolean;
  readonly userAgent: string;
}

export class RuntimeEnvironment {
  private static cachedCapabilities: RuntimeCapabilities | null = null;

  /**
   * Detects and returns current runtime capabilities across Web, PWA, and Windows Desktop.
   */
  public static detect(): RuntimeCapabilities {
    if (this.cachedCapabilities) {
      // Re-evaluate dynamic online state
      return {
        ...this.cachedCapabilities,
        isOnline: typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean' ? navigator.onLine : true,
      };
    }

    const isBrowser = typeof window !== 'undefined';
    const userAgent = isBrowser && navigator.userAgent ? navigator.userAgent : 'Node.js/Test';

    // 1. Detect Standalone PWA
    const isStandalonePWA =
      isBrowser &&
      (window.matchMedia?.('(display-mode: standalone)').matches ||
        (window.navigator as unknown as { standalone?: boolean })?.standalone === true ||
        (typeof document !== 'undefined' && document.referrer?.includes('android-app://')));

    // 2. Detect Windows Desktop Native Host (Edge App mode, Electron/Tauri or Custom Native Launcher)
    const isWindowsDesktop =
      isBrowser &&
      (window.location.search.includes('platform=windows') ||
        (window as unknown as { __AYA_WINDOWS_DESKTOP__?: boolean }).__AYA_WINDOWS_DESKTOP__ === true ||
        (userAgent.includes('Windows') && isStandalonePWA));

    // Platform Type
    let platform: PlatformType = 'WEB_BROWSER';
    if (isWindowsDesktop) {
      platform = 'WINDOWS_DESKTOP';
    } else if (isStandalonePWA) {
      platform = 'WEB_PWA';
    }

    const hasIndexedDB = isBrowser && 'indexedDB' in window;
    const hasServiceWorker = isBrowser && 'serviceWorker' in navigator;
    const hasWebAssembly = typeof WebAssembly !== 'undefined';
    const hasAudioContext = isBrowser && ('AudioContext' in window || 'webkitAudioContext' in window);
    const hasMediaDevices = isBrowser && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    const isOnline = isBrowser && typeof navigator.onLine === 'boolean' ? navigator.onLine : true;

    this.cachedCapabilities = {
      platform,
      isWindowsDesktop,
      isStandalonePWA,
      isWebBrowser: platform === 'WEB_BROWSER',
      hasIndexedDB,
      hasServiceWorker,
      hasWebAssembly,
      hasAudioContext,
      hasMediaDevices,
      isOnline,
      userAgent,
    };

    return this.cachedCapabilities;
  }

  /**
   * Reset cache for testing
   */
  public static resetCache(): void {
    this.cachedCapabilities = null;
  }
}
