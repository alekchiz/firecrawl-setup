# Развёртывание LITE (только воркеры) — Ubuntu 24.04, без git

Цель: на сервере поднять два воркера — `camou` (3100) и `cloak` (3101) —
для MCP-стенда. Подходит для машины 2 CPU / 4 GiB / 40 ГБ. Git не требуется.

> **Что получится в конце:** будут жить `camou-worker` и `cloak-worker`;
> пользователи подключаются к ним через тулы `scrape_url` / `scrape_cloak` /
> `scrape_wb` / `scrape_ozon`. `scrape_markdown` в LITE не работает (нет Firecrawl).

---

## Предусловия

- Ubuntu 24.04 (x86_64), доступ по SSH, пользователь с `sudo`, интернет.
- Планируемое место: ~5–8 ГБ (образы + данные), RAM ≥ 2 ГБ (лучше 4 ГБ).

## Шаг 1. Обновить систему и поставить базовые утилиты

```bash
sudo apt-get update
sudo apt-get install -y curl ca-certificates openssl
```

## Шаг 2. Создать файл подкачки (swap) 4 ГиБ

Нужен при сборке, чтобы не упасть по памяти.

```bash
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Ожидаемый результат:
```bash
free -h        # строка "Swap:" должна показывать ~4GiB
```

## Шаг 3. Установить Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
sudo systemctl enable --now docker
```

После этого **выйди из SSH и зайди снова** (или `newgrp docker`), чтобы команды
`docker` работали без `sudo`.

Проверка:
```bash
docker version --format '{{.Server.Version}}'
docker compose version
```

## Шаг 4. Скачать проект архивом (без git)

```bash
mkdir -p ~/lite && cd ~/lite
curl -L -o firecrawl-setup.tar.gz \
  https://codeload.github.com/alekchiz/firecrawl-setup/tar.gz/refs/heads/lite-stand
tar -xzf firecrawl-setup.tar.gz
cd firecrawl-setup-lite-stand
```

Проверка состава:
```bash
ls
# должны увидеть: camou-worker/ cloak-worker/ docker-compose.yml manage-keys.sh docs/ ...
```

## Шаг 5. Настроить `.env`

```bash
cp .env.example .env
```

Открой файл и проверь / задай значения:
```bash
nano .env
```
- `AUTH_TOKEN` — мастер-токен (legacy; опционально, можно оставить пустым,
  пользователям выдаёшь персональные через `manage-keys.sh`).
- `PROXY_URL` — пусто (без прокси) или жилой прокси `http://user:pass@host:port`
  (стабилизирует Ozon).
- **Проверь**, что каждая строка заканчивается переводом строки (иначе значения
  «склейются»). `AUTH_TOKEN` может быть любой длинной строкой.

## Шаг 6. Создать файл персональных ключей

```bash
touch tokens.txt && chmod 600 tokens.txt
```

## Шаг 7. Собрать образы (по одному!)

Собирай по очереди — при параллельной сборке на 4 GiB возможен OOM:

```bash
docker compose build camou-worker
docker compose build cloak-worker    # качает ~200 МБ stealth-Chromium
```

## Шаг 8. Запустить и проверить

```bash
docker compose up -d camou-worker cloak-worker
docker compose ps    # оба должны быть Up
```

Проверка эндпоинтов (подставь `TOKEN` — персональный ключ или `AUTH_TOKEN`):
```bash
TOKEN=<токен>
curl -s -H "x-api-token: $TOKEN" http://localhost:3100/health   # ож. {"ok":true,engine:"camoufox"}
curl -s -H "x-api-token: $TOKEN" http://localhost:3101/health   # ож. {"ok":true,engine:"cloakbrowser"}
curl -s -X POST http://localhost:3100/scrape \
  -H 'Content-Type: application/json' -H "x-api-token: $TOKEN" \
  -d '{"url":"https://example.com/"}' | head -c 200             # ож. status ok
```

## Шаг 9. Выдать пользователям ключи

```bash
./manage-keys.sh gen ivan    # покажет AUTH_TOKEN=<ключ> — отдай его Ивану
./manage-keys.sh list
```
Подробнее — `ADMIN-GUIDE.md`.

## Шаг 10. Открыть доступ снаружи

Файрвол (UFW):
```bash
sudo ufw allow 22/tcp
sudo ufw allow 3100/tcp
sudo ufw allow 3101/tcp
sudo ufw enable && sudo ufw status
```
Роутер/провайдер: пробросить порты `3100` и `3101` на этот сервер.

Проверка снаружи (с другого компьютера):
```bash
curl -s -H "x-api-token: $TOKEN" http://<ПУБЛИЧНЫЙ_IP>:3101/health   # 200
```

## Автозапуск

В `docker-compose.yml` стоит `restart: unless-stopped`, а Docker включён в boot
(шаг 3). После перезагрузки контейнеры поднимутся сами.

## Типичные проблемы

| Симптом | Причина / решение |
|---------|-------------------|
| `docker: command not found` | не перелогинился после шага 3 — `newgrp docker` |
| сборка упала «OOM» | увеличь swap (шаг 2) или перезапусти сборку после отдыха |
| `401` у всех | токены пусты (`manage-keys.sh list`), выдай заново |
| внешний порт не открывается | не проброшен NAT на роутере (шаг 10) |
| Ozon `ip-blocked` | без прокси норма — заполни `PROXY_URL` и перезапусти |

## Что дальше

- Выдай ключи (шаг 9) и раздай пользователям `USER-GUIDE.md`.
- Опциональный мониторинг — `MONITORING.md`.
- Для полной версии с Firecrawl — `DEPLOY-NOGIT-FULL.md`.