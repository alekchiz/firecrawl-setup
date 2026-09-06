// Обработка Ozon: навигация + детект/перехват капчи.
//
// Честная оговорка: капча Озона proprietry ("проверка безопасности"),
// выдаётся по поведению+IP+отпечатку. Программно "вскрыть" её стабильно
// нельзя. Здесь реализовано то, что реально даёт результат:
//   1) обход чекбокс/слайдер-стадии если она пассивна,
//   2) ожидание перехода проверки,
//   3) если капча интерактивная — помечаем статус и даём человеку дорешать
//      в оконном режиме (HEADED=true), либо внешний солвер (solver.js).

const { newPage } = require('./browser');
const { trySolve } = require('./solver');

// Выбор CSS-селекторов капчи Озона и финального контента. Сайт меняется —
// держи список актуальным под текущую вёрстку.
const CAPTCHA_SELECTORS = [
  'div[data-widget="checkoutCaptcha"]',
  '#Captcha',
  'iframe[src*="captcha"]',
  '.fap-validate',
  '[class*="captcha"]',
];
const CAPTCHA_TIMEOUT = 15000;   // ожидание появления капчи
const SOLVE_TIMEOUT = 45000;     // сколько ждём автоперехода проверки

async function openOzon(page, url) {
  console.log('[ozon] opening', url);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // лёгкое "человеческое" поведение
  await page.mouse.move(600 + Math.floor(Math.random() * 300), 300 + Math.floor(Math.random() * 200));
  await page.waitForTimeout(1200 + Math.floor(Math.random() * 1500));
}

function findCaptcha(page) {
  return page.$([...CAPTCHA_SELECTORS].join(','));
}

async function handleCaptcha(page) {
  const before = Date.now();
  let tries = 0;
  while (Date.now() - before < CAPTCHA_TIMEOUT) {
    const captcha = await findCaptcha(page);
    if (!captcha) return { passed: true, method: 'auto' };
    console.log(`[ozon] captcha present (try ${++tries})`);
    if (tries === 1) await logDomHints(page);
    // Пробуем пассивный переход (чекбокс) и слайдер. Если не вышло за цикл —
    // ставим скриншот-маркер "интерактивная".
    await trySolve(page, captcha);
    await page.waitForTimeout(1200);
  }

  console.warn('[ozon] captcha NOT cleared within timeout, saving screenshot');
  const shot = `/tmp/captcha_${Date.now()}.png`;
  await page.screenshot({ path: shot, fullPage: false });
  return { passed: false, screenshot: shot };
}

// Журналируем классы DOM-элементов капчи в момент, когда она уже на странице.
async function logDomHints(page) {
  const hints = await page
    .evaluate(() => {
      return [...document.querySelectorAll('*')]
        .filter((el) => {
          const c = String(el.className || '');
          return /captcha|slider|drag|fap|verify|slide|handle|push/i.test(c);
        })
        .slice(0, 20)
        .map((el) => {
          const c = (el.className && el.className.toString) ? el.className.toString() : String(el.className);
          return `${el.tagName}.${c.slice(0, 90)}`;
        });
    })
    .catch(() => []);
  console.log('[ozon] dom hints (captcha present):', JSON.stringify(hints));
}

async function scrapeOzon(url, opts = {}) {
  const page = await newPage();

  try {
    await openOzon(page, url);

    const cap = await handleCaptcha(page);
    if (!cap.passed) {
      return {
        ok: false,
        status: 'captcha',
        screenshot: cap.screenshot,
        hint: 'Интерактивная капча Ozon. Запусти с HEADED=true для ручного прохода или подключи солвер.',
      };
    }

    // Дожидаемся контента (список/карточка) и забираем HTML.
    await page.waitForSelector('main, #layoutPageHeader, [data-widget]', {
      timeout: 30000,
    }).catch(() => {});
    await page.waitForTimeout(1500);

    const html = await page.content();
    const title = await page.title().catch(() => '');
    return { ok: true, status: 'ok', title, html: html.slice(0, opts.maxBytes || 1000000), url: page.url() };
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = { scrapeOzon, openOzon, handleCaptcha };
