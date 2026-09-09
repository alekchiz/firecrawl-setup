# lite-stand — вариант A (только воркеры, без Firecrawl)

Ветка для развёртывания на **лёгких машинах (2 vCPU / 4 GiB / 40 ГБ)**.
От `main` отличается: не рассчитываем на Firecrawl — `scrape_markdown` может
отсутствовать, обычные сайты берём через `scrape_url`.

## Что работает (все тулы этой ветки)
- `scrape_url` — Camoufox-воркер (`:3100`) — обычные и маркетплейсы.
- `scrape_cloak` — CloakBrowser (`:3101`) — Turnstile/«403» (DNS-шоп).
- `scrape_wb` — товары Wildberries (475 цены).
- `scrape_ozon` — товары Ozon (названия/ссылки; цены — закрытый API Ozon).
- `scrape_markdown` — **только если** развёрнут Firecrawl; иначе агент использует
  `scrape_url`.

## Деплой на новый стенд (2/4/40)
1. docker + git: `apt-get update && apt-get install -y git` + установить Docker
   (`curl -fsSL https://get.docker.com | sh`), добавить пользователя в группу docker.
2. Клонировать эту ветку:
   `git clone -b lite-stand https://github.com/alekchiz/firecrawl-setup.git`
3. `.env`: `AUTH_TOKEN=<секрет>`, `PROXY_URL=` (пусто = без прокси) или жилой.
4. Собрать оба воркера (по одному, чтобы не упереться в RAM):
   `docker compose build camou-worker && docker compose build cloak-worker`
5. Поднять: `docker compose up -d camou-worker cloak-worker`
6. Пробросить порты на роутере: `3002 (если Firecrawl), 3100, 3101` → внутрь.
7. Проверить: `/scrape` на `:3100`/`:3101` с `x-api-token`.

## Память
- 4 GiB — впритык при сборке (`cloak-worker`: скачивание ~200 МБ хром + pip).
  Рекомендуется временный swap 4 ГБ:
  `fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile`.
- После запуска оба браузера держат ~1.5–2.5 ГБ — комфортно.

## Важно по `scrape_ozon`
Без жилого прокси Ozon может периодически давать `ip-blocked` — это флюктуация
самого Ozon. Для стабильности заполни `PROXY_URL` на стенде.