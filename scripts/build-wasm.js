const { execFileSync } = require('node:child_process');
const { copyFileSync, mkdirSync, statSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const artifact = join(
  root,
  'engine',
  'target',
  'wasm32-unknown-unknown',
  'release',
  'spreadnext_formula_engine.wasm'
);
const destination = join(root, 'public', 'formula-engine.wasm');

execFileSync(
  'cargo',
  ['build', '--manifest-path', join(root, 'engine', 'Cargo.toml'), '--release', '--target', 'wasm32-unknown-unknown'],
  { stdio: 'inherit' }
);

mkdirSync(join(root, 'public'), { recursive: true });
copyFileSync(artifact, destination);

const size = statSync(destination).size;
console.log(`Formula engine built: public/formula-engine.wasm (${(size / 1024).toFixed(1)} kB)`);
