/**
 * @file RuntimeEnvironment.test.ts
 * @description Unit tests for cross-platform runtime environment detection and capability negotiation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RuntimeEnvironment } from '../infrastructure/runtime/RuntimeEnvironment.ts';

describe('RuntimeEnvironment - Cross-Platform Detection Unit Tests', () => {
  beforeEach(() => {
    RuntimeEnvironment.resetCache();
  });

  afterEach(() => {
    RuntimeEnvironment.resetCache();
  });

  it('1. should detect node/test environment cleanly without throwing', () => {
    const caps = RuntimeEnvironment.detect();
    expect(caps).toBeDefined();
    expect(caps.platform).toBeDefined();
    expect(typeof caps.isOnline).toBe('boolean');
  });

  it('2. should detect Windows desktop environment when custom flag or platform parameter is present', () => {
    // Simulate window with location search
    const originalWindow = globalThis.window;
    try {
      (globalThis as any).window = {
        location: { search: '?platform=windows' },
        navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', onLine: true },
        matchMedia: () => ({ matches: false }),
      };

      RuntimeEnvironment.resetCache();
      const caps = RuntimeEnvironment.detect();
      expect(caps.isWindowsDesktop).toBe(true);
      expect(caps.platform).toBe('WINDOWS_DESKTOP');
    } finally {
      (globalThis as any).window = originalWindow;
    }
  });

  it('3. should detect PWA standalone mode when display-mode matches', () => {
    const originalWindow = globalThis.window;
    try {
      (globalThis as any).window = {
        location: { search: '' },
        navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14)', onLine: true },
        matchMedia: (query: string) => ({ matches: query.includes('display-mode: standalone') }),
      };

      RuntimeEnvironment.resetCache();
      const caps = RuntimeEnvironment.detect();
      expect(caps.isStandalonePWA).toBe(true);
      expect(caps.platform).toBe('WEB_PWA');
    } finally {
      (globalThis as any).window = originalWindow;
    }
  });

  it('4. should detect web browser mode as default when no desktop or standalone flag is active', () => {
    const originalWindow = globalThis.window;
    try {
      (globalThis as any).window = {
        location: { search: '' },
        navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0', onLine: true },
        matchMedia: () => ({ matches: false }),
      };

      RuntimeEnvironment.resetCache();
      const caps = RuntimeEnvironment.detect();
      expect(caps.isWebBrowser).toBe(true);
      expect(caps.platform).toBe('WEB_BROWSER');
    } finally {
      (globalThis as any).window = originalWindow;
    }
  });
});
