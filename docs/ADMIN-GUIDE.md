# Инструкция администратора

Что обязан знать и делать администратор стенда: выдача и отзыв ключей,
проверка работы, обновления, диагностика и безопасность.

---

## 1. Вход на сервер

```bash
ssh <user>@<IP-стенда>
cd ~/firecrawl-setup        # стандартный путь установки (из DEPLOY-*)
```

## 2. Персональные ключи пользователей

Ключи хранятся в `tokens.txt` (формат: `токен имя`), читаются воркерами на каждый
запрос. Правки действуют **сразу**, без перезапуска.

**Выдать ключ:**
```bash
./manage-keys.sh gen ivan
# вывод: AUTH_TOKEN=<ключ> — передай его Ивану через безопасный канал
```

**Показать все:**
```bash
./manage-keys.sh list
```

**Отозвать (мгновенно):**
```bash
./manage-keys.sh revoke ivan            # по имени
./manage-keys.sh revoke <сам_токен>     # или по токену
```

Правила:
- Один ключ = один человек. Не давай общий «мастер-ключ» наружу.
- При компрометации ключа — немедленно `revoke`.
- `tokens.txt` chmod 600, в git его нет.

## 3. Состояние сервисов

```bash
cd ~/firecrawl-setup
docker compose ps                # статусы контейнеров
docker stats --no-stream         # CPU/RAM в этот момент
df -h /                          # место на диске
```

Health-проверка:
```bash
TOK=<любой_валидный_ключ>
curl -s -H "x-api-token: $TOK" http://localhost:3100/health   # ож. 200, engine camoufox
curl -s -H "x-api-token: $TOK" http://localhost:3101/health   # ож. 200, engine cloakbrowser
# FULL: curl -s http://localhost:3002/v0/health/readiness      # 200
```

## 4. Обновление

```bash
cd ~/firecrawl-setup
git pull                            # (для lite-stand: git checkout lite-stand && git pull)
docker compose build camou-worker cloak-worker
docker compose up -d --force-recreate camou-worker cloak-worker
```
Firecrawl (если FULL) — см. `DEPLOY-GIT.md`.

## 5. Диагностика

Логи:
```bash
docker logs --tail 50 camou-worker
docker logs --tail 50 cloak-worker
# ключевые маркеры: goto ok · dom cc=… · slider dragged · done block=… 
# · ip-blocked / captcha / error / launch error
```

Типовые неполадки и действия:

| Симптом | Действие |
|---------|----------|
| Всё `401` | токены пусты/слетели → `manage-keys.sh list`, выдай заново |
| health 200, но `scrape` висит | воркер занят одним браузером — не дублируй, подожди |
| Запуск браузера виснет в логах | `sudo systemctl restart docker` (сброс докер-ноды) |
| Ozon `ip-blocked` | заполни `PROXY_URL` жилым прокси в `.env` + пересоздай воркеры |
| Диск забит | `docker image prune -f`, `docker system prune -f` (с осторожностью) |
| Firecrawl не готов | `docker logs firecrawl-api-1`; пересобрать (DEPLOY-NOGIT-FULL) |

## 6. Мониторинг

- Ежедневно: `docker compose ps`, `df -h /`, скан логов на `error`/`OOM`.
- Журнал ключей — по `manage-keys.sh list`.
- **Опционально**: лёгкий Prometheus (`docs/MONITORING.md`):
  ```bash
  docker compose -f docker-compose.yml -f monitoring/docker-compose.monitoring.yml up -d
  ```
  Метрики RAM/CPU/диска; на 4 GiB держи интервал 30с.

## 7. Загрузка и рост

- Воркеры не параллелят (один браузер). При многих пользователях — поднимай
  доп. пары воркеров («replica») или планируй очередь.
- При подозрении на нагрузку — смотри `docker stats` и логи.

## 8. Безопасность

- `tokens.txt`/`.env` — chmod 600, не публиковать.
- Наружу открывай только нужные порты: `3002` (FULL), `3100`, `3101`, `22`.
- Не собирай персональные/закрытые данные сверх задачи пользователя.
- Секреты проверяются и не должны попадать в git (см. `.gitignore`).