#!/usr/bin/env node
/** Local HTTP integration tests. No real keys, model requests, Electron profile, or external network. */
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { setTimeout: delay } = require('node:timers/promises');
const { fetchBalance, resolveBalanceEndpoint } = require('../src/shared/deepseek-api');
const { requestChat, resolveChatEndpoint, DEFAULT_MODEL } = require('../src/plugins/llm-chat/chat-client');

const FIXTURE_KEY = 'local-fixture-only';
const messages = [{ role: 'user', content: '你好' }];
let passed = 0;
const sockets = new Set();

async function check(name, fn) {
  await fn();
  passed++;
  console.log(`PASS ${name}`);
}

function bounded(promise, ms = 2500) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Fixture deadline exceeded')), ms); })])
    .finally(() => clearTimeout(timer));
}

async function fixture(req, res) {
  assert.equal(req.headers.authorization, `Bearer ${FIXTURE_KEY}`);
  const url = new URL(req.url, 'http://127.0.0.1');
  const json = (value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
  if (req.method === 'GET') {
    if (url.pathname === '/user/balance') return json({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '12.30', granted_balance: '2.30', topped_up_balance: '10.00' }] });
    if (url.pathname === '/401') return json({ error: { message: 'fixture unauthorized' } }, 401);
    if (url.pathname === '/null') return json(null);
    if (url.pathname === '/invalid-money') return json({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: 'NaN', granted_balance: '0', topped_up_balance: '0' }] });
    if (url.pathname === '/broken') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{broken'); }
    if (url.pathname === '/aborted') { res.writeHead(200, { 'Content-Length': '500' }); res.write('{'); return setTimeout(() => res.destroy(), 10); }
    return;
  }
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  assert.equal(body.model, DEFAULT_MODEL);
  assert.deepEqual(body.thinking, { type: 'disabled' });
  const scenario = url.pathname.split('/')[2] || 'normal';
  if (scenario === 'plugin-cancel') {
    assert.equal(body.messages[0].role, 'system');
    assert.equal(body.messages.at(-1).content, '你好');
  } else assert.deepEqual(body.messages, messages);
  if (scenario === '401') return json({ error: { message: 'fixture unauthorized' } }, 401);
  if (scenario === 'normal' || scenario === 'fallback') return json({ choices: [{ message: { content: '你好，主人。' }, finish_reason: 'stop' }] });
  if (scenario === 'empty') return json({ choices: [] });
  if (scenario === 'broken') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{broken'); }
  if (scenario === 'no-headers') return;
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  if (scenario === 'sse-error') return res.end('data: {"error":{"message":"fixture rate limit"}}\n\n');
  if (scenario === 'sse-broken') return res.end('data: {broken}\n\n');
  if (scenario === 'aborted-stream') {
    res.write('data: {"choices":[{"delta":{"content":"未完成"}}]}\n\n');
    return setTimeout(() => res.destroy(), 10);
  }
  if (scenario === 'truncated') return res.end('data: {"choices":[{"delta":{"content":"只到一半"}}]}\n\n');
  if (scenario === 'cancel-stream' || scenario === 'plugin-cancel' || scenario === 'stall') {
    res.write('data: {"choices":[{"delta":{"content":"已生成部分"}}]}\n\n');
    return;
  }
  const payload = Buffer.from(': heartbeat\r\nevent: message\r\ndata: {"choices":[{"delta":{"content":"你"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"好🐋"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]');
  // Split both JSON and a multibyte UTF-8 character across real socket writes.
  for (let i = 0; i < payload.length && !res.destroyed; i += 7) {
    res.write(payload.subarray(i, i + 7));
    await delay(1);
  }
  if (!res.destroyed) res.end();
}

