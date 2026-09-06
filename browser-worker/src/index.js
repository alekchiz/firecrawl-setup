// HTTP-сервис антидетект-воркера.
// Публикует POST /scrape — тот же контракт, что отвечает Firecrawl
// worker-у, но с нашим антидетект-браузером для Ozon.

const express = require('express');
const { scrapeOzon } = require('./ozon');
const { newPage, ensureContext } = require('./browser');

const app = express();
app.use(express.json({ limit: '4mb' }));

app.post('/scrape', async (req, res) => {
  const { url, maxBytes } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url required' });

  try {
    if (String(url).includes('ozon')) {
      return res.json(await scrapeOzon(url, { maxBytes }));
    }
    // Обычная страница — простой антидетект-проход.
    const page = await newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      return res.json({ ok: true, status: 'ok', html: (await page.content()).slice(0, maxBytes || 1000000) });
    } finally {
      await page.close().catch(() => {});
    }
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e?.message || e) });
  }
});

app.get('/health', (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[browser-worker] listening on :${PORT}`);
  console.log(`[browser-worker] proxy=${process.env.PROXY_URL || 'NONE'} headed=${process.env.HEADED === 'true'}`);
});

// Прогрев Chromium при старте: первый боевой запрос не должен совпадать
// с холодным запуском браузера (иначе пик памяти -> OOM, сокет рвётся).
setTimeout(async () => {
  try {
    await ensureContext();
    const page = await newPage();
    await page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    await page.close().catch(() => {});
    console.log('[browser-worker] chromium warmed up');
  } catch (e) {
    console.warn('[browser-worker] warmup failed:', String(e?.message || e));
  }
}, 1500);
