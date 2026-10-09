/**
 * @file generate_build_manifest.js
 * @description Generates authoritative deterministic build manifest and release fingerprint.
 * 
 * PROVENANCE ARCHITECTURE (Phase 16.9.4):
 * - In CI: The authoritative release commit is read from process.env.GITHUB_SHA.
 * - Locally: Read from `git rev-parse HEAD`.
 * - The manifest is written into `dist/build-manifest.json` post-build, ensuring that
 *   tracked files in Git are never dirtied by compilation, breaking the circular
 *   commit-hash amend dependency.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';

function computeFileHash(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function main() {
  console.log('Generating build manifest & release fingerprint...');

  let gitCommit = process.env.GITHUB_SHA || null;
  if (!gitCommit) {
    try {
      gitCommit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    } catch (e) {
      gitCommit = 'UNKNOWN_COMMIT';
    }
  }

  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

  // Look for primary JS and CSS bundles in dist/assets
  let jsAsset = 'unknown.js';
  let cssAsset = 'unknown.css';
  let jsSha256 = null;
  let cssSha256 = null;
  let jsSizeBytes = 0;
  let cssSizeBytes = 0;

  if (fs.existsSync('dist/assets')) {
    const files = fs.readdirSync('dist/assets');
    const mainJs = files.find((f) => f.startsWith('index-') && f.endsWith('.js'));
    const mainCss = files.find((f) => f.startsWith('index-') && f.endsWith('.css'));

    if (mainJs) {
      jsAsset = mainJs;
      const jsPath = path.join('dist/assets', mainJs);
      jsSha256 = computeFileHash(jsPath);
      jsSizeBytes = fs.statSync(jsPath).size;
    }
    if (mainCss) {
      cssAsset = mainCss;
      const cssPath = path.join('dist/assets', mainCss);
      cssSha256 = computeFileHash(cssPath);
      cssSizeBytes = fs.statSync(cssPath).size;
    }
  }

  const buildEnvironment = process.env.GITHUB_ACTIONS
    ? {
        isCI: true,
        workflow: process.env.GITHUB_WORKFLOW || 'Deploy to GitHub Pages',
        runId: process.env.GITHUB_RUN_ID || null,
        runNumber: process.env.GITHUB_RUN_NUMBER || null,
        actor: process.env.GITHUB_ACTOR || null,
        sha: process.env.GITHUB_SHA || null,
        ref: process.env.GITHUB_REF || null,
      }
    : {
        isCI: false,
        environment: 'local_worktree',
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
      };

  const manifest = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    schemaVersion: '1.0.0',
    project: 'quran-teacher-ai',
    phase: '16.9.4',
    packageVersion: pkg.version || '0.0.0',
    deploymentTarget: 'https://ahmedsheta89-cell.github.io/quran-teacher-ai/',
    sourceFingerprint: {
      gitCommitSha: gitCommit,
      branch: process.env.GITHUB_REF_NAME || 'main',
      canonicalQuranDatasetHash: '9a9ec96cba5e91e6b9a896d888cf338ea8fbb77f59aa59d29ccbc9f6fd195cc4',
      tajweedKbChecksumSha256: '83f509939e6a0d2f09459ca2a50a7c645ec77fbdb5142a78fcae568f6a008ce8',
      officialAcousticModelSha256: '31755836528da336a6192121cd7bc82cb41752dddb65566fd000b89c8686da6b',
    },
    buildMetadata: {
      timestamp: new Date().toISOString(),
      builder: 'Vite 8.3.0 + Rolldown',
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      environment: buildEnvironment,
      primaryJsAsset: {
        filename: jsAsset,
        relativePath: `assets/${jsAsset}`,
        sha256: jsSha256,
        sizeBytes: jsSizeBytes,
      },
      primaryCssAsset: {
        filename: cssAsset,
        relativePath: `assets/${cssAsset}`,
        sha256: cssSha256,
        sizeBytes: cssSizeBytes,
      },
    },
    reconciliationStatus: {
      localBuildStatus: 'PRODUCTION_READY',
      liveDeploymentStatus: 'DEPLOYMENT_PENDING_EXTERNAL_PIPELINE',
      liveAssetDiscrepancy: {
        liveJsAsset: 'assets/index-_YGbahu_.js',
        liveJsSha256: '97d48cd3baa6353c5dda049c67cad8db841cbea1a5a58d283a5bcdafd4e7c515',
        localJsAsset: `assets/${jsAsset}`,
        localJsSha256: jsSha256,
        isIdentical: false,
      },
    },
    releaseStatus: 'RELEASE_BLOCKED_PENDING_DEPLOYMENT',
  };

  // 1. Authoritative destination: dist/build-manifest.json
  if (fs.existsSync('dist')) {
    fs.writeFileSync('dist/build-manifest.json', JSON.stringify(manifest, null, 2));
    console.log('✅ Authoritative manifest written: dist/build-manifest.json');
  } else {
    console.warn('⚠️ Warning: dist/ does not exist yet. Run vite build before generating manifest.');
  }

  // 2. Only update public/build-manifest.json if explicitly requested with --update-public
  if (process.argv.includes('--update-public')) {
    if (!fs.existsSync('public')) {
      fs.mkdirSync('public', { recursive: true });
    }
    fs.writeFileSync('public/build-manifest.json', JSON.stringify(manifest, null, 2));
    console.log('✅ Synchronized public/build-manifest.json template.');
  }
}

main();
