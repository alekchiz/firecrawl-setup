# Развёртывание через git (LITE и FULL)

Альтернатива установке «без git»: тот же результат, но с обновлениями через `git pull`.
Среда: Ubuntu 24.04, пользователь с `sudo`.

## Общая подготовка

```bash
sudo apt-get update
sudo apt-get install -y git curl ca-certificates openssl
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
sudo systemctl enable --now docker
# перелогинься / newgrp docker
```

## Вариант A: LITE (только воркеры)

```bash
git clone -b lite-stand https://github.com/alekchiz/firecrawl-setup.git ~/lite
cd ~/lite
cp .env.example .env
touch tokens.txt && chmod 600 tokens.txt
docker compose build camou-worker
docker compose build cloak-worker
docker compose up -d camou-worker cloak-worker
```

## Вариант B: FULL (воркеры + Firecrawl)

```bash
git clone https://github.com/alekchiz/firecrawl-setup.git ~/lite
cd ~/lite
cp .env.example .env && touch tokens.txt && chmod 600 tokens.txt
docker compose build camou-worker && docker compose build cloak-worker
docker compose up -d camou-worker cloak-worker

# Firecrawl (отдельный репозиторий)
git clone --depth 1 -b v2.11.162 https://github.com/firecrawl/firecrawl.git ~/app/firecrawl
cd ~/app/firecrawl
cat > .env <<'EOF'
USE_DB_AUTHENTICATION=false
POSTGRES_USER=postgres
POSTGRES_PASSWORD=<надёжный 32+>
POSTGRES_DB=postgres
EOF
bash ~/lite/patch-ipv4.sh "$PWD"
docker compose up --build -d
```

## Обновления

Воркеры/стенд:
```bash
cd ~/lite
git pull                       # (для lite-stand: git checkout lite-stand && git pull)
docker compose build camou-worker cloak-worker
docker compose up -d --force-recreate camou-worker cloak-worker
```

Firecrawl (если FULL):
```bash
cd ~/app/firecrawl
git pull && git checkout v2.11.162
docker compose up --build -d
```

Персональные ключи — правки в `tokens.txt` (через `./manage-keys.sh`), git не трогаю
файл токенов (он в `.gitignore`), обновления его не затирают.

## Порты и файрвол

```bash
sudo ufw allow 22/tcp && sudo ufw allow 3002/tcp
sudo ufw allow 3100/tcp && sudo ufw allow 3101/tcp
sudo ufw enable
# NAT: 3002 (FULL), 3100, 3101 → внутрь
```

## Проверка

```bash
TOK=$(grep '^AUTH_TOKEN=' ~/lite/.env | cut -d= -f2)
curl -s -H "x-api-token: $TOK" http://localhost:3100/health   # 200
curl -s -H "x-api-token: $TOK" http://localhost:3101/health   # 200
```