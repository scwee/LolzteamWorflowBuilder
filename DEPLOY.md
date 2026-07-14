# Деплой LZT Builder на VPS

Пошаговый гайд: поднять личный builder на сервере. Логина нет — после установки сразу UI → токен → сценарии.

Репозиторий: https://github.com/scwee/LolzteamWorflowBuilder

---

## Что нужно

| | |
|---|---|
| VPS | Ubuntu 22.04 / 24.04, **от 2 GB RAM** |
| Доступ | root или `sudo` по SSH |
| Опционально | домен с A-записью на IP сервера |

Стек поднимается Docker Compose: `api`, `worker`, `beat`, `web`, `postgres`, `redis`, `nginx`.

---

## Способ 1 — одной командой (рекомендуется)

### 1. Подключитесь к серверу

```bash
ssh root@ВАШ_IP
```

### 2. Скачайте и запустите установщик

```bash
curl -fsSL https://raw.githubusercontent.com/scwee/LolzteamWorflowBuilder/main/install.sh -o install.sh
# или: wget -O install.sh https://raw.githubusercontent.com/scwee/LolzteamWorflowBuilder/main/install.sh

chmod +x install.sh
sudo bash install.sh
```

Скрипт:

1. поставит Docker (если нет);
2. склонирует проект в `/opt/lzt-builder`;
3. спросит режим доступа;
4. сгенерирует секреты и поднимет контейнеры.

### 3. Выберите режим

| Режим | Когда выбирать |
|-------|----------------|
| **1** — домен + HTTPS | есть домен, нужен Let's Encrypt |
| **2** — домен по HTTP | домен есть, SSL настроите позже |
| **3** — IP + порт | самый простой старт (по умолчанию) |

Пример для режима **3**: порт `3001` → сайт на `http://ВАШ_IP:3001`.

Откройте порт в firewall:

```bash
ufw allow 3001/tcp
ufw reload
```

### 4. После установки

1. Откройте URL из вывода скрипта.
2. **Учётные данные** → добавьте LZT Market token.
3. Создайте сценарий на главной.

Секреты (`SECRETS_ENCRYPTION_KEY`, `POSTGRES_PASSWORD`) скрипт покажет в конце — сохраните.

---

## Способ 2 — вручную

Если нужен полный контроль над `.env`.

### 1. ПО и клон

```bash
ssh root@ВАШ_IP
apt update && apt upgrade -y
apt install -y git docker.io docker-compose-plugin
systemctl enable --now docker

cd /opt
git clone https://github.com/scwee/LolzteamWorflowBuilder.git lzt-builder
cd lzt-builder
```

### 2. `.env`

```bash
cp .env.example .env
nano .env
```

Обязательно задайте (в `.env`):

```bash
ENVIRONMENT=production

# пароль Postgres — только буквы/цифры (без @ : / # ?)
POSTGRES_PASSWORD=$(openssl rand -hex 24)

# ключ шифрования LZT-токенов в БД
SECRETS_ENCRYPTION_KEY=$(python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())")
```

И укажите URL:

**По IP и порту 3001:**

```env
HTTP_PORT=3001
HTTPS_PORT=3443
CORS_ORIGINS=http://ВАШ_IP:3001
WEBHOOK_BASE_URL=http://ВАШ_IP:3001
NEXT_PUBLIC_API_URL=
```

**По домену (HTTPS позже):**

```env
CORS_ORIGINS=https://builder.example.com
WEBHOOK_BASE_URL=https://builder.example.com
NEXT_PUBLIC_API_URL=
```

`NEXT_PUBLIC_API_URL` оставьте пустым — фронт ходит на тот же хост через nginx.

### 3. Nginx и запуск

```bash
cp deploy/nginx.http.conf deploy/nginx.conf
docker compose build
docker compose up -d
docker compose ps
curl -sf http://127.0.0.1:${HTTP_PORT:-80}/health && echo OK
```

Откройте сайт в браузере → **Учётные данные** → LZT-токен.

### 4. HTTPS (если есть домен)

```bash
apt install -y certbot
docker compose stop nginx
certbot certonly --standalone -d builder.example.com

# верните HTTPS-шаблон из репо и замените YOUR_DOMAIN
cp deploy/nginx.conf deploy/nginx.conf.bak  # если нужно
# отредактируйте deploy/nginx.conf: YOUR_DOMAIN → builder.example.com
docker compose up -d nginx
```

---

## Обновление

```bash
sudo bash /opt/lzt-builder/update.sh
```

Или вручную:

```bash
cd /opt/lzt-builder
git pull
docker compose build
docker compose up -d
```

---

## Полезные команды

```bash
cd /opt/lzt-builder

docker compose ps
docker compose logs -f api worker web
docker compose restart
docker compose down          # остановить (данные в volumes остаются)
docker compose down -v       # ⚠ удалить и БД
```

---

## Диагностика

```bash
cd /opt/lzt-builder
docker compose ps
docker compose logs api --tail=50
curl -sf http://127.0.0.1:${HTTP_PORT:-80}/health && echo OK
```

| Симптом | Что сделать |
|---------|-------------|
| Сайт не открывается | `ufw allow ПОРТ/tcp`; открывайте именно `HTTP_PORT`, не системный nginx на :80 |
| `404 Not Found nginx/…` | зашли на порт 80 хоста — нужен `http://IP:3001` (или ваш `HTTP_PORT`) |
| `api` unhealthy | `docker compose logs api --tail=80` — часто нет `SECRETS_ENCRYPTION_KEY` в prod |
| Ошибка Postgres с `@` в пароле | пароль только hex: `openssl rand -hex 24`, затем `docker compose down -v && up -d` |
| `bind: address already in use` | сменить `HTTP_PORT` / `HTTPS_PORT` в `.env` |
| Фронт бьёт не туда | `NEXT_PUBLIC_API_URL=` пустой → `docker compose build web && up -d` |

---

## Важно по безопасности

- Инстанс **без логина**: любой, кто знает URL, видит flows и credentials.
- Держите репозиторий **private** и не светите IP/домен публично без firewall/VPN.
- Не коммитьте файл `.env` в git.

---

## См. также

- [docs/OPERATIONS.md](docs/OPERATIONS.md) — бэкапы, миграции, эксплуатация
- [README.md](README.md) — локальный запуск для разработки
