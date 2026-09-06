// Запуск антидетект-браузера с живым профилем и stealth-надстройкой.
// Озон палит голый Playwright (navigator.webdriver + headless-отпечаток),
// поэтому двигаемся в сторону "настоящего" Chrome с персистентным профилем.

const path = require('path');
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();

// Stealth скрывает navigator.webdriver, подправляет отдельные отпечатки.
// Полного fingerprint-камуфляжа НЕ даёт — это остаётся честным минусом на проде.
chromium.use(stealth);

const PROFILE_DIR = process.env.PROFILE_DIR || path.join(__dirname, 'profiles', 'ozon');
const PROXY_URL = process.env.PROXY_URL;
const HEADED = process.env.HEADED === 'true';

const ARGS = [
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-blink-features=AutomationControlled', // прячет признак автоматизации
  '--disable-infobars',
  '--start-maximized',
  '--lang=ru-RU,ru',
];

function proxyCfg() {
  if (!PROXY_URL) return undefined;
  const raw = /^.+\/\/?.*/.test(PROXY_URL) ? PROXY_URL : `http://${PROXY_URL}`;
  const u = new URL(raw);
  const cfg = { server: `${u.protocol}//${u.host}` };
  if (u.username) {
    cfg.username = decodeURIComponent(u.username);
    cfg.password = decodeURIComponent(u.password || '');
  }
  return cfg;
}

let contextPromise = null;

function ensureContext() {
  if (!contextPromise) {
    contextPromise = chromium.launchPersistentContext(PROFILE_DIR, {
      headless: !HEADED,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      viewport: { width: 1366, height: 768 },
      locale: 'ru-RU',
      timezoneId: 'Europe/Moscow',
      args: ARGS,
      proxy: proxyCfg(),
      ignoreHTTPSErrors: true,
    });
  }
  return contextPromise;
}

async function newPage() {
  const ctx = await ensureContext();
  const page = await ctx.newPage();

  // Подправляем некоторые отпечатки вручную (дополняем to stealth).
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(window, 'chrome', { value: { runtime: {} } });
  });

  return page;
}

module.exports = { newPage, ensureContext, PROXY_URL, HEADED };
