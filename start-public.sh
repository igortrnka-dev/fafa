#!/usr/bin/env bash
# Spustí appku lokálne a sprístupní ju na verejnej HTTPS adrese cez Cloudflare tunel.
# Použitie:  ./start-public.sh
set -e
cd "$(dirname "$0")"

# 1) kontrola cloudflared
if ! command -v cloudflared >/dev/null 2>&1; then
  echo "Chýba cloudflared. Nainštaluj ho raz príkazom:"
  echo "    brew install cloudflared"
  exit 1
fi

# 2) kontrola .env
if [ ! -f .env ]; then
  echo "Chýba súbor .env. Skopíruj .env.example na .env a vyplň ho."
  exit 1
fi

# 3) závislosti
[ -d node_modules ] || npm install

# 4) uvoľni port 3000 a spusti server
PORT=$(grep -E '^PORT=' .env | cut -d= -f2); PORT=${PORT:-3000}
lsof -ti tcp:$PORT | xargs kill 2>/dev/null || true
echo "Spúšťam server na porte $PORT…"
node --env-file=.env server.js &
SERVER_PID=$!
# po ukončení (Ctrl+C) zastav aj server
trap "echo; echo 'Zastavujem…'; kill $SERVER_PID 2>/dev/null || true" EXIT INT TERM

# 5) počkaj kým server nabehne
until curl -s -o /dev/null "http://localhost:$PORT/login"; do sleep 0.3; done
echo "Server beží."
echo "--------------------------------------------------------"
echo "Nižšie sa objaví verejná adresa v tvare https://....trycloudflare.com"
echo "Tú pošli kolegom aj kuriérom. Admin je na nej priamo, heslo z .env."
echo "--------------------------------------------------------"

# 6) verejný tunel (beží, kým ho nezastavíš cez Ctrl+C)
cloudflared tunnel --url "http://localhost:$PORT"
