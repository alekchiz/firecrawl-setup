# Aнтидетект-слой + self-hosted Firecrawl под Ozon

Деплой на домашнем сервере (Ubuntu + Docker). IP дома резиденциальный и
статический — это главный плюс против капчи Ozon.

```
firecrawl-setup/
  docker-compose.yml      # browser-worker + camou-worker (антидетект-слой)
  .env.example            # PROXY_URL / HEADED
  deploy.sh               # установка Docker + шаги деплоя
  browser-worker/         # Node-воркер (stealth-Chromium)
    src/
      index.js            # HTTP-сервис (POST /scrape)
      browser.js          # stealth-Chrome с живым профилем
      ozon.js             # навигация по Ozon + обработка капчи
      solver.js           # адаптер солвера
    profiles/ozon/        # персистентный профиль браузера (важно!)
  camou-worker/           # Python-воркер на Camoufox (главный слой для Ozon)
    app/main.py           # FastAPI POST /scrape + солвер капчи-пазла
    Dockerfile
```

## Что есть и зачем

- **Firecrawl (self-hosted, официальный)** — API скрейпинга, поднимается из
  своего клона через `docker compose up --build`. Используется для обычных
  сайтов. Образ `firecrawl/app` не существует — предсобранных серверных
  образов Firecrawl не даёт.
- **browser-worker (этот репозиторий)** — настоящий Chromium со stealth и
  живым профилем для Ozon. Озон палит голый Playwright, поэтому трудные
  страницы идём через него.
- **camou-worker** — антидетект-Firefox (Camoufox) с правдоподобным отпечатком.
  Именно он идёт на Ozon: их капча "Antibot v12" (puzzle-слайдер) решается
  драгом `#slider` на смещение `#puzzle.left`, но блокируется в первую очередь
  по фингерпринту — Camoufox это закрывает. Порт 3100.

## Установка Docker

```bash
cd firecrawl-setup
bash deploy.sh
# затем exit и зайди заново (или: newgrp docker)
```

## Self-host Firecrawl (официальный путь, pinned v2.11.162)

```bash
git clone https://github.com/firecrawl/firecrawl.git
cd firecrawl
git checkout v2.11.162
cat > .env <<'EOF'
USE_DB_AUTHENTICATION=false
POSTGRES_USER=postgres
POSTGRES_PASSWORD=replace-with-at-least-32-random-characters
POSTGRES_DB=postgres
EOF
docker compose up --build -d
```

Проверка API (появится на порту 3002):

```bash
curl --fail --silent "http://localhost:3002/v0/health/readiness"   # {"status":"ok"}
curl --fail-with-body -s -X POST http://localhost:3002/v2/scrape \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com","formats":["markdown"]}'
```

> Smoke-стек Firecrawl включает Fetch и Playwright-обработку, но НЕ имеет
> скриншотов/действий/встроенного антибота (это Fire-engine, идёт отдельно).
> Слой против капчи у нас — это `browser-worker`.

## Запуск антидетект-воркера

Собрать оба воркера:

```bash
cd ~/firecrawl-setup
cp .env.example .env        # PROXY_URL пустой, HEADED=false
docker compose build browser-worker camou-worker
docker compose up -d browser-worker camou-worker

# тест на Ozon
curl -X POST localhost:3100/scrape -H 'Content-Type: application/json' \
  -d '{"url":"https://www.ozon.ru/"}' | python3 -m json.tool
```

Ответ `"status":"ok"` — прошли. `"status":"captcha"` — не вышло за попытки.
`"status":"ip-blocked"` — Ozon заблокировал IP/сеть: «Похоже, нет соединения».

```bash
# в .env: HEADED=true, затем
docker compose restart browser-worker
# пройди проверку руками в окне один раз (прогрев профиля)
# верни HEADED=false и restart
```

## Домашний сервер: контроль внешнего IP

`curl -s ifconfig.me` дал `109.94.1.210` — сравнено с WAN роутера, IP статический.
Условия идеальные: жилой + статический + публичный. Не удаляй
`browser-worker/profiles/` — там накопленное доверие к сессии.