function loadStoreFixture(initial = {}) {
  const data = { llm: { apiEndpoint: 'https://api.deepseek.com', balanceEndpoint: '', apiKey: '', ...initial } };
  let available = true;
  const safeStorage = {
    isEncryptionAvailable: () => available,
    encryptString: (text) => Buffer.from(`fixture-encrypted:${text}`),
    decryptString: (buffer) => {
      const value = buffer.toString();
      if (!value.startsWith('fixture-encrypted:')) throw new Error('invalid fixture ciphertext');
      return value.slice('fixture-encrypted:'.length);
    }
  };
  class MemoryStore {
    constructor({ defaults }) { for (const [key, value] of Object.entries(defaults)) if (!(key in data)) data[key] = value; }
    get(key) { return structuredClone(data[key]); }
    set(key, value) { data[key] = structuredClone(value); }
  }
  const module = { exports: {} };
  const filename = path.join(__dirname, '../src/shared/store.js');
  const source = fs.readFileSync(filename, 'utf8');
  const run = vm.runInThisContext(`(function(require,module,exports,Buffer){${source}\n})`, { filename });
  run((name) => {
    if (name === 'electron-store') return MemoryStore;
    if (name === 'electron') return { safeStorage };
    if (name === './characters') return require('../src/shared/characters');
    throw new Error(`Unexpected fixture import: ${name}`);
  }, module, module.exports, Buffer);
  return { api: module.exports, data, setAvailable(value) { available = value; } };
}

