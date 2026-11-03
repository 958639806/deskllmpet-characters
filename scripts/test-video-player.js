#!/usr/bin/env node
/** Executes the real player and pet controller in a tiny DOM/video model. No browser/codec claims. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function environment({ decodedFrames = false, petConfig = {} } = {}) {
  let nextTimer = 1;
  const timers = new Map();
  const raf = new Set();
  const nodes = new Map();
  const bubbles = [];
  const apiListeners = {};
  const parent = { insertBefore(node) { nodes.set(node.id, node); } };
  class Video {
    constructor(id) {
      this.id = id;
      this.style = {};
      this.classList = { add() {} };
      this.parentNode = parent;
      this.readyState = 0;
      this.paused = true;
      this.loadCalls = 0;
      this.listeners = new Map();
      this.frameCallbacks = [];
      if (decodedFrames) this.requestVideoFrameCallback = (fn) => { this.frameCallbacks.push(fn); return this.frameCallbacks.length; };
    }
    cloneNode() { return new Video('buffer'); }
    addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(fn); }
    removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
    pause() { this.paused = true; }
    play() { this.paused = false; return Promise.resolve(); }
    load() { this.loadCalls++; this.readyState = 0; }
    emit(name) {
      if (name === 'loadeddata') this.readyState = 2;
      for (const fn of [...(this.listeners.get(name) || [])]) fn();
      if (typeof this[`on${name}`] === 'function') this[`on${name}`]();
    }
    decoded() { for (const fn of this.frameCallbacks.splice(0)) fn(0, {}); }
  }
  const first = new Video('pet-video');
  nodes.set(first.id, first);
  const canvas = {
    id: 'placeholder-canvas', width: 200, height: 200, style: {},
    getContext: () => new Proxy({}, { get: () => () => {} })
  };
  nodes.set(canvas.id, canvas);
  const container = { style: { setProperty() {} }, insertBefore: parent.insertBefore, addEventListener() {} };
  nodes.set('pet-container', container);
  const context = {
    window: { matchMedia: () => ({ matches: true }), addEventListener() {}, petAPI: {
      moveWindow() {}, showBubble: (payload) => bubbles.push(payload),
      getPetConfig: async () => petConfig,
      getAnimationConfig: async () => ({}),
      getBalanceConfig: async () => ({ enabled: false }),
      getAppPath: async () => ({ projectRoot: 'C:/fixture' }),
      getAvailableAnimations: async () => ({ idle: [], click: [] }),
      ...Object.fromEntries(['onReloadAnimations', 'onConfigChanged', 'onBalanceConfigChanged', 'onShowBalance', 'onMenuAction', 'onThemeChanged', 'onCharacterChanged']
        .map((name) => [name, (listener) => { apiListeners[name] = listener; }]))
    } },
    document: { getElementById: (id) => nodes.get(id) || null, addEventListener() {}, createElement: () => canvas },
    console: { log() {}, warn() {}, error() {} },
    setTimeout(fn, ms) { const id = nextTimer++; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval(fn, ms) { const id = nextTimer++; timers.set(id, { fn, ms }); return id; },
    clearInterval(id) { timers.delete(id); },
    requestAnimationFrame() { const id = nextTimer++; raf.add(id); return id; },
    cancelAnimationFrame(id) { raf.delete(id); }
  };
  vm.createContext(context);
  const root = path.join(__dirname, '..');
  for (const file of ['video-player.js', 'pet.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'src/renderer/pet', file), 'utf8'), context, { filename: file });
  }
  const run = (code) => vm.runInContext(code, context);
  const player = run('videoPlayer');
  return { run, player, container, canvas, raf, timers, bubbles, apiListeners, petAPI: context.window.petAPI, back: () => player.videos.find((video) => video !== player.front) };
}

function loadMainModule(relativePath, stubs, platform = 'win32') {
  const filename = path.join(__dirname, '..', relativePath);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, __dirname: path.dirname(filename),
    require: (name) => Object.hasOwn(stubs, name) ? stubs[name] : require(name),
    process: { platform, argv: [] }, console
  }, { filename });
  return module.exports;
}

function nativeWindowFixture(opacity, platform = 'win32') {
  const messages = [];
  const pet = { opacity, scale: 1, crop: 1 };
  class BrowserWindow {
    constructor(options) {
      assert.equal(options.opacity, undefined, 'native window alpha must not be configured');
      this.handlers = new Map();
      this.topCalls = [];
      this.webContents = { send: (channel, payload) => messages.push({ channel, payload }), isDestroyed: () => false, on() {} };
    }
    async loadFile() {}
    setAlwaysOnTop(top, level) { this.topCalls.push({ top, level }); this.level = level; }
    setVisibleOnAllWorkspaces() {}
    setIgnoreMouseEvents() {}
    on(name, fn) { if (!this.handlers.has(name)) this.handlers.set(name, []); this.handlers.get(name).push(fn); }
    emit(name) { for (const fn of this.handlers.get(name) || []) fn(); }
    show() { this.emit('show'); }
    hide() { this.emit('hide'); }
    focus() { this.emit('focus'); }
    isDestroyed() { return false; }
    setOpacity() { throw new Error('native setOpacity must never be called for the transparent pet'); }
  }
  const store = {
    getWindowPosition: () => undefined, saveWindowPosition() {},
    getPetConfig: () => ({ ...pet }), setPetConfig: (config) => Object.assign(pet, config),
    getBubbleConfig: () => ({})
  };
  const electron = { BrowserWindow, screen: { getPrimaryDisplay: () => ({ workArea: { width: 1920, height: 1080 } }) } };
  const windows = loadMainModule('src/main/pet-window.js', { electron, '../shared/store': store }, platform);
  return { messages, store, electron, windows };
}

async function microtasks() { for (let i = 0; i < 6; i++) await Promise.resolve(); }

async function load(env, path, options) {
  const pending = env.player.play(path, options);
  const back = env.back();
  back.emit('loadeddata');
  await microtasks();
  back.decoded();
  assert.equal(await pending, true);
  return back;
}

let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }

(async () => {
  await check('Windows pet, bubble and menu keep screen-saver level through show/focus cycles', async () => {
    const env = nativeWindowFixture(0.6);
    const stubs = { electron: env.electron, '../shared/store': env.store, './pet-window': env.windows };
    const bubble = loadMainModule('src/main/bubble-window.js', stubs);
    const menu = loadMainModule('src/main/menu-window.js', stubs);
    const windows = [
      ['pet', await env.windows.createPetWindow()],
      ['bubble', bubble.createBubbleWindow()],
      ['menu', menu.createMenuWindow()]
    ];
    for (const [name, win] of windows) {
      assert.ok(win.topCalls.length > 0, `${name}: an explicit window level is required`);
      for (let i = 0; i < 2; i++) { win.hide(); win.show(); win.focus(); }
      assert.equal(win.level, 'screen-saver', `${name}: activation must preserve the Windows workaround`);
      assert.ok(win.topCalls.every((call) => call.top === true && call.level === 'screen-saver'),
        `${name}: no application callback may reapply floating/Shell_TrayWnd placement`);
    }
  });

  await check('window-level workaround preserves macOS screen-saver and Linux floating choices', async () => {
    for (const [platform, expected] of [['darwin', 'screen-saver'], ['linux', 'floating']]) {
      const env = nativeWindowFixture(1, platform);
      const stubs = { electron: env.electron, '../shared/store': env.store, './pet-window': env.windows };
      const bubble = loadMainModule('src/main/bubble-window.js', stubs, platform);
      const menu = loadMainModule('src/main/menu-window.js', stubs, platform);
      const windows = [await env.windows.createPetWindow(), bubble.createBubbleWindow(), menu.createMenuWindow()];
      assert.ok(windows.every((win) => win.topCalls.length > 0 && win.topCalls.every((call) => call.top && call.level === expected)),
        `${platform}: the Windows fix must not change other platforms' levels`);
    }
  });

  await check('native pet startup and the compatibility setter never change layered-window opacity', async () => {
    for (const opacity of [0.6, 1]) {
      const env = nativeWindowFixture(opacity);
      await env.windows.createPetWindow();
      assert.equal(env.messages.length, 0, 'initial opacity is read by the renderer, not a native window call');
      env.windows.setPetOpacity(0.6);
      assert.equal(env.messages[0].channel, 'config-changed');
      assert.equal(env.messages[0].payload.opacity, 0.6);
      for (const [input, expected] of [[-1, 0.1], [2, 1], ['bad', 1]]) {
        env.windows.setPetOpacity(input);
        assert.equal(env.messages.at(-1).payload.opacity, expected);
      }
    }
  });

  await check('saving pet settings sends one config update without the legacy native-opacity route', async () => {
    const env = nativeWindowFixture(1);
    await env.windows.createPetWindow();
    const handlers = new Map();
    env.electron.ipcMain = { handle: (name, fn) => handlers.set(name, fn), on() {} };
    const ipc = loadMainModule('src/main/ipc-handlers.js', {
      electron: env.electron, '../shared/store': env.store,
      './character-manager': {},
      '../shared/deepseek-api': {}, './settings-window': {}, './bubble-window': {}, './menu-window': {},
      './pet-window': { ...env.windows, setPetOpacity() { throw new Error('settings must use its existing single config broadcast'); } }
    });
    ipc.registerIpcHandlers();
    const result = handlers.get('set-pet-config')({}, { opacity: 0.4 });
    assert.equal(result.success, true);
    assert.equal(env.store.getPetConfig().opacity, 0.4);
    assert.equal(env.messages.length, 1);
    assert.equal(env.messages[0].channel, 'config-changed');
    assert.equal(env.messages[0].payload.opacity, 0.4);
  });

  await check('saved opacity and live config updates fade the shared pet container with a 0.1 to 1 clamp', async () => {
    const env = environment({ petConfig: { opacity: 0.6 } });
    await env.run('init()');
    assert.equal(env.container.style.opacity, '0.6');
    assert.equal(env.canvas.style.display, 'block', 'placeholder shares the same opacity container');
    env.apiListeners.onConfigChanged({ opacity: 0.35 });
    assert.equal(env.container.style.opacity, '0.35');
    for (const [input, expected] of [[0, '0.1'], [-1, '0.1'], [2, '1'], ['bad', '1']]) {
      env.apiListeners.onConfigChanged({ opacity: input });
      assert.equal(env.container.style.opacity, expected);
    }
    env.apiListeners.onConfigChanged({ opacity: 0.5 });
    env.apiListeners.onConfigChanged({ crop: 0.8 });
    assert.equal(env.container.style.opacity, '0.5', 'unrelated settings must preserve opacity');
    assert.ok(env.player.videos.every((video) => video.style.opacity === '0'), 'container opacity must not overwrite per-video crossfade state');
  });

  await check('replaying the same decoded loop after stop resumes playback without loading again', async () => {
    const env = environment();
    const front = await load(env, 'same-idle.webm');
    const loads = env.player.videos.map((video) => video.loadCalls);
    assert.equal(front.paused, false);
    env.player.stop();
    assert.equal(front.paused, true);
    assert.equal(await env.player.play('same-idle.webm'), true);
    assert.equal(env.player.front, front);
    assert.equal(front.paused, false, 'same-source fast path must resume a stopped front layer');
    assert.deepEqual(env.player.videos.map((video) => video.loadCalls), loads);
  });

  await check('returning to a stopped original loop cancels a pending different source and keeps playback running', async () => {
    const env = environment();
    const front = await load(env, 'original-idle.webm');
    env.player.stop();
    const pending = env.player.play('pending-other-character.webm');
    const stale = env.back();
    const loads = env.player.videos.map((video) => video.loadCalls);
    env.player.stop();
    assert.equal(await env.player.play('original-idle.webm'), true);
    assert.equal(await pending, false);
    stale.emit('loadeddata');
    await microtasks();
    assert.equal(env.player.front, front);
    assert.equal(env.player.source, 'original-idle.webm');
    assert.equal(front.paused, false);
    assert.equal(stale.paused, true);
    assert.equal(env.player.cancelPending, null);
    assert.deepEqual(env.player.videos.map((video) => video.loadCalls), loads, 'returning to a decoded original clip must not reload either layer');
  });

  await check('quick drag/release cancels carry load even when returning to the same idle clip', async () => {
    const env = environment();
    env.run("state.appPath.projectRoot='C:/fixture'; state.idlePool=[{name:'idle.webm',path:'idle.webm'}]; state.dragAnimPath='carry.webm'");
    const initial = env.run("playVideo('idle.webm')");
    env.back().emit('loadeddata');
    await initial;
    env.run('onMouseDown({button:0,screenX:10,screenY:10,preventDefault(){}}); onMouseMove({screenX:20,screenY:20})');
    const staleCarry = env.back();
    assert.equal(env.run('state.isPlayingDrag'), true);
    env.run('onMouseUp({})');
    assert.equal(env.run('state.isPlayingDrag'), false);
    assert.equal(env.player.cancelPending, null);
    staleCarry.emit('loadeddata');
    await microtasks();
    assert.match(env.player.source, /idle\.webm$/);
    assert.equal(env.player.front.style.opacity, '1');
    assert.equal(staleCarry.style.opacity, '0');
    assert.equal(staleCarry.paused, true);
  });

  await check('placeholder remains animated while a replacement is loading or fails', async () => {
    const env = environment();
    env.run('createPlaceholderAnimation()');
    assert.equal(env.canvas.style.display, 'block');
    const oldRaf = env.run('state.placeholderAnimId');
    assert.ok(env.raf.has(oldRaf));
    const pending = env.run("playVideo('missing.webm')");
    assert.equal(env.canvas.style.display, 'block');
    assert.ok(env.raf.has(oldRaf), 'placeholder RAF must not be canceled before a decoded replacement exists');
    env.back().emit('error');
    assert.equal(await pending, false);
    assert.equal(env.canvas.style.display, 'block');
    assert.ok(env.raf.has(env.run('state.placeholderAnimId')));
    const good = env.run("playVideo('good.webm')");
    assert.equal(env.canvas.style.display, 'block');
    env.back().emit('loadeddata');
    assert.equal(await good, true);
    assert.equal(env.canvas.style.display, 'none');
    assert.equal(env.run('state.placeholderAnimId'), null);
    assert.equal(env.raf.size, 0);
  });

  await check('loadeddata alone does not expose a video before its frame callback', async () => {
    const env = environment({ decodedFrames: true });
    const original = env.player.front;
    const pending = env.player.play('decoded.webm');
    const back = env.back();
    back.emit('loadeddata');
    await microtasks();
    assert.equal(env.player.front, original);
    assert.equal(back.style.opacity, '0');
    assert.equal(back.frameCallbacks.length, 1);
    back.decoded();
    assert.equal(await pending, true);
    assert.equal(env.player.front, back);
    assert.equal(back.style.opacity, '1');
  });

  await check('click completion restores idle and clears the click safety timer', async () => {
    const env = environment();
    env.run("state.idlePool=[{name:'idle.webm',path:'idle.webm'}]; state.clickPool=[{name:'pat.webm',path:'pat.webm'}]");
    await load(env, 'initial.webm');
    env.run('playClickAnimation()');
    const click = env.back();
    click.emit('loadeddata');
    await microtasks();
    assert.equal(env.run('state.isPlayingClick'), true);
    click.emit('ended');
    assert.equal(env.run('state.isPlayingClick'), false);
    assert.equal(env.timers.has(env.run('state.clickFallbackTimer')), false);
    env.back().emit('loadeddata');
    await microtasks();
    assert.match(env.player.source, /idle\.webm$/);
  });

  await check('automatic missing-key refresh and its cooldown stay silent', async () => {
    const env = environment();
    let calls = 0;
    env.petAPI.getApiBalance = async () => { calls++; return { success: false, error: '尚未配置 API Key，请在设置中填写' }; };
    assert.equal(await env.run('showBalance({silent:true})'), false);
    assert.equal(env.bubbles.length, 0, 'automatic failure must not leave a loading or error bubble');
    assert.equal(await env.run('showBalance({silent:true})'), false);
    assert.equal(calls, 1, 'cooldown must not request balance again');
    assert.equal(env.bubbles.length, 0, 'cached automatic failure must remain silent');
  });

  await check('manual missing-key refresh still explains how to configure the key', async () => {
    const env = environment();
    env.petAPI.getApiBalance = async () => ({ success: false, error: '尚未配置 API Key，请在设置中填写' });
    assert.equal(await env.run('showBalance({force:true})'), false);
    assert.equal(env.bubbles.length, 2);
    assert.match(env.bubbles[0].text, /查询余额中/);
    assert.match(env.bubbles[1].text, /余额查询失败.*API Key/);
    assert.equal(env.bubbles[1].duration, 4000, 'manual error must replace the loading message');
  });

  await check('automatic success still shows a card, while a disabled queued refresh does nothing', async () => {
    const env = environment();
    let calls = 0;
    env.petAPI.getApiBalance = async () => {
      calls++;
      return { success: true, data: { isAvailable: true, balances: [{ currency: 'CNY', totalBalance: '12.34' }] } };
    };
    env.run('state.balance.enabled=false');
    assert.equal(await env.run('showBalance({silent:true})'), false);
    assert.equal(calls, 0);
    env.run('state.balance.enabled=true');
    assert.equal(await env.run('showBalance({silent:true})'), true);
    assert.equal(env.bubbles.length, 1);
    assert.equal(env.bubbles[0].kind, 'balance');
    assert.equal(env.bubbles[0].data.balances[0].totalBalance, '12.34');
  });

  function snapshot(id) {
    const root = `assets/characters/${id}`;
    return { character: { id, name: id }, pet: { characterId: id }, animations: { characterId: id, idlePool: [], clickPool: [] },
      availableAnimations: { characterId: id,
        idle: [{ name: '待机.webm', path: `${root}/idle/待机.webm` }],
        click: [{ name: '摸头.webm', path: `${root}/click/摸头.webm` }, { name: '拖拽悬空.webm', path: `${root}/click/拖拽悬空.webm` }] } };
  }

  await check('changing character cancels the previous carry and replaces all three action pools', async () => {
    const env = environment();
    await env.run('init()');
    env.apiListeners.onCharacterChanged(snapshot('orange-mage'));
    env.back().emit('loadeddata'); await microtasks();
    assert.match(env.player.source, /orange-mage\/idle\//);
    env.run('onMouseDown({button:0,screenX:10,screenY:10,preventDefault(){}}); onMouseMove({screenX:20,screenY:20})');
    const staleCarry = env.back();
    assert.equal(env.run('state.isPlayingDrag'), true);
    env.apiListeners.onCharacterChanged(snapshot('violet-cat'));
    staleCarry.emit('loadeddata'); await microtasks();
    assert.equal(env.run('state.character.id'), 'violet-cat');
    assert.equal(env.run('state.isPlayingDrag || state.isPlayingClick'), false);
    assert.equal(env.run('state.clickPool.length'), 1, 'carry is excluded from random click reactions');
    assert.ok(env.run("[...state.idlePool,...state.clickPool,...state.allClickAnimations].every(a=>a.path.includes('/violet-cat/'))"));
    assert.match(env.run('state.dragAnimPath'), /violet-cat\/click\//);
    assert.match(env.player.source, /violet-cat\/idle\//);
    env.run('playClickAnimation()'); env.back().emit('loadeddata'); await microtasks();
    assert.match(decodeURIComponent(env.player.source), /violet-cat\/click\/摸头/);
    env.player.front.emit('ended'); env.back().emit('loadeddata'); await microtasks();
    assert.match(env.player.source, /violet-cat\/idle\//);
  });

  await check('a stale async animation refresh cannot restore another character after a switch', async () => {
    const env = environment();
    await env.run('init()');
    env.apiListeners.onCharacterChanged(snapshot('orange-mage'));
    env.back().emit('loadeddata'); await microtasks();
    let finishOld;
    env.petAPI.getAvailableAnimations = () => new Promise((resolve) => { finishOld = resolve; });
    const old = env.apiListeners.onReloadAnimations({ characterId: 'orange-mage', idlePool: ['待机.webm'] });
    env.apiListeners.onCharacterChanged(snapshot('white-dragon'));
    env.back().emit('loadeddata'); await microtasks();
    finishOld(snapshot('orange-mage').availableAnimations);
    await old;
    assert.equal(env.run('state.character.id'), 'white-dragon');
    assert.ok(env.run("state.idlePool.every(a=>a.path.includes('/white-dragon/'))"));
    assert.match(env.player.source, /white-dragon\/idle\//);
  });

  console.log(`\n${passed} player/controller regression checks passed (VM DOM/video model; real codec and window rendering not exercised).`);
})().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
