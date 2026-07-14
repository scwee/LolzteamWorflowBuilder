# Эксплуатация LZT Builder

Практическое руководство для VPS-инстанса (Docker Compose). Первичная установка —
[DEPLOY.md](../DEPLOY.md).

## Сервисы

| Контейнер | Роль | Порт (внутри) |
|-----------|------|---------------|
| `nginx` | TLS + reverse proxy, единственный внешний вход | `HTTP_PORT` / `HTTPS_PORT` |
| `web` | Next.js фронтенд | 3000 |
| `api` | FastAPI + миграции Alembic на старте | 8000 |
| `worker` | Celery — исполнение flows | — |
| `beat` | Celery — loop / cron расписания | — |
| `postgres` | данные | 5432 |
| `redis` | broker/result, кэш, rate-limit, локи | 6379 |

## Повседневные команды

```bash
cd /opt/lzt-builder

docker compose ps                      # статусы
docker compose logs -f api worker web  # живые логи
docker compose restart api             # перезапуск одного сервиса
docker compose up -d                   # применить изменения .env / compose
```

## Обновление версии

```bash
cd /opt/lzt-builder
git pull
docker compose build
docker compose up -d
docker compose logs -f api        # дождаться "Application startup complete"
```

Фронтенд вшивает `NEXT_PUBLIC_API_URL` при сборке — после его изменения обязательно
`docker compose build web`, простого рестарта недостаточно.

## Миграции БД

Alembic прогоняется автоматически при старте `api` (см. `docker-entrypoint.sh`).
Ручной запуск при необходимости:

```bash
docker compose exec api alembic upgrade head
docker compose exec api alembic current
docker compose exec api alembic history
```

Цепочка ревизий: `001 → 002 → 003 → 004 → 005 → 006 → 007_credential_events`.

## Бэкап и восстановление Postgres

```bash
# Бэкап (переменные берём из .env)
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" \
  | gzip > backup-$(date +%F).sql.gz

# Восстановление в чистую базу
gunzip -c backup-2026-07-12.sql.gz \
  | docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```

Данные лежат в volume `postgres_data`. `docker compose down` их сохраняет;
`docker compose down -v` — **удаляет** (используется для полного сброса).

## Диагностика

```bash
curl -sf http://127.0.0.1:${HTTP_PORT:-80}/health && echo OK   # api через nginx
docker compose exec redis redis-cli ping                        # PONG
docker compose exec postgres pg_isready -U "$POSTGRES_USER"      # accepting connections
docker stats --no-stream                                        # CPU / RAM по контейнерам
```

Таблица частых проблем деплоя — в [DEPLOY.md](../DEPLOY.md#диагностика).

## Аудит кредов

Действия с LZT-токенами и OpenAPI-кредами (создание, замена, обновление, удаление)
пишутся в таблицу `credential_events` и видны в UI на странице **Credentials →
Журнал действий**. Сами секреты в журнал не попадают — только метаданные и IP.

## Масштабирование worker'ов

При росте нагрузки увеличьте параллелизм Celery, не трогая код:

```bash
# в .env
CELERY_CONCURRENCY=4          # потоков внутри одного worker (по умолчанию 2)
```

```bash
docker compose up -d --scale worker=3   # несколько worker-контейнеров
```

`beat` должен остаться в единственном экземпляре (иначе задачи расписания дублируются).
