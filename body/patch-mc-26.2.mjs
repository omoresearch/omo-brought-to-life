#!/usr/bin/env node
// Teach the vendored Mineflayer stack Minecraft 26.2 (Omo Space's version)
// until the upstream releases land. Idempotent; re-run after `npm install`.
//
//  * minecraft-data: 26.2 data from PrismarineJS/minecraft-data#1339
//  * minecraft-protocol, mineflayer: list 26.2 as supported (upstream PRs
//    PrismarineJS/node-minecraft-protocol#1550 and mineflayer#4192 say no
//    source changes are needed beyond the data)
//  * prismarine-chunk: map 26.2 to the 1.18 chunk format (prismarine-chunk#333)
//  * prismarine-physics: 26.2 feature flags (prismarine-physics#138)
//
// Usage: node patch-mc-26.2.mjs [node_modules dir]   (runs as npm postinstall)

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const NM = path.resolve(process.argv[2] || 'node_modules');
const DATA_REPO = 'Cyverno/minecraft-data';
const DATA_REF = process.env.MC_DATA_REF || 'f5c90c2a56d12fe1ae76027d85714bf6c1fc2fd6';
const VERSION = '26.2';

function findPackages(name, dir = NM, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (entry === name && existsSync(path.join(full, 'package.json'))) out.push(full);
    if (entry === 'node_modules' || entry.startsWith('@')) findPackages(name, full, out);
    else if (statSync(full).isDirectory() && existsSync(path.join(full, 'node_modules'))) {
      findPackages(name, path.join(full, 'node_modules'), out);
    }
  }
  return out;
}

function edit(file, transform) {
  const before = readFileSync(file, 'utf8');
  const after = transform(before);
  if (after !== before) {
    writeFileSync(file, after);
    console.log(`patched ${path.relative(NM, file)}`);
  }
}

// 1. minecraft-data
const tarball = `${os.tmpdir()}/mcdata-${DATA_REF}.tar.gz`;
if (!existsSync(tarball)) {
  execFileSync('curl', ['-fsSL', '-o', tarball, `https://codeload.github.com/${DATA_REPO}/tar.gz/${DATA_REF}`]);
}
const extractDir = `${os.tmpdir()}/mcdata-${DATA_REF}`;
if (!existsSync(extractDir)) {
  mkdirSync(extractDir, { recursive: true });
  execFileSync('tar', ['-xzf', tarball, '-C', extractDir, '--strip-components=1', '--wildcards', '*/data/pc/26.2', '*/data/dataPaths.json', '*/data/pc/common/protocolVersions.json']);
}
for (const pkg of findPackages('minecraft-data')) {
  const data = path.join(pkg, 'minecraft-data', 'data');
  if (!existsSync(data)) continue;
  execFileSync('cp', ['-r', path.join(extractDir, 'data', 'pc', VERSION), path.join(data, 'pc')]);
  const upstream = JSON.parse(readFileSync(path.join(extractDir, 'data', 'dataPaths.json'), 'utf8'));
  const pathsFile = path.join(data, 'dataPaths.json');
  const local = JSON.parse(readFileSync(pathsFile, 'utf8'));
  if (!local.pc['26.1']) continue; // too old to extend (an unrelated nested copy)
  if (!local.pc[VERSION] && upstream.pc[VERSION]) {
    // Upstream may point at shared dirs this older package lacks; fall back to 26.1's.
    const resolved = {};
    for (const [key, dir] of Object.entries(upstream.pc[VERSION])) {
      const file = key === 'proto' ? 'proto.yml' : `${key}.json`;
      resolved[key] = existsSync(path.join(data, dir, file)) ? dir : local.pc['26.1'][key];
      if (!resolved[key]) delete resolved[key];
    }
    local.pc[VERSION] = resolved;
    writeFileSync(pathsFile, JSON.stringify(local, null, 2));
    console.log(`patched ${path.relative(NM, pathsFile)}`);
  }
  // data.js is a generated static index of lazy requires; add the version block.
  const paths = local.pc[VERSION];
  const dataJs = path.join(pkg, 'data.js');
  if (paths && existsSync(dataJs)) {
    edit(dataJs, (src) => {
      if (src.includes(`'${VERSION}': {`)) return src;
      const getters = Object.entries(paths).map(([key, dir]) => (key === 'proto'
        ? `      proto: __dirname + '/minecraft-data/data/${dir}/proto.yml'`
        : `      get ${key} () { return require("./minecraft-data/data/${dir}/${key}.json") }`)).join(',\n');
      const anchor = src.indexOf("    '26.1': {");
      if (anchor < 0) return src;
      return `${src.slice(0, anchor)}    '${VERSION}': {\n${getters}\n    },\n${src.slice(anchor)}`;
    });
  }
  const pv = path.join(data, 'pc', 'common', 'protocolVersions.json');
  const local26 = JSON.parse(readFileSync(pv, 'utf8'));
  if (!local26.some((v) => v.minecraftVersion === VERSION)) {
    const up = JSON.parse(readFileSync(path.join(extractDir, 'data', 'pc', 'common', 'protocolVersions.json'), 'utf8'));
    const entry = up.find((v) => v.minecraftVersion === VERSION);
    if (entry) {
      local26.unshift(entry);
      writeFileSync(pv, JSON.stringify(local26, null, 2));
      console.log(`patched ${path.relative(NM, pv)}`);
    }
  }
}

// 2. supported-version lists
const addAfter261 = (src) => (src.includes(`'${VERSION}'`) ? src : src.replace(/'26\.1'\]/, `'26.1', '${VERSION}']`));
for (const pkg of findPackages('minecraft-protocol')) edit(path.join(pkg, 'src', 'version.js'), addAfter261);
for (const pkg of findPackages('mineflayer')) edit(path.join(pkg, 'lib', 'version.js'), addAfter261);

// 3. prismarine-chunk
for (const pkg of findPackages('prismarine-chunk')) {
  edit(path.join(pkg, 'src', 'index.js'), (src) => (src.includes(`${VERSION}:`)
    ? src
    : src.replace("26.1: require('./pc/1.18/chunk')", `26.1: require('./pc/1.18/chunk'),\n    ${VERSION}: require('./pc/1.18/chunk')`)));
}

// 4. prismarine-physics
for (const pkg of findPackages('prismarine-physics')) {
  edit(path.join(pkg, 'lib', 'features.json'), (src) => src.replace(/"26\.1"\]/g, `"26.1", "${VERSION}"]`));
}
console.log('Minecraft 26.2 patch done');
