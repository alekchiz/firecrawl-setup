# Развёртывание FULL (воркеры + Firecrawl) — Ubuntu 24.04, без git

Цель: поднять всё, что есть в проекте — воркеры `camou` (3100), `cloak` (3101)
**и** Firecrawl (3002). Тогда у пользователей будет и «обычный» скрейп
`scrape_markdown`, и антибот-тулы.

> Требования: **4 vCPU / 8 GiB / 40 ГБ** (на 4 GiB — только с swap и лимитами,
> см. шаг 11). Git не нужен.

---

## Шаг 1. Базовые пакеты Docker

```bash
sudo apt-get update && sudo apt-get install -y curl ca-certificates openssl
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
sudo systemctl enable --now docker
# перелогинься / newgrp docker
```

Swap (обязателен при 4 GiB, полезен и при 8 GiB):
```bash
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## Шаг 2. Воркеры (стенд) — как в LITE

```bash
mkdir -p ~/lite && cd ~/lite
curl -L -o firecrawl-setup.tar.gz \
  https://codeload.github.com/alekchiz/firecrawl-setup/tar.gz/refs/heads/main
tar -xzf firecrawl-setup.tar.gz && cd firecrawl-setup-main
cp .env.example .env
touch tokens.txt && chmod 600 tokens.txt
# приведи .env в порядок (AUTH_TOKEN, PROXY_URL) — как в DEPLOY-NOGIT-LITE.md
docker compose build camou-worker && docker compose build cloak-worker
docker compose up -d camou-worker cloak-worker
```

Проверь воркеры:
```bash
curl -s http://localhost:3100/health -H "x-api-token: <TOKEN>"   # 200
```

## Шаг 3. Firecrawl

```bash
mkdir -p ~/app && cd ~/app
curl -L -o firecrawl.tar.gz https://github.com/firecrawl/firecrawl/archive/refs/tags/v2.11.162.tar.gz
tar -xzf firecrawl.tar.gz && mv firecrawl-2.11.162 firecrawl && cd firecrawl
cat > .env <<'EOF'
USE_DB_AUTHENTICATION=false
POSTGRES_USER=postgres
POSTGRES_PASSWORD=сгенерируй_надёжный_более_32_символов
POSTGRES_DB=postgres
EOF
```

IPv4-фикс (из репозитория стенда):
```bash
bash ~/lite/firecrawl-setup-main/patch-ipv4.sh "$PWD"
```

Сборка и запуск (долго, на 2 CPU — терпи и повторяй при обрыве сети):
```bash
docker compose up --build -d
```

Дождись готовности:
```bash
for i in $(seq 1 30); do
  c=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3002/v0/health/readiness || true)
  [ "$c" = "200" ] && break; sleep 10
done
echo "readiness=$c"     # ож. 200
```

## Шаг 4. Доступ снаружи

```bash
sudo ufw allow 22/tcp && sudo ufw allow 3002/tcp
sudo ufw allow 3100/tcp && sudo ufw allow 3101/tcp
sudo ufw enable
# NAT на роутере: 3002, 3100, 3101 → внутрь
```

## Шаг 5. Персональные ключи

Как в LITE (`manage-keys.sh gen/gen/list`). Пользователи в конфиг добавляют
дополнительно `FIRECRAWL_URL=http://<IP>:3002`.

## Шаг 6. Проверка интеграции

```bash
TOK=<токен>
curl -s -H "x-api-token: $TOK" http://localhost:3100/health   # 200
curl -s -X POST http://localhost:3002/v2/scrape \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/","formats":["markdown"]}' | head -c 120
```

## Шаг 7. (4 GiB) Лимиты памяти

Если RAM всего 4 GiB — ограничь API и playwright-service Firecrawl. Добавь в
`docker-compose.yml` Firecrawl под сервис `api` и `playwright-service`:
```yaml
    mem_limit: 1024m
    pids_limit: 512
```
и перезапусти: `docker compose up -d`. Без этого на 4 GiB высок риск OOM.

## Типичные проблемы

| Симптом | Решение |
|---------|---------|
| Firecrawl не поднимается | пересобрать (`docker compose build`), смотреть `docker logs firecrawl-api-1` |
| readiness долго 500/пусто | ждать/пересобрать; проверить Postgres/Redis в `docker compose ps` |
| сборка падает по сети | повтор `docker compose build` (ретраи) |
| OOM при сборке | увеличить swap |

## Что дальше

- Раздай ключи и `USER-GUIDE.md` пользователям.
- Роль Firecrawl — «обычные сайты» (`scrape_markdown`); тяжёлые/антибот — через
  воркеры. Firecrawl построен без fire-engine: капчи он не решает.
- Обновление — `DEPLOY-GIT.md` (или повторить шаги при новой версии).