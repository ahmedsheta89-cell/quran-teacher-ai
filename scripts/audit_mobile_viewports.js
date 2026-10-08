/**
 * @file audit_mobile_viewports.js
 * @description Real Headless Chrome CDP Runner for Mobile Viewport and Horizontal Overflow Audit.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const VIEWPORT_MATRIX = [
  { name: 'iPhone SE (1st gen)', width: 320, height: 568 },
  { name: 'Standard Small Android', width: 360, height: 640 },
  { name: 'iPhone SE (2nd/3rd gen)', width: 375, height: 667 },
  { name: 'iPhone 12/13/14', width: 390, height: 844 },
  { name: 'Google Pixel 7 / Galaxy S', width: 412, height: 915 },
  { name: 'iPhone 14/15 Pro Max', width: 430, height: 932 },
];

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const USER_DATA_DIR = 'F:\\quran\\scratch\\chrome_cdp_profile';
const TARGET_URL = 'http://localhost:4173/';
const SCRATCH_DIR = 'F:\\quran\\scratch';

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.idCounter = 1;
    this.callbacks = new Map();
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (err) => reject(err);
      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id && this.callbacks.has(msg.id)) {
          const { resolve, reject, timer } = this.callbacks.get(msg.id);
          clearTimeout(timer);
          this.callbacks.delete(msg.id);
          if (msg.error) {
            reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          } else {
            resolve(msg.result);
          }
        }
      };
    });
  }

  async send(method, params = {}, timeoutMs = 8000) {
    const id = this.idCounter++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.callbacks.has(id)) {
          this.callbacks.delete(id);
          reject(new Error(`CDP method ${method} timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      this.callbacks.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {}
    }
  }
}

async function main() {
  console.log('🚀 Starting Real Headless Chrome Mobile Viewport Validation...');

  if (!fs.existsSync(SCRATCH_DIR)) {
    fs.mkdirSync(SCRATCH_DIR, { recursive: true });
  }

  // 1. Launch Chrome with CDP enabled
  const chromeArgs = [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--remote-debugging-port=9222',
    `--user-data-dir=${USER_DATA_DIR}`,
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-sync',
    '--disable-translate',
    '--mute-audio',
    '--no-first-run',
    '--safebrowsing-disable-auto-update',
    'about:blank',
  ];

  const chromeProc = spawn(CHROME_PATH, chromeArgs, { stdio: 'ignore' });

  // 2. Poll for CDP endpoint readiness
  let endpoints = null;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      endpoints = await fetchJson('http://127.0.0.1:9222/json/list');
      if (endpoints && endpoints.length > 0) break;
    } catch (e) {
      await wait(300);
    }
  }

  if (!endpoints || endpoints.length === 0) {
    chromeProc.kill();
    throw new Error('Failed to connect to Chrome DevTools Protocol after 30 attempts');
  }

  const pageEndpoint = endpoints[0];
  console.log(`📡 Connected to Chrome CDP: ${pageEndpoint.webSocketDebuggerUrl}`);

  const cdp = new CdpClient(pageEndpoint.webSocketDebuggerUrl);
  await cdp.connect();

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('DOM.enable');

  // Navigate to Target URL
  console.log(`🌐 Navigating to ${TARGET_URL}...`);
  await cdp.send('Page.navigate', { url: TARGET_URL });
  await wait(3000); // Allow initial bundles and React to render

  const auditResults = [];

  for (const vp of VIEWPORT_MATRIX) {
    console.log(`\n📱 Auditing Viewport: ${vp.name} (${vp.width}x${vp.height})...`);

    // Override device metrics
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: vp.width,
      height: vp.height,
      deviceScaleFactor: 2,
      mobile: true,
      fitWindow: false,
    });

    await wait(800); // Allow responsive reflow

    // Evaluate layout measurements in page context
    const evalRes = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const root = document.documentElement;
        const body = document.body;
        const winWidth = window.innerWidth;
        const scrollWidth = root.scrollWidth;
        const bodyScrollWidth = body ? body.scrollWidth : 0;
        const clientWidth = root.clientWidth;
        
        // Find elements causing horizontal overflow if any
        const overflowingElements = [];
        const allElements = document.querySelectorAll('*');
        for (const el of allElements) {
          const rect = el.getBoundingClientRect();
          if (rect.right > winWidth + 1) { // 1px tolerance for subpixel rounding
            const tag = el.tagName.toLowerCase();
            const id = el.id ? '#' + el.id : '';
            const cls = typeof el.className === 'string' ? '.' + el.className.split(' ').slice(0, 2).join('.') : '';
            overflowingElements.push({
              selector: tag + id + cls,
              right: rect.right,
              overflowPx: rect.right - winWidth,
            });
          }
        }

        const hasModal = !!document.querySelector('[data-testid="first-user-guide-modal"]') ||
                         document.body.innerText.includes('دليل الاستخدام') ||
                         document.body.innerText.includes('مرحباً بك');

        return {
          windowInnerWidth: winWidth,
          rootScrollWidth: scrollWidth,
          bodyScrollWidth: bodyScrollWidth,
          rootClientWidth: clientWidth,
          hasHorizontalOverflow: scrollWidth > winWidth,
          overflowDeltaPx: Math.max(0, scrollWidth - winWidth),
          overflowingElementsCount: overflowingElements.length,
          topOverflowingSample: overflowingElements.slice(0, 3),
          hasModal,
          pageTitle: document.title,
          textSample: document.body.innerText.slice(0, 100).replace(/\\s+/g, ' '),
        };
      })()`,
      returnByValue: true,
    });

    const metrics = evalRes?.result?.value || evalRes?.value || {};

    // Capture Screenshot (fromSurface: false for software renderer in headless)
    let screenshotSaved = false;
    try {
      const screenshotRes = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: false,
      }, 5000);

      const screenshotPath = path.join(SCRATCH_DIR, `screenshot_${vp.width}x${vp.height}.png`);
      fs.writeFileSync(screenshotPath, Buffer.from(screenshotRes.data, 'base64'));
      console.log(`   - Screenshot Saved: ${screenshotPath}`);
      screenshotSaved = true;
    } catch (ssErr) {
      console.warn(`   - Screenshot note: ${ssErr.message}`);
    }

    console.log(`   - Dimensions: width=${vp.width}px, height=${vp.height}px`);
    console.log(`   - Root ScrollWidth: ${metrics.rootScrollWidth}px (InnerWidth: ${metrics.windowInnerWidth}px)`);
    console.log(`   - Horizontal Overflow: ${metrics.hasHorizontalOverflow ? '❌ FAILED' : '✅ NONE (0px overflow)'}`);
    console.log(`   - Overflowing Elements: ${metrics.overflowingElementsCount}`);

    auditResults.push({
      device: vp.name,
      width: vp.width,
      height: vp.height,
      scrollWidth: metrics.rootScrollWidth,
      windowInnerWidth: metrics.windowInnerWidth,
      hasHorizontalOverflow: metrics.hasHorizontalOverflow,
      overflowDeltaPx: metrics.overflowDeltaPx,
      overflowingElementsCount: metrics.overflowingElementsCount,
      topOverflowingSample: metrics.topOverflowingSample,
      hasModal: metrics.hasModal,
      pageTitle: metrics.pageTitle,
      textSample: metrics.textSample,
      screenshotSaved,
      screenshotFile: `screenshot_${vp.width}x${vp.height}.png`,
      status: metrics.hasHorizontalOverflow ? 'FAIL' : 'PASS',
    });
  }

  cdp.close();
  chromeProc.kill();

  const report = {
    timestamp: new Date().toISOString(),
    engine: 'Google Chrome Headless (CDP)',
    targetUrl: TARGET_URL,
    totalViewportsAudited: auditResults.length,
    viewportsPassing: auditResults.filter((r) => r.status === 'PASS').length,
    viewportsFailing: auditResults.filter((r) => r.status === 'FAIL').length,
    results: auditResults,
  };

  const reportPath = path.join(SCRATCH_DIR, 'mobile_viewport_audit_results.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log('\n======================================================');
  console.log(`FINAL VIEWPORT AUDIT: ${report.viewportsPassing}/${report.totalViewportsAudited} VIEWPORTS PASSED`);
  console.log(`Report written to: ${reportPath}`);
  console.log('======================================================\n');
}

main().catch((err) => {
  console.error('Audit failed with error:', err);
  process.exit(1);
});
