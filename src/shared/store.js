/**
 * 持久化存储模块
 * 使用 electron-store 管理应用配置
 */

const Store = require('electron-store');
const { DEFAULT_CHARACTER_ID, normalizeCharacterId } = require('./characters');

const defaults = {
  llm: {
    apiEndpoint: 'https://api.deepseek.com',
    balanceEndpoint: '',
    apiKey: ''
  },
  animations: {
    idlePool: [],
    clickPool: [],
    currentIdleIndex: 0
  },
  balance: {
    enabled: true,
    intervalMinutes: 30,
    // 关闭余额气泡后，双击桌宠随机展示的自定义语句（每行一句）
    customPhrases: []
  },
  pet: {
    characterId: DEFAULT_CHARACTER_ID,
    opacity: 1.0,
    scale: 1.0,
    autoStart: false,
    theme: 'dark',
    // 蓝鲸女仆素材为完整方形人物，默认保留整张画布。
    crop: 1.0,
    cropOffsetX: 0,
    cropOffsetY: 0
  },
  // 气泡（独立悬浮窗口）设置
  bubble: {
    scale: 1.0,      // 气泡整体大小倍率
    offsetX: 0,      // 相对宠物中心的水平偏移（像素）
    offsetY: 0       // 相对默认位置（宠物正上方）的垂直偏移（像素，负值更靠上）
  },
  windowPosition: { petX: null, petY: null },
  firstRun: true
};

let _store = null;

function getStore() {
  if (!_store) _store = new Store({ defaults });
  return _store;
}

// ====== 主 Key：使用 Electron safeStorage；不改变插件自己的存储边界 ======
// getLLMConfig 仍向现有设置页/主进程返回可用明文，磁盘上只保存加密后的 base64。
function keyStorage() {
  try { return require('electron').safeStorage; } catch (e) { return null; }
}

function canEncrypt(storage) {
  try { return !!storage && storage.isEncryptionAvailable(); } catch (e) { return false; }
}

function encryptKey(key) {
  const storage = keyStorage();
  if (!canEncrypt(storage)) throw new Error('系统密钥加密不可用，API Key 未保存。请在正常桌面会话中重试。');
  try { return storage.encryptString(key).toString('base64'); }
  catch (e) { throw new Error('API Key 加密失败，未写入明文'); }
}

function getLLMConfig() {
  const saved = { ...defaults.llm, ...getStore().get('llm') };
  let key = String(saved.apiKey || '').trim();
  let keyProtection = key ? 'legacy-plaintext' : 'none';
  if (saved.apiKeyEncrypted) {
    const storage = keyStorage();
    if (!canEncrypt(storage)) throw new Error('当前系统无法解密已保存的 API Key，请返回原用户的桌面会话或重新配置 Key。');
    try { key = storage.decryptString(Buffer.from(saved.apiKeyEncrypted, 'base64')); }
    catch (e) { throw new Error('API Key 解密失败，请重新输入 Key；原加密记录已保留。'); }
    keyProtection = 'safeStorage';
  } else if (key && canEncrypt(keyStorage())) {
    // Migrate legacy plaintext only after encryption succeeds; failed migration never erases it.
    const encrypted = encryptKey(key);
    getStore().set('llm', { ...saved, apiKey: '', apiKeyEncrypted: encrypted });
    keyProtection = 'safeStorage';
  }
  delete saved.apiKeyEncrypted;
  return { ...saved, apiKey: key, keyProtection };
}

function setLLMConfig(config) {
  const saved = { ...defaults.llm, ...getStore().get('llm') };
  const next = { ...saved };
  for (const name of ['apiEndpoint', 'balanceEndpoint']) {
    if (config && Object.prototype.hasOwnProperty.call(config, name)) next[name] = String(config[name] || '').trim();
  }
  if (config && Object.prototype.hasOwnProperty.call(config, 'apiKey')) {
    const key = String(config.apiKey || '').trim();
    const encrypted = key ? encryptKey(key) : '';
    next.apiKey = '';
    if (encrypted) next.apiKeyEncrypted = encrypted;
    else delete next.apiKeyEncrypted;
  }
  getStore().set('llm', next);
}

