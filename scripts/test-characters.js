#!/usr/bin/env node
// Execute real registry/store/manager/IPC/tray/settings code with in-memory fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const ROOT = path.join(__dirname, '..');
const registry = require('../src/shared/characters');
let passed = 0;
async function check(name, fn) { await fn(); console.log('PASS ' + name); passed++; }
function load(file, stubs, extra = {}) {
  const filename = path.join(ROOT, file);
  const module = { exports: {} };
  const nativeRequire = createRequire(filename);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, __dirname: path.dirname(filename), Buffer,
    require: (name) => Object.hasOwn(stubs, name) ? stubs[name] : nativeRequire(name),
    process: { platform: 'win32', argv: [] }, console, ...extra
  }, { filename });
  return module.exports;
}
function fixture() {
  const data = {
    pet: { opacity: 0.6, crop: 1 },
    animations: { idlePool: ['legacy-blue.webm'], clickPool: ['legacy-blue-pat.webm'] },
    llm: { apiKeyEncrypted: 'untouched-fixture-ciphertext', apiEndpoint: 'https://example.invalid' },
    balance: { customPhrases: ['保留我的自定义语句'] },
    windowPosition: { petX: 123, petY: 456 }, sentinel: { keep: true }
  };
  class MemoryStore {
    constructor({ defaults }) { for (const [key, value] of Object.entries(defaults)) if (!(key in data)) data[key] = structuredClone(value); }
    get(key) { return structuredClone(data[key]); }
    set(key, value) { data[key] = structuredClone(value); }
  }
  const reloadStore = () => load('src/shared/store.js', { 'electron-store': MemoryStore, './characters': registry });
  const store = reloadStore();
  const messages = [];
  const win = { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: (channel, snapshot) => messages.push({ channel, snapshot }) } };
  const electron = { BrowserWindow: { getAllWindows: () => [win] } };
  const directories = new Map();
  for (const character of registry.CHARACTERS) {
    for (const type of ['idle', 'click']) directories.set(path.join(ROOT, character.animationRoot, type),
      type === 'idle' ? ['待机.webm', 'ignore.txt'] : ['摸头.webm', '拖拽悬空.webm']);
  }
  const manager = load('src/main/character-manager.js', {
    electron, '../shared/store': store, '../shared/characters': registry,
    fs: { existsSync: (file) => directories.has(file), readdirSync: (directory) => directories.get(directory) }
  });
  return { data, reloadStore, store, electron, win, messages, manager };
}

