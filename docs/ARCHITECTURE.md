# Архитектура и справочник API — LZT Builder

Визуальный конструктор сценариев (n8n-подобный UX) для LZT Market и произвольных HTTP/OpenAPI
интеграций. Локальный single-tenant builder: без логина; данные принадлежат system user `local`.

---

## 1. Стек и сервисы

| Слой | Технологии |
|------|-----------|
| Frontend | Next.js (App Router), React Flow, Tailwind |
| Backend API | FastAPI + SQLAlchemy (async) |
| Исполнение | Celery worker + beat |
| Хранилища | PostgreSQL (данные), Redis (broker/result, кэш, rate-limit, локи) |
| Прокси | Nginx (TLS, маршрутизация `web`/`api`, `/docs` скрыт в prod) |
| Auth | нет — API открыт на инстансе; owner = system user `local` |
| Корреляция | `X-Request-ID` на каждом запросе (фронт → API → логи → outbound HTTP) |
| Заголовки безопасности | API — `SecurityHeadersMiddleware` (nosniff, DENY, HSTS); web — CSP + анти-clickjacking в `next.config.ts` |

Docker Compose (prod): `api`, `worker`, `beat`, `web`, `postgres`, `redis`, `nginx`.
Локально: `docker-compose.dev.yml` поднимает только Postgres+Redis, api/web запускаются вручную.

```
Browser ─▶ Nginx ─┬─▶ web (Next.js)
                  └─▶ api (FastAPI) ─▶ Postgres
                                    └─▶ Redis ─▶ worker/beat ─▶ (LZT / HTTP / OpenAPI)
```

---

## 2. Структура репозитория

```
backend/app/
  main.py            # сборка FastAPI, lifespan, ensure_local_owner, подключение роутеров
  config.py          # Settings (env), лимиты на инстанс, проверка SECRETS_ENCRYPTION_KEY в prod
  owner.py           # system user `local` + Depends(get_owner)
  flows/             # CRUD потоков, запуск/стоп, runs, pins, schedule, файлы; schemas (Pydantic)
  engine/            # ядро исполнения графа
    registry.py        # реестр builtin-нод + ExecutionState
    executor.py        # обход графа, fan-out, ветвление, пул потоков
    topology.py        # topological_sort, оценка условий, выбор следующих нод
    interpolator.py    # шаблоны {{ node.field }}
    http_node.py       # нода http_request (через http_util)
    http_util.py       # единая точка outbound HTTP: DNS-pin + cap размера тела + no-redirect
    lzt_client.py      # HTTP-клиент LZT Market (retry/rate-limit, через http_util)
    lzt_nodes.py       # ноды api_call, file_source (fan-out по строкам)
    openapi_handler.py # исполнение custom OpenAPI-нод (через http_util)
    utility_nodes.py   # set_variables, parse_message, pick_value, resolve_delay_seconds
    url_guard.py       # SSRF-guard, DNS-pin (outbound_httpx_kwargs)
    safe_regex.py      # ReDoS-guard (движок regex: caps + нативный timeout + семафор)
    validate.py        # статическая валидация графа
    errors.py          # GraphExecutionError
    rate_limit.py      # троттлинг вызовов LZT (bucket sleep)
    file_utils.py      # разбор строк login:pass и т.п.
  integrations/      # импорт OpenAPI (fetcher/parser/generator/loader), кэш, credentials
  lzt_accounts/      # CRUD LZT-аккаунтов, refresh /me
  catalog/           # каталог LZT-эндпоинтов (endpoints.json)
  credentials/       # единый список кредов (LZT + OpenAPI)
  webhooks/          # приём входящих вебхуков
  security/          # crypto (Fernet, recursive mask/redact), redis_lock, security headers
  tasks/             # celery_app, flow_tasks (execute_flow, loop, cron)
  db/                # models (SQLAlchemy), session, base
  alembic/           # миграции 001–006
frontend/
  app/               # страницы: login, register, flows, flow/[id], credentials, accounts,
                     #          integrations, executions, credentials
  components/flow/   # редактор: canvas, palette, config-drawer, logs-panel, data-transfer
  lib/               # api.ts (клиент), nodes.ts (типы нод), flow-templates.ts, use-flow-history
```

---

## 3. Модель исполнения

1. Триггер: ручной `POST /flows/{id}/run`, вебхук `POST /hooks/{token}`, расписание (cron)
   или loop-режим (интервал). Все триггеры ставят задачу Celery `execute_flow`.
2. `flow_tasks.execute_flow` строит `ExecutionState`, дешифрует секреты графа
   (`crypto.decrypt_graph_secrets`), обходит граф.
3. `executor` идёт по топологии; ветвление (`if_condition`/`switch`) выбирает исходящие рёбра
   по результату `topology._evaluate_condition`; `file_source` даёт fan-out по строкам.
