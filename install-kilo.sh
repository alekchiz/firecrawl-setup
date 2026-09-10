#!/usr/bin/env bash
# Установка клиента Kilo из этого репозитория одной командой.
#
#   ./install-kilo.sh
#
# Что делает:
#   1. проверяет Node.js 18+
#   2. кладёт мост в ~/mcp/firecrawl_node_bridge.js
#   3. ставит скилл на этот проект (.kilo/skill/firecrawl-stack)
#   4. вписывает секцию mcp в ~/.config/kilo/kilo.jsonc, НЕ удаляя остальное
#
# Токен берётся (в порядке приоритета):
#   - env AUTH_TOKEN=... ./install-kilo.sh
#   - строка AUTH_TOKEN=... в <репозиторий>/.env  (.env в gitignore, не коммитится)
#   - интерактивный запрос
#
# IP/адреса можно переопределить:
#   WORKER_IP=194.242.122.178 FIRECRAWL_URL=http://109.94.1.210:3002 ./install-kilo.sh

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---- 0) Node 18+ ----
if ! command -v node >/dev/null 2>&1; then
  echo "✖ node не найден. Установи LTS: https://nodejs.org" >&2
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "✖ node $NODE_MAJOR.x, нужен 18+. Установи LTS: https://nodejs.org" >&2
  exit 1
fi
echo "✔ Node.js $(node -v)"

# ---- адреса ----
WORKER_IP="${WORKER_IP:-194.242.122.178}"
WORKER_URL="http://${WORKER_IP}:3100/scrape"
CLOAK_WORKER_URL="http://${WORKER_IP}:3101/scrape"
FIRECRAWL_URL="${FIRECRAWL_URL:-http://109.94.1.210:3002}"   # Firecrawl остался на домашнем сервере

# ---- токен ----
AUTH_TOKEN="${AUTH_TOKEN:-}"
if [ -z "$AUTH_TOKEN" ] && [ -f "$REPO/.env" ]; then
  AUTH_TOKEN="$(grep -E '^AUTH_TOKEN=' "$REPO/.env" | tail -1 | cut -d= -f2-)"
  AUTH_TOKEN="${AUTH_TOKEN//\"}"
  AUTH_TOKEN="${AUTH_TOKEN//\'}"
  AUTH_TOKEN="${AUTH_TOKEN//[[:space:]]}"
fi
if [ -z "$AUTH_TOKEN" ]; then
  printf 'AUTH_TOKEN: '
  IFS= read -r AUTH_TOKEN
fi
[ -n "$AUTH_TOKEN" ] || { echo "✖ токен пуст" >&2; exit 1; }
echo "✔ токен получен (${#AUTH_TOKEN} симв.)"

# ---- 1) мост в ~/mcp ----
BRIDGE_SRC="$REPO/mcp/firecrawl_node_bridge.js"
[ -f "$BRIDGE_SRC" ] || { echo "✖ нет моста: $BRIDGE_SRC" >&2; exit 1; }
mkdir -p "$HOME/mcp"
cp "$BRIDGE_SRC" "$HOME/mcp/firecrawl_node_bridge.js"
chmod +x "$HOME/mcp/firecrawl_node_bridge.js"
echo "✔ мост -> $HOME/mcp/firecrawl_node_bridge.js"

# ---- 2) скилл на этот проект ----
mkdir -p "$REPO/.kilo/skill"
rm -rf "$REPO/.kilo/skill/firecrawl-stack"
cp -R "$REPO/skill/firecrawl-stack" "$REPO/.kilo/skill/"
echo "✔ скилл -> $REPO/.kilo/skill/firecrawl-stack"

# ---- 3) конфиг mcp ----
CONFIG_DST="${KILO_CONFIG:-$HOME/.config/kilo/kilo.jsonc}"
mkdir -p "$(dirname "$CONFIG_DST")"

# Передаём значения в node через env, чтобы не тащить их в аргументах/heredoc.
export BRIDGE_PATH="$HOME/mcp/firecrawl_node_bridge.js"
export WORKER_URL CLOAK_WORKER_URL FIRECRAWL_URL AUTH_TOKEN CONFIG_DST
node <<'NODE'
const fs = require('fs');
const cfgPath = process.env.CONFIG_DST;
const entry = {
  type: 'local',
  command: ['node', process.env.BRIDGE_PATH],
  timeout: 300000,
  environment: {
    WORKER_URL: process.env.WORKER_URL,
    CLOAK_WORKER_URL: process.env.CLOAK_WORKER_URL,
    FIRECRAWL_URL: process.env.FIRECRAWL_URL,
    AUTH_TOKEN: process.env.AUTH_TOKEN,
  },
  enabled: true,
};

let raw = '';
if (fs.existsSync(cfgPath)) raw = fs.readFileSync(cfgPath, 'utf8');

function mergeInto(obj) {
  obj.mcp = obj.mcp || {};
  obj.mcp['firecrawl-stack'] = entry;
  return obj;
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
      if (c === '\n') line = false;
      out += (c === '\n' ? '\n' : '');
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

if (raw.trim() === '') {
  // файла не было — создаём с нуля
  fs.writeFileSync(cfgPath, JSON.stringify(mergeInto({}), null, 2) + '\n');
  console.log('✔ создан ' + cfgPath);
} else {
  let obj = null;
  try { obj = JSON.parse(raw); } catch (e) { obj = null; }
  if (obj !== null) {
    fs.writeFileSync(cfgPath, JSON.stringify(mergeInto(obj), null, 2) + '\n');
    console.log('✔ mcp вписан в ' + cfgPath);
  } else {
    try {
      const cleaned = JSON.parse(stripJsonc(raw));
      fs.writeFileSync(cfgPath, JSON.stringify(mergeInto(cleaned), null, 2) + '\n');
      console.log('✔ mcp вписан (jsonc-комментарии вычищены) в ' + cfgPath);
    } catch (e) {
      console.log('⚠ не могу прочитать ' + cfgPath);
      console.log('Добавь секцию mcp вручную (см. README) или убери комментарии и запусти снова.');
    }
  }
}
NODE

# ---- 4) итог ----
echo
echo "================ ИТОГ ================"
echo "Мост   : $HOME/mcp/firecrawl_node_bridge.js"
echo "Скилл  : $REPO/.kilo/skill/firecrawl-stack"
echo "Конфиг : $CONFIG_DST"
echo
echo "Дальше: 1) полностью закрой и открой VS Code  2) /mcps → firecrawl-stack = Connected"
echo "Проверка: «собери топ-3 принтера на Wildberries» — вернёт список с ценами."
