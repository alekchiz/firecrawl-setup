param()
$ErrorActionPreference = 'Stop'

# Установка клиента Kilo из этого репозитория одной командой (Windows/PowerShell).
#   .\install-kilo.ps1
# Токен: env AUTH_TOKEN -> строка AUTH_TOKEN=... в .env -> интерактивный ввод.

$Repo = $PSScriptRoot

# ---- 0) Node 18+ ----
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error 'node не найден. Установи LTS: https://nodejs.org'
  exit 1
}
$Major = [int](node -p "process.versions.node.split('.')[0]")
if ($Major -lt 18) {
  Write-Error "node $Major.x, нужен 18+. Установи LTS: https://nodejs.org"
  exit 1
}
Write-Host "OK Node.js $(node -v)"

# ---- адреса ----
$WorkerIp = if ($env:WORKER_IP) { $env:WORKER_IP } else { '194.242.122.178' }
$WorkerUrl  = "http://${WorkerIp}:3100/scrape"
$CloakUrl   = "http://${WorkerIp}:3101/scrape"
$Firecrawl  = if ($env:FIRECRAWL_URL) { $env:FIRECRAWL_URL } else { 'http://109.94.1.210:3002' }

# ---- токен ----
$Token = $env:AUTH_TOKEN
$EnvFile = Join-Path $Repo '.env'
if (-not $Token -and (Test-Path $EnvFile)) {
  foreach ($line in Get-Content $EnvFile -ErrorAction SilentlyContinue) {
    if ($line -match '^AUTH_TOKEN=') {
      $Token = (($line -split '=', 2)[1]).Trim().Trim('"', "'")
    }
  }
}
if (-not $Token) { $Token = Read-Host 'AUTH_TOKEN' }
if (-not $Token) { Write-Error 'токен пуст'; exit 1 }
Write-Host "OK токен получен ($($Token.Length) симв.)"

# ---- 1) мост ----
$BridgeSrc = Join-Path $Repo 'mcp\firecrawl_node_bridge.js'
if (-not (Test-Path $BridgeSrc)) { Write-Error "нет моста: $BridgeSrc"; exit 1 }
$McpDir = Join-Path $HOME 'mcp'
New-Item -ItemType Directory -Force -Path $McpDir | Out-Null
$BridgeDst = Join-Path $McpDir 'firecrawl_node_bridge.js'
Copy-Item $BridgeSrc $BridgeDst -Force
Write-Host "OK мост -> $BridgeDst"

# ---- 2) скилл на этот проект ----
$SkillDir = Join-Path $Repo '.kilo\skill'
New-Item -ItemType Directory -Force -Path $SkillDir | Out-Null
$SkillDst = Join-Path $SkillDir 'firecrawl-stack'
if (Test-Path $SkillDst) { Remove-Item $SkillDst -Recurse -Force }
Copy-Item (Join-Path $Repo 'skill\firecrawl-stack') $SkillDst -Recurse -Force
Write-Host "OK скилл -> $SkillDst"

# ---- 3) конфиг mcp (слияние делегируем node, тот же код, что и в bash-версии) ----
$ConfigDst = if ($env:KILO_CONFIG) { $env:KILO_CONFIG } else { Join-Path $HOME '.config\kilo\kilo.jsonc' }
$ConfigDir = Split-Path $ConfigDst -Parent
New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null

$env:BRIDGE_PATH = $BridgeDst
$env:WORKER_URL = $WorkerUrl
$env:CLOAK_WORKER_URL = $CloakUrl
$env:FIRECRAWL_URL = $Firecrawl
$env:AUTH_TOKEN = $Token
$env:CONFIG_DST = $ConfigDst

$nodeSrc = @'
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

function mergeInto(obj) {
  obj.mcp = obj.mcp || {};
  obj.mcp['firecrawl-stack'] = entry;
  return obj;
}

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

let raw = '';
if (fs.existsSync(cfgPath)) raw = fs.readFileSync(cfgPath, 'utf8');

if (raw.trim() === '') {
  fs.writeFileSync(cfgPath, JSON.stringify(mergeInto({}), null, 2) + '\n');
  console.log('OK создан ' + cfgPath);
} else {
  let obj = null;
  try { obj = JSON.parse(raw); } catch (e) { obj = null; }
  if (obj !== null) {
    fs.writeFileSync(cfgPath, JSON.stringify(mergeInto(obj), null, 2) + '\n');
    console.log('OK mcp вписан в ' + cfgPath);
  } else {
    try {
      const cleaned = JSON.parse(stripJsonc(raw));
      fs.writeFileSync(cfgPath, JSON.stringify(mergeInto(cleaned), null, 2) + '\n');
      console.log('OK mcp вписан (jsonc-комментарии вычищены) в ' + cfgPath);
    } catch (e) {
      console.log('WARN не могу прочитать ' + cfgPath);
      console.log('Добавь секцию mcp вручную (см. README) или убери комментарии и запусти снова.');
    }
  }
}
'@

$TmpJs = Join-Path $env:TEMP 'install_kilo_config.js'
Set-Content -Path $TmpJs -Value $nodeSrc -Encoding UTF8
node $TmpJs
Remove-Item $TmpJs -Force

# ---- 4) итог ----
Write-Host ''
Write-Host '================ ИТОГ ================'
Write-Host "Мост   : $BridgeDst"
Write-Host "Скилл  : $SkillDst"
Write-Host "Конфиг : $ConfigDst"
Write-Host ''
Write-Host 'Дальше: 1) полностью закрой и открой VS Code  2) /mcps -> firecrawl-stack = Connected'
Write-Host 'Проверка: «собери топ-3 принтера на Wildberries» — вернёт список с ценами.'
