/* Lanza Chrome sin ventana, abre index.html?selftest=1 y muestra el resultado.
     node tests/run-ui-tests.js [--head] [--width=1400] [--url=https://...]
   Necesita el servidor local: node tests/serve.js                        */
'use strict';

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const args = process.argv.slice(2);
const opt = function (name, fallback) {
  const found = args.find(function (a) { return a.startsWith('--' + name + '='); });
  return found ? found.split('=')[1] : fallback;
};
const PORT = Number(opt('port', 8787));
const DEBUG_PORT = Number(opt('debug-port', 9333));
const WIDTH = Number(opt('width', 1400));
const HEIGHT = Number(opt('height', 900));
const HEADFUL = args.includes('--head');
const BASE = opt('url', 'http://localhost:' + PORT);
const URL = BASE.replace(/\/+$/, '') + '/index.html?selftest=1';

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].filter(Boolean);

function findBrowser() {
  for (const c of CANDIDATES) {
    try { if (fs.existsSync(c)) return c; } catch (e) { /* sigue */ }
  }
  return null;
}

function getJson(url) {
  return new Promise(function (resolve, reject) {
    const req = http.get(url, function (res) {
      let body = '';
      res.on('data', function (d) { body += d; });
      res.on('end', function () {
        try { resolve(JSON.parse(body)); } catch (err) { reject(err); }
      });
    });
    req.on('error', reject);
  });
}

const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

async function main() {
  const browser = findBrowser();
  if (!browser) {
    console.error('No encontre Chrome ni Edge. Define CHROME_PATH.');
    process.exit(2);
  }

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-test-'));
  const child = spawn(browser, [
    HEADFUL ? '--auto-open-devtools-for-tabs' : '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--remote-debugging-port=' + DEBUG_PORT,
    '--user-data-dir=' + profile,
    '--window-size=' + WIDTH + ',' + HEIGHT,
    'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  let lastError = '';
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(250);
    try {
      const list = await getJson('http://127.0.0.1:' + DEBUG_PORT + '/json/list');
      target = list.find(function (t) { return t.type === 'page' && t.webSocketDebuggerUrl; });
    } catch (err) { lastError = err.message; }
  }
  if (!target) {
    child.kill();
    console.error('Chrome no respondio en el puerto ' + DEBUG_PORT + (lastError ? ' (' + lastError + ')' : ''));
    process.exit(2);
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const consoleErrors = [];

  ws.addEventListener('message', function (event) {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      consoleErrors.push('EXCEPCION: ' + (d.exception && d.exception.description || d.text) +
        (d.url ? ' @ ' + d.url.split('/').pop() + ':' + (d.lineNumber + 1) : ''));
    }
    if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning')) {
      consoleErrors.push(msg.params.type.toUpperCase() + ': ' +
        msg.params.args.map(function (a) { return a.description || a.value; }).join(' '));
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      consoleErrors.push('LOG: ' + msg.params.entry.text + ' ' + (msg.params.entry.url || ''));
    }
  });

  function send(method, params, timeoutMs) {
    return new Promise(function (resolve, reject) {
      const id = ++seq;
      const timer = setTimeout(function () {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error('la pagina no responde a ' + method +
          ' (puede haberse quedado en un prompt/confirm abierto)'));
      }, timeoutMs || 15000);
      pending.set(id, {
        resolve: function (value) { clearTimeout(timer); resolve(value); },
        reject: function (err) { clearTimeout(timer); reject(err); }
      });
      ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
    });
  }

  await new Promise(function (resolve, reject) {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL });

  async function evaluate(expression) {
    const res = await send('Runtime.evaluate', {
      expression: expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception
        ? res.exceptionDetails.exception.description
        : res.exceptionDetails.text);
    }
    return res.result.value;
  }

  let summary = '';
  let bloqueada = '';
  for (let i = 0; i < 200; i++) {
    await sleep(200);
    try {
      summary = await evaluate('window.__selftestDone || ""');
      bloqueada = '';
    } catch (err) {
      summary = '';
      bloqueada = err.message;
      if (/no responde/.test(bloqueada)) break;
    }
    if (summary) break;
  }
  if (bloqueada) console.error('\n  ' + bloqueada);

  let detail = '';
  try {
    detail = await evaluate("(document.getElementById('selftest-out')||{}).textContent || ''");
  } catch (err) { detail = ''; }

  if (!HEADFUL) {
    ws.close();
    child.kill();
  }

  if (consoleErrors.length) {
    console.log('\n  Mensajes del navegador:');
    consoleErrors.slice(0, 25).forEach(function (e) { console.log('   ' + e); });
  }
  console.log('');
  console.log(detail || '(sin resultados: la pagina no llego a terminar)');
  console.log('');

  const okRun = /^SELFTEST OK/.test(summary || '');
  if (!okRun) {
    console.error('  ' + (summary || 'las pruebas de interfaz no terminaron'));
    process.exit(1);
  }
  process.exit(0);
}

main().catch(function (err) {
  console.error(err);
  process.exit(2);
});
