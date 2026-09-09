# Развёртывание через git (LITE и FULL)

Тот же результат, что и «без git», но обновления через `git pull` — проще
поддерживать в долгую. Ubuntu 24.04, пользователь с `sudo`.

---

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
# приведи .env (AUTH_TOKEN, PROXY_URL) в порядок
docker compose build camou-worker
docker compose build cloak-worker
docker compose up -d camou-worker cloak-worker
```

## Вариант B: FULL (воркеры + Firecrawl)

```bash
# стенд
git clone https://github.com/alekchiz/firecrawl-setup.git ~/lite
cd ~/lite
cp .env.example .env && touch tokens.txt && chmod 600 tokens.txt
docker compose build camou-worker && docker compose build cloak-worker
docker compose up -d camou-worker cloak-worker

# Firecrawl
mkdir -p ~/app && git clone --depth 1 -b v2.11.162 https://github.com/firecrawl/firecrawl.git ~/app/firecrawl
cd ~/app/firecrawl
cat > .env <<'EOF'
USE_DB_AUTHENTICATION=false
POSTGRES_USER=postgres
POSTGRES_PASSWORD=надёжный_пароль_32+
POSTGRES_DB=postgres
EOF
bash ~/lite/patch-ipv4.sh "$PWD"
docker compose up --build -d
```

## Обновление

Стенд:
```bash
cd ~/lite
git pull                        # lite-stand: git checkout lite-stand && git pull
docker compose build camou-worker cloak-worker
docker compose up -d --force-recreate camou-worker cloak-worker
```
Firecrawl:
```bash
cd ~/app/firecrawl && git pull && git checkout v2.11.162
docker compose up --build -d
```

> `tokens.txt` и `.env` в git не хранятся (в `.gitignore`) — `git pull` их не
> затрёт. Ключи пользователей живут своей жизнью через `manage-keys.sh`.

## Порты и файрвол

```bash
sudo ufw allow 22/tcp && sudo ufw allow 3002/tcp   # 3002 — для FULL
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

## Частые вопросы

- **Где брать новую версию?** `git pull` на соответствующей ветке (`main` —
  FULL/боевая, `lite-stand` — LITE).
- **Что со старыми файлами `browser-worker`, `deploy.sh`?** Легаси, не используются
  (`camou-worker`/`cloak-worker` — актуальны).
- **Как отозвать доступ?** `./manage-keys.sh revoke <имя>` (см. ADMIN-GUIDE).