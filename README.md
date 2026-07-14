# Lolzteam Workflow Builder

Визуальный конструктор сценариев для [LZT Market API](https://lzt-market.readme.io/reference/information) — как n8n: canvas, ноды, запуски, токены.

**Без логина:** открыл UI → добавил LZT-токен → работаешь.

Стек: Next.js · FastAPI · PostgreSQL · Redis · Celery · Docker

Репозиторий: https://github.com/scwee/LolzteamWorflowBuilder

---

## С чего начать

| Цель | Куда |
|------|------|
| Поднять на **VPS** (рекомендуется) | [Шаг A](#a-запуск-на-vps-одной-командой) |
| Запустить **на своём Mac** для разработки | [Шаг B](#b-локальный-запуск-разработка) |
| Что делать **после** запуска | [Шаг C](#c-что-делать-в-интерфейсе) |

Подробный деплой и диагностика: [DEPLOY.md](DEPLOY.md).

---

## A. Запуск на VPS (одной командой)

### 1. Нужно

- VPS Ubuntu 22.04 / 24.04, от **2 GB RAM**
- SSH (root или sudo)
- Опционально: домен

### 2. Подключись к серверу

```bash
ssh root@ВАШ_IP
```

### 3. Скачай и запусти установщик

```bash
curl -fsSL https://raw.githubusercontent.com/scwee/LolzteamWorflowBuilder/main/install.sh -o install.sh
chmod +x install.sh
sudo bash install.sh
```

Скрипт поставит Docker, склонирует проект в `/opt/lzt-builder`, спросит режим доступа и поднимет весь стек.

### 4. Выбери режим

| Режим | Когда |
|-------|--------|
| **1** | домен + HTTPS (Let's Encrypt) |
| **2** | домен по HTTP |
| **3** | только IP + порт (проще всего) |

Для режима **3** (порт например `3001`):

```bash
ufw allow 3001/tcp
ufw reload
```

Сайт: `http://ВАШ_IP:3001`

### 5. Сохрани секреты

В конце скрипт покажет `POSTGRES_PASSWORD` и `SECRETS_ENCRYPTION_KEY` — сохрани их.

Дальше → [Шаг C](#c-что-делать-в-интерфейсе).

### Обновление на VPS

```bash
sudo bash /opt/lzt-builder/update.sh
```

---

## B. Локальный запуск (разработка)

Нужны: Docker, Python 3.10+, Node.js 20+.

### 1. Клон и env

```bash
git clone https://github.com/scwee/LolzteamWorflowBuilder.git
cd LolzteamWorflowBuilder

cp .env.example .env
```

Локально пароль Postgres уже `lztbuilder` (как в `docker-compose.dev.yml`).  
`SECRETS_ENCRYPTION_KEY` можно оставить пустым **только на своей машине**.

### 2. Postgres + Redis

```bash
docker compose -f docker-compose.dev.yml up -d
```

### 3. Backend (терминал 1)

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

### 4. Celery (терминал 2 и 3)

```bash
cd backend
source .venv/bin/activate
celery -A app.tasks.celery_app worker --loglevel=info
```

```bash
cd backend
source .venv/bin/activate
celery -A app.tasks.celery_app beat --loglevel=info
```

### 5. Frontend (терминал 4)

```bash
cd frontend
echo 'NEXT_PUBLIC_API_URL=http://localhost:8000' > .env.local
npm install
npm run dev
```

Открой: http://localhost:3000

Дальше → [Шаг C](#c-что-делать-в-интерфейсе).

---

## C. Что делать в интерфейсе

1. **Учётные данные** (меню слева)  
   Вставь LZT Market token → сохрани. Можно несколько аккаунтов.

2. **Сценарии** (главная)  
   Создай пустой workflow или выбери шаблон.

3. **Редактор**  
   Перетащи ноды с палитры, соедини стрелками, настрой поля (кнопка «Выбрать поле»).

4. **Запуск**  
   Нажми Run. История — в разделе **Запуски**.

5. **Интеграции** (по желанию)  
   Импорт своего OpenAPI → появятся кастомные ноды.

Логина и регистрации нет: кто открыл URL — тот и пользуется. Держи инстанс приватным (firewall / VPN / private repo).

---

## Возможности

- Canvas: drag-and-drop, IF / Switch / Merge, autosave
- Триггеры: Manual, Webhook, Loop / Cron
- LZT Market каталог, HTTP Request, File Source
- Несколько LZT-токенов
- OpenAPI-импорт
- Executions в боковом меню

## Структура репо

```
frontend/              Next.js UI
backend/               FastAPI + Celery
deploy/                nginx
docker-compose.yml     полный стек (VPS / install.sh)
docker-compose.dev.yml только Postgres + Redis (локально)
install.sh             установщик на VPS
update.sh              обновление на VPS
DEPLOY.md              подробный гайд по деплою
```

## Документация

| Файл | О чём |
|------|--------|
| [DEPLOY.md](DEPLOY.md) | VPS: install, SSL, ошибки |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | бэкапы, логи, эксплуатация |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | API и архитектура |
