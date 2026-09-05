#!/usr/bin/env bash
set -euo pipefail

# ФАЗА 1 — подготовка Ubuntu (22.04/24.04). Запускать под sudo-пользователем.
# После этой фазы ОБЯЗАТЕЛЬНО перелогинься, затем: bash bootstrap.sh

echo "==> Обновляем систему"
sudo apt-get update && sudo apt-get upgrade -y

echo "==> Ставим Docker + Compose + утилиты"
sudo apt-get install -y ca-certificates curl git openssl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

echo "==> Запускаем демон Docker"
sudo systemctl enable --now docker

echo "==> Добавляем пользователя $USER в группу docker"
sudo usermod -aG docker "$USER"

echo "==> Отключаем сон/гибернацию (важно для домашнего сервера)"
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target 2>/dev/null || true

echo
echo "✅ Фаза 1 готова."
echo "ВЫПОЛНИ: выход и вход заново (или: newgrp docker), затем:"
echo "  bash bootstrap.sh"
echo
echo "Проверка после этого: docker ps"