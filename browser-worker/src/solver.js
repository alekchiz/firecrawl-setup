// Адаптер решения капчи. Два пути:
//   - пассивные/доступные проверки обрабатываем здесь сами,
//   - для активной капчи — хуки на внешний солвер (CapSolver/2Captcha),
//     подключаемые через переменную окружения SOLVER_API_KEY.
//
// ВНИМАНИЕ про "self-hosted": стабильно решать капчу Озона своей нейронкой
// на VPS нереально. Этот файл — интерфейс, куда подключается либо
// ручной проход (HEADED=true), либо внешний солвер. См. README.

const SOLVER_API_KEY = process.env.SOLVER_API_KEY;
const SOLVER_URL = process.env.SOLVER_URL; // например https://api.capsolver.com

// Селекторы головки слайдера капчи. Ozon использует десктопную версию:
// «передвиньте ползунок вправо». Список держим широким под разные вёрстки.
const SLIDER_HANDLE_SELECTORS = [
  '[class*="slider"] [class*="handle"]',
  '[class*="slider"] [class*="thumb"]',
  '[class*="drag"] [class*="button"]',
  '[class*="captcha"] [class*="button"]',
  '[role="slider"]',
  '.fap-slider',
];

async function trySolve(page, captcha) {
  // 1) Пассивная стадия: кликабельный чекбокс без интерактивного ввода.
  const frames = page.frames();
  for (const f of frames) {
    const maybe = await f.$('#checkbox, .recaptcha-checkbox-border, [data-widget*="captcha"] [role="checkbox"]');
    if (maybe) {
      await maybe.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(1800);
      return;
    }
  }

  // 2) Слайдер-капча: тянем головку до правого края трека.
  await trySlider(page);

  // 3) Если настроен внешний солвер — делегируем (см. README).
  if (SOLVER_API_KEY && SOLVER_URL) {
    await remoteSolve(page);
  }
}

async function trySlider(page) {
  for (const sel of SLIDER_HANDLE_SELECTORS) {
    const handle = await page.$(sel).catch(() => null);
    if (!handle) continue;
    const hbox = await handle.boundingBox().catch(() => null);
    if (!hbox) continue;

    // Трек — ближайший контейнер слайдера/капчи.
    const track = await handle
      .evaluateHandle((el) =>
        el.closest('[class*="slider"],[class*="drag"],.fap-validate,[class*="captcha"]') || document.body
      )
      .catch(() => null);
    const tbox = track ? await track.boundingBox().catch(() => null) : null;
    const endX = tbox ? tbox.x + tbox.width - 6 : hbox.x + hbox.width + 80;
    const startX = hbox.x + hbox.width / 2;
    const y = hbox.y + hbox.height / 2;

    await page.mouse.move(startX, y);
    await page.mouse.down();

    // Несколько шагов + лёгкий шум по Y — ближе к естественному движению.
    const steps = 20 + Math.floor(Math.random() * 8);
    for (let i = 1; i <= steps; i++) {
      const x = startX + (endX - startX) * (i / steps);
      await page.mouse.move(x, y + (Math.random() - 0.5) * 2);
      await page.waitForTimeout(8 + Math.random() * 10);
    }
    await page.waitForTimeout(180);
    await page.mouse.up();
    await page.waitForTimeout(1600);
    return;
  }
}

// Место под интеграцию с CapSolver/2Captcha: по-хорошему нужен sitekey,
// который для Озона достаётся динамически. Ниже — заглушка-каркас.
async function remoteSolve(page) {
  const sitekey = await page
    .locator('[data-sitekey]')
    .first()
    .getAttribute('data-sitekey')
    .catch(() => null);
  if (!sitekey) return false;

  // Здесь был бы вызов CAPTCHA-task API солвера и подстановка ответа.
  console.warn('[solver] sitekey=', sitekey, '— внешний солвер не реализован, подключи по инструкции README.');
  return false;
}

module.exports = { trySolve };
