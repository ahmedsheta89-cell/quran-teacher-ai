/**
 * @file compare_bundles.js
 * @description Forensic comparison of local production bundle vs live GitHub Pages bundle.
 */

import fs from 'fs';

async function main() {
  const liveUrl = 'https://ahmedsheta89-cell.github.io/quran-teacher-ai/assets/index-_YGbahu_.js';
  console.log(`Downloading LIVE bundle from: ${liveUrl}`);
  const liveRes = await fetch(liveUrl);
  const liveText = await liveRes.text();
  const files = fs.readdirSync('dist/assets');
  const mainJs = files.find((f) => f.startsWith('index-') && f.endsWith('.js'));
  if (!mainJs) throw new Error('No index-*.js found in dist/assets');
  const localText = fs.readFileSync(`dist/assets/${mainJs}`, 'utf8');

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
  console.log('====================================================================================================');

  const results = {};

  for (const m of markers) {
    const inLocal = localText.includes(m);
    const inLive = liveText.includes(m);
    results[m] = { local: inLocal, live: inLive };
    console.log(`Marker: ${m.padEnd(45)} | LOCAL: ${inLocal ? 'PRESENT' : 'ABSENT '} | LIVE: ${inLive ? 'PRESENT' : 'ABSENT '}`);
  }

  console.log('====================================================================================================\n');

  fs.writeFileSync('scratch/marker_comparison_results.json', JSON.stringify(results, null, 2));
}

main().catch(console.error);
