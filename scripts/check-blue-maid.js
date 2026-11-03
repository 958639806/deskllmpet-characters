// Real Electron, real IPC, real VP9 alpha and a local HTTP mock. No live key.
require('../src/shared/stdio-guard');
const fs = require('fs');
const path = require('path');
const http = require('http');
const electron = require('electron');
const { app, BrowserWindow, ipcMain } = electron;
const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'verification');
fs.mkdirSync(OUTPUT, { recursive: true });
const profile = path.join(OUTPUT, 'profiles', `mock-${Date.now()}-${process.pid}`);
app.setPath('userData', profile);
const results = [];
const pageErrors = [];
let server;
let store;
let host;
let mockRequests = 0;
const fakeKey = 'local-smoke-key-not-a-real-account';
const responseText = '你好，我是蓝鲸女仆。这条回复来自本地模拟服务。';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function assert(ok, message) { if (!ok) throw new Error(message); }
function pass(name, details) { results.push({ name, passed: true, details }); console.log('PASS ' + name); }
async function until(check, description, ms = 15000) {
  const limit = Date.now() + ms;
  while (Date.now() < limit) { if (await check()) return; await sleep(60); }
  throw new Error('Timed out: ' + description);
}
app.on('browser-window-created', (_, win) => {
  win.setPosition(-12000, -12000);
  win.webContents.on('preload-error', (_, preload, error) => pageErrors.push(error.message));
  win.webContents.on('render-process-gone', (_, details) => pageErrors.push(details.reason));
  win.webContents.on('console-message', (_, level, message) => { if (level >= 3) pageErrors.push(message); });
});

async function startMock() {
  server = http.createServer((req, res) => {
    mockRequests++;
    if (req.headers.authorization !== 'Bearer ' + fakeKey) {
      res.writeHead(401); res.end(JSON.stringify({ error: { message: 'local test authorization failed' } })); return;
    }
    if (req.url === '/user/balance') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '12.34', granted_balance: '2.00', topped_up_balance: '10.34' }] }));
      return;
    }
    if (req.url === '/v1/chat/completions') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const request = JSON.parse(body);
        assert(request.model === 'deepseek-flash', 'Unexpected model in UI request');
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const parts = ['你好，我是蓝鲸女仆。', '这条回复来自本地模拟服务。'];
        res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: parts[0] } }] }) + '\n\n');
        setTimeout(() => {
          if (res.destroyed) return;
          res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: parts[1] }, finish_reason: 'stop' }] }) + '\n\n');
          res.end('data: [DONE]\n\n');
        }, 80);
      });
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return 'http://127.0.0.1:' + server.address().port;
}