async function run() {
  const server = http.createServer((req, res) => fixture(req, res).catch((error) => {
    if (!res.headersSent) res.writeHead(500);
    res.end(`fixture error: ${error.message}`);
  }));
  server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const balanceConfig = (route) => ({ apiKey: FIXTURE_KEY, ...(route ? { balanceEndpoint: base + route } : { apiEndpoint: base }) });
  const chatConfig = (scenario) => ({ apiKey: FIXTURE_KEY, apiEndpoint: `${base}/case/${scenario}/v1` });
  try {
    await check('official balance endpoint remains GET /user/balance', async () => {
      assert.equal(resolveBalanceEndpoint({}), 'https://api.deepseek.com/user/balance');
      const value = await fetchBalance(balanceConfig());
      assert.equal(value.balances[0].totalBalance, '12.30');
      assert.equal(value.isAvailable, true);
    });
    for (const [route, error] of [['/401', /401/], ['/broken', /解析失败/], ['/null', /格式无效/], ['/invalid-money', /格式无效/], ['/aborted', /中断|响应错误/]]) {
      await check(`balance rejects ${route}`, () => assert.rejects(bounded(fetchBalance(balanceConfig(route))), error));
    }
    await check('balance timeout settles', () => assert.rejects(bounded(fetchBalance(balanceConfig('/stall'), { timeoutMs: 40 })), /超时/));
    await check('missing key does not make a request or fabricate balance', () => assert.rejects(fetchBalance({}), /尚未配置/));
    await check('chat endpoint retains custom query and rejects unsupported protocol', () => {
      assert.equal(resolveChatEndpoint(`${base}/v1?fixture=1`), `${base}/v1/chat/completions?fixture=1`);
      assert.throws(() => resolveChatEndpoint('ftp://example.test'), /HTTP/);
    });
    await check('chat JSON response and current default model', async () => {
      assert.equal(DEFAULT_MODEL, 'deepseek-flash');
      assert.equal(await requestChat(chatConfig('normal'), messages, { stream: false }).promise, '你好，主人。');
    });
    await check('SSE split socket chunks, CRLF, UTF-8 and final no-newline DONE', async () => {
      const chunks = [];
      const result = await bounded(requestChat(chatConfig('sse'), messages, { onChunk: (text) => chunks.push(text) }).promise);
      assert.equal(result, '你好🐋');
      assert.equal(chunks.join(''), result);
    });
    await check('stream request accepts valid JSON response from compatibility gateway', async () => {
      assert.equal(await requestChat(chatConfig('fallback'), messages).promise, '你好，主人。');
    });
    for (const [scenario, error] of [['401', /401/], ['broken', /解析失败/], ['empty', /未返回正文/], ['sse-error', /fixture rate limit/], ['sse-broken', /JSON 解析失败/], ['truncated', /提前结束/], ['aborted-stream', /中断/]]) {
      await check(`chat rejects ${scenario}`, () => assert.rejects(bounded(requestChat(chatConfig(scenario), messages).promise), error));
    }
    await check('cancel before headers rejects promptly', async () => {
      const handle = requestChat(chatConfig('no-headers'), messages);
      setTimeout(() => handle.cancel(), 15);
      await assert.rejects(bounded(handle.promise), (error) => error.canceled === true);
    });
    await check('cancel during SSE rejects without further chunks', async () => {
      let count = 0;
      const handle = requestChat(chatConfig('cancel-stream'), messages, { onChunk: () => { count++; handle.cancel(); } });
      await assert.rejects(bounded(handle.promise), (error) => error.canceled === true);
      assert.equal(count, 1);
    });
    await check('stalled SSE timeout settles', () => assert.rejects(bounded(requestChat(chatConfig('stall'), messages, { timeoutMs: 40 }).promise), /超时/));
    await check('plugin cancellation persists the partial response', async () => {
      const plugin = require('../src/plugins/llm-chat/main');
      const handlers = new Map();
      const listeners = new Map();
      let done;
      const completion = new Promise((resolve) => { done = resolve; });
      const memory = { conversations: [], activeConversationId: null };
      const ctx = {
        settings: { get: () => ({ apiKey: FIXTURE_KEY, apiEndpoint: `${base}/case/plugin-cancel/v1` }) },
        host: {},
        createStore: () => ({ get: (key) => structuredClone(memory[key]), set: (key, value) => { memory[key] = structuredClone(value); } }),
        ipc: {
          handle: (name, fn) => handlers.set(name, fn),
          on: (name, fn) => listeners.set(name, fn),
          send(name, payload) {
            if (name === 'stream-chunk') listeners.get('cancel-stream')(null, { requestId: payload.requestId });
            if (name === 'stream-done' || name === 'stream-error') done({ name, payload });
          }
        },
        onCommand() {}, onSettingsAction() {}, onSettingsChanged() {}, onDeactivate() {}, log() {}, warn() {}
      };
      plugin.activate(ctx);
      listeners.get('send-message')(null, { requestId: 'fixture-plugin-request', content: '你好' });
      const result = await bounded(completion);
      assert.equal(result.name, 'stream-done');
      assert.equal(result.payload.canceled, true);
      const conversation = handlers.get('get-active-conversation')();
      assert.equal(conversation.messages.at(-1).content, '已生成部分');
      plugin.deactivate();
      ctx.settings.get = () => ({});
      memory.conversations = [];
      memory.activeConversationId = null;
      plugin.activate(ctx);
      listeners.get('send-message')(null, { requestId: 'fixture-missing-key', content: '你好' });
      await delay(0);
      assert.equal(memory.conversations.length, 0);
      plugin.deactivate();
    });
    await check('safeStorage wrapper encrypts at rest and preserves settings API', () => {
      const f = loadStoreFixture();
      f.api.setLLMConfig({ apiKey: 'fixture-secret' });
      assert.equal(f.data.llm.apiKey, '');
      assert.equal(JSON.stringify(f.data).includes('fixture-secret'), false);
      assert.equal(f.api.getLLMConfig().apiKey, 'fixture-secret');
      assert.equal(f.api.getLLMConfig().keyProtection, 'safeStorage');
      assert.equal(f.api.getPetConfig().crop, 1);
      const ciphertext = f.data.llm.apiKeyEncrypted;
      f.api.setLLMConfig({ balanceEndpoint: base + '/user/balance' });
      assert.equal(f.data.llm.apiKeyEncrypted, ciphertext);
      f.api.setLLMConfig({ apiKey: '' });
      assert.equal(f.data.llm.apiKeyEncrypted, undefined);
    });
    await check('legacy key migrates only after encryption is available', () => {
      const f = loadStoreFixture({ apiKey: 'fixture-legacy' });
      f.setAvailable(false);
      assert.equal(f.api.getLLMConfig().keyProtection, 'legacy-plaintext');
      f.setAvailable(true);
      assert.equal(f.api.getLLMConfig().apiKey, 'fixture-legacy');
      assert.equal(f.data.llm.apiKey, '');
      assert.ok(f.data.llm.apiKeyEncrypted);
    });
    await check('unavailable encryption refuses new plaintext writes; corrupt cipher can be replaced', () => {
      const f = loadStoreFixture();
      f.setAvailable(false);
      assert.throws(() => f.api.setLLMConfig({ apiKey: 'must-not-save' }), /未保存/);
      assert.equal(f.data.llm.apiKey, '');
      f.setAvailable(true);
      f.data.llm.apiKeyEncrypted = Buffer.from('bad').toString('base64');
      assert.throws(() => f.api.getLLMConfig(), /解密失败/);
      f.api.setLLMConfig({ apiKey: 'fixture-replacement' });
      assert.equal(f.api.getLLMConfig().apiKey, 'fixture-replacement');
    });
    console.log(`\n${passed} checks passed. Local HTTP + simulated safeStorage only; no live DeepSeek or DPAPI test.`);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
}

run().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
