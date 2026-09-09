# Полная установка упрощённой версии (lite-stand) на Ubuntu 24.04 без git

Версия «вариант A»: только воркеры `camou` (:3100) + `cloak` (:3101), без Firecrawl.
Машина: 2 vCPU / 4 GiB / 40 ГБ. Гит **не нужен** — всё через curl/zip.

---

## 0. Подготовка системы

```bash
sudo apt-get update
sudo apt-get install -y curl ca-certificates
```

## 1. Swap (защита от OOM при сборке, 4 GiB)

```bash
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
# чтобы swap не пропадал после перезагрузки:
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h   # должно появиться "Swap: 4.0GiB"
```

## 2. Установить Docker (без git)

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
sudo systemctl enable docker && sudo systemctl start docker
# вход с новой сессией (или newgrp docker), чтобы пользоваться docker без sudo
```

## 3. Скачать репозиторий (архив ветки lite-stand, гит не нужен)

```bash
mkdir -p ~/lite && cd ~/lite
curl -L -o lite.tar.gz https://codeload.github.com/alekchiz/firecrawl-setup/tar.gz/refs/heads/lite-stand
tar -xzf lite.tar.gz
cd firecrawl-setup-lite-stand
ls                     # должны быть camou-worker/ cloak-worker/ docker-compose.yml
```

## 4. Конфиг `.env`

```bash
cp .env.example .env
echo 'AUTH_TOKEN=ПРИДУМАЙ-СЕКРЕТ-ДЛИННЫЙ' >> .env   # общий ключ для коллег
# PROXY_URL: оставляй пустым (без прокси) или впиши жилой, например:
# printf 'PROXY_URL=http://user:pass@pool.proxy.market:10000\n' >> .env
nano .env   # убедись, что строки не сломаны (закончились переносом строки)
```

## 5. Сборка (по одному воркеру, чтобы не упереться в RAM)

```bash
docker compose build camou-worker
docker compose build cloak-worker   # тянет ~200 МБ Chrome CloakBrowser
```

## 6. Запуск

```bash
docker compose up -d camou-worker cloak-worker
docker compose ps                   # оба должны быть Up
```

## 7. Проверка локально

```bash
TOK=$(grep '^AUTH_TOKEN=' .env | cut -d= -f2)
curl -s -H "x-api-token: $TOK" http://localhost:3100/health   # ож 200
curl -s -H "x-api-token: $TOK" http://localhost:3101/health   # ож 200
curl -s -X POST http://localhost:3100/scrape \
  -H "Content-Type: application/json" -H "x-api-token: $TOK" \
  -d '{"url":"https://example.com/"}' | head -c 200
```

## 8. Файрвол (UFW) и проброс портов

```bash
sudo ufw allow 22/tcp
sudo ufw allow 3100/tcp
sudo ufw allow 3101/tcp
sudo ufw enable && sudo ufw status
```

На роутере/провайдере пробросить на этот сервер:
`3100` и `3101` (иначе коллеги не достучатся).

Проверка снаружи:
```bash
curl -s -H "x-api-token: $TOK" http://<ПУБЛИЧНЫЙ_IP>:3101/health   # ож 200
```

## 9. Автозапуск

`docker-compose.yml` имеет `restart: unless-stopped`, а docker поднят в boot
(шаг 2). После перезагрузки контейнеры поднимутся сами.

---

## Как подключают коллеги (MCP)

В `kilo.jsonc` (или проектный):
```jsonc
"mcp": {
  "firecrawl-stack": {
    "type": "local",
    "command": ["node", "/путь/firecrawl_node_bridge.js"],
    "environment": {
      "WORKER_URL": "http://<IP>:3100/scrape",
      "CLOAK_WORKER_URL": "http://<IP>:3101/scrape",
      "AUTH_TOKEN": "<тот же секрет из .env>"
    },
    "enabled": true
  }
}
```
(Bridge-файл лежит в репо: `mcp/firecrawl_node_bridge.js`.)

## Тулы, которые будут работать
`scrape_url` (обычные сайты) · `scrape_cloak` (Turnstile/403) · `scrape_wb` (WB,
с ценами) · `scrape_ozon` (Ozon, без цен). `scrape_markdown` в lite-версии нет —
обычные сайты бери через `scrape_url`.

## Примечания
- Ozon без прокси периодически даёт `ip-blocked` — для стабильности заполни `PROXY_URL`.
- 4 GiB хватает; при сборке следи за `docker stats` (swap подстрахует).