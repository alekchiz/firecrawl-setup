'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

// Установка клиента Kilo из этого репозитория одной командой (любая ОС).
//   node install-kilo.js
// Не зависит от PowerShell/политики выполнения — нужен только Node.js 18+.
// Токен: env AUTH_TOKEN -> строка AUTH_TOKEN=... в .env -> интерактивный ввод.

const REPO = __dirname;
const HOME = os.homedir();

function fail(msg) {
  console.error('✖ ' + msg);
  process.exit(1);
}

async function readToken() {
  if (process.env.AUTH_TOKEN) return process.env.AUTH_TOKEN;
  const envFile = path.join(REPO, '.env');
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      if (/^AUTH_TOKEN=/.test(line.trim())) {
        const v = line.slice('AUTH_TOKEN='.length).trim().replace(/^["']|["']$/g, '');
        if (v) return v;
      }
    }
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question('AUTH_TOKEN: ', (t) => { rl.close(); res((t || '').trim()); }));
}

// Убирает // и /* */ комментарии, НЕ трогая строки (например URL с "https://").
function stripJsonc(src) {
  let out = '', i = 0, inStr = false, strCh = '', line = false, block = false;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (block) {
      if (c === '*' && n === '/') { block = false; i += 2; out += ' '; }
      else { out += (c === '\n' ? '\n' : ' '); i++; }
      continue;
    }
    if (line) {
      out += (c === '\n' ? '\n' : '');
      if (c === '\n') line = false;
      i++;
      continue;
    }
    if (inStr) {
      out += c;
      if (c === '\\') { out += src[i + 1] || ''; i += 2; continue; }
      if (c === strCh) inStr = false;
      i++;
      continue;
    }
    if (c === '"' || c === "'") { inStr = true; strCh = c; out += c; i++; continue; }
    if (c === '/' && n === '/') { line = true; i += 2; continue; }
    if (c === '/' && n === '*') { block = true; i += 2; continue; }
    out += c; i++;
  }
  return out;
}

async function main() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 18) fail('node ' + major + '.x, нужен 18+. Установи LTS: https://nodejs.org');
  console.log('✔ Node.js ' + process.version);

  const workerIp = process.env.WORKER_IP || '194.242.122.178';
  const workerUrl = 'http://' + workerIp + ':3100/scrape';
  const cloakUrl = 'http://' + workerIp + ':3101/scrape';
  const firecrawlUrl = process.env.FIRECRAWL_URL || 'http://109.94.1.210:3002';

  const token = await readToken();
  if (!token) fail('токен пуст');
  console.log('✔ токен получен (' + token.length + ' симв.)');

  // 1) мост
  const bridgeSrc = path.join(REPO, 'mcp', 'firecrawl_node_bridge.js');
  if (!fs.existsSync(bridgeSrc)) fail('нет моста: ' + bridgeSrc);
  fs.mkdirSync(path.join(HOME, 'mcp'), { recursive: true });
  const bridgeDst = path.join(HOME, 'mcp', 'firecrawl_node_bridge.js');
  fs.copyFileSync(bridgeSrc, bridgeDst);
  console.log('✔ мост -> ' + bridgeDst);

  // 2) скилл на этот проект
  fs.mkdirSync(path.join(REPO, '.kilo', 'skill'), { recursive: true });
  const skillDst = path.join(REPO, '.kilo', 'skill', 'firecrawl-stack');
  fs.rmSync(skillDst, { recursive: true, force: true });
  fs.cpSync(path.join(REPO, 'skill', 'firecrawl-stack'), skillDst, { recursive: true });
  console.log('✔ скилл -> ' + skillDst);

  // 3) конфиг mcp (слияние)
  const configDst = process.env.KILO_CONFIG || path.join(HOME, '.config', 'kilo', 'kilo.jsonc');
  const cfgDir = path.dirname(configDst);
  fs.mkdirSync(cfgDir, { recursive: true });

  const entry = {
    type: 'local',
    command: ['node', bridgeDst],
    timeout: 300000,
    environment: {
      WORKER_URL: workerUrl,
      CLOAK_WORKER_URL: cloakUrl,
      FIRECRAWL_URL: firecrawlUrl,
      AUTH_TOKEN: token,
    },
    enabled: true,
  };
  const merge = (obj) => { obj.mcp = obj.mcp || {}; obj.mcp['firecrawl-stack'] = entry; return obj; };

  let raw = '';
  if (fs.existsSync(configDst)) raw = fs.readFileSync(configDst, 'utf8');
  if (raw.trim() === '') {
    fs.writeFileSync(configDst, JSON.stringify(merge({}), null, 2) + '\n');
    console.log('✔ создан ' + configDst);
  } else {
    let obj = null;
    try { obj = JSON.parse(raw); } catch (e) { obj = null; }
    if (obj !== null) {
      fs.writeFileSync(configDst, JSON.stringify(merge(obj), null, 2) + '\n');
      console.log('✔ mcp вписан в ' + configDst);
    } else {
      try {
        const cleaned = JSON.parse(stripJsonc(raw));
        fs.writeFileSync(configDst, JSON.stringify(merge(cleaned), null, 2) + '\n');
        console.log('✔ mcp вписан (jsonc-комментарии вычищены) в ' + configDst);
      } catch (e) {
        console.error('⚠ не могу прочитать ' + configDst);
        console.error('Добавь секцию mcp вручную (см. README) или убери комментарии и запусти снова.');
      }
    }
  }

  console.log('');
  console.log('================ ИТОГ ================');
  console.log('Мост   : ' + bridgeDst);
  console.log('Скилл  : ' + skillDst);
  console.log('Конфиг : ' + configDst);
  console.log('');
  console.log('Дальше: 1) полностью закрой и открой VS Code  2) /mcps → firecrawl-stack = Connected');
  console.log('Проверка: «собери топ-3 принтера на Wildberries» — вернёт список с ценами.');
}

main().catch((e) => fail(e.message));
