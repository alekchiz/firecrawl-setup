# Мониторинг (опционально, лёгкий)

Прослеживаем состояние хоста: CPU, RAM, диск, сеть и т.п. Стек рассчитан на
маленький стенд: **node-exporter + Prometheus**, retention **7 дней**, интервал 30с.

Занимаемый объём: образы ~50 МБ, данные ~десяти-сотни МБ, RAM ~100–150 МБ.
(Подробный разбор объёма — см. `docs/README.md`; про footprint — раздел выше.)

## Состав
- `monitoring/docker-compose.monitoring.yml` — override compose: сервисы `node-exporter` (:9100) и `prometheus` (:9090).
- `monitoring/prometheus.yml` — конфиг scrape (интервал 30с, цель localhost:9100).

## Запуск

```bash
cd ~/firecrawl-setup
docker compose -f docker-compose.yml -f monitoring/docker-compose.monitoring.yml up -d
docker compose -f docker-compose.yml -f monitoring/docker-compose.monitoring.yml ps
```

Проверка:
```bash
curl -s localhost:9090/-/ready        # ож. "Prometheus is Ready."
curl -s localhost:9090/api/v1/query --data-urlencode 'query=up'   # up{job="node"}=1
```

## Полезные запросы (PromQL)

```promql
# CPU загрузка хоста (%)
100 - avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100

# RAM занятая (bytes)
node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes

# Диск / занятый (bytes)
node_filesystem_avail_bytes{mountpoint="/"}  # доступно

# Аптайм
time() - node_boot_time_seconds
```

## Остановка (если не нужен)

```bash
docker compose -f docker-compose.yml -f monitoring/docker-compose.monitoring.yml down
```

## Безопасность

- UI Prometheus слушает на `0.0.0.0:9090`. Если внешний доступ не нужен —
  слушай только локально (`--web.listen-address=127.0.0.1:9090`) или закрой файрволом:
  `sudo ufw allow from 10.0.0.0/8 to any port 9090` (пример).
- Метрики хоста содержат чувствительно: не вешай порт в публичный интернет без
  проверки доступа.

## На маленьком стенде (4 GiB)

- Интервал в `prometheus.yml` — 30–60с.
- Retention уже установлен 168h (7 дней).
- Если RAM впритык (воркеры + Firecrawl) — можно оставить только
  `node-exporter` (без Prometheus) и смотреть метрики: `curl localhost:9100/metrics`.