(async () => {
  await check('registry has five stable IDs and invalid/path-like IDs fall back safely', () => {
    assert.deepEqual(registry.listCharacters().map((c) => c.id), ['blue-maid', 'blonde-reaper', 'orange-mage', 'violet-cat', 'white-dragon']);
    for (const bad of ['', null, '../../outside', '__proto__']) assert.equal(registry.getCharacter(bad).id, 'blue-maid');
    assert.equal(registry.getCharacter('blue-maid').animationRoot, 'assets/animations');
  });

  await check('legacy preferences remain blue-only, each character persists separate animation choices', () => {
    const f = fixture();
    assert.equal(f.store.getPetConfig().characterId, 'blue-maid');
    assert.equal(f.store.getAnimationConfig().idlePool[0], 'legacy-blue.webm');
    f.manager.selectCharacter('orange-mage');
    assert.equal(f.store.getAnimationConfig().idlePool.length, 0);
    f.store.setAnimationConfig({ idlePool: ['orange-only.webm'], clickPool: ['摸头.webm'] });
    f.manager.selectCharacter('violet-cat');
    assert.equal(f.store.getAnimationConfig().idlePool.length, 0);
    f.store.setAnimationConfig({ idlePool: ['violet-only.webm'] });
    f.manager.selectCharacter('orange-mage');
    assert.equal(f.store.getAnimationConfig().idlePool[0], 'orange-only.webm');
    assert.equal(f.reloadStore().getPetConfig().characterId, 'orange-mage', 'selection survives module/store restart');
    f.manager.selectCharacter('blue-maid');
    assert.equal(f.store.getAnimationConfig().idlePool[0], 'legacy-blue.webm');
    f.store.setAnimationConfig({ characterId: 'orange-mage', idlePool: ['late-orange-save.webm'] });
    assert.equal(f.store.getAnimationConfig().idlePool[0], 'legacy-blue.webm', 'a stale settings save stays scoped to its original character');
  });

  await check('switch snapshots contain only selected roots and preserve unrelated profile data', () => {
    const f = fixture();
    const retained = structuredClone({ llm: f.data.llm, balance: f.data.balance, windowPosition: f.data.windowPosition, sentinel: f.data.sentinel });
    for (const character of registry.CHARACTERS) {
      const snapshot = f.manager.selectCharacter(character.id);
      assert.equal(snapshot.character.id, character.id);
      assert.equal(snapshot.pet.characterId, character.id);
      assert.equal(snapshot.availableAnimations.idle.length, 1);
      assert.equal(snapshot.availableAnimations.click.length, 2);
      assert.ok([...snapshot.availableAnimations.idle, ...snapshot.availableAnimations.click].every((item) => item.path.startsWith(character.animationRoot + '/')));
      assert.match(snapshot.availableAnimations.click.map((item) => item.name).join(','), /拖拽悬空/);
      assert.equal(f.messages.at(-1).channel, 'character-changed');
    }
    assert.equal(f.manager.selectCharacter('../outside').character.id, 'blue-maid');
    assert.equal(f.store.getPetConfig().opacity, 0.6);
    assert.deepEqual({ llm: f.data.llm, balance: f.data.balance, windowPosition: f.data.windowPosition, sentinel: f.data.sentinel }, retained);
  });

  await check('registered IPC exposes the same persisted selection and selected-only animation scan', () => {
    const f = fixture(); const handlers = new Map();
    f.electron.ipcMain = { handle: (name, fn) => handlers.set(name, fn), on() {} };
    const ipc = load('src/main/ipc-handlers.js', {
      electron: f.electron, '../shared/store': f.store, './character-manager': f.manager,
      './pet-window': { getPetWindow: () => f.win }, '../shared/deepseek-api': {},
      './settings-window': {}, './bubble-window': {}, './menu-window': {}
    });
    ipc.registerIpcHandlers();
    assert.equal(handlers.get('get-characters')().length, 5);
    handlers.get('set-character')({}, 'white-dragon');
    assert.equal(handlers.get('get-character-state')().character.id, 'white-dragon');
    assert.equal(handlers.get('get-available-animations')().characterId, 'white-dragon');
    handlers.get('set-character')({}, 'no-such-character');
    assert.equal(handlers.get('get-pet-config')().characterId, 'blue-maid');
  });

  await check('tray radio selection changes character and refreshes checked state and name', () => {
    const f = fixture(); let tray;
    f.electron.Tray = class {
      constructor() { tray = this; }
      on() {}
      setToolTip(value) { this.tooltip = value; }
      setContextMenu(value) { this.menu = value; }
    };
    f.electron.Menu = { buildFromTemplate: (template) => template };
    const api = load('src/main/tray.js', {
      electron: f.electron, '../shared/store': f.store, '../shared/characters': registry,
      './character-manager': f.manager, './pet-window': { getPetWindow: () => f.win },
      './settings-window': {}, '../plugins/plugin-manager': null
    });
    api.createTray();
    assert.equal(tray.menu[0].submenu.length, 5);
    tray.menu[0].submenu.find((item) => item.label === '紫发星猫').click();
    assert.equal(f.store.getPetConfig().characterId, 'violet-cat');
    assert.equal(tray.menu[0].submenu.filter((item) => item.checked).length, 1);
    assert.equal(tray.menu[0].submenu.find((item) => item.checked).label, '紫发星猫');
    assert.match(tray.tooltip, /紫发星猫/);
  });

  await check('settings character refresh replaces selector/pools without altering custom API/persona fields', () => {
    const f = fixture(); const nodes = new Map();
    const node = () => ({ value: '', textContent: '', innerHTML: '', querySelectorAll: () => [], addEventListener() {} });
    for (const id of ['pet-character', 'pet-character-hint', 'idle-anim-list', 'click-anim-list', 'api-key']) nodes.set(id, node());
    const context = { window: { settingsAPI: {} }, document: {
      getElementById: (id) => nodes.get(id), createElement: node,
      head: { appendChild() {} }, addEventListener() {}
    }, console };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/renderer/settings/settings.js'), 'utf8'), context);
    context.characters = registry.listCharacters();
    vm.runInContext("state.characters=characters; state.config={pet:{characterId:'blue-maid'},llm:{apiKey:'unchanged'},animations:{}}; for(const [key,id] of [['petCharacter','pet-character'],['petCharacterHint','pet-character-hint'],['idleAnimList','idle-anim-list'],['clickAnimList','click-anim-list']]) elements[key]=document.getElementById(id)", context);
    nodes.get('api-key').value = 'unsaved-key';
    context.snapshot = f.manager.selectCharacter('blonde-reaper');
    vm.runInContext('applyCharacterSnapshot(snapshot)', context);
    assert.equal(nodes.get('pet-character').value, 'blonde-reaper');
    assert.match(nodes.get('pet-character-hint').textContent, /金发战斧/);
    assert.equal(nodes.get('api-key').value, 'unsaved-key');
    assert.equal(vm.runInContext('state.config.llm.apiKey', context), 'unchanged');
    assert.equal(vm.runInContext('state.config.animations.characterId', context), 'blonde-reaper');
  });

  await check('chat preserves a custom persona and only interprets exact old defaults as a generic companion', async () => {
    const custom = '用户自己写的角色：请用简短的粤语回答。';
    const oldDefault = '你是用户桌面上的蓝鲸女仆，蓝发、温柔、活泼。用中文简洁自然地交流，不假装执行了未执行的操作。';
    for (const original of [custom, oldDefault, '']) {
      let requestedPrompt;
      const plugin = load('src/plugins/llm-chat/main.js', {
        './chat-client': { DEFAULT_MODEL: 'fixture', requestChat(config, messages) {
          requestedPrompt = messages[0].content;
          return { promise: Promise.resolve('fixture reply'), cancel() {} };
        } }
      });
      const listeners = new Map();
      const memory = { conversations: [], activeConversationId: null };
      const settings = { apiKey: 'fixture-only-key', systemPrompt: original };
      let complete;
      const done = new Promise((resolve) => { complete = resolve; });
      plugin.activate({
        settings: { get: () => settings }, host: {},
        createStore: () => ({ get: (key) => structuredClone(memory[key]), set: (key, value) => { memory[key] = structuredClone(value); } }),
        ipc: { handle() {}, on: (name, fn) => listeners.set(name, fn), send: (name) => { if (name === 'stream-done' || name === 'stream-error') complete(name); } },
        onCommand() {}, onSettingsAction() {}, onSettingsChanged() {}, onDeactivate() {}, log() {}, warn() {}
      });
      listeners.get('send-message')(null, { requestId: 'fixture-character-persona', content: '你好' });
      assert.equal(await done, 'stream-done');
      assert.equal(settings.systemPrompt, original, 'no settings are rewritten');
      if (original === custom) assert.equal(requestedPrompt, custom);
      else { assert.match(requestedPrompt, /桌宠伙伴/); assert.doesNotMatch(requestedPrompt, /蓝鲸女仆/); }
      plugin.deactivate();
    }
  });

  console.log(`\n${passed} character registry/store/IPC/tray/settings checks passed (in-memory; no user profile or GUI used).`);
})().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
