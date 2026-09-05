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
RUN npm install --omit=dev
# Устанавливаем Chromium, используемый playwright
RUN npx playwright install chromium --with-deps || true

COPY src ./src
RUN mkdir -p /app/profiles

EXPOSE 3000
CMD ["node", "src/index.js"]