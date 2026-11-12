#!/usr/bin/env bash
# Installs / updates the Dreaming inbox on the VPS. Safe to run again.
# Usage (from the dev PC):  ssh root@VPS 'bash /root/dreaming-install.sh' < ~/.dreaming/admin.key
# Expects server.js, dashboard.js, the dashboard/ folder and package.json already copied to /opt/dreaming.
# Touches only: /opt/dreaming, the `dreaming` Postgres role + database, the PM2 process `dreaming-api`.
set -euo pipefail

read -r ADMIN_KEY || true
APP=/opt/dreaming
mkdir -p "$APP"

# Database: own role and database, password kept root-only.
if [ ! -s /root/.dreaming-dbpass ]; then
  (umask 077; openssl rand -hex 24 | tr -d '\n' > /root/.dreaming-dbpass)
fi
DBPASS=$(cat /root/.dreaming-dbpass)
if ! sudo -u postgres psql -Atc "select 1 from pg_roles where rolname = 'dreaming'" | grep -q 1; then
  sudo -u postgres psql -v ON_ERROR_STOP=1 -q -c "create role dreaming login password '$DBPASS';"
  echo "created role dreaming"
fi
if ! sudo -u postgres psql -Atc "select 1 from pg_database where datname = 'dreaming'" | grep -q 1; then
  sudo -u postgres psql -v ON_ERROR_STOP=1 -q -c "create database dreaming owner dreaming;"
  echo "created database dreaming"
fi

# Settings file, root-only. Written once; later runs keep it.
if [ ! -s "$APP/.env" ]; then
  if [ ${#ADMIN_KEY} -lt 32 ]; then echo "admin key missing on stdin" >&2; exit 1; fi
  (umask 077; cat > "$APP/.env" <<ENV
PORT=3020
DATABASE_URL=postgres://dreaming:${DBPASS}@127.0.0.1:5432/dreaming
ADMIN_KEY=${ADMIN_KEY}
IP_SALT=$(openssl rand -hex 16)
ALLOWED_ORIGINS=https://antoniomarketuae-design.github.io,http://localhost:8787
KEEP_DAYS=60
ENV
  )
  echo "wrote $APP/.env"
fi
chmod 600 "$APP/.env"

cd "$APP"
npm install --omit=dev --no-audit --no-fund --loglevel=error

if pm2 describe dreaming-api >/dev/null 2>&1; then
  pm2 restart dreaming-api --update-env >/dev/null
  echo "restarted dreaming-api"
else
  pm2 start server.js --name dreaming-api --cwd "$APP" --time >/dev/null
  echo "started dreaming-api"
fi
pm2 save >/dev/null

for i in 1 2 3 4 5; do
  sleep 1
  if curl -fsS http://127.0.0.1:3020/health; then echo; exit 0; fi
done
echo "health check failed" >&2
pm2 logs dreaming-api --lines 30 --nostream >&2
exit 1
