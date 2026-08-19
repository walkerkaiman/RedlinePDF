#!/usr/bin/env node
// Sync app version files to a release tag so the bundle/deb version and the
// in-app __APP_VERSION__ both match the GitHub release they ship under.
// Usage: node scripts/sync-release-version.mjs <x.y.z>   (e.g. 0.2.3)

import { readFileSync, writeFileSync } from 'node:fs';

const v = (process.argv[2] ?? '').trim().replace(/^v/, '');
if (!/^\d+\.\d+\.\d+$/.test(v)) {
  console.error(`Version must be X.Y.Z semver, got: ${v}`);
  process.exit(1);
}

// 1) src-tauri/tauri.conf.json — single source of truth:
//    drives the bundle filename / deb package version AND __APP_VERSION__ (vite).
const confPath = 'src-tauri/tauri.conf.json';
let confText = readFileSync(confPath, 'utf8');
if (!/"version"\s*:\s*"[^"]+"/.test(confText)) {
  console.error(`No "version" key found in ${confPath}`);
  process.exit(1);
}
writeFileSync(
  confPath,
  confText.replace(/("version"\s*:\s*)"[^"]+"/, `$1"${v}"`),
);

// 2) src-tauri/Cargo.toml — only the [package] version line; leave dependency versions alone.
const cargoPath = 'src-tauri/Cargo.toml';
const lines = readFileSync(cargoPath, 'utf8').split('\n');
let inPackage = false;
let replaced = false;
for (let i = 0; i < lines.length; i++) {
  if (/^\s*\[/.test(lines[i])) {
    inPackage = lines[i].trim() === '[package]';
  } else if (!replaced && inPackage && /^\s*version\s*=/.test(lines[i])) {
    lines[i] = `version = "${v}"`;
    replaced = true;
  }
}
if (!replaced) {
  console.error(`No version line found under [package] in ${cargoPath}`);
  process.exit(1);
}
writeFileSync(cargoPath, lines.join('\n'));

console.log(`Synced app version to ${v} (tauri.conf.json + Cargo.toml)`);