4. Результат каждой ноды пишется в `state.node_results[node_id]` и доступен следующим нодам
   через шаблоны `{{ node_id.response.field }}` (движок `interpolator`).
5. Прогресс/логи сохраняются в `FlowRun` (+ `NodeRun` snapshot) и стримятся во фронт по SSE
   (`GET /flows/{id}/runs/{run_id}/stream`).

Секреты хранятся зашифрованными (Fernet, `SECRETS_ENCRYPTION_KEY`) — рекурсивно по всем
полям `node.data` (`Authorization`/`token`/`api_key`/…) и `settings.proxy`; дешифруются только
в момент исполнения. В API-ответах граф маскируется (`mask_graph_secrets` → `__kept_secret__`),
на сохранении маска подменяется хранимым шифротекстом. В persisted-логах/snapshot'ах секреты
редактируются (`redact_secrets`) и обрезаются по размеру. В `template_context` кладутся данные
нод, **но не** `credentials`/`lzt_token`.

---

## 4. Типы нод

| Тип | Назначение |
|-----|-----------|
| `flow_start` / `flow_end` | маркеры начала/конца |
| `webhook_trigger` | вход по вебхуку |
| `api_call` | вызов LZT Market endpoint из каталога |
| `http_request` | произвольный HTTP (через SSRF-guard) |
| `file_source` | файл, итерация по строкам `login:pass` (fan-out) |
| `set_variables` / `parse_message` / `pick_value` | работа с данными |
| `delay` | пауза |
| `if_condition` / `switch` / `merge` | управление потоком |
| `execute_flow` | вызов подсценария |
| `custom_*` (OpenAPI) | ноды, сгенерированные из импортированной спеки |

Данные между нодами: кнопка «Выбрать поле» подставляет `{{ node_id.response… }}`.

---

## 5. Справочник HTTP API

Auth: API без JWT — все CRUD-роуты работают от system user `local` (`get_owner`).
Вебхуки по-прежнему защищены секретным `token` в URL.

**Корреляция запросов:** `RequestIdMiddleware` присваивает каждому запросу `request_id`
(переиспользует валидный входящий `X-Request-ID`, иначе генерирует UUID). Id возвращается
в заголовке `X-Request-ID`, попадает в тело ошибок (`{"detail", "request_id"}`), во все
логи (`RequestIdLogFilter`) и в исходящие запросы движка (`http_util` добавляет
`X-Request-ID`). В Celery-задаче исполнения id равен `run-<run_id>`. Фронтенд генерирует
свой `X-Request-ID` на каждый запрос и прикладывает его к `ApiError.requestId`.

### Служебное
| Метод | Путь | Тело / параметры | Ответ |
|-------|------|------------------|-------|
| GET | `/health` | — | `{status}` |

### Потоки (flows)
| Метод | Путь | Тело / параметры | Ответ |
|-------|------|------------------|-------|
| GET | `/flows` | — | `list[FlowResponse]` |
| POST | `/flows` | `FlowCreateRequest` | `FlowResponse` · лимит кол-ва |
| GET | `/flows/{id}` | — | `FlowResponse` |
| PUT | `/flows/{id}` | `FlowUpdateRequest` (name, graph_json, is_active) | `FlowResponse` |
| DELETE | `/flows/{id}` | — | 204 |
| POST | `/flows/{id}/run` | — | `FlowRunResponse` 202 · concurrent+hourly лимиты |
| POST | `/flows/{id}/stop` | — | `FlowResponse` |
| GET | `/flows/{id}/pins` | — | `dict` |
| PUT | `/flows/{id}/pins` | `dict` | `{status, pin_data}` |
| GET | `/flows/{id}/runs` | — | `list[FlowRunResponse]` (limit 20) |
| GET | `/flows/{id}/runs/{run_id}` | — | `FlowRunResponse` |
| GET | `/flows/{id}/runs/{run_id}/nodes` | — | `list[NodeRunResponse]` (limit 2000) |
| GET | `/flows/{id}/runs/{run_id}/stream` | SSE | `text/event-stream` |
| POST | `/flows/{id}/test-node` | `TestNodeRequest` | `{status, result\|error}` |
| PUT | `/flows/{id}/schedule` | `ScheduleRequest` (cron, timezone, is_active) | `{status}` |

### Файлы потока
| Метод | Путь | Тело / параметры | Ответ |
|-------|------|------------------|-------|
| GET | `/flows/{id}/files` | `?node_id` | `list[FlowFileResponse]` |
| POST | `/flows/{id}/files` | multipart `upload`, `node_id` | `FlowFileResponse` · ≤ `MAX_FLOW_FILE_BYTES` |
| GET | `/flows/{id}/files/{file_id}` | — | `FlowFileContentResponse` |
| DELETE | `/flows/{id}/files/{file_id}` | — | 204 |

