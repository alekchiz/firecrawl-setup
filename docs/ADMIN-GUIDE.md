# Инструкция администратора стенда

Роли и обязанности администратора: установка/обновление, выдача и отзыв ключей,
мониторинг, диагностика и поддержка пользователей.

---

## 1. Роль доступа

Работа происходит **на сервере стенда** по SSH:
```bash
ssh <user>@<IP-стенда>
cd ~/firecrawl-setup    # (путь установки; поддерживай единый для всех серверов)
```

## 2. Персональные ключи пользователей

Выдача:
```bash
./manage-keys.sh gen ivan    # → покажет: AUTH_TOKEN=<токен>; запиши его
./manage-keys.sh list        # таблица TOKEN USER
```
Отзыв (мгновенный, без перезапуска):
```bash
./manage-keys.sh revoke ivan
# или ./manage-keys.sh revoke <сам токен>
```
Файл `tokens.txt` (в папке установки) содержит строки `token ИМЯ`, монтируется
в контейнеры и читается на каждый запрос. Правки токенов **не требуют** ребилда
и не затираются `git pull` (файл в `.gitignore`).

Принцип: **один ключ = один пользователь**. Раздавай только лично/через защищённый
канал. При компрометации — немедленно `revoke`.

## 3. Состояние сервисов

```bash
cd ~/firecrawl-setup
docker compose ps                  # статусы контейнеров
docker stats --no-stream           # CPU/RAM в момент снимка
df -h /                            # место на диске
```

Проверка эндпоинтов (health):
```bash
TOK=<токен>
curl -s -H "x-api-token: $TOK" http://localhost:3100/health   # ож. 200
curl -s -H "x-api-token: $TOK" http://localhost:3101/health   # ож. 200
# полная версия: http://localhost:3002/v0/health/readiness → 200
```

## 4. Обновление

Рабочие версии:
- FULL/боевая ветка: `main`
- LITE (лёгкая): `lite-stand`

```bash
cd ~/firecrawl-setup
git pull                          # (если lite: git checkout lite-stand && git pull)
docker compose build camou-worker cloak-worker
docker compose up -d --force-recreate camou-worker cloak-worker
```

Firecrawl (если развёрнут): см. `docs/DEPLOY-GIT.md`.

## 5. Диагностика

Логи воркера:
```bash
docker logs --tail 50 camou-worker
docker logs --tail 50 cloak-worker
```
Словца в логах: `goto ok`, `dom cc=…`, `slider dragged`, `done block=…`,
`ip-blocked/captcha/error`.

Типовые неполадки и решения:

| Симптом | Действие |
|---------|----------|
| `401` у всех | токены слетели/файл пуст → `manage-keys.sh list`, `gen` заново |
| health 200, но `/scrape` висит | воркер занят одним браузером; подожди, не дублируй |
| запуск браузера висит в логах | `sudo systemctl restart docker` (сбрасывает докер-ноду) |
| Ozon `ip-blocked` | заполни `PROXY_URL` жилым прокси в `.env` + перезапуск |
| диск забивается | `docker system prune -f` (после удаления неиспользуемых образов) |
| Firecrawl не readiness | пересобери (`docs/DEPLOY-NOGIT-FULL.md`), проверь лог `docker logs firecrawl-api-1` |

## 6. Мониторинг (рекомендации)

- Раз в день: `docker compose ps`, `df -h /`, скраб сообщений в логах (`error`, `OOM`).
- Вести журнал выдачи ключей (кто, когда, кому) — хотя бы в `manage-keys.sh list`.
- При росте нагрузки (много пользователей) — воркеры не параллелят: думай о
  большем числе воркеров или планировании очередей.
- **Опциональный мониторинг**: лёгкий стек `node-exporter` + `prometheus`
  (retention 7 дней) — см. `docs/MONITORING.md`. Запуск:
  `docker compose -f docker-compose.yml -f monitoring/docker-compose.monitoring.yml up -d`.
  Метрики: RAM/CPU/диск. На 4 GiB держи интервал 30с.

## 7. Безопасность

- `tokens.txt` и `.env` — chmod 600, не публиковать.
- Пробрасывать наружу только нужные порты (3002/3100/3101).
- Не собирать/не хранить персональные данные пользователей сверх заданной задачи.
