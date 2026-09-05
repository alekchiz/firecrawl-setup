#!/usr/bin/env bash
set -euo pipefail

# Деплой на чистом Ubuntu 22.04/24.04.
# Запускать под пользователем с sudo. После установки перелогинься,
# чтобы группа docker подхватилась: exit, потом ssh-заново (или newgrp docker).

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

echo "==> Запускаем демон Docker"
sudo systemctl enable --now docker

echo "==> Добавляем пользователя в группу docker (подхватится после перелогина)"
sudo usermod -aG docker "$USER"

echo
echo "=== ШАГ 1: ПЕРЕЛОГИНЬСЯ (exit и зайди заново), потом выполни: ==="
echo "newgrp docker"
echo
echo "=== ШАГ 2: Firecrawl из официального клона ==="
echo "git clone https://github.com/firecrawl/firecrawl.git"
echo "cd firecrawl && git checkout v2.11.162"
echo "cat > .env <<'EOF'
USE_DB_AUTHENTICATION=false
POSTGRES_USER=postgres
POSTGRES_PASSWORD=replace-with-at-least-32-random-characters
POSTGRES_DB=postgres
EOF"
echo "docker compose up --build -d"
echo
echo "=== ШАГ 3: антидетект-воркер из этого репозитория ==="
echo "cd ~/firecrawl-setup && cp .env.example .env && docker compose up --build -d"
