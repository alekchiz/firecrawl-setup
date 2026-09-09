FROM python:3.12-slim

# Депенденты Chromium (CloakBrowser — stealth-Chromium) + шрифты
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates fonts-liberation fonts-dejavu \
    libgtk-3-0 libasound2 libatk-bridge2.0-0 libatk1.0-0 libcups2 \
    libdbus-1-3 libdbus-glib-1-2 libdrm2 libgbm1 libglib2.0-0 \
    libnspr4 libnss3 libxcomposite1 libxdamage1 libxfixes3 \
    libxkbcommon0 libxrandr2 libxt6 libxtst6 libx11-xcb1 \
    libpango-1.0-0 libcairo2 libgdk-pixbuf-2.0-0 \
    xdg-utils xvfb wget unzip fontconfig \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --index-url https://pypi.org/simple --no-cache-dir -U pip \
    && pip install --index-url https://pypi.org/simple --no-cache-dir -r requirements.txt

# Скачиваем stealth-Chromium бинарь CloakBrowser (free v146; лицензия — для latest)
RUN python3 -c "from cloakbrowser import ensure_binary; ensure_binary()" \
    && echo "cloakbrowser binary OK"

COPY app ./app
ENV PYTHONUNBUFFERED=1
EXPOSE 3101
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "3101"]
