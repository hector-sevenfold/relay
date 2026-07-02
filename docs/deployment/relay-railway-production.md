# Relay Railway Production Deployment

Target production hostname: `relay.sevenfold.io`

Scope lock:
- This document is deployment preparation only.
- No new product features are introduced here.
- Relay remains a single Railway web service serving the protected admin UI plus public RSS feeds.

## 1. Railway deployment configuration

Added to repo:
- `railway.json`
- `nixpacks.toml`

What they do:
- build with Nixpacks
- run `npm install`
- build frontend assets with `npm run build`
- start the app with `npm run start`
- health check using `/api/health`
- restart on failure

## 2. Required and optional environment variables

Production-required:
- `ADMIN_PASSWORD`

Usually leave unset on Railway:
- `PORT`
  - Railway injects the runtime port automatically.

Optional overrides:
- `DATABASE_PATH`
- `DATA_DIR`

Recommended production setup:
- Set `ADMIN_PASSWORD` only.
- Do not set `DATABASE_PATH` or `DATA_DIR` unless you intentionally want a non-default storage path.
- Let the app use Railway's mounted volume path automatically.

Database path resolution order in code:
1. `DATABASE_PATH`
2. `DATA_DIR/rss-feed-generator.db`
3. `RAILWAY_VOLUME_MOUNT_PATH/rss-feed-generator.db`
4. `./data/rss-feed-generator.db`

## 3. Persistent volume requirement

Relay uses SQLite and must have persistent storage in production.

Recommended Railway volume configuration:
- Attach one persistent volume to the Relay service
- Mount path: `/app/data`

Expected persisted database path:
- `/app/data/rss-feed-generator.db`

Why this works:
- Railway exposes `RAILWAY_VOLUME_MOUNT_PATH` for attached volumes
- Relay already resolves the SQLite path from that environment when present
- This keeps feed/client data durable across restarts and deploys

Volume verification after deploy:
1. Open Railway service logs
2. Confirm startup logs print a database path under `/app/data/` or the mounted volume path
3. Create or edit a client in Relay
4. Restart the service
5. Confirm the client still exists after restart

## 4. Authentication verification

Current production auth model:
- HTTP Basic Auth protects:
  - `/`
  - frontend assets
  - admin API routes under `/api/*` except `/api/health`
- Public without auth:
  - `/api/health`
  - `/feeds/:slug.xml`

Expected production behavior:
- `GET /` -> `401` until valid Basic Auth credentials are supplied
- `GET /api/clients` -> `401` without auth
- `GET /api/health` -> `200` without auth
- `GET /feeds/<client-slug>.xml` -> `200` without auth for enabled clients

Login format:
- username: any value
- password: must match `ADMIN_PASSWORD`

## 5. Public RSS endpoint verification

Public feed contract:
- Enabled client feed URL: `/feeds/{client_slug}.xml`
- Feed route must remain public so WordPress and client portals can consume it

Verify after deploy:
1. Open `https://relay.sevenfold.io/feeds/<client-slug>.xml` in a clean browser session
2. Confirm no auth prompt appears
3. Confirm RSS XML renders or downloads successfully
4. Confirm item links point to publisher URLs rather than protected admin routes

## 6. Scheduled refresh behavior on Railway

Current production model:
- Relay uses one in-process scheduler inside the web server
- The scheduler checks every minute
- Due enabled clients refresh automatically based on each client's configured interval
- No separate worker or cron service is required for this version

Operational implications:
- one Railway web service is sufficient
- if the service restarts, the scheduler resumes automatically
- scheduled refresh depends on the main server process staying up

Verify after deploy:
1. Ensure at least one enabled client has a scheduled refresh interval
2. Run one manual refresh first so baseline data exists
3. Wait past the next due interval
4. Confirm `last_refreshed_at` advances automatically
5. Confirm source health and article cache update as expected

## 7. Railway deployment checklist

