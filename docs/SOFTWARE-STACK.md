# Программный стек и компоненты проекта

Сводка по ПО и утилитам, используемым в проекте. Версии — актуальные на момент
поддержки; уточняй по `requirements.txt`/`package.json` в репо.

## 1. Масштаб компонентов

### Сервер (стенд)
| Компонент | Назначение | Технология / версия |
|-----------|-----------|---------------------|
| Docker | контейнеризация | Docker Engine 24+ (get.docker.com) |
| Docker Compose | оркестрация контейнеров | Compose v2 (встроен в Docker) |
| ОС сервера | платформа | Ubuntu 24.04 LTS (x86_64) |

### Воркеры (Python)
| Компонент | Т. | Примечание |
|-----------|-----|------------|
| `camou-worker` | Python 3.12, FastAPI, Uvicorn | движок **Camoufox** (Firefox+stealth) |
| `cloak-worker` | Python 3.12, FastAPI, Uvicorn | движок **CloakBrowser** (Chromium, C++-патчи) |
| Playwright API | играет в обоих воркерах | Camoufox (sync_api) / CloakBrowser (launch) |

### MCP-мост (Node)
| Компонент | Назначение |
|-----------|-----------|
| `firecrawl_node_bridge.js` | stdio MCP-сервер (newline-JSON, protocol 2025-11-25), проксирует 5 тулов на воркеры |
| Node.js 18+ | рантайм моста (на машине пользователя) |

### Firecrawl (полная версия, отдельный репозиторий/проект)
| Компонент | Назначение |
|-----------|-----------|
| firecrawl-api | REST API v2 (`/v2/scrape`) |
| firecrawl-playwright-service | рендер/обработка |
| Postgres (nuq-postgres) | БД |
| Redis | кэш |
| RabbitMQ | очереди |
| FoundationDB | (в составе образа) |

## 2. Прочие утилиты на сервере/рабочих местах

- `curl`, `tar` — скачивание архивом без git.
- `git` — (при установке через git) управление версиями.
- `openssl` — генерация токенов (`openssl rand -hex N`).
- `sed`, `nano`/`vim` — правка конфигов.
- `ufw` — файрвол.
- `Systemd` — автозапуск Docker.
- `swap` (fallocate/mkswap/swapon) — подстраховка памяти.

## 3. На клиенте пользователя (Kilo Code)

| Компонент | Назначение |
|-----------|-----------|
| Kilo Code | агентный интерфейс (модель deepseek и др.) |
| Node.js 18+ | для MCP-моста `firecrawl_node_bridge.js` |
| `kilo.jsonc` | конфиг: MCP-сервер `firecrawl-stack` |
| Скилл | `.kilo/skill/firecrawl-stack/SKILL.md` направляет агента на стенд |

## 4. Внешние зависимости для скрейпинга

- Жилые/чистые прокси (опц.): `pool.proxy.market` (`http://user:pass@host:port`).
- Публичные эндпоинты магазинов: WB `search.wb.ru` (через `scrape_wb`).

## 5. Репозиторий (структура)

```
camou-worker/   Dockerfile + app/main.py (Camoufox-воркер, :3100)
cloak-worker/   Dockerfile + app/main.py (CloakBrowser-воркер, :3101)
mcp/            firecrawl_node_bridge.js (+ firecrawl_mcp.py, python-мост)
skill/          скилл для Kilo (канон), см. также .kilo/skill/
docs/           документация
manage-keys.sh  управление персональными ключами
patch-ipv4.sh   патч Dockerfile под IPv4 (для Firecrawl)
docker-compose.yml
```

## 6. Портовая схема

| Порт | Сервис |
|------|--------|
| 3002 | Firecrawl API (полная версия) |
| 3100 | camou-worker (`/scrape`) |
| 3101 | cloak-worker (`/scrape`) |
| 22 | SSH администрирование |

## 7. Обновление стека

- Образы воркеров: `docker compose build/up` после `git pull`.
- Бинарь CloakBrowser: кеш в `~/.cloakbrowser`, обновляется `python -m cloakbrowser update` (или при сборке образа).
- Camoufox: бандлируется в образе при сборке.