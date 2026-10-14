# Deploying agentcut.studio

The website runs on the owner's box — the machine postgun.ai, refsplit and the rest run
on — as one node process under pm2, behind nginx, with Cloudflare proxying the domain to
that machine's address. The Postgres database `agentcut` is on the owner's database host,
reached straight over TCP from the app; there is no Hyperdrive and no certificate for
Cloudflare to verify in this path.

The Worker config (`../wrangler.jsonc`) stays, because `pnpm dev` and the tests run the
app in local workerd. It is not what production serves.

```
~/agentcut on the box          what it is
  .env                         the only secret: DATABASE_URL, and Clerk's keys when set
  dist/server.mjs              the site, bundled (src/node.ts + everything it imports)
  dist/migrate.mjs             the schema runner, bundled
  public/                      styles.css, fonts, images
  migrations/                  *.sql, applied in name order
  ecosystem.config.cjs         pm2: agentcut-web on port 3013
  nginx.conf, setup.sh         a copy of this folder's, so the box can set itself up again
```

## The first time

1. The database. The role `agentcut_app` owns the database `agentcut` on the owner's
   Postgres host; its password is `AGENTCUT_APP_PASSWORD` in the credentials file on the
   box, beside the other apps' roles.
2. `apps/web/deploy/deploy.sh` — it builds and sends everything, then fails at the schema
   step because `.env` does not exist yet. That is expected on a first run.
3. On the box: `cp ~/agentcut/env.example ~/agentcut/.env`, fill in `DATABASE_URL`, then
   `cd ~/agentcut && ./setup.sh` — the self-signed origin certificate, the nginx vhost,
   the migrations and the pm2 process, each only if it is missing.
4. DNS: `agentcut.studio` and `www` are proxied A records on the box's address, like
   `postgun.ai`. The zone's SSL mode is **Full**, because the origin certificate is
   self-signed.
5. Clerk, when there is a production instance: `CLERK_SECRET_KEY` and
   `CLERK_PUBLISHABLE_KEY` into `.env`, then `pm2 restart agentcut-web --update-env`.
   Without them the site is anonymous — browsing, searching and installing work, and
   `/login` says so. GitHub must be the instance's social connection, and
   `agentcut.studio` one of its domains.

## Every time after

```sh
apps/web/deploy/deploy.sh     # build, rsync, migrate, pm2 restart, smoke test
```

## When something is wrong

```sh
ssh refsplit-prod 'pm2 logs agentcut-web --lines 80 --nostream'
ssh refsplit-prod 'curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3013/'   # app, no nginx
ssh refsplit-prod 'sudo nginx -t && sudo systemctl reload nginx'
```

A 502 from Cloudflare with a healthy `127.0.0.1:3013` is nginx or the certificate; a 500
from the app with nginx fine is almost always `DATABASE_URL`.