### LZT-аккаунты и каталог
| Метод | Путь | Тело / параметры | Ответ |
|-------|------|------------------|-------|
| GET | `/lzt-accounts` | — | `list[AccountResponse]` |
| POST | `/lzt-accounts` | `AccountCreateRequest` (token ≥8) | `AccountResponse` |
| POST | `/lzt-accounts/{id}/refresh` | — | `AccountResponse` (по `/me`) |
| DELETE | `/lzt-accounts/{id}` | — | 204 |
| GET | `/catalog` | `?q,&tag` | `list[dict]` |
| GET | `/catalog/tags` | — | `list[dict]` |
| GET | `/catalog/{endpoint_id:path}` | — | `dict` |

### Интеграции (OpenAPI) и credentials
| Метод | Путь | Тело / параметры | Ответ |
|-------|------|------------------|-------|
| POST | `/integrations/openapi/preview` | `{url}` | `OpenApiPreviewResponse` · 10/час |
| POST | `/integrations/openapi/preview/upload` | file | `OpenApiPreviewResponse` · 10/час |
| POST | `/integrations/openapi/import` | `OpenApiImportRequest` | `list[CustomNodeTypeResponse]` · 10/час |
| GET | `/integrations` | — | `list[IntegrationResponse]` |
| DELETE | `/integrations/{id}` | — | 204 |
| PUT | `/integrations/{id}/credentials` | `CredentialUpdateRequest` | `{status}` |
| GET | `/integrations/node-types` | — | `list[CustomNodeTypeResponse]` |
| GET | `/credentials` | — | `list[CredentialItem]` (без секретов) |

### Вебхуки
| Метод | Путь | Тело / параметры | Ответ |
|-------|------|------------------|-------|
| POST | `/hooks/{token}` | raw ≤256 KB | `WebhookResponse` · 60/мин на `token:ip` + run-лимиты; требует `flow.is_active` |

> Лимиты ввода: `max_length` на полях логина/имён, cap на граф (`MAX_NODES=500`,
> `MAX_EDGES=1000`), pins и `mock_context` ≤512 KB, тела внешних ответов ≤5 MiB, cron/timezone
> валидируются. Курсорная пагинация list-эндпоинтов — принятый остаточный пункт бэклога.

---

## 6. Конфигурация (env)

| Переменная | Назначение | Прод-требование |
|------------|-----------|-----------------|
| `ENVIRONMENT` | `development` / `production` | `production` |
| `DATABASE_URL` / `DATABASE_URL_SYNC` | Postgres (async/sync) | — |
| `REDIS_URL`, `CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND` | Redis | — |
| `SECRETS_ENCRYPTION_KEY` | Fernet-ключ для секретов | обязателен (иначе plaintext) |
| `CORS_ORIGINS`, `WEBHOOK_BASE_URL` | домены | реальный домен |
| `MAX_ACTIVE_FLOWS_PER_USER`, `MAX_RUNS_PER_HOUR`, `MAX_CONCURRENT_RUNS_PER_USER`, `MAX_FLOW_FILE_BYTES` | лимиты на инстанс | по нагрузке |

`config.py` в production требует `SECRETS_ENCRYPTION_KEY`.
Без ключа шифрования секреты хранятся открытым текстом (только для локальной разработки).

---

## 7. Модель данных (основное)

| Таблица | Ключевые поля |
|---------|---------------|
| `users` | system owner `local` (колонка осталась; логин не используется) |
| `invite_codes` | legacy-таблица, не используется приложением |
| `flows` | `user_id`, `name`, `graph_json`, `settings`, `is_active` |
| `flow_runs` | `flow_id`, `status`, `context`, `current_node_id`, timestamps |
| `node_runs` | `run_id`, `node_id`, `status`, `output_snapshot` |
| `flow_schedules` | `flow_id`, `cron_expression`, `timezone`, `is_active` |
| `flow_files` | `flow_id`, `node_id`, `filename`, `content` / `content_binary` |
| `webhook_tokens` | `flow_id`, `node_id`, `token` (`token_urlsafe(24)`) |
| `lzt_accounts` | `user_id`, `token` (enc), `nickname` |
| `integrations` + `custom_node_types` | импортированные OpenAPI-спеки и ноды |

Миграции — Alembic `001`…`006` (`003` — cascade deletes, `006` — drop `funpay_accounts`).
Запуск: `alembic upgrade head` (в контейнере — через `docker-entrypoint.sh` для роли `api`).

---

## 8. Запуск

Локально:
```bash
cp .env.example .env
docker compose -f docker-compose.dev.yml up -d   # postgres + redis
cd backend && alembic upgrade head && uvicorn app.main:app --reload
cd frontend && npm install && npm run dev
```

Production: см. [../DEPLOY.md](../DEPLOY.md) — один `docker compose up -d` поднимает
api/worker/beat/web/postgres/redis/nginx.

Связанные документы: [OPERATIONS.md](OPERATIONS.md) — эксплуатация.