async function run() {
  const endpoint = await startMock();
  store = require('../src/shared/store');
  store.setLLMConfig({ apiEndpoint: endpoint, balanceEndpoint: endpoint + '/user/balance', apiKey: fakeKey });
  const stored = JSON.parse(fs.readFileSync(path.join(profile, 'config.json'), 'utf8'));
  assert(!stored.llm.apiKey && stored.llm.apiKeyEncrypted, 'Primary key was not encrypted at rest');
  assert(store.getLLMConfig().apiKey === fakeKey, 'safeStorage decryption did not restore local test key');
  pass('Windows safeStorage encrypts and decrypts the primary test key', { encryptionAtRest: true });

  require('../src/main/ipc-handlers').registerIpcHandlers();
  const bubbles = [];
  // Capture the real pet's requests without putting mock money on the desktop.
  ipcMain.removeHandler('pet-show-bubble');
  ipcMain.handle('pet-show-bubble', (_, payload) => { bubbles.push(payload); return { success: true }; });
  const manager = require('../src/plugins/plugin-manager');
  host = manager.initPluginHost({ electron, logger: console, hostServices: { getSharedLLMConfig: store.getLLMConfig, openSettings: () => ({ success: true }) } });
  const reports = await host.loadAll();
  assert(reports.some((entry) => entry.id === 'llm-chat' && entry.status === 'active'), 'Chat plugin was not active');
  const pet = await require('../src/main/pet-window').createPetWindow(false, { show: false });
  await until(() => pet.webContents.executeJavaScript('typeof state !== "undefined" && !!videoPlayer.source && elements.video.readyState >= 2'), 'initial decoded video');
  const first = await pet.webContents.executeJavaScript(`(() => {
    const v = elements.video;
    const c = document.createElement('canvas'); c.width = 512; c.height = 512;
    const ctx = c.getContext('2d'); ctx.drawImage(v, 0, 0, 512, 512);
    return { source: state.currentIdleFile, width:v.videoWidth, height:v.videoHeight,
      cornerAlpha:ctx.getImageData(0,0,1,1).data[3], centerAlpha:ctx.getImageData(256,260,1,1).data[3],
      crop:state.config.crop, idleCount:state.idlePool.length, clickCount:state.clickPool.length,
      carryAvailable:!!state.dragAnimPath };
  })()`);
  assert(first.width === 512 && first.height === 512 && first.cornerAlpha === 0 && first.centerAlpha > 128, 'VP9 alpha was not decoded correctly in Chromium');
  assert(first.crop === 1 && first.idleCount === 1 && first.clickCount === 1 && first.carryAvailable, 'Incorrect skin/crop/action pools');
  pass('Real Chromium decodes blue-maid VP9 alpha with full-body framing', first);
  await sleep(1800);
  const playback = await pet.webContents.executeJavaScript('({time:elements.video.currentTime, total:elements.video.getVideoPlaybackQuality().totalVideoFrames, dropped:elements.video.getVideoPlaybackQuality().droppedVideoFrames})');
  assert(playback.time > 0.1, 'Idle video did not advance');
  pass('Native video playback advances', playback);
  const screenshot = await pet.webContents.capturePage();
  fs.writeFileSync(path.join(OUTPUT, 'pet-idle.png'), screenshot.toPNG());

  await pet.webContents.executeJavaScript('playClickReaction()');
  await until(() => pet.webContents.executeJavaScript('state.isPlayingClick && videoPlayer.source.includes(encodeURIComponent("摸头"))'), 'head-pat clip');
  await until(() => pet.webContents.executeJavaScript('!state.isPlayingClick && videoPlayer.source.includes(encodeURIComponent("待机"))'), 'return to idle');
  pass('Head-pat clip ends and returns to idle');

  await pet.webContents.executeJavaScript(`(() => {
    const c = elements.container;
    c.dispatchEvent(new MouseEvent('mousedown', {button:0, screenX:100, screenY:100, bubbles:true}));
    document.dispatchEvent(new MouseEvent('mousemove', {screenX:120, screenY:110, bubbles:true}));
    document.dispatchEvent(new MouseEvent('mouseup', {button:0, screenX:120, screenY:110, bubbles:true}));
  })()`);
  await sleep(300);
  assert(await pet.webContents.executeJavaScript('!state.isPlayingDrag && videoPlayer.source.includes(encodeURIComponent("待机"))'), 'Quick drag/release left carry clip active');
  pass('Synthetic drag/release returns to idle during a pending clip load');

  const balance = await pet.webContents.executeJavaScript('window.petAPI.getApiBalance()');
  assert(balance.success && balance.data.balances[0].totalBalance === '12.34', 'Balance IPC did not reach local HTTP service');
  await pet.webContents.executeJavaScript('showBalance({force:true})');
  assert(bubbles.some((entry) => entry.kind === 'balance' && entry.data.balances[0].totalBalance === '12.34'), 'Balance result did not reach the pet bubble');
  pass('Balance settings -> encrypted key -> HTTP -> IPC -> pet card payload (local mock only)');

  await host.runCommand('llm-chat', 'open-chat');
  await until(() => BrowserWindow.getAllWindows().some((win) => win.webContents.getURL().includes('/llm-chat/renderer/chat.html')), 'chat window load');
  const chat = BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().includes('/llm-chat/renderer/chat.html'));
  assert(chat, 'Chat window was not created');
  await until(() => chat.webContents.executeJavaScript('typeof state !== "undefined" && !!state.config && !!elements.btnSend'), 'chat UI init');
  assert(await chat.webContents.executeJavaScript('state.config.hasApiKey'), 'Chat did not inherit the primary key');
  await chat.webContents.executeJavaScript('elements.messageInput.value="你好，介绍一下自己"; elements.btnSend.click()');
  await until(() => chat.webContents.executeJavaScript('!state.isStreaming && Array.from(document.querySelectorAll(".message.assistant:not(.error)")).some(m=>(m.dataset.content||"").includes("本地模拟服务"))'), 'streaming response in chat UI');
  const chatResult = await chat.webContents.executeJavaScript('({model:state.config.model, keyFrom:state.config.keyFrom, reply:Array.from(document.querySelectorAll(".message.assistant:not(.error)")).at(-1).dataset.content})');
  assert(chatResult.reply === responseText, 'Chat UI response differed from local SSE response');
  await sleep(450); // Let CSS entry transitions and the compositor finish before visual QA.
  fs.writeFileSync(path.join(OUTPUT, 'chat-local-mock.png'), (await chat.webContents.capturePage()).toPNG());
  pass('Real chat window inherits primary key, streams reply and saves history (local mock only)', chatResult);
  const historyPath = path.join(profile, 'plugins', 'llm-chat', 'data.json');
  assert(fs.readFileSync(historyPath, 'utf8').includes(responseText), 'Chat response was not persisted');
  assert(pageErrors.length === 0, 'Renderer/preload errors: ' + pageErrors.join('; '));
  pass('No renderer/preload crashes and the local response persists');
  store.setLLMConfig({ apiKey: '' });
  fs.writeFileSync(path.join(OUTPUT, 'blue-maid-integration.json'), JSON.stringify({ result: 'passed', mockOnly: true, liveDeepSeekTested: false, realMouseTested: false, checkedUtc: new Date().toISOString(), results, mockRequests }, null, 2));
}

app.whenReady().then(run).then(async () => {
  if (host) await host.deactivateAll();
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.destroy();
  if (server) server.close();
  app.exit(0);
}).catch((error) => {
  console.error(error.stack);
  fs.writeFileSync(path.join(OUTPUT, 'blue-maid-integration.json'), JSON.stringify({ result: 'failed', mockOnly: true, error: error.stack, results }, null, 2));
  if (server) server.close();
  app.exit(1);
});
