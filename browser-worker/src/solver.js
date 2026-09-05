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

async function trySolve(page, captcha) {
  // 1) Пассивная стадия: иногда достаточно показывается кнопка-чекбокс
  //    без интерактивного ввода. Пробуем фреймы встроенных капч.
  const frames = page.frames();
  for (const f of frames) {
    const maybe = await f.$('#checkbox, .recaptcha-checkbox-border, [data-widget*="captcha"] [role="checkbox"]');
    if (maybe) {
      await maybe.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(2000);
      return true;
    }
  }

  // 2) Активная капча: если настроен внешний солвер — делегируем.
  if (SOLVER_API_KEY && SOLVER_URL) {
    const solved = await remoteSolve(page);
    if (solved) return true;
  }

  return false;
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