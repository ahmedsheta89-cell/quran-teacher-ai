/**
 * @file audit_live_runtime_browser.js
 * @description Real Headless Chrome CDP Runner inspecting the LIVE deployed site.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const LIVE_URL = 'https://ahmedsheta89-cell.github.io/quran-teacher-ai/';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const USER_DATA_DIR = 'F:\\quran\\scratch\\chrome_live_profile';
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
    this.events = [];
    this.consoleLogs = [];
    this.networkErrors = [];
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
        } else if (msg.method) {
          if (msg.method === 'Runtime.consoleAPICalled') {
            this.consoleLogs.push({
              type: msg.params.type,
              args: (msg.params.args || []).map((a) => a.value ?? a.description),
            });
          } else if (msg.method === 'Network.loadingFailed') {
            this.networkErrors.push(msg.params);
          }
        }
      };
    });
  }

  async send(method, params = {}, timeoutMs = 12000) {
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
  console.log('🚀 Launching Real Chrome CDP against LIVE deployment...');

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
    throw new Error('Failed to connect to Chrome DevTools Protocol');
  }

  const pageEndpoint = endpoints[0];
  console.log(`📡 Connected to Chrome CDP: ${pageEndpoint.webSocketDebuggerUrl}`);

  const cdp = new CdpClient(pageEndpoint.webSocketDebuggerUrl);
  await cdp.connect();

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');

  console.log(`🌐 Navigating to LIVE URL: ${LIVE_URL}...`);
  await cdp.send('Page.navigate', { url: LIVE_URL });
  await wait(4000); // Allow remote assets from GitHub Pages to download and execute

  // Evaluate DOM state of LIVE deployment
  const evalRes = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const title = document.title;
      const htmlDir = document.documentElement.getAttribute('dir') || document.body.getAttribute('dir');
      const lang = document.documentElement.getAttribute('lang');
      const root = document.documentElement;
      const bodyText = document.body ? document.body.innerText : '';

      const hasModalInDom = bodyText.includes('مقرأة معلّم القرآن الرقمي') ||
                            bodyText.includes('دليل الاستخدام') ||
                            !!document.querySelector('[data-testid=\"first-user-guide-modal\"]');

      const hasClassroomView = bodyText.includes('الفاتحة') ||
                               bodyText.includes('ابدأ التسميع') ||
                               bodyText.includes('تسميع');

      const scripts = Array.from(document.querySelectorAll('script[src]')).map(s => s.src);

      return {
        title,
        htmlDir,
        lang,
        scrollWidth: root.scrollWidth,
        clientWidth: root.clientWidth,
        innerWidth: window.innerWidth,
        hasModalInDom,
        hasClassroomView,
        scripts,
        bodySnippet: bodyText.slice(0, 150).replace(/\\s+/g, ' '),
      };
    })()`,
    returnByValue: true,
  });

  const domState = evalRes.result?.value || {};

  // Capture Screenshot of LIVE site
  let screenshotSaved = false;
  try {
    const screenshotRes = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: false,
    }, 6000);
    const ssPath = path.join(SCRATCH_DIR, 'live_deployment_screenshot.png');
    fs.writeFileSync(ssPath, Buffer.from(screenshotRes.data, 'base64'));
    console.log(`📸 Captured live deployment screenshot: ${ssPath}`);
    screenshotSaved = true;
  } catch (e) {
    console.warn('Screenshot error:', e.message);
  }

  cdp.close();
  chromeProc.kill();

  const auditReport = {
    timestamp: new Date().toISOString(),
    liveUrl: LIVE_URL,
    domState,
    consoleErrorsCount: cdp.consoleLogs.filter((l) => l.type === 'error').length,
    consoleErrors: cdp.consoleLogs.filter((l) => l.type === 'error'),
    networkErrorsCount: cdp.networkErrors.length,
    networkErrors: cdp.networkErrors,
    screenshotSaved,
    microphoneTestStatus: 'NOT_TESTED (Automated headless environment without interactive user prompt)',
    reconciliationFindings: {
      isPageAccessible: true,
      isRtlConfigured: domState.htmlDir === 'rtl',
      isFirstUserGuideModalPresentInLive: domState.hasModalInDom,
      isOldBundleLoadedInLive: domState.scripts.some((s) => s.includes('index-_YGbahu_.js')),
    },
  };

  console.log('\n====================================================================================================');
  console.log('LIVE RUNTIME AUDIT SUMMARY:');
  console.log(`Page Title: ${domState.title}`);
  console.log(`RTL Direction: ${domState.htmlDir} (lang: ${domState.lang})`);
  console.log(`FirstUserGuideModal in Live DOM: ${domState.hasModalInDom ? '✅ PRESENT' : '❌ ABSENT (Old Bundle)'}`);
  console.log(`Classroom View Mounted: ${domState.hasClassroomView ? '✅ YES' : '❌ NO'}`);
  console.log(`Active Bundle in Live: ${domState.scripts.join(', ')}`);
  console.log(`Console Errors: ${auditReport.consoleErrorsCount}`);
  console.log(`Microphone Hardware Live Test: ${auditReport.microphoneTestStatus}`);
  console.log('====================================================================================================\n');

  fs.writeFileSync('scratch/live_runtime_browser_audit.json', JSON.stringify(auditReport, null, 2));
}

main().catch(console.error);
