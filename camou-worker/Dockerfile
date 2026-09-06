FROM python:3.12-slim

# Депенденты Firefox + PIL (для работы отпечатков/рендера)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates fonts-liberation fonts-dejavu \
    libasound2 libatk-bridge2.0-0 libatk1.0-0 libcups2 libdbus-1-3 \
    libdrm2 libgbm1 libglib2.0-0 libnspr4 libnss3 libxcomposite1 \
    libxdamage1 libxfixes3 libxkbcommon0 libxrandr2 \
    xdg-utils wget unzip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -U pip && pip install --no-cache-dir -r requirements.txt

# Скачиваем сам браузер Camoufox (кастомный Firefox)
RUN python3 -m camoufox fetch

COPY app ./app
ENV PYTHONUNBUFFERED=1
EXPOSE 3100
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "3100"]