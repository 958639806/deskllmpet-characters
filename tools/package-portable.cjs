#!/usr/bin/env node
'use strict';

// Builds a self-contained Windows portable edition from the already verified
// local Electron runtime. No download, installation, source edit or user-data
// access takes place. Existing releases and ZIP files are never overwritten.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createRequire } = require('module');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const APP_EXE = 'DeskLLMPet-BlueMaid.exe';
const REQUIRED_ASSETS = [];
const REQUIRED_APP_FILES = [
  'package.json', 'LICENSE', 'src/main/main.js', 'src/shared/deepseek-api.js',
  'src/shared/characters.js', 'src/main/character-manager.js',
  'src/plugins/plugin-manager.js', 'src/plugins/llm-chat/plugin.json',
  'src/plugins/llm-chat/main.js', 'src/plugins/llm-chat/renderer/chat.html',
  'assets/icon.png', 'assets/tray-icon.png'
];
const args = new Set(process.argv.slice(2));
for (const arg of args) if (arg !== '--dry-run' && !/^--revision=[a-z0-9][a-z0-9.-]*$/i.test(arg)) throw new Error(`Unknown argument: ${arg}`);
const revisions = [...args].filter(arg => arg.startsWith('--revision='));
if (revisions.length > 1) throw new Error('Specify at most one output revision');
const revision = revisions.length ? `-${revisions[0].slice('--revision='.length)}` : '';

function invariant(ok, message) { if (!ok) throw new Error(message); }
function json(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function relative(file) { return path.relative(ROOT, file).split(path.sep).join('/'); }
function inside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}
function assertOwned(file) {
  invariant(file !== ROOT && inside(ROOT, file), `Output is outside the project: ${file}`);
}
function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function packageNameValid(name) {
  return /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name);
}
function findPackage(name, fromDir) {
  invariant(packageNameValid(name), `Invalid dependency name: ${name}`);
  const request = createRequire(path.join(fromDir, 'package.json'));
  for (const base of request.resolve.paths(name) || []) {
    const candidate = path.join(base, name, 'package.json');
    if (fs.existsSync(candidate)) {
      const real = fs.realpathSync(path.dirname(candidate));
      invariant(json(path.join(real, 'package.json')).name === name, `Dependency name mismatch: ${name}`);
      return real;
    }
  }
  throw new Error(`Missing production dependency ${name} from ${relative(fromDir)}`);
}
function licenseFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && /^(?:licen[cs]e|copying|notice)(?:[._-].*)?$/i.test(entry.name))
    .map(entry => entry.name).sort();
}
function characterAssetPlan() {
  const { CHARACTERS, DEFAULT_CHARACTER_ID } = require(path.join(ROOT, 'src/shared/characters'));
  const expectedIds = ['blue-maid', 'blonde-reaper', 'orange-mage', 'violet-cat', 'white-dragon'];
  invariant(Array.isArray(CHARACTERS) && CHARACTERS.length === 5 && DEFAULT_CHARACTER_ID === 'blue-maid',
    'The five-character registry/default is incomplete');
  invariant(CHARACTERS.map(character => character.id).sort().join('|') === expectedIds.sort().join('|'),
    'The five-character registry IDs do not match this edition');
  return CHARACTERS.map(character => {
    const root = path.resolve(ROOT, character.animationRoot);
    invariant(inside(path.join(ROOT, 'assets'), root), `Character root leaves production assets: ${character.id}`);
    const files = {};
    for (const action of ['idle', 'click']) {
      const dir = path.join(root, action);
      invariant(fs.existsSync(dir) && fs.statSync(dir).isDirectory(), `Missing ${character.id} production ${action} folder`);
      files[action] = fs.readdirSync(dir).filter(file => file.toLowerCase().endsWith('.webm')).sort()
        .map(file => `${character.animationRoot}/${action}/${file}`.replaceAll('\\', '/'));
    }
    const carry = files.click.filter(file => /拖拽悬空|被鼠标拖拽/i.test(path.basename(file)));
    const pat = files.click.filter(file => /摸头/i.test(path.basename(file)) && !carry.includes(file));
    invariant(files.idle.length === 1 && files.click.length === 2 && carry.length === 1 && pat.length === 1,
      `Expected idle, head-pat and carry production clips for ${character.id}`);
    return { ...character, actions: { idle: files.idle[0], pat: pat[0], carry: carry[0] } };
  });
}

