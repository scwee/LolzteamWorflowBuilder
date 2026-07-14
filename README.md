# LZT Builder

Визуальный no-code конструктор workflow для [LZT Market API](https://lzt-market.readme.io/reference/information) — UX как у n8n (тёмный UI, палитра, executions, credentials).

Стек: **Next.js** + **FastAPI** + **PostgreSQL** + **Redis** + **Celery**.

Личный локальный builder: без логина и регистрации. Подняли стек → добавили LZT-токен в Учётные данные → работаете со сценариями.

## Возможности

- Canvas-редактор: drag-and-drop, IF / Switch / Merge, autosave, MiniMap
- Выбор полей из output предыдущих нод (field picker), без ручного кода
- Триггеры: Manual, Webhook, Loop / Cron
- LZT Market каталог, HTTP Request, File Source, Set / Parse / Pick
- OpenAPI-импорт своих API
- Несколько LZT-токенов на странице Credentials
- Executions и Credentials в боковом меню

## Быстрый старт (локально)

```bash
cp .env.example .env
docker compose -f docker-compose.dev.yml up -d   # postgres + redis

cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
alembic upgrade head
uvicorn app.main:app --reload --port 8000

# отдельно
celery -A app.tasks.celery_app worker --loglevel=info
celery -A app.tasks.celery_app beat --loglevel=info

cd ../frontend
cp .env.local.example .env.local
npm install
npm run dev
```

Откройте http://localhost:3000 → **Учётные данные** → добавьте LZT Market token → создайте сценарий.

Пустой `SECRETS_ENCRYPTION_KEY` допустим **только локально**: без ключа секреты хранятся открытым текстом. Для VPS см. [DEPLOY.md](DEPLOY.md).

## Production (VPS + Docker)

Пошаговый гайд: **[DEPLOY.md](DEPLOY.md)** (`install.sh` или ручной Docker Compose).  
Эксплуатация — [docs/OPERATIONS.md](docs/OPERATIONS.md).

API на инстансе открыт без логина — рассчитано на личный локальный или приватный хост.

## Ноды

| Тип | Описание |
|-----|----------|
| `flow_start` / `flow_end` | маркеры |
| `webhook_trigger` | входящий webhook |
| `api_call` | LZT Market endpoint |
| `http_request` | произвольный HTTP |
| `file_source` | файл: `login:pass[:email]` или CSV с заголовком, прокси на строку, дедуп, параллельность |
| `account_status` | проверка валидности LZT-токена через `/me` (nickname, баланс) |
| `set_variables` / `parse_message` / `pick_value` | данные |
| `filter` / `aggregate` | фильтр массива по условию; count/unique/join/sum/avg/min/max |
| `delay` | пауза |
| `if_condition` / `switch` / `merge` | логика |
| `execute_flow` | подсхема |
| OpenAPI custom | импорт из Integrations |

Данные между нодами: кнопка «Выбрать поле» → `{{ node_id.response… }}`.

## Структура

- `frontend/` — Next.js UI
- `backend/` — FastAPI + Celery engine
- `deploy/` — nginx
- `docker-compose.yml` — production stack
- `docker-compose.dev.yml` — только Postgres/Redis
