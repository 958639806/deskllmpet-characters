/* Real Electron + IPC + VP9 alpha; isolated seeded profiles, no live API.
 * Run with Node: node scripts/check-characters.js
 * This deliberately does not claim actual Windows desktop visibility.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const VERIFY = path.join(ROOT, 'verification');
const { CHARACTERS } = require('../src/shared/characters');
const EXPECTED_IDS = ['blue-maid', 'blonde-reaper', 'orange-mage', 'violet-cat', 'white-dragon'];
const stageArg = process.argv.find(arg => arg.startsWith('--characters-stage='));
const profileArg = process.argv.find(arg => arg.startsWith('--characters-profile='));
const resultArg = process.argv.find(arg => arg.startsWith('--characters-result='));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function assert(ok, message) { if (!ok) throw new Error(message); }
function inside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function characterFiles(character) {
  const scan = action => {
    const dir = path.join(ROOT, character.animationRoot, action);
    assert(fs.existsSync(dir), `Missing generated ${character.id}/${action} assets`);
    return fs.readdirSync(dir).filter(name => /\.webm$/i.test(name)).sort()
      .map(name => ({ name, path: `${character.animationRoot}/${action}/${name}` }));
  };
  const idle = scan('idle');
  const click = scan('click');
  const carry = click.filter(file => /拖拽悬空|被鼠标拖拽/.test(file.name));
  const pat = click.filter(file => /摸头/.test(file.name) && !carry.includes(file));
  assert(idle.length === 1 && click.length === 2 && pat.length === 1 && carry.length === 1,
    `Expected three production actions for ${character.id}`);
  return { idle: idle[0], pat: pat[0], carry: carry[0] };
}
function assertPreserved(config) {
  assert(config.characterTestSentinel === 'preserve-unrelated-legacy-values', 'Unknown legacy value was lost');
  assert(config.pet.opacity === 0.6 && config.pet.scale === 0.85 && config.pet.crop === 1, 'Existing geometry/opacity changed while switching');
  assert(config.llm.apiEndpoint === 'http://127.0.0.1:1/never-called' && config.llm.apiKey === '', 'Unrelated API configuration changed');
  assert(config.balance.enabled === false && config.balance.customPhrases[0] === 'characters-test-preserve', 'Existing balance preferences changed');
}

async function supervisor() {
  assert(CHARACTERS.map(character => character.id).sort().join('|') === [...EXPECTED_IDS].sort().join('|'), 'Unexpected character registry');
  const assets = CHARACTERS.map(character => ({ ...character, actions: characterFiles(character) }));
  const fingerprints = assets.flatMap(character => Object.values(character.actions).map(file =>
    crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, file.path))).digest('hex')));
  assert(new Set(fingerprints).size === 15, 'Some production character/action files are duplicates');
  if (process.argv.includes('--preflight')) {
    console.log(JSON.stringify({ characters: assets.length, distinctAnimations: fingerprints.length, noWindowsStarted: true }, null, 2));
    return;
  }
  const id = crypto.randomUUID();
  fs.mkdirSync(path.join(VERIFY, 'profiles'), { recursive: true });
  const profile = path.join(VERIFY, 'profiles', `characters-${id}`);
  const invalidProfile = path.join(VERIFY, 'profiles', `characters-invalid-${id}`);
  for (const value of [profile, invalidProfile]) assert(inside(path.join(VERIFY, 'profiles'), value) && !fs.existsSync(value), 'Profile is not a fresh test-only destination');
  const blue = assets.find(character => character.id === 'blue-maid').actions;
  const seed = {
    llm: { apiEndpoint: 'http://127.0.0.1:1/never-called', balanceEndpoint: '', apiKey: '' },
    animations: { idlePool: [blue.idle.name], clickPool: [blue.pat.name], currentIdleIndex: 0 },
    balance: { enabled: false, intervalMinutes: 0, customPhrases: ['characters-test-preserve'] },
    pet: { opacity: 0.6, scale: 0.85, crop: 1, autoStart: false },
    windowPosition: { petX: -12000, petY: -12000 }, firstRun: false,
    characterTestSentinel: 'preserve-unrelated-legacy-values'
  };
  fs.mkdirSync(profile); fs.mkdirSync(invalidProfile);
  fs.writeFileSync(path.join(profile, 'config.json'), JSON.stringify(seed, null, 2));
  fs.writeFileSync(path.join(invalidProfile, 'config.json'), JSON.stringify({ ...seed, pet: { ...seed.pet, characterId: '../../invalid-role' } }, null, 2));
  const historyBytes = JSON.stringify({ characterTestHistory: 'preserve-unrelated-chat-history', conversations: [] });
  for (const destination of [profile, invalidProfile]) {
    const historyDir = path.join(destination, 'plugins', 'llm-chat');
    fs.mkdirSync(historyDir, { recursive: true });
    fs.writeFileSync(path.join(historyDir, 'data.json'), historyBytes);
  }
  const reportFile = path.join(VERIFY, `characters-integration-${id}.json`);
  const report = { startedAt: new Date().toISOString(), success: false, mockOnly: true, liveDeepSeekTested: false,
    actualDesktopVisibilityTested: false, originalUserProfileAccessed: false, profiles: [profile, invalidProfile], stages: [] };
  const electron = require('electron');
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  try {
    for (const [stage, selectedProfile] of [['exercise', profile], ['persisted', profile], ['invalid-saved', invalidProfile]]) {
      const resultFile = path.join(VERIFY, `characters-${stage}-${id}.json`);
      const stdout = fs.openSync(path.join(VERIFY, `characters-${stage}-${id}.stdout.log`), 'wx');
      const stderr = fs.openSync(path.join(VERIFY, `characters-${stage}-${id}.stderr.log`), 'wx');
      let result;
      try {
        result = await new Promise((resolve, reject) => {
          const child = spawn(electron, [__filename, `--characters-stage=${stage}`, `--characters-profile=${selectedProfile}`, `--characters-result=${resultFile}`],
            { cwd: ROOT, env, windowsHide: true, stdio: ['ignore', stdout, stderr] });
          const timer = setTimeout(() => { child.kill(); reject(new Error(`Character worker timed out: ${stage}`)); }, 110000);
          child.once('error', error => { clearTimeout(timer); reject(error); });
          child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
        });
      } finally { fs.closeSync(stdout); fs.closeSync(stderr); }
      const details = fs.existsSync(resultFile) ? readJson(resultFile) : { error: 'No worker report' };
      report.stages.push({ stage, exit: result, report: resultFile, ...details });
      assert(result.code === 0 && !result.signal && details.success, `Character ${stage} failed: ${details.error || result.code}`);
      assertPreserved(readJson(path.join(selectedProfile, 'config.json')));
      assert(fs.readFileSync(path.join(selectedProfile, 'plugins/llm-chat/data.json'), 'utf8') === historyBytes,
        'Character operations changed unrelated stored chat history');
    }
    report.success = true;
  } finally {
    report.finishedAt = new Date().toISOString();
    report.passedChecks = report.stages.reduce((sum, stage) => sum + (stage.results || []).length, 0);
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ success: report.success, report: reportFile, passedChecks: report.passedChecks }, null, 2));
  }
}

function worker() {
  require('../src/shared/stdio-guard');
  const { app, BrowserWindow } = require('electron');
  const stage = stageArg.slice('--characters-stage='.length);
  const profile = path.resolve(profileArg.slice('--characters-profile='.length));
  const resultFile = path.resolve(resultArg.slice('--characters-result='.length));
  assert(['exercise', 'persisted', 'invalid-saved'].includes(stage), 'Unknown worker stage');
  assert(inside(path.join(VERIFY, 'profiles'), profile) && inside(VERIFY, resultFile), 'Worker escaped its verification directory');
  app.setPath('userData', profile);
  if (process.platform === 'win32') app.disableHardwareAcceleration();
  const report = { stage, success: false, profile, results: [], liveNetworkCalls: 0 };
  const pageErrors = [];
  const pass = (name, details) => { report.results.push({ name, details }); console.log('PASS ' + name); };
  async function until(check, description, milliseconds = 14000) {
    const deadline = Date.now() + milliseconds;
    while (Date.now() < deadline) { if (await check()) return; await sleep(45); }
    throw new Error(`Timed out: ${description}`);
  }
  app.on('browser-window-created', (_, win) => {
    win.webContents.on('preload-error', (_, preload, error) => pageErrors.push(error.message));
    win.webContents.on('render-process-gone', (_, details) => pageErrors.push(details.reason));
    win.webContents.on('console-message', (_, level, message) => { if (level >= 3) pageErrors.push(message); });
  });
  async function run() {
    const api = require('../src/shared/deepseek-api');
    api.fetchBalance = async () => { report.liveNetworkCalls++; throw new Error('Network API is blocked in character-only tests'); };
    require('../src/main/ipc-handlers').registerIpcHandlers();
    const store = require('../src/shared/store');
    const pet = await require('../src/main/pet-window').createPetWindow(false, { show: false });
    const settings = new BrowserWindow({ show: false, x: -12000, y: -12000,
      webPreferences: { preload: path.join(ROOT, 'src/preload/settings-preload.js'), contextIsolation: true, nodeIntegration: false } });
    await settings.loadURL('data:text/html,<title>Character IPC test bridge</title>');
    const invoke = (window, namespace, method, value) => window.webContents.executeJavaScript(
      `window.${namespace}.${method}(${value === undefined ? '' : JSON.stringify(value)})`);
    const setCharacter = id => invoke(pet, 'petAPI', 'setCharacter', id);
    const stateSnapshot = () => pet.webContents.executeJavaScript(`(() => ({
      character: window.petState.character, config: window.petState.config,
      idle: window.petState.idlePool, click: window.petState.clickPool,
      allClick: window.petState.allClickAnimations, carry: window.petState.dragAnimPath,
      isPlayingClick: window.petState.isPlayingClick, isPlayingDrag: window.petState.isPlayingDrag,
      source: videoPlayer.source, ready: elements.video.readyState, opacity: elements.container.style.opacity,
      paused: elements.video.paused, currentTime: elements.video.currentTime, duration: elements.video.duration,
      totalFrames: elements.video.getVideoPlaybackQuality().totalVideoFrames
    }))()`);
    async function idleReady(character) {
      await until(async () => {
        const data = await stateSnapshot();
        return data.character.id === character.id && data.ready >= 2 && !data.paused && !data.isPlayingClick && !data.isPlayingDrag &&
          decodeURIComponent(data.source).includes(`${character.animationRoot}/idle/`);
      }, `${character.id} idle and cancellation`);
      return stateSnapshot();
    }
    async function assertAdvancing(character, label) {
      const before = await idleReady(character);
      await sleep(220);
      const after = await stateSnapshot();
      const frameDelta = after.totalFrames - before.totalFrames;
      const timeDelta = after.currentTime - before.currentTime;
      assert(!before.paused && !after.paused && after.source === before.source &&
        (Math.abs(timeDelta) > 0.04 || frameDelta >= 3), `${label}: idle stayed paused or frozen`);
      pass(label, { pausedBefore: before.paused, pausedAfter: after.paused,
        currentTimeBefore: before.currentTime, currentTimeAfter: after.currentTime, frameDelta, waitMilliseconds: 220 });
    }
    async function decode(action, expected) {
      await until(() => pet.webContents.executeJavaScript(
        `elements.video.readyState >= 2 && decodeURIComponent(videoPlayer.source).endsWith(${JSON.stringify(expected.path)})`), `${action} decoded source`);
      const alpha = await pet.webContents.executeJavaScript(`(() => {
        const v=elements.video,c=document.createElement('canvas'); c.width=v.videoWidth;c.height=v.videoHeight;
        const ctx=c.getContext('2d');ctx.drawImage(v,0,0);const data=ctx.getImageData(0,0,c.width,c.height).data;
        let opaque=0;for(let i=3;i<data.length;i+=4)if(data[i]>128)opaque++;
        const corners=[3,(c.width-1)*4+3,((c.height-1)*c.width)*4+3,(c.width*c.height-1)*4+3].map(i=>data[i]);
        return {width:c.width,height:c.height,opaquePixels:opaque,corners};
      })()`);
      assert(alpha.width === 512 && alpha.height === 512 && alpha.opaquePixels > 8000 && Math.max(...alpha.corners) <= 8,
        `Invalid foreground/transparent decoding: ${expected.path}`);
      pass(`Chromium VP9 alpha: ${expected.path}`, alpha);
    }
    const list = await invoke(pet, 'petAPI', 'getCharacters');
    assert(list.map(character => character.id).sort().join('|') === [...EXPECTED_IDS].sort().join('|'), 'IPC did not expose exactly five IDs');
    pass('Registry and real IPC expose five character IDs', list);
    const initial = await invoke(pet, 'petAPI', 'getCharacterState');
    const expectedInitial = stage === 'persisted' ? 'white-dragon' : 'blue-maid';
    assert(initial.character.id === expectedInitial, 'Initial character selection/fallback is incorrect');
    await idleReady(CHARACTERS.find(character => character.id === expectedInitial));
    const location = await invoke(pet, 'petAPI', 'getAppPath');
    assert(path.resolve(location.userData) === profile, 'Worker accessed a non-test profile');
    assertPreserved(readJson(path.join(profile, 'config.json')));
    assert(pet.getOpacity() === 1 && await pet.webContents.executeJavaScript('elements.container.style.opacity') === '0.6', 'CSS/native opacity boundary changed');
    pass(stage === 'persisted' ? 'A real process restart restores white-dragon' : 'Legacy/invalid saved character falls back to blue-maid without data loss');

    if (stage === 'exercise') {
      const initialBlue = CHARACTERS.find(character => character.id === 'blue-maid');
      await setCharacter(initialBlue.id);
      await assertAdvancing(initialBlue, 'Selecting the current character resumes the existing idle and advances after 200ms');
      await pet.webContents.executeJavaScript(`Promise.all([
        window.petAPI.setCharacter('orange-mage'), window.petAPI.setCharacter('blue-maid')
      ])`);
      await assertAdvancing(initialBlue, 'Rapid A-to-pending-B-to-A remains unpaused and advances after 200ms');
      for (const character of CHARACTERS) {
        const expected = characterFiles(character);
        const selected = await setCharacter(character.id);
        assert(selected.success && selected.character.id === character.id, 'Character selection IPC failed');
        const data = await idleReady(character);
        const available = await invoke(pet, 'petAPI', 'getAvailableAnimations');
        const all = [...available.idle, ...available.click];
        assert(available.characterId === character.id && all.length === 3 && all.every(file => file.path.startsWith(character.animationRoot + '/')), 'Available actions leaked another character');
        assert(data.idle.length === 1 && data.click.length === 1 && data.allClick.length === 2 &&
          [...data.idle, ...data.click, ...data.allClick].every(file => file.path.startsWith(character.animationRoot + '/')) && data.carry === expected.carry.path,
          'Renderer action pools mixed characters or included carry in pat reactions');
        assert(data.config.opacity === 0.6 && data.config.scale === 0.85, 'Character switch overwrote legacy settings');
        pass(`Selected ${character.id}: isolated idle/pat/carry pools`, data);
        await decode('idle', expected.idle);
        await pet.webContents.executeJavaScript('playClickReaction()');
        await decode('pat', expected.pat);
        await idleReady(character);
        await pet.webContents.executeJavaScript(`(() => {
          elements.container.dispatchEvent(new MouseEvent('mousedown',{button:0,screenX:100,screenY:100,bubbles:true}));
          document.dispatchEvent(new MouseEvent('mousemove',{screenX:120,screenY:110,bubbles:true}));
        })()`);
        await decode('carry', expected.carry);
        await pet.webContents.executeJavaScript(`document.dispatchEvent(new MouseEvent('mouseup',{button:0,screenX:120,screenY:110,bubbles:true}))`);
        await idleReady(character);
        await invoke(settings, 'settingsAPI', 'setAnimationConfig', { idlePool: [expected.idle.name], clickPool: [expected.pat.name] });
        await idleReady(character);
      }
      const blue = CHARACTERS[0];
      const dragon = CHARACTERS.find(character => character.id === 'white-dragon');
      await setCharacter(blue.id); await idleReady(blue);
      await pet.webContents.executeJavaScript('playClickReaction()');
      await setCharacter('orange-mage');
      await setCharacter(dragon.id); await idleReady(dragon); await sleep(3400);
      assert((await stateSnapshot()).character.id === dragon.id && !(await stateSnapshot()).source.includes(encodeURIComponent('蓝发女仆')), 'An old action callback restored another character');
      pass('Rapid switching cancels pending old-character actions');
      const foreign = characterFiles(blue);
      await invoke(settings, 'settingsAPI', 'setAnimationConfig', { idlePool: [foreign.idle.name], clickPool: [foreign.pat.name] });
      const isolated = await idleReady(dragon);
      assert(isolated.idle.every(file => file.path.startsWith(dragon.animationRoot + '/')) && isolated.click.every(file => file.path.startsWith(dragon.animationRoot + '/')), 'Foreign saved pool names escaped role filtering');
      await setCharacter(blue.id); await idleReady(blue);
      const blueSaved = await invoke(pet, 'petAPI', 'getAnimationConfig');
      assert(blueSaved.idlePool.includes(foreign.idle.name) && blueSaved.clickPool.includes(foreign.pat.name), 'A different role overwrote the legacy blue-maid pool');
      pass('Per-role saved pools remain isolated, including foreign-name fallback');
      const invalid = await setCharacter('../../not-a-character');
      assert(invalid.character.id === 'blue-maid', 'Invalid IPC ID did not fall back safely');
      await idleReady(blue);
      pass('Invalid IPC character ID safely selects blue-maid');
      await setCharacter(dragon.id); await idleReady(dragon);
      assert(store.getPetConfig().characterId === dragon.id, 'Last selected role was not persisted');
    }
    assertPreserved(readJson(path.join(profile, 'config.json')));
    assert(report.liveNetworkCalls === 0, 'Character-only test unexpectedly attempted a network API');
    assert(pageErrors.length === 0, 'Preload/renderer errors: ' + pageErrors.join('; '));
    pass('Unrelated legacy values preserved; no API calls or renderer/preload crashes');
    report.success = true;
  }
  app.whenReady().then(run).catch(error => { report.error = error.stack || error.message; console.error(report.error); }).finally(() => {
    for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.destroy();
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(resultFile, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    app.exit(report.success ? 0 : 1);
  });
}

if (stageArg) worker();
else supervisor().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
