#!/usr/bin/env bash
#
# Deploy the website. Run it from a checkout, not on the box:
#   apps/web/deploy/deploy.sh
#
# It builds here and sends the result, because the box has 9 GB free and no business
# installing a monorepo that carries Remotion and Next: node runs one bundled file.
#
#   AGENTCUT_DEPLOY_HOST   ssh host (default refsplit-prod, the owner's ~/.ssh/config)
#   AGENTCUT_DEPLOY_DIR    folder on the box (default agentcut, beside postgun)
set -euo pipefail

HOST=${AGENTCUT_DEPLOY_HOST:-refsplit-prod}
DIR=${AGENTCUT_DEPLOY_DIR:-agentcut}
cd "$(cd "$(dirname "$0")" && pwd)/.."

echo "==> Build"
pnpm build:css
node scripts/build-server.mjs

echo "==> Send to $HOST:$DIR"
ssh "$HOST" "mkdir -p '$DIR'"
rsync -az --delete dist/ "$HOST:$DIR/dist/"
rsync -az --delete public/ "$HOST:$DIR/public/"
rsync -az --delete migrations/ "$HOST:$DIR/migrations/"
rsync -az deploy/ecosystem.config.cjs deploy/nginx.conf deploy/setup.sh deploy/env.example "$HOST:$DIR/"

echo "==> Schema and restart"
ssh "$HOST" "export PATH=\$HOME/.nvm/versions/node/v22.21.1/bin:\$PATH; cd '$DIR' \
  && node --env-file=.env dist/migrate.mjs \
  && pm2 restart agentcut-web --update-env \
  && sleep 3 && pm2 list --no-color | grep agentcut-web"

echo "==> Smoke"
for u in https://agentcut.studio/ https://agentcut.studio/packs https://agentcut.studio/api/packs; do
  printf '  %-44s %s\n' "$u" "$(curl -s -o /dev/null -w '%{http_code}' -m 30 "$u")"
done
