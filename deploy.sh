#!/usr/bin/env bash
set -euo pipefail

# Базовый деплой на чистом Ubuntu 22.04/24.04.
# Запускать под пользователем с правами sudo.

echo "==> Обновляем систему"
sudo apt-get update && sudo apt-get upgrade -y

echo "==> Ставим Docker + Compose"
sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

echo "==> Добавляем пользователя в группу docker"
sudo usermod -aG docker "$USER"

echo "==> Клонируем и собираем Firecrawl (актуальная версия)"
if [ ! -d firecrawl ]; then
  git clone https://github.com/firecrawl/firecrawl
fi
cd firecrawl
cp .env.example .env
# Место для правки .env — LICENSE_KEY и ключи. Открой вручную.
echo "! ВНИМАНИЕ: открой firecrawl/.env и впиши LICENSE_KEY и ключи."
cd ..

echo "==> Готовим переменные окружения для compose"
if [ ! -f .env ]; then cp .env.example .env; fi

echo
echo "Дальше:"
echo "  1) Отредактируй .env (PROXY_URL, HEADED, LICENSE_KEY в firecrawl/.env)"
echo "  2) docker compose up --build -d"
echo "  3) Проверка: curl -X POST localhost:3000/scrape -H 'Content-Type: application/json' -d '{\"url\":\"https://www.ozon.ru/\"}'"