const rootPackage = json(path.join(ROOT, 'package.json'));
invariant(/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(rootPackage.version), 'Invalid release version');
const bundleName = `DeskLLMPet-BlueMaid-v${rootPackage.version}${revision}`;
const releaseParent = path.join(ROOT, 'release');
const output = path.join(releaseParent, bundleName);
const zipOutput = path.join(ROOT, `${bundleName}.zip`);
assertOwned(output);
assertOwned(zipOutput);
invariant(!fs.existsSync(output), `Refusing to overwrite existing release: ${relative(output)}`);
invariant(!fs.existsSync(zipOutput), `Refusing to overwrite existing ZIP: ${relative(zipOutput)}`);
invariant(!fs.existsSync(`${zipOutput}.sha256`), `Refusing to overwrite an existing ZIP checksum: ${relative(`${zipOutput}.sha256`)}`);
invariant(process.platform === 'win32', 'This packager uses the verified Windows Electron runtime');

const electronDir = path.dirname(require.resolve('electron/package.json', { paths: [ROOT] }));
const electronPackage = json(path.join(electronDir, 'package.json'));
const electronDist = path.join(electronDir, 'dist');
const electronSource = { version: electronPackage.version, origin: 'https://github.com/electron/electron/releases/tag/v' + electronPackage.version, verification: 'Installed dist/version and required files are checked; npm lockfile supplies package integrity.' };
invariant(fs.readFileSync(path.join(electronDist, 'version'), 'utf8').trim().replace(/^v/, '') === electronPackage.version,
  'Electron dist version does not match package metadata');
for (const file of ['electron.exe', 'LICENSE', 'LICENSES.chromium.html', 'resources.pak', 'icudtl.dat']) {
  invariant(fs.statSync(path.join(electronDist, file)).isFile(), `Missing Electron runtime file: ${file}`);
}
const CHARACTER_ASSET_PLAN = characterAssetPlan();
REQUIRED_ASSETS.push(...CHARACTER_ASSET_PLAN.flatMap(character => Object.values(character.actions)));
invariant(new Set(REQUIRED_ASSETS).size === 15, 'The production edition must contain 15 distinct character actions');
REQUIRED_APP_FILES.push(...REQUIRED_ASSETS);
for (const file of REQUIRED_APP_FILES) {
  const source = path.join(ROOT, file);
  invariant(fs.existsSync(source) && fs.statSync(source).isFile(), `Missing production file: ${file}`);
  invariant(fs.statSync(source).size > 0, `Empty production file: ${file}`);
}
for (const file of REQUIRED_ASSETS) {
  const header = fs.readFileSync(path.join(ROOT, file)).subarray(0, 4).toString('hex');
  invariant(header === '1a45dfa3', `Production animation is not a WebM/EBML file: ${file}`);
}

const dependencyPlan = [];
const missingLicenses = new Set();
const supplementalLicenses = {
  'type-fest@2.19.0': {
    file: path.join(__dirname, 'licenses/type-fest-v2.19.0-license-mit.txt'),
    destination: 'LICENSE-MIT.txt',
    sha256: '5c932d88256b4ab958f64a856fa48e8bd1f55bc1d96b8149c65689e0c61789d3',
    source: 'https://raw.githubusercontent.com/sindresorhus/type-fest/v2.19.0/license-mit'
  }
};
function planDependencies(parentSource, parentDestination, ancestry = new Map()) {
  const pkg = json(path.join(parentSource, 'package.json'));
  const optional = new Set(Object.keys(pkg.optionalDependencies || {}));
  const names = [...new Set([...Object.keys(pkg.dependencies || {}), ...optional])].sort();
  for (const name of names) {
    let source;
    try { source = findPackage(name, parentSource); }
    catch (error) { if (optional.has(name)) continue; throw error; }
    if (ancestry.has(source)) continue; // Node resolves this cycle from its ancestor.
    const dependency = json(path.join(source, 'package.json'));
    const destination = path.join(parentDestination, 'node_modules', name);
    const licenses = licenseFiles(source);
    const supplementalLicense = licenses.length === 0 ? supplementalLicenses[`${name}@${dependency.version}`] : null;
    if (supplementalLicense) {
      invariant(fs.existsSync(supplementalLicense.file) && sha256(supplementalLicense.file) === supplementalLicense.sha256,
        `Missing or changed supplemental upstream license: ${name}@${dependency.version}`);
      licenses.push(supplementalLicense.destination);
    }
    if (licenses.length === 0) missingLicenses.add(`${name}@${dependency.version}`);
    const record = {
      name, version: dependency.version, license: dependency.license || null,
      repository: dependency.repository || null, source, destination, licenses, supplementalLicense,
      dependencies: Object.keys(dependency.dependencies || {}).sort()
    };
    dependencyPlan.push(record);
    planDependencies(source, destination, new Map([...ancestry, [source, destination]]));
  }
}
planDependencies(ROOT, '.');
invariant(missingLicenses.size === 0, `Missing license/notice files: ${[...missingLicenses].join(', ')}`);