Если понадобится другой адрес — заполни `PROXY_URL=http://user:pass@host:port`.

## Ограничения (честно)

Капча Озона — собственная, по поведению + IP + отпечатку. На жилом статическом
IP шансы высокие, но интерактивную капчу headless-автоматизацией стабильно
"вскрыть" нельзя: прогрев профиля (`HEADED=true`) или внешний солвер через
`browser-worker/src/solver.js` (каркас готов: достаёт sitekey, есть хук под
CapSolver). Для больших объёмов рассмотри отдельный anti-detect-фреймворк
(Camoufox / undetected-chromedriver) — наш воркер это базовая рабочая версия.

## Итог по Ozon (зафиксировано)

Стек доведён до рабочего состояния, но **Ozon блокирует этот IP на уровне сети**:
после решения капчи-пазла уводит на страницу «Похоже, нет соединения» (incident
`fab_chlg`, `?abt_att=N&captchaDone=true`) и возвращает «Выключите VPN /
подключитесь к другой сети». Это блок адреса (в странице фигурирует исходящий
IP `109.94.1.210`), его не обойти настройками браузера.

Что уже решено и работает:

- **fingerprint** — Camoufox-воркер (`camou-worker`, порт 3100): антидетект-Firefox
  с правдоподобным отпечатком; запуск в контейнере требует GTK3 + `seccomp:unconfined`.
- **капча-пазл "Antibot v12"** — солвер тянет `#slider` на смещение `#puzzle.left`
  (`--scale` чередуем между попытками). Блокировку по фингерпринту прошли.
- **детект исхода** — `ok` / `captcha` / `ip-blocked` (по тексту и `abt_att=`).

Остался нерешённым только **IP-слой**: смени адрес выхода (4G-хотспот, другой
провайдер, жилой прокси через `PROXY_URL`) — при чистом IP весь стек Ozon
должен пройти. Для остальных сайтов стек готов к использованию уже сейчас.

### Avito — тот же вердикт

Авито тоже блокирует этот IP на уровне сети: после антибот-челленджа отдаёт
страницу `«Доступ ограничен: проблема с IP»`. Это снова адрес, а не браузер:
Camoufox-воркер (порт 3100) умеет ждать автопроход JS-челленджа Авито, но саму
«проблему с IP» обойти нельзя. Вывод идентичен Ozon: нужен чистый egress-IP,
тогда стек на Авито готов (детект исхода `ok`/`captcha` уже отлажен).

## Что открывается на этом IP (проверено Camoufox-воркером)

Блок ставят только Ozon и Авито (собственная IP-репутация). Всё остальное
проходит — статус `ok`:

- Wildberries, Юла (Youla), DNS, Citilink, MegaMarket, Яндекс Маркет,
  AliExpress RU.

Для этих площадок стек готов; под любые из них можно достроить парсер
(листинг/карточка/цена) через `POST :3100/scrape` или Firecrawl `:3002`.

### Ozon и Авито — открыты через жилой прокси

На прямом IP `109.94.1.210` Ozon и Авито блокируют по репутации адреса. Через
**жилой прокси** (`PROXY_URL=http://user:pass@host:port`, у нас
`pool.proxy.market`) оба отдают контент:
`Ozon: ok (html 600KB)`, `Avito: ok (html 668KB)`, капча-виджет в DOM отсутствует.

Практические заметки:
- **После правки `camou-worker/*` или `browser-worker/*` пересобирай образ:**
  `docker compose build camou-worker` (иначе правки в контейнер не попадут).
- Для стабильного прогона бери **sticky RU-сессию** прокси (у proxy.market —
  липкость через суффикс в логине), ротация с каждым запросом иногда вызывает
  разовый челлендж.
- Детект капчи завязан на контейнер `#captcha-container` (виден только у Ozon),
  чтобы чужие карусели с id `#slider` не считались капчей.
