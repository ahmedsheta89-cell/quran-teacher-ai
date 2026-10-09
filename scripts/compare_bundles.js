/**
 * @file compare_bundles.js
 * @description Forensic comparison of local production bundle vs live GitHub Pages bundle.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

function computeSha256(text) {
  return crypto.createHash('sha256').update(Buffer.from(text)).digest('hex');
}

async function main() {
  const baseUrl = 'https://ahmedsheta89-cell.github.io/quran-teacher-ai/';
  console.log(`Scraping LIVE deployment HTML from: ${baseUrl}`);
  const htmlRes = await fetch(baseUrl);
  const htmlText = await htmlRes.text();

  // Dynamically extract main JS asset from live HTML
  const scriptMatch = htmlText.match(/src="(?:\.\/)?([^"]*assets\/index-[^"]+\.js)"/);
  let liveAssetUrl = null;
  let liveJsFilename = 'unknown';

  if (scriptMatch) {
    const relativeSrc = scriptMatch[1];
    liveJsFilename = path.basename(relativeSrc);
    liveAssetUrl = relativeSrc.startsWith('http')
      ? relativeSrc
      : new URL(relativeSrc, baseUrl).href;
    console.log(`Discovered LIVE script asset from HTML: ${liveAssetUrl}`);
  } else {
    liveJsFilename = 'index-_YGbahu_.js';
    liveAssetUrl = 'https://ahmedsheta89-cell.github.io/quran-teacher-ai/assets/index-_YGbahu_.js';
    console.warn(`Could not extract script tag from HTML, falling back to: ${liveAssetUrl}`);
  }

  const liveRes = await fetch(liveAssetUrl);
  const liveText = await liveRes.text();
  const liveSha256 = computeSha256(liveText);

  // Check live build-manifest.json
  let liveManifest = null;
  let liveManifestFound = false;
  try {
    const manifestUrl = new URL('build-manifest.json', baseUrl).href;
    const manifestRes = await fetch(manifestUrl);
    if (manifestRes.ok) {
      liveManifest = await manifestRes.json();
      liveManifestFound = true;
      console.log('✅ LIVE build-manifest.json found and loaded.');
    } else {
      console.log(`ℹ️ LIVE build-manifest.json status: ${manifestRes.status}`);
    }
  } catch (e) {
    console.log('Error fetching live manifest:', e.message);
  }

  // Load local dist assets
  if (!fs.existsSync('dist/assets')) {
    throw new Error('dist/assets not found. Run npm run build first.');
  }
  const files = fs.readdirSync('dist/assets');
  const mainJs = files.find((f) => f.startsWith('index-') && f.endsWith('.js'));
  if (!mainJs) throw new Error('No index-*.js found in dist/assets');
  const localText = fs.readFileSync(`dist/assets/${mainJs}`, 'utf8');
  const localSha256 = computeSha256(localText);

  const markers = [
    'مقرأة معلّم القرآن الرقمي',
    'أهلاً بك في منصة معلّم القرآن الرقمي الذكي لمساعدتك على مدارسة وتسميع القرآن الكريم',
    'EXACT_NORMALIZED_MATCH: Observed tokens precisely match expected word',
    'HUMMING_OR_NOISE_REJECTED',
    'لم أتحقق من نطق الكلمة بوضوح. اقرأ بتؤدة وترتيل.',
    'ADVANCEMENT_REQUESTED',
    'ADVANCEMENT_APPROVED',
    'ADVANCEMENT_COMMITTED',
    'ADVANCEMENT_REJECTED',
    'SCIENTIFICALLY_UNVALIDATED_PARTIAL_MATCH',
    'Math.random() > 0.65',
  ];

  console.log('\n====================================================================================================');
  console.log('MARKER RECONCILIATION AUDIT (LOCAL BUILD vs LIVE DEPLOYED)');
  console.log(`LOCAL ASSET: ${mainJs} (SHA-256: ${localSha256})`);
  console.log(`LIVE ASSET:  ${liveJsFilename} (SHA-256: ${liveSha256})`);
  console.log(`MATCH:       ${localSha256 === liveSha256 ? 'IDENTICAL_PASS' : 'MISMATCH_DISCREPANCY'}`);
  console.log('====================================================================================================');

  const results = {
    localAsset: { filename: mainJs, sha256: localSha256 },
    liveAsset: { filename: liveJsFilename, sha256: liveSha256, url: liveAssetUrl },
    isIdentical: localSha256 === liveSha256,
    liveManifestFound,
    liveManifest,
    markers: {},
  };

  for (const m of markers) {
    const inLocal = localText.includes(m);
    const inLive = liveText.includes(m);
    results.markers[m] = { local: inLocal, live: inLive };
    console.log(`Marker: ${m.padEnd(45)} | LOCAL: ${inLocal ? 'PRESENT' : 'ABSENT '} | LIVE: ${inLive ? 'PRESENT' : 'ABSENT '}`);
  }

  console.log('====================================================================================================\n');

  if (!fs.existsSync('scratch')) fs.mkdirSync('scratch', { recursive: true });
  fs.writeFileSync('scratch/marker_comparison_results.json', JSON.stringify(results, null, 2));
}

main().catch(console.error);