// Put every unambiguous name/version at the application root. A dependency
// with multiple installed versions is copied immediately below its consumer,
// so Node's normal lookup rules choose that exact version without symlinks.
const graph = new Map(dependencyPlan.map(record => [record.source, record]));
const versionsByName = new Map();
for (const record of graph.values()) {
  if (!versionsByName.has(record.name)) versionsByName.set(record.name, new Set());
  versionsByName.get(record.name).add(record.version);
}
const flattened = new Map();
for (const record of graph.values()) {
  if (versionsByName.get(record.name).size === 1) {
    const destination = path.join('node_modules', record.name);
    if (!flattened.has(destination)) flattened.set(destination, { ...record, destination });
  }
}
for (const name of Object.keys(rootPackage.dependencies || {})) {
  const source = findPackage(name, ROOT);
  const destination = path.join('node_modules', name);
  flattened.set(destination, { ...graph.get(source), destination });
}
function nestConflictingVersions(owner, ancestry = new Set([owner.source])) {
  for (const name of owner.dependencies) {
    const source = findPackage(name, owner.source);
    const record = graph.get(source);
    invariant(record, `Production graph is missing ${name}`);
    if (versionsByName.get(name).size === 1) continue;
    if (ancestry.has(source)) continue;
    const destination = path.join(owner.destination, 'node_modules', name);
    if (!flattened.has(destination)) {
      const child = { ...record, destination };
      flattened.set(destination, child);
      nestConflictingVersions(child, new Set([...ancestry, source]));
    }
  }
}
for (const record of [...flattened.values()]) nestConflictingVersions(record);
dependencyPlan.splice(0, dependencyPlan.length, ...flattened.values());

invariant(dependencyPlan.some(record => record.name === 'electron-store'), 'electron-store is not in production dependencies');
invariant(!dependencyPlan.some(record => ['electron', 'electron-builder', 'app-builder-bin'].includes(record.name)),
  'Development/build dependency leaked into the production graph');

function copyTree(source, destination, options = {}) {
  const sourceRoot = fs.realpathSync(options.sourceRoot || source);
  const copy = (from, to, parts = []) => {
    const entry = fs.lstatSync(from);
    if (entry.isSymbolicLink()) {
      invariant(inside(sourceRoot, fs.realpathSync(from)), `Source link leaves its payload: ${from}`);
    }
    const stat = fs.statSync(from);
    if (stat.isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      for (const item of fs.readdirSync(from).sort()) {
        if (['node_modules', '.git', '.tools', '.cache'].includes(item)) continue;
        if (options.electron && parts.length === 1 && parts[0] === 'resources' && item === 'default_app.asar') continue;
        if (options.app) invariant(!/^(?:character-source|art|raw|verification|\.env(?:\..*)?|.*(?:testuserdata|smoke-userdata|test[-_]?profile).*)$/i.test(item),
          `Forbidden private/raw/test payload: ${path.join(from, item)}`);
        copy(path.join(from, item), path.join(to, item), [...parts, item]);
      }
    } else {
      invariant(stat.isFile(), `Unsupported payload entry: ${from}`);
      fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
      if (options.app && /\.(?:js|cjs|mjs|json|html|md|txt)$/i.test(from)) {
        invariant(!/\bsk-[a-f0-9]{24,}\b/i.test(fs.readFileSync(to, 'utf8')),
          `Possible live API key in application payload: ${from}`);
      }
    }
  };
  copy(source, destination);
}
function walkFiles(dir, records = [], base = dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(dir, entry.name);
    invariant(!fs.lstatSync(file).isSymbolicLink(), `Packaged symbolic link is not independent: ${file}`);
    if (entry.isDirectory()) walkFiles(file, records, base);
    else {
      invariant(entry.isFile(), `Unsupported packaged entry: ${file}`);
      records.push({ path: path.relative(base, file).split(path.sep).join('/'), bytes: fs.statSync(file).size, sha256: sha256(file) });
    }
  }
  return records;
}
function powershell(script, extraEnv) {
  // The provided PowerShell 7 runtime supports long Windows paths; the older
  // Windows PowerShell/.NET ZIP API fails on deeply nested npm dependencies.
  const result = spawnSync('pwsh.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
    stdio: 'inherit', windowsHide: true, env: { ...process.env, ...extraEnv }
  });
  invariant(!result.error && result.status === 0, `ZIP operation failed (${result.error?.message || result.status})`);
}

