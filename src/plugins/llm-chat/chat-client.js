/** OpenAI-compatible chat client. Uses Node built-ins so local HTTP fixtures can exercise the real transport. */
const https = require('https');
const http = require('http');

const DEFAULT_CHAT_ENDPOINT = 'https://api.deepseek.com/v1/chat/completions';
// Verified against https://api-docs.deepseek.com/api/list-models/ on 2026-10-17.
const DEFAULT_MODEL = 'deepseek-flash';
const REQUEST_TIMEOUT = 120000;

function canceledError() {
  const err = new Error('已取消生成');
  err.canceled = true;
  return err;
}

function resolveChatEndpoint(endpoint) {
  let raw = String(endpoint || '').trim();
  if (!raw) return DEFAULT_CHAT_ENDPOINT;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;
  const parsed = new URL(raw);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('API 地址必须是 HTTP/HTTPS，且不能包含用户名或密码');
  }
  let pathname = parsed.pathname.replace(/\/+$/, '');
  if (!/\/chat\/completions$/i.test(pathname)) pathname = pathname ? `${pathname}/chat/completions` : '/v1/chat/completions';
  parsed.pathname = pathname;
  parsed.hash = '';
  return parsed.toString();
}

function clampNumber(value, min, max, fallback) {
  if (value === '' || value == null) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function parseSseLine(line) {
  const trimmed = String(line == null ? '' : line).trim();
  if (!trimmed.startsWith('data:')) return null;
  const data = trimmed.slice(5).trim();
  if (!data) return null;
  if (data === '[DONE]') return { done: true, content: '' };
  let parsed;
  try { parsed = JSON.parse(data); } catch (e) { throw new Error('流式响应 JSON 解析失败'); }
  if (!parsed || typeof parsed !== 'object') throw new Error('流式响应格式无效');
  if (parsed.error) throw new Error(String(parsed.error.message || parsed.error || '模型返回错误'));
  const choice = Array.isArray(parsed.choices) ? parsed.choices[0] : null;
  if (choice && ['aborted', 'insufficient_system_resource', 'content_filter'].includes(choice.finish_reason)) {
    throw new Error(`模型未正常完成回复（${choice.finish_reason}）`);
  }
  const content = choice && choice.delta && choice.delta.content;
  if (content != null && typeof content !== 'string') throw new Error('流式正文格式无效');
  return { done: false, content: content || '', finished: !!(choice && choice.finish_reason != null) };
}

/** Handles UTF-8 decoded chunks, CRLF, keepalive lines, and a final line without a newline. */
function createSseParser(onDelta, onDone) {
  let buffer = '';
  let done = false;
  let finished = false;
  const consume = (line) => {
    if (done) return;
    const event = parseSseLine(line);
    if (!event) return;
    if (event.finished) finished = true;
    if (event.content) onDelta(event.content);
    if (event.done) {
      done = true;
      if (onDone) onDone();
    }
  };
  return {
    push(chunk) {
      if (done) return;
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) consume(line);
    },
    flush() { if (buffer && !done) consume(buffer); buffer = ''; },
    isComplete() { return done || finished; }
  };
}

