/* Captura pantallazos de la aplicacion (para revisar el aspecto):
     node tests/screenshot.js salida.png [ancho] [alto] ["codigo js opcional"]
   Necesita el servidor local: node tests/serve.js                        */
'use strict';

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const outFile = process.argv[2] || 'shot.png';
const WIDTH = Number(process.argv[3] || 1440);
const HEIGHT = Number(process.argv[4] || 900);
const SETUP = process.argv[5] || '';
const PORT = Number(process.env.PORT || 8787);
const DEBUG_PORT = Number(process.env.DEBUG_PORT || 9400);
const SITE = process.env.SITE || ('http://localhost:' + PORT);
const URL = process.env.PAGE_URL || (SITE.replace(/[/]+$/, '') + '/index.html');

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].filter(Boolean);

const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

function getJson(url) {
  return new Promise(function (resolve, reject) {
    http.get(url, function (res) {
      let body = '';
      res.on('data', function (d) { body += d; });
      res.on('end', function () {
        try { resolve(JSON.parse(body)); } catch (err) { reject(err); }
      });
    }).on('error', reject);
  });
}

async function main() {
  const browser = CANDIDATES.find(function (c) { return fs.existsSync(c); });
  if (!browser) { console.error('No encontre Chrome'); process.exit(2); }

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-shot-'));
  const child = spawn(browser, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--disable-extensions',
    '--hide-scrollbars',
    '--remote-debugging-port=' + DEBUG_PORT,
    '--user-data-dir=' + profile,
    '--window-size=' + WIDTH + ',' + HEIGHT,
    'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(250);
    try {
      const list = await getJson('http://127.0.0.1:' + DEBUG_PORT + '/json/list');
      target = list.find(function (t) { return t.type === 'page' && t.webSocketDebuggerUrl; });
    } catch (err) { /* arrancando */ }
  }
  if (!target) { child.kill(); console.error('Chrome no respondio'); process.exit(2); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', function (event) {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  });
  const send = function (method, params) {
    return new Promise(function (resolve, reject) {
      const id = ++seq;
      pending.set(id, { resolve: resolve, reject: reject });
      ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
    });
  };
  await new Promise(function (r) { ws.addEventListener('open', r, { once: true }); });

  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: WIDTH < 500
  });
  await send('Page.navigate', { url: URL });
  await sleep(1200);
  if (SETUP) {
    const res = await send('Runtime.evaluate', { expression: SETUP, awaitPromise: true, returnByValue: true });
    if (res.exceptionDetails) {
      console.error('El codigo previo fallo: ' +
        (res.exceptionDetails.exception && res.exceptionDetails.exception.description ||
         res.exceptionDetails.text || ''));
    } else if (res.result && res.result.value !== undefined) {
      console.log('resultado: ' + JSON.stringify(res.result.value));
    }
    await sleep(700);
  }
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(outFile, Buffer.from(shot.data, 'base64'));
  ws.close();
  child.kill();
  console.log('Guardado ' + outFile + ' (' + WIDTH + 'x' + HEIGHT + ')');
  process.exit(0);
}

main().catch(function (err) { console.error(err); process.exit(2); });