console.log(`Portable output: ${relative(output)}`);
console.log(`ZIP output: ${relative(zipOutput)}`);
console.log(`Runtime: Electron ${electronPackage.version}; production package copies: ${dependencyPlan.length}`);
console.log(`Characters: ${CHARACTER_ASSET_PLAN.length}; animations: ${REQUIRED_ASSETS.length}; required application/plugin files exist.`);
if (args.has('--dry-run')) {
  console.log('Dry run complete; no files were created or changed.');
  process.exit(0);
}

fs.mkdirSync(releaseParent, { recursive: true });
const nonce = crypto.randomUUID();
const stageParent = path.join(releaseParent, `.packaging-${nonce}`);
const stage = path.join(stageParent, bundleName);
const temporaryZip = path.join(ROOT, `.${bundleName}.${nonce}.zip.part`);
assertOwned(stageParent);
assertOwned(stage);
assertOwned(temporaryZip);
fs.mkdirSync(stageParent); // Unique staging directory, never overwrite another release.
fs.mkdirSync(stage);
try {
  copyTree(electronDist, stage, { electron: true });
  fs.renameSync(path.join(stage, 'electron.exe'), path.join(stage, APP_EXE));
  const app = path.join(stage, 'resources', 'app');
  fs.mkdirSync(app, { recursive: true });
  for (const dir of ['src', 'assets']) copyTree(path.join(ROOT, dir), path.join(app, dir), { app: true });
  for (const file of ['LICENSE', 'package.json']) fs.copyFileSync(path.join(ROOT, file), path.join(app, file), fs.constants.COPYFILE_EXCL);
  const notices = ['DeskLLMPet Blue Maid portable edition', '',
    'Application: resources/app/LICENSE', 'Electron: LICENSE',
    'Chromium and bundled runtime third-party notices: LICENSES.chromium.html', '', 'Production npm dependencies:'];
  const dependencies = [];
  for (const record of dependencyPlan) {
    const destination = path.resolve(app, record.destination);
    invariant(inside(app, destination), 'Dependency destination leaves the packaged app');
    copyTree(record.source, destination);
    if (record.supplementalLicense) fs.copyFileSync(record.supplementalLicense.file,
      path.join(destination, record.supplementalLicense.destination), fs.constants.COPYFILE_EXCL);
    const localPath = path.relative(app, destination).split(path.sep).join('/');
    const licensePaths = record.licenses.map(file => `${localPath}/${file}`);
    dependencies.push({ name: record.name, version: record.version, license: record.license,
      repository: record.repository, packagePath: localPath, licenseFiles: licensePaths,
      supplementalLicenseSource: record.supplementalLicense?.source || null });
    notices.push(`${record.name}@${record.version} (${typeof record.license === 'string' ? record.license : JSON.stringify(record.license)}):`,
      ...licensePaths.map(file => `  resources/app/${file}`));
  }
  for (const file of ['README-BLUE-MAID.md', 'UPSTREAM.json']) {
    if (fs.existsSync(path.join(ROOT, file))) fs.copyFileSync(path.join(ROOT, file), path.join(stage, file), fs.constants.COPYFILE_EXCL);
  }
  fs.writeFileSync(path.join(stage, '启动桌宠.cmd'), `@echo off\r\nstart "" "%~dp0${APP_EXE}"\r\n`, 'utf8');
  fs.writeFileSync(path.join(stage, 'THIRD-PARTY-NOTICES.txt'), notices.join('\r\n') + '\r\n');
  fs.writeFileSync(path.join(stage, 'DEPENDENCIES.json'), JSON.stringify({
    app: { name: rootPackage.name, version: rootPackage.version, license: rootPackage.license },
    runtime: { name: 'Electron', version: electronPackage.version, archiveSHA256: electronSource.archiveSHA256 },
    dependencies
  }, null, 2) + '\n');
  fs.writeFileSync(path.join(stage, 'CHARACTERS.json'), JSON.stringify({
    defaultCharacterId: 'blue-maid', characterCount: CHARACTER_ASSET_PLAN.length,
    animationCount: REQUIRED_ASSETS.length,
    characters: CHARACTER_ASSET_PLAN.map(character => ({
      id: character.id, name: character.name, animationRoot: character.animationRoot,
      actions: Object.fromEntries(Object.entries(character.actions).map(([action, file]) => [action, {
        path: `resources/app/${file}`, bytes: fs.statSync(path.join(app, file)).size,
        sha256: sha256(path.join(app, file))
      }]))
    }))
  }, null, 2) + '\n');
  for (const file of REQUIRED_APP_FILES) invariant(fs.existsSync(path.join(app, file)), `Packaged file missing: ${file}`);
  for (const record of dependencyPlan) {
    const packagedDir = path.resolve(app, record.destination);
    invariant(json(path.join(packagedDir, 'package.json')).version === record.version, `Packaged dependency version mismatch: ${record.name}`);
    for (const name of record.dependencies) {
      const expectedDir = findPackage(name, record.source);
      const actualDir = findPackage(name, packagedDir);
      const expected = json(path.join(expectedDir, 'package.json'));
      const actual = json(path.join(actualDir, 'package.json'));
      invariant(inside(app, actualDir), `Dependency escapes bundle: ${name}`);
      invariant(actual.version === expected.version, `Resolved dependency version mismatch: ${record.name} -> ${name}`);
      if (actual.main || actual.exports || !actual.types) {
        const entry = createRequire(path.join(packagedDir, 'package.json')).resolve(name);
        invariant(inside(app, entry), `Dependency entry resolves outside bundle: ${record.name} -> ${name}`);
      }
    }
  }
  invariant(inside(app, createRequire(path.join(app, 'package.json')).resolve('electron-store')), 'electron-store resolves outside the bundle');
  const manifest = walkFiles(stage);
  invariant(manifest.some(file => file.path === APP_EXE), 'Packaged executable missing');
  const longestPath = manifest.reduce((longest, file) => file.path.length > longest.length ? file.path : longest, '');
  invariant(longestPath.length < 150, `Packaged relative path exceeds the Windows-friendly target: ${longestPath.length} ${longestPath}`);
  fs.writeFileSync(path.join(stage, 'PACKAGE-MANIFEST.json'), JSON.stringify({
    edition: bundleName, generatedAt: new Date().toISOString(), fileCount: manifest.length,
    longestRelativePath: longestPath, longestRelativePathLength: longestPath.length, files: manifest
  }, null, 2) + '\n');
  powershell("$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory($env:DESK_PET_PACKAGE_SOURCE,$env:DESK_PET_PACKAGE_ZIP,[System.IO.Compression.CompressionLevel]::Optimal,$true)", {
    DESK_PET_PACKAGE_SOURCE: stage, DESK_PET_PACKAGE_ZIP: temporaryZip
  });
  powershell("$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; $zip=[System.IO.Compression.ZipFile]::OpenRead($env:DESK_PET_PACKAGE_ZIP); try { foreach($name in (ConvertFrom-Json $env:DESK_PET_REQUIRED_ZIP_ENTRIES)) { $entry=$zip.GetEntry($name); if($null -eq $entry -or $entry.Length -le 0){throw ('Missing or empty ZIP entry: '+$name)} }; $files=@($zip.Entries | Where-Object {$_.Name -ne ''}); if($files.Count -ne [int]$env:DESK_PET_PACKAGE_FILE_COUNT){throw 'ZIP file count differs from the verified manifest'} } finally {$zip.Dispose()}", {
    DESK_PET_PACKAGE_ZIP: temporaryZip,
    DESK_PET_PACKAGE_FILE_COUNT: String(manifest.length + 1),
    DESK_PET_REQUIRED_ZIP_ENTRIES: JSON.stringify([
      `${bundleName}/${APP_EXE}`, `${bundleName}/PACKAGE-MANIFEST.json`,
      `${bundleName}/CHARACTERS.json`,
      ...REQUIRED_APP_FILES.map(file => `${bundleName}/resources/app/${file}`)
    ])
  });
  invariant(!fs.existsSync(output) && !fs.existsSync(zipOutput), 'A release appeared while packaging; refusing to overwrite it');
  fs.renameSync(stage, output);
  fs.rmdirSync(stageParent); // Exact, newly-created and now-empty directory only.
  fs.copyFileSync(temporaryZip, zipOutput, fs.constants.COPYFILE_EXCL);
  fs.unlinkSync(temporaryZip); // Exact, newly-created temporary ZIP only.
  const zipHash = sha256(zipOutput);
  fs.writeFileSync(`${zipOutput}.sha256`, `${zipHash}  ${path.basename(zipOutput)}\n`, { flag: 'wx' });
  console.log(`Portable files verified: ${manifest.length}; no symbolic links remain.`);
  console.log(`Longest packaged relative path: ${longestPath.length} characters (${longestPath})`);
  console.log(`ZIP SHA256: ${zipHash}`);
  console.log(`Ready: ${relative(output)}`);
} catch (error) {
  console.error('Packaging failed; unique staging/partial artifacts are preserved for inspection.');
  console.error(`Staging: ${relative(stage)}`);
  console.error(`Partial ZIP: ${relative(temporaryZip)}`);
  throw error;
}
