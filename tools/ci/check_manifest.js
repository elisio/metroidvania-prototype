#!/usr/bin/env node
// Verifica se todo arquivo referenciado pelos manifestos de assets existe.
//
// Lê assets/game/manifest.js (window.ASSET_MANIFEST) e, se houver,
// assets/game/hero_sheet.js (window.HERO_SHEET.image). Os scripts são
// executados num sandbox `vm` com um `window` falso — sem dependências.
//
// Uso: node tools/ci/check_manifest.js [raiz-do-repo]
// Saída: 0 se tudo existe, 1 se faltar arquivo ou o manifesto for inválido.
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));
const gameDir = path.join(root, 'assets', 'game');
const errors = [];
let checked = 0;

function loadWindowScript(file) {
  const sandbox = { window: {}, console };
  sandbox.self = sandbox.window;
  sandbox.globalThis = sandbox.window;
  const code = fs.readFileSync(file, 'utf8');
  vm.runInNewContext(code, sandbox, { filename: file, timeout: 2000 });
  return sandbox.window;
}

function checkFile(ref, from) {
  checked++;
  if (typeof ref !== 'string' || !ref) {
    errors.push(`${from}: referência inválida (${JSON.stringify(ref)})`);
    return;
  }
  const full = path.resolve(gameDir, ref);
  if (!full.startsWith(root + path.sep)) {
    errors.push(`${from}: "${ref}" aponta para fora do repositório`);
    return;
  }
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    errors.push(`${from}: arquivo ausente: ${path.relative(root, full)}`);
  }
}

// 1) manifest.js — obrigatório
const manifestPath = path.join(gameDir, 'manifest.js');
if (!fs.existsSync(manifestPath)) {
  console.error(`ERRO: ${path.relative(root, manifestPath)} não encontrado`);
  process.exit(1);
}
let win;
try {
  win = loadWindowScript(manifestPath);
} catch (e) {
  console.error(`ERRO: falha ao executar manifest.js: ${e.message}`);
  process.exit(1);
}
const manifest = win.ASSET_MANIFEST;
if (!manifest || typeof manifest !== 'object') {
  console.error('ERRO: manifest.js não define window.ASSET_MANIFEST');
  process.exit(1);
}
for (const [key, entry] of Object.entries(manifest)) {
  const ref = typeof entry === 'string' ? entry : entry && (entry.file || entry.src || entry.path);
  checkFile(ref, `ASSET_MANIFEST["${key}"]`);
}

// 2) hero_sheet.js — opcional
const heroPath = path.join(gameDir, 'hero_sheet.js');
if (fs.existsSync(heroPath)) {
  try {
    const hw = loadWindowScript(heroPath);
    if (hw.HERO_SHEET && hw.HERO_SHEET.image) checkFile(hw.HERO_SHEET.image, 'HERO_SHEET.image');
    else errors.push('hero_sheet.js: window.HERO_SHEET.image não definido');
  } catch (e) {
    errors.push(`hero_sheet.js: falha ao executar: ${e.message}`);
  }
}

if (errors.length) {
  console.error(`check_manifest: ${errors.length} problema(s) em ${checked} referência(s):`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log(`check_manifest: OK — ${checked} referência(s), todos os arquivos existem.`);
