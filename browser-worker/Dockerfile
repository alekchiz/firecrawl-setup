FROM node:20-slim

# Депенденты Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 \
    libatk1.0-0 libcups2 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0 \
    libnspr4 libnss3 libxcomposite1 libxdamage1 libxfixes3 libxkbcommon0 \
    libxrandr2 xdg-utils wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
# На сервере нет IPv6-маршрута: DNS может вернуть AAAA для npm/Cloudflare,
# и Node зависает. Форсим IPv4 + даём npm таймауты/ретраи вместо вечного ожидания.
ENV NODE_OPTIONS=--dns-result-order=ipv4first \
    npm_config_fetch_timeout=180000 \
    npm_config_fetch_retries=5 \
    npm_config_fetch_retry_max_timeout=180000 \
    PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT=120000
RUN npm install --omit=dev --no-audit --no-fund
# Устанавливаем Chromium, используемый playwright
RUN npx playwright install chromium --with-deps || true

COPY src ./src
RUN mkdir -p /app/profiles

EXPOSE 3000
CMD ["node", "src/index.js"]