Before first production deploy:
- [ ] Repo contains `railway.json`
- [ ] Repo contains `nixpacks.toml`
- [ ] `npm install` works from root
- [ ] `npm run build` succeeds
- [ ] `npm run start` succeeds locally
- [ ] `ADMIN_PASSWORD` chosen and stored in Railway variables
- [ ] Railway persistent volume attached
- [ ] Railway volume mount path set to `/app/data`
- [ ] Public networking enabled
- [ ] Railway-generated domain tested before custom domain cutover

During deploy:
- [ ] Create Railway project/service from repo
- [ ] Confirm build command completes
- [ ] Confirm service starts successfully
- [ ] Confirm `/api/health` returns `200`
- [ ] Confirm startup logs show the SQLite database path

After deploy:
- [ ] Confirm `/` prompts for Basic Auth
- [ ] Confirm `/api/clients` requires auth
- [ ] Confirm `/api/health` remains public
- [ ] Confirm `/feeds/<client-slug>.xml` remains public
- [ ] Confirm one manual refresh works
- [ ] Confirm data persists after service restart

## 8. DNS instructions for `relay.sevenfold.io`

Use Railway's custom-domain flow.

Recommended order:
1. Deploy Relay and verify it on the generated Railway domain first
2. In Railway, open the Relay service
3. Go to Networking / Public Networking
4. Add custom domain: `relay.sevenfold.io`
5. Railway will provide the exact DNS records required for that service
6. In your DNS provider for `sevenfold.io`, add:
   - the CNAME record Railway provides for `relay`
   - the TXT verification record Railway provides
7. Wait for Railway to validate the domain and provision SSL
8. Re-test the site on `https://relay.sevenfold.io`

Important:
- Use the exact record values Railway shows at deploy time
- Do not guess the CNAME target
- Keep the Railway-generated domain active until `relay.sevenfold.io` is verified and serving HTTPS correctly

Expected final URLs:
- Admin UI: `https://relay.sevenfold.io/`
- Health: `https://relay.sevenfold.io/api/health`
- Feed URLs: `https://relay.sevenfold.io/feeds/{client_slug}.xml`

## 9. Post-deployment checklist

Immediately after production is live:
- [ ] Create the first admin password in Railway as `ADMIN_PASSWORD`
- [ ] Log into `https://relay.sevenfold.io/`
- [ ] Create real clients
- [ ] Configure real categories and sources
- [ ] Verify each client RSS URL
- [ ] Run the first manual refresh for each real client
- [ ] Verify source health status for each client
- [ ] Confirm article links open original publisher pages
- [ ] Test at least one WordPress or client-portal integration against a live feed URL

Recommended first-usage validation:
- [ ] Confirm at least one Google News-backed client feed works end to end
- [ ] Confirm at least one direct RSS-backed client source works end to end
- [ ] Confirm a disabled client feed returns `404`
- [ ] Confirm refresh results persist across a restart
- [ ] Confirm scheduled refresh advances without manual intervention

## 10. Production smoke-test commands

Replace placeholders before running.

Health endpoint:

```bash
curl -i https://relay.sevenfold.io/api/health
```

Protected admin route should challenge:

```bash
curl -i https://relay.sevenfold.io/
```

Protected API should challenge:

```bash
curl -i https://relay.sevenfold.io/api/clients
```

Protected API with auth should pass:

```bash
curl -i -u anyuser:YOUR_ADMIN_PASSWORD https://relay.sevenfold.io/api/clients
```

Public feed should work without auth:

```bash
curl -i https://relay.sevenfold.io/feeds/YOUR_CLIENT_SLUG.xml
```

## 11. Verified local pre-deploy expectations

Local production verification should confirm:
- production build succeeds
- admin auth gates the UI and admin APIs
- `/api/health` is public
- public RSS feed route is accessible without auth
- scheduler logic refreshes due clients while the server process is running

This is the last preparation step before actual Railway deployment.
