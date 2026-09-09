# Развёртывание ПОЛНОЙ версии на Ubuntu 24.04 — БЕЗ git

Полная версия = воркеры (camou :3100, cloak :3101) **+ Firecrawl** (:3002).
Требования выше: 4 vCPU / 8 GiB / 40+ ГБ (на 4 GiB — только с swap и лимитами,
см. раздел «Лимиты памяти»). Интернет обязателен.

Firecrawl — отдельный открытый проект; тянется архивом, git не нужен.

---

## 1. Подготовка и Docker

```bash
sudo apt-get update && sudo apt-get install -y curl ca-certificates openssl
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
sudo systemctl enable --now docker   # затем перелогинься/newgrp docker
```

Swap (для 8 GiB опционально, для 4 GiB — обязательно):
```bash
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 2. Стенд-воркеры (как в LITE)

```bash
mkdir -p ~/lite && cd ~/lite
curl -L -o firecrawl-setup.tar.gz \
  https://codeload.github.com/alekchiz/firecrawl-setup/tar.gz/refs/heads/main
tar -xzf firecrawl-setup.tar.gz
cd firecrawl-setup-main
cp .env.example .env
# AUTH_TOKEN, PROXY_URL — по желанию; см. DEPLOY-NOGIT-LITE.md шаг 5
touch tokens.txt && chmod 600 tokens.txt
docker compose build camou-worker
docker compose build cloak-worker
docker compose up -d camou-worker cloak-worker
```

## 3. Firecrawl (официальный smoke-stack, версия v2.11.162)

```bash
mkdir -p ~/app && cd ~/app
curl -L -o firecrawl.tar.gz https://github.com/firecrawl/firecrawl/archive/refs/tags/v2.11.162.tar.gz
tar -xzf firecrawl.tar.gz && mv firecrawl-2.11.162 firecrawl
cd firecrawl
```

`.env` (минимум, без ДБ-аутентификации):
```bash
cat > .env <<'EOF'
USE_DB_AUTHENTICATION=false
POSTGRES_USER=postgres
POSTGRES_PASSWORD=<надёжный, минимум 32 символа>
POSTGRES_DB=postgres
EOF
```

IPv4-фикс (из репозитория стенда) — против проблем с npm по IPv6:
```bash
bash ~/lite/firecrawl-setup-main/patch-ipv4.sh "$PWD"
```

Сборка и запуск (долго, на 2 CPU — терпеливо, может требоваться повтор):
```bash
docker compose up --build -d
```

Готовность:
```bash
for i in $(seq 1 30); do
  c=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3002/v0/health/readiness || true)
  [ "$c" = "200" ] && break; sleep 10
done
echo "Firecrawl readiness: $c"
```

## 4. Доступ снаружи

Firecrawl и стенд:
```bash
sudo ufw allow 22/tcp && sudo ufw allow 3002/tcp
sudo ufw allow 3100/tcp && sudo ufw allow 3101/tcp
sudo ufw enable
# NAT: 3002, 3100, 3101 → внутрь машины
```

## 5. Лимиты памяти (только если RAM 4 GiB)

Добавь в `docker-compose.yml` Firecrawl под `api` и `playwright-service`:
```yaml
    mem_limit: 1024m
    pids_limit: 512
```
и перезапусти: `docker compose up -d`. Без этого на 4 GiB возможен OOM.

## 6. Проверка интеграции

```bash
TOK=<мастер-токен из .env стенда>
curl -s -H "x-api-token: $TOK" http://localhost:3100/health   # 200
curl -s -X POST http://localhost:3002/v2/scrape \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/","formats":["markdown"]}' | head -c 120
```
В конфиге MCP у пользователей: `WORKER_URL`, `CLOAK_WORKER_URL`,
`FIRECRAWL_URL=http://<IP>:3002`.

## Примечания
- Firecrawl построен без fire-engine: честно не решает антибот и капчу; его роль —
  `scrape_markdown` (обычные сайты). Тяжёлые сайты — через воркеры.
- Сборка Firecrawl на 2 CPU затратна; используй swap и терпи повторы.