#!/usr/bin/env bash
# Spustí tento počítač ako verejný server s VYBRANOU subdoménou cez localtunnel.
# Adresa bude:  https://<SUBDOMENA>.loca.lt
# Použitie:  ./start-subdomain.sh            (subdoména z premennej nižšie)
#            ./start-subdomain.sh inemeno     (vlastná subdoména)
set -e
cd "$(dirname "$0")"

SUBDOMAIN="${1:-deliveryverification}"

if [ ! -f .env ]; then echo "Chýba .env"; exit 1; fi
[ -d node_modules ] || npm install

PORT=$(grep -E '^PORT=' .env | cut -d= -f2); PORT=${PORT:-3000}
lsof -ti tcp:$PORT | xargs kill 2>/dev/null || true

echo "Spúšťam server na porte $PORT…"
node --env-file=.env server.js &
SERVER_PID=$!
trap "echo; echo 'Zastavujem…'; kill $SERVER_PID 2>/dev/null || true" EXIT INT TERM
until curl -s -o /dev/null "http://localhost:$PORT/login"; do sleep 0.3; done
echo "Server beží."

echo "--------------------------------------------------------"
echo "Verejná adresa: https://$SUBDOMAIN.loca.lt"
echo "Link kuriéra:   https://$SUBDOMAIN.loca.lt/deliveryverification/<kód>"
echo
echo "POZOR: pri prvom otvorení loca.lt ukáže varovnú stránku."
echo "Treba na nej kliknúť na tlačidlo 'Click to Continue'."
echo "Heslo na tej stránke (ak ho pýta) je verejná IP tohto Macu:"
curl -s https://api.ipify.org || echo "(IP sa nepodarilo zistiť)"
echo
echo "--------------------------------------------------------"

# localtunnel cez npx (stiahne sa sám). Ak je subdoména obsadená, dostaneš náhodnú.
npx --yes localtunnel --port "$PORT" --subdomain "$SUBDOMAIN"
