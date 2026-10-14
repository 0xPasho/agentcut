#!/usr/bin/env bash
#
# One-time setup of the website on the owner's box. Idempotent: run it again after a
# change to nginx.conf or the pm2 file, it will not undo anything.
#
#   apps/web/deploy/deploy.sh      # sends dist/, public/, migrations/ and this folder
#   ssh <box> 'cd ~/agentcut && ./setup.sh'
#
# What it does: the self-signed origin certificate (Cloudflare proxies the domain and
# talks to this vhost over TLS, as it does for postgun.ai), the nginx vhost, and the pm2
# process. It never writes .env — that one is the owner's, from env.example.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
DOMAIN=${DOMAIN:-agentcut.studio}
SSL_DIR=/etc/nginx/ssl/agentcut
export PATH="$HOME/.nvm/versions/node/v22.21.1/bin:$PATH"

cd "$DIR"
test -f .env || { echo "No $DIR/.env — copy env.example and fill in DATABASE_URL first."; exit 1; }
test -f dist/server.mjs || { echo "No bundle in $DIR/dist — run deploy.sh from a checkout first."; exit 1; }

echo "==> Origin certificate"
if sudo test -f "$SSL_DIR/fullchain.pem"; then
  echo "    already at $SSL_DIR"
else
  sudo mkdir -p "$SSL_DIR"
  sudo openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
    -keyout "$SSL_DIR/privkey.pem" -out "$SSL_DIR/fullchain.pem" \
    -subj "/CN=$DOMAIN" -addext "subjectAltName=DNS:$DOMAIN,DNS:www.$DOMAIN"
  sudo chmod 600 "$SSL_DIR/privkey.pem"
fi

echo "==> nginx"
sudo cp "$DIR/nginx.conf" /etc/nginx/sites-available/agentcut
sudo ln -sfn /etc/nginx/sites-available/agentcut /etc/nginx/sites-enabled/agentcut
sudo nginx -t
sudo systemctl reload nginx

echo "==> Schema"
node --env-file=.env dist/migrate.mjs

echo "==> pm2"
if pm2 describe agentcut-web >/dev/null 2>&1; then
  pm2 restart agentcut-web --update-env
else
  pm2 start "$DIR/ecosystem.config.cjs"
fi
pm2 save
sleep 3
pm2 list --no-color | grep agentcut-web

echo "==> Smoke"
printf '  %-40s %s\n' "http://127.0.0.1:3013/" "$(curl -s -o /dev/null -w '%{http_code}' -m 20 http://127.0.0.1:3013/)"
printf '  %-40s %s\n' "http://127.0.0.1:3013/api/packs" "$(curl -s -o /dev/null -w '%{http_code}' -m 20 http://127.0.0.1:3013/api/packs)"
