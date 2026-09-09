# Развёртывание упрощённой версии (LITE) на Ubuntu 24.04 — БЕЗ git

Цель: поднять MCP-стенд «только воркеры» (camou :3100, cloak :3101) на машине
2 vCPU / 4 GiB / 40 ГБ. Файлы тянутся архивом через `curl` — git не нужен.

Среда: Ubuntu 24.04 (x86_64), пользователь с правами `sudo`, выход в интернет.

---

## 1. Подготовка системы

```bash
sudo apt-get update
sudo apt-get install -y curl ca-certificates openssl
```

## 2. Swap (защита сборки от OOM на 4 GiB)

```bash
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h   # строка Swap должна показать ~4GiB
```

## 3. Установка Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
sudo systemctl enable --now docker
# Выйди и зайди заново (или выполни `newgrp docker`), чтобы docker работал без sudo.
```

## 4. Скачивание проекта без git

```bash
mkdir -p ~/lite && cd ~/lite
curl -L -o firecrawl-setup.tar.gz \
  https://codeload.github.com/alekchiz/firecrawl-setup/tar.gz/refs/heads/lite-stand
tar -xzf firecrawl-setup.tar.gz
cd firecrawl-setup-lite-stand
```

Проверь состав:
```bash
ls                    # camou-worker/ cloak-worker/ docker-compose.yml manage-keys.sh ...
```

## 5. Файл учётных данных `.env`

```bash
cp .env.example .env
sed -i "s|^AUTH_TOKEN=.*|AUTH_TOKEN=ВАШ-МАСТЕР-ТОКЕН|" .env   # legacy-токен (опционально)
# PROXY_URL оставь пустым (без прокси) или пропиши жилой:
# printf 'PROXY_URL=http://user:pass@host:port\n' >> .env
nano .env
```

Убедись, что строки заканчиваются переводами строк (иначе значения «склеятся»).

## 6. Пустой файл токенов (персональные ключи)

```bash
touch tokens.txt && chmod 600 tokens.txt
```

## 7. Сборка (по одному, не параллельно)

```bash
docker compose build camou-worker
docker compose build cloak-worker   # тянет ~200 МБ stealth-Chromium
```

## 8. Запуск и автозапуск

```bash
docker compose up -d camou-worker cloak-worker
docker compose ps
# restart: unless-stopped в compose + enabled docker => поднимутся после reboot
```

## 9. Проверка

```bash
TOK=$(grep '^AUTH_TOKEN=' .env | cut -d= -f2)
curl -s -H "x-api-token: $TOK" http://localhost:3100/health    # 200
curl -s -H "x-api-token: $TOK" http://localhost:3101/health    # 200
curl -s -X POST http://localhost:3100/scrape \
  -H 'Content-Type: application/json' -H "x-api-token: $TOK" \
  -d '{"url":"https://example.com/"}' | head -c 200
```

## 10. Доступ снаружи

Файрвол:
```bash
sudo ufw allow 22/tcp
sudo ufw allow 3100/tcp
sudo ufw allow 3101/tcp
sudo ufw enable && sudo ufw status
```

NAT/проброс на роутере: **3100, 3101** → внутренний IP этой машины.
Проверка снаружи:
```bash
curl -s -H "x-api-token: $TOK" http://<ПУБЛИЧНЫЙ_IP>:3101/health  # 200
```

## 11. Персональные ключи пользователей

```bash
./manage-keys.sh gen ivan     # выдаёт ключ, показывает AUTH_TOKEN=...
./manage-keys.sh list
./manage-keys.sh revoke ivan  # мгновенно отозвать
```
Выданные ключи раздай пользователям (полные шаги — в USER-GUIDE.md).

## Что работает в LITE
`scrape_url` (обычные/маркетплейсы), `scrape_cloak` (Turnstile/403),
`scrape_wb` (WB с ценами), `scrape_ozon` (Ozon, без цен). Тула `scrape_markdown`
нет (нет Firecrawl) — обычные сайты через `scrape_url`.

## Примечания
- Ozon без жилого прокси периодически `ip-blocked` — заполни `PROXY_URL` для стабильности.
- 4 GiB хватает; следи за `docker stats` и swap при сборке.