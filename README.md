# RSS Feed Generator

Simple multi-client RSS feed generator for client-specific news feeds.

Stack:
- Node.js + Express
- React + Vite
- SQLite via better-sqlite3
- In-process refresh scheduler

## What this version includes

- Modular source architecture
- Per-client public RSS feeds at `/feeds/:clientSlug.xml`
- Protected admin/dashboard UI and admin APIs via `ADMIN_PASSWORD`
- SQLite persistence
- 15-minute scheduled refresh while the Node server is running
- Manual per-client refresh
- Source-level refresh and health reporting

## Public vs protected routes

Public:
- `GET /feeds/:clientSlug.xml`
- `GET /api/health`

Protected when `ADMIN_PASSWORD` is set:
- the dashboard UI
- all admin/API routes other than `/api/health`
- built frontend assets

Authentication uses HTTP Basic Auth. The username can be anything; the password must match `ADMIN_PASSWORD`.

## Environment variables

Copy `.env.example` to `.env` for local use if you want explicit configuration.

Required for protected admin access:
- `ADMIN_PASSWORD`

Optional:
- `PORT` - defaults to `8788`
- `DATABASE_PATH` - absolute or relative path to the SQLite file
- `DATA_DIR` - directory where `rss-feed-generator.db` should be created

Database path resolution order:
1. `DATABASE_PATH`
2. `DATA_DIR/rss-feed-generator.db`
3. `RAILWAY_VOLUME_MOUNT_PATH/rss-feed-generator.db`
4. `./data/rss-feed-generator.db`

## Local development

Install root dependencies:

```bash
npm install
```

The root `postinstall` script also installs the frontend dependencies.

Run the app in development:

```bash
npm run dev
```

Build production assets:

```bash
npm run build
```

Run the production server:

```bash
npm run start
```

## Clean-install production smoke test

From a fresh checkout:

```bash
npm install
npm run build
ADMIN_PASSWORD=change-me npm run start
```

Then check:

```bash
curl http://127.0.0.1:8788/api/health
curl -u anyuser:change-me http://127.0.0.1:8788/api/clients
```

## Railway deployment

This app is ready to run as a single Railway service.

Detailed production deployment runbook:
- `docs/deployment/relay-railway-production.md`

Target production hostname for Sevenfold:
- `relay.sevenfold.io`

### 1) Create the service

- Create a new Railway project/service from this repo.
- Railway can use the default Node build flow.

Recommended commands:
- Build command: `npm run build`
- Start command: `npm run start`

`npm install` installs both root and frontend dependencies because the root package runs `npm --prefix frontend install` during `postinstall`.

### 2) Add environment variables

Set at least:

- `ADMIN_PASSWORD` = a strong password
- `PORT` = leave unset unless you want to override Railway's port injection

Optional:
- `DATABASE_PATH`
- `DATA_DIR`

Usually you do not need to set `DATABASE_PATH` or `DATA_DIR` on Railway if you mount the volume at the path described below.

### 3) Add a persistent volume for SQLite

Railway volumes are mounted at runtime, not build time. Railway also exposes `RAILWAY_VOLUME_MOUNT_PATH` automatically for attached volumes.

Recommended setup:
- Attach one volume to this service
- Mount path: `/app/data`

Why `/app/data`:
- Railway documents that app files live under `/app`
- if your app writes to `./data`, the matching persistent mount path should be `/app/data`
- this app automatically detects `RAILWAY_VOLUME_MOUNT_PATH` and stores the database there as `rss-feed-generator.db`

With that mount path, SQLite will persist at:

```text
/app/data/rss-feed-generator.db
```

### 4) Public networking

Enable Public Networking for the service.

After deploy:
- admin UI will be behind HTTP Basic Auth using `ADMIN_PASSWORD`
- feed URLs remain public, for example:
  - `https://your-domain-or-railway-domain/feeds/client-slug.xml`

### 5) Scheduled refresh behavior on Railway

No separate worker is required for this version.

The server runs an in-process scheduler that checks every minute and refreshes due client feeds. Scheduled refreshes continue to run as long as the Node server process is alive.

That means:
- one web service is enough
- no cron service is required for the current deployment target
- if the server restarts, the scheduler resumes automatically on boot

## Custom domain setup on Railway

Railway public networking supports both generated Railway domains and custom domains.

High-level flow:
1. Open the service in Railway
2. Go to Settings -> Networking -> Public Networking
3. Generate a Railway domain first to verify the deployment
4. Add your custom domain
5. Railway will show the required DNS records
6. Add both records at your DNS provider:
   - the CNAME record Railway provides
   - the TXT record Railway provides
7. Wait for Railway to validate DNS and provision SSL

Recommended pattern:
- Put the admin UI on your main domain, for example `feeds.example.com`
- Use public feed URLs under that same host, for example `https://feeds.example.com/feeds/acme.xml`

## Notes for WordPress / client portals

Each enabled client exposes a public feed URL:

```text
/feeds/{client_slug}.xml
```

These feed URLs do not require the admin password and are intended for downstream consumers like WordPress, Feedzy, or client portals.

## Deployment checklist

Before shipping:
- set `ADMIN_PASSWORD`
- mount a persistent Railway volume at `/app/data`
- run one successful deploy
- verify `/api/health`
- verify admin login prompt appears on `/`
- verify `/feeds/<client-slug>.xml` loads without auth
- verify a manual refresh works after deploy
- verify articles persist after a restart