// ====== 余额气泡配置 ======

/** 单条自定义语句的最大长度 */
const MAX_PHRASE_LENGTH = 200;
/** 自定义语句最多条数 */
const MAX_PHRASE_COUNT = 50;

/**
 * 清洗自定义语句：去掉空行、合并换行、去重、限长限量
 * 纯函数，写盘前统一用它，避免脏数据落到配置里
 */
function normalizeCustomPhrases(input) {
  if (!Array.isArray(input)) return [];
  const result = [];
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const text = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_PHRASE_LENGTH);
    if (!text || result.includes(text)) continue;
    result.push(text);
    if (result.length >= MAX_PHRASE_COUNT) break;
  }
  return result;
}

function getBalanceConfig() { return { ...defaults.balance, ...getStore().get('balance') }; }

function setBalanceConfig(config) {
  const next = { ...getBalanceConfig(), ...config };
  if (config && config.customPhrases !== undefined) {
    next.customPhrases = normalizeCustomPhrases(config.customPhrases);
  }
  getStore().set('balance', next);
}

// ====== 动画配置 ======
function getAnimationConfig(characterId = getPetConfig().characterId) {
  const id = normalizeCharacterId(characterId);
  const saved = getStore().get('animations') || {};
  // Existing top-level pools belong to the original blue-maid only.
  const selected = saved.byCharacter?.[id] || (id === DEFAULT_CHARACTER_ID ? saved : {});
  return {
    characterId: id,
    idlePool: Array.isArray(selected.idlePool) ? selected.idlePool : [],
    clickPool: Array.isArray(selected.clickPool) ? selected.clickPool : [],
    currentIdleIndex: Number(selected.currentIdleIndex) || 0
  };
}
function setAnimationConfig(config) {
  if (!config || typeof config !== 'object') return;
  const id = normalizeCharacterId(config.characterId ?? getPetConfig().characterId);
  const saved = getStore().get('animations') || {};
  const next = { ...getAnimationConfig(id) };
  for (const key of ['idlePool', 'clickPool']) {
    if (Array.isArray(config[key])) next[key] = config[key].filter((name) => typeof name === 'string');
  }
  if (Number.isFinite(Number(config.currentIdleIndex))) next.currentIdleIndex = Number(config.currentIdleIndex);
  delete next.characterId;
  getStore().set('animations', { ...saved, byCharacter: { ...saved.byCharacter, [id]: next } });
}

// ====== 宠物设置 ======
function getPetConfig() {
  const pet = { ...defaults.pet, ...getStore().get('pet') };
  return { ...pet, characterId: normalizeCharacterId(pet.characterId) };
}
function setPetConfig(config) {
  const pet = { ...getPetConfig(), ...config };
  getStore().set('pet', { ...pet, characterId: normalizeCharacterId(pet.characterId) });
}

// ====== 气泡设置 ======
function getBubbleConfig() { return { ...defaults.bubble, ...getStore().get('bubble') }; }
function setBubbleConfig(config) { getStore().set('bubble', { ...getBubbleConfig(), ...config }); }

// ====== 窗口位置 ======
function saveWindowPosition(x, y) { getStore().set('windowPosition', { petX: x, petY: y }); }
function getWindowPosition() { return getStore().get('windowPosition'); }

// ====== 所有配置 ======
function getAllConfig() {
  return {
    llm: getLLMConfig(),
    animations: getAnimationConfig(),
    balance: getBalanceConfig(),
    pet: getPetConfig(),
    bubble: getBubbleConfig()
  };
}

module.exports = {
  getLLMConfig, setLLMConfig,
  getBalanceConfig, setBalanceConfig,
  normalizeCustomPhrases, MAX_PHRASE_LENGTH, MAX_PHRASE_COUNT,
  getAnimationConfig, setAnimationConfig,
  getPetConfig, setPetConfig,
  getBubbleConfig, setBubbleConfig,
  saveWindowPosition, getWindowPosition,
  getAllConfig,
  getStore
};