function requestChat(config, messages, options = {}) {
  const stream = options.stream !== false;
  const onChunk = typeof options.onChunk === 'function' ? options.onChunk : null;
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : REQUEST_TIMEOUT;
  let req = null;
  let response = null;
  let settled = false;
  let rejectRequest;
  const finish = (fn, value) => {
    if (settled) return;
    settled = true;
    fn(value);
  };
  const promise = new Promise((resolve, reject) => {
    rejectRequest = reject;
    const fail = (message) => finish(reject, message instanceof Error ? message : new Error(message));
    const succeed = (text) => {
      if (typeof text !== 'string' || !text.trim()) return fail('模型未返回正文，请检查模型和回复上限');
      finish(resolve, text);
    };
    const apiKey = String((config && config.apiKey) || '').trim();
    if (!apiKey) return fail('尚未配置 API Key，请在「设置 → AI 对话」中填写');
    let target;
    try { target = new URL(resolveChatEndpoint(config && config.apiEndpoint)); }
    catch (e) { return fail('API 地址格式无效，请检查 HTTP/HTTPS 地址'); }
    const transport = target.protocol === 'https:' ? https : http;
    const model = String((config && config.model) || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
    const payload = {
      model,
      messages: Array.isArray(messages) ? messages : [],
      max_tokens: Math.round(clampNumber(config && config.maxTokens, 1, 200000, 2048)),
      temperature: clampNumber(config && config.temperature, 0, 2, 0.7),
      stream
    };
    // These DeepSeek models default to thinking=enabled. A small companion reply
    // should produce text directly instead of spending its reply budget on hidden reasoning.
    if (['deepseek-flash', 'deepseek-v4-pro'].includes(model)) payload.thinking = { type: 'disabled' };
    const body = JSON.stringify(payload);
    try {
      req = transport.request(target, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`,
          Accept: stream ? 'text/event-stream' : 'application/json', 'Content-Length': Buffer.byteLength(body)
        },
        timeout: timeoutMs
      }, (res) => {
        response = res;
        res.setEncoding('utf8');
        res.on('aborted', () => fail('响应中断，未将不完整回复标记为成功'));
        res.on('error', (e) => fail(`响应中断: ${e.message}`));
        if (res.statusCode !== 200) {
          let raw = '';
          res.on('data', (chunk) => { raw += chunk; });
          res.on('end', () => {
            let message = `请求失败 (HTTP ${res.statusCode})`;
            try { const parsed = JSON.parse(raw); message = parsed?.error?.message || parsed?.message || message; } catch (e) { /* retain HTTP error */ }
            const errors = { 401: 'API Key 无效或已过期 (401)', 402: '账户余额不足 (402)', 404: '接口不存在 (404)，请检查 API 地址或模型', 429: '请求过于频繁或额度不足 (429)' };
            fail(errors[res.statusCode] || message);
          });
          return;
        }
        const contentType = String(res.headers['content-type'] || '');
        if (stream && !/application\/json/i.test(contentType)) {
          let full = '';
          const parser = createSseParser((text) => {
            if (settled) return;
            full += text;
            if (onChunk) { try { onChunk(text); } catch (e) { /* renderer failure must not escape transport callbacks */ } }
          }, () => { succeed(full); res.destroy(); });
          res.on('data', (chunk) => {
            if (settled) return;
            try { parser.push(chunk); } catch (e) { fail(e); res.destroy(); }
          });
          res.on('end', () => {
            if (settled) return;
            try {
              parser.flush();
              if (!parser.isComplete()) return fail('流式响应提前结束，未收到完成标记');
              succeed(full);
            } catch (e) { fail(e); }
          });
          return;
        }
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          if (settled) return;
          try {
            const parsed = JSON.parse(raw);
            if (parsed?.error) return fail(String(parsed.error.message || '模型返回错误'));
            const choice = Array.isArray(parsed?.choices) ? parsed.choices[0] : null;
            if (choice && ['aborted', 'insufficient_system_resource', 'content_filter'].includes(choice.finish_reason)) {
              return fail(`模型未正常完成回复（${choice.finish_reason}）`);
            }
            succeed(choice && choice.message && choice.message.content);
          } catch (e) { fail('响应 JSON 解析失败'); }
        });
      });
      req.on('error', (e) => fail(`网络请求失败: ${e.message}`));
      req.on('timeout', () => { fail(`请求超时（${timeoutMs / 1000} 秒）`); req.destroy(); });
      req.end(body);
    } catch (e) { fail(`无法发送请求: ${e.message}`); }
  });
  return {
    promise,
    cancel() {
      if (settled) return;
      // Destroying a request is not itself a Promise rejection (especially before response headers).
      finish(rejectRequest, canceledError());
      if (response) response.destroy();
      if (req) req.destroy();
    }
  };
}

function testConnection(config) {
  return requestChat(config, [{ role: 'user', content: '你好，请只回复四个字：连接成功' }], { stream: false }).promise;
}

module.exports = { DEFAULT_CHAT_ENDPOINT, DEFAULT_MODEL, resolveChatEndpoint, parseSseLine, createSseParser, requestChat, testConnection };
