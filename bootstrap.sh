#!/usr/bin/env bash
set -euo pipefail

# ФАЗА 2 — деплой Firecrawl + антидетект-воркера на чистом сервере.
# Запускать ПОСЛЕ ФАЗЫ 1 и после перелогина, из корня этого репозитория.
# Важно: воркер собирается ПЕРВЫМ (сервер простаивает) — так не перегружаем 2-CPU.

APP="$HOME/app"
mkdir -p "$APP"

echo "==> Внешний IP: $(curl -s ifconfig.me) (сверь с WAN роутера)"
echo "==> Чистим висящее место docker"
docker system prune -af 2>/dev/null || true

# ---- 1) Антидетект-воркер (этот репозиторий) ----
cd "$APP"
if [ ! -d firecrawl-setup ]; then
  git clone https://github.com/alekchiz/firecrawl-setup.git
fi
cd firecrawl-setup
cp -n .env.example .env || true
echo "==> Собираем browser-worker (стек Firecrawl ещё не запущен)"
for i in $(seq 1 6); do
  echo "== worker build $i/6 =="
  if docker compose build browser-worker; then break; fi
  echo "== worker build не вышло, пауза =="
  sleep 12
done
docker compose up -d browser-worker
echo "==> Проверка воркера:"
curl -s http://localhost:3000/health && echo

# ---- 2) Firecrawl (официальный self-host, pinned v2.11.162) ----
cd "$APP"
if [ ! -d firecrawl ]; then
  git clone https://github.com/firecrawl/firecrawl.git
fi
cd firecrawl
git checkout v2.11.162
echo "==> IPv4-first патч Dockerfile Firecrawl (нет IPv6-маршрута на сервере)"
bash "$APP/firecrawl-setup/patch-ipv4.sh" "$PWD" || echo "!! патч не применился, смотрим ниже"
if [ ! -f .env ]; then
  PASS=$(openssl rand -hex 16)
  cat > .env <<EOF
USE_DB_AUTHENTICATION=false
POSTGRES_USER=postgres
POSTGRES_PASSWORD=$PASS
POSTGRES_DB=postgres
EOF
  echo "==> POSTGRES_PASSWORD сгенерирован: $PASS (сохранён в ~/app/firecrawl/.env)"
fi
echo "==> Собираем и запускаем Firecrawl (долго, грузит CPU)"
for i in $(seq 1 8); do
  echo "== firecrawl build $i/8 =="
  if docker compose up --build -d; then echo OK-build; break; fi
  echo "== firecrawl build не вышло, пауза =="
  sleep 15
done

# ---- 3) Проверка ----
echo "==> Ожидаем готовности Firecrawl"
for i in $(seq 1 30); do
  sleep 2
  if curl -sf -o /dev/null http://localhost:3002/v0/health/readiness; then
    echo "Firecrawl готов: HTTP 200"
    break
  fi
done
curl -s -o /dev/null -w 'readiness HTTP %{http_code}\n' http://localhost:3002/v0/health/readiness || echo "readiness ещё не отвечает — глянь логи: docker compose logs api"

echo
echo "================ ИТОГ ================"
echo "Firecrawl   : http://localhost:3002  (health /v0/health/readiness)"
echo "Воркер      : http://localhost:3000  (POST /scrape)"
echo
echo "Тест воркера на Ozon:"
echo "  curl -X POST localhost:3000/scrape -H 'Content-Type: application/json' -d '{\"url\":\"https://www.ozon.ru/\"}' | python3 -m json.tool"
echo
echo "Если капча не проходит — см. README (HEADED=true прогрев или селектор слайдера)."
