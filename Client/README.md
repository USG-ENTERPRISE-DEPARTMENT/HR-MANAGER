<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/b55c5182-49a2-4ab2-95d8-718e09068308

## Run Locally (client only)

**Prerequisites:**  Node.js

1. Install dependencies:
   `npm install`
2. Run the app:
   `npm run dev`

The client is the front end of a full-stack HR system. It expects the API
server (in the sibling `Server/` folder) to be running. For a complete
deployment, follow the guide below.

---

## Testing the API (smoke suite)

Instead of clicking through every screen, run the per-module smoke tests. They hit the **running** API
over HTTP (auth, routing, permission guards, CRUD round-trips) and report pass/fail per module. Great
for catching regressions and for confirming the app works identically on MySQL and Postgres.

```bash
cd Server
npm run smoke                 # run every module (exit code 1 if any check fails)
node smoke/run.js salary      # run a single module
node smoke/run.js salary leave payroll   # run several
node smoke/run.js --list      # list all module names
```

**Prerequisites:** the API server must be running (`npm run dev`) and the database seeded (a
`super-admin` login must exist — see step 4 of the full setup). Override the target/credentials with the
`SMOKE_BASE_URL`, `SMOKE_EMAIL`, and `SMOKE_PASSWORD` env vars if needed.

Tests only ever create temporary `ZZ_`-prefixed records and delete them afterward, so they are safe to
run against a real database and safe to re-run. Full details and how to add a module:
[`Server/smoke/README.md`](../Server/smoke/README.md).

---

# Full Setup on a New Server

This sets up the whole stack — MySQL database, the Express API (`Server/`), and
the React/Vite client (`Client/`) — from scratch on a fresh machine.

## 1. Prerequisites

Install these on the server first:

- **Node.js 20+** and npm (`node -v`, `npm -v`)
- **MySQL 8+** (or MariaDB 10.5+) — the default database — reachable from the server.
  PostgreSQL 14+ is also supported (see [Switching between MySQL and Postgres](#switching-between-mysql-and-postgres)).
- **Git**
- A reverse proxy for production (nginx, IIS, Caddy, …) — optional for local

## 2. Get the code

```bash
git clone <your-repo-url> HR
cd HR
```

The repo has two apps:

| Folder    | What it is                          | Default port |
|-----------|-------------------------------------|--------------|
| `Server/` | Express + Prisma API + cron jobs    | `3050`       |
| `Client/` | React 19 + Vite front end           | `3002` (dev) |

## 3. Create the database

Create an empty MySQL database and a user with full rights on it:

```sql
CREATE DATABASE xhrm CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'hr'@'%' IDENTIFIED BY 'a-strong-password';
GRANT ALL PRIVILEGES ON xhrm.* TO 'hr'@'%';
FLUSH PRIVILEGES;
```

The schema is applied by Prisma in step 4 — you do **not** import a SQL dump.

## 4. Set up the API server (`Server/`)

```bash
cd Server
npm install
```

Create a `Server/.env` file. The required keys (see the existing `.env` for the
full list, including optional SMTP / GL-posting / employee-sync integrations):

```dotenv
PORT=3050
NODE_ENV=production
LOG_LEVEL=info

# Public URL of the client app — used in emails (e.g. the "Sign In" link in the
# new-user welcome email). Set this to your real app URL in production.
FRONTEND_URL=https://hr.your-company.com

# Prisma connection string — must match the DB/user created above
DATABASE_URL="mysql://hr:a-strong-password@localhost:3306/xhrm"

# Auth secrets — generate long random strings (e.g. `openssl rand -hex 32`)
ACCESS_TOKEN_SECRET=<random>
REFRESH_TOKEN_SECRET=<random>
JWT_SECRET=<random>
JWT_EXPIRES_IN=1d
API_KEY=<random>

# Optional integrations (leave blank to disable):
# SMTP_HOST / SMTP_PORT / SMTP_SECURE / SMTP_USER / SMTP_PASS / SMTP_FROM
# EMPLOYEE_SYNC_URL
# POSTING_API_URL / POSTING_API_KEY / POSTING_API_SECRET / POSTING_CHANNEL_CODE / ...
# PAYROLL_EXPENSE_GL / PAYROLL_DEDUCTION_GL / PAYROLL_NET_PAYABLE_GL

# Offline AI assistant (optional — see section 8):
# AI_ENABLED / OLLAMA_BASE_URL / OLLAMA_CHAT_MODEL / OLLAMA_EMBED_MODEL
```

Generate the Prisma client and create all tables:

```bash
npx prisma generate
npx prisma db push      # creates the schema in the empty database
```

Seed the baseline data. Run these once, in order:

```bash
node src/prisma/seed.js              # roles, permissions, and the default super-admin login
node src/prisma/seedPermissions.js   # syncs to the current canonical permission catalog + role grants
node src/prisma/seedCodeLists.js     # reference lists: titles, genders, nationalities, etc.
```

`seed.js` (also runnable via `npx prisma db seed`) creates the four system roles
and the **super-admin** user. `seedPermissions.js` then reconciles permissions to
the latest catalog (it is safe to re-run any time the permission list changes).

Start the API:

```bash
npm run start        # production (node server.js)
# or
npm run dev          # development (nodemon, auto-restart)
```

The API now listens on `http://<server>:3050`. Uploaded files are stored under
`Server/uploads/` and served from there — make sure that folder is writable and
persisted (back it up / mount a volume).

### Smoke tests

Once the server is running and seeded, verify any module with `npm run smoke` (from `Server/`) instead
of clicking through it — see [Testing the API](#testing-the-api-smoke-suite) above.

### Switching between MySQL and Postgres

The API runs on **either MySQL or PostgreSQL** — the query layer is database-agnostic. Which one is
"live" is decided by **which Prisma client is generated**, not by editing `.env`. Each schema file
hardwires its own provider *and* which env var it reads:

| Schema file                          | Provider     | Reads env var  |
|--------------------------------------|--------------|----------------|
| `src/prisma/schema.prisma`           | `mysql`      | `DATABASE_URL` |
| `src/prisma/schema.postgres.prisma`  | `postgresql` | `PG_URL`       |

Keep **both** connection strings in `Server/.env` at all times — you do **not** edit them to switch:

```dotenv
DATABASE_URL="mysql://hr:password@localhost:3306/xhrm"
PG_URL="postgresql://postgres:password@localhost:5432/xhrm"
```

Switch by regenerating the client (helper scripts in `Server/package.json`):

```bash
npm run db:which        # show the currently active provider
npm run db:use-mysql    # regenerate the Prisma client for MySQL
npm run db:use-pg       # regenerate the Prisma client for Postgres
```

**Full switch procedure:**

1. **Stop the server** (Ctrl+C) — on Windows a running server locks the Prisma client file.
2. `npm run db:use-pg`  (or `npm run db:use-mysql`)
3. **Restart** the server (`npm run dev` / `npm run start`).

> The MySQL client only ever reads `DATABASE_URL`; the Postgres client only ever reads `PG_URL`.
> So changing `PG_URL` has **no effect** while the MySQL client is active — you must regenerate.
> Unsure which DB you're on? Run `npm run db:which`.

**First-time Postgres setup.** Postgres does not auto-create the database, so create it, then push the
Postgres schema and seed it:

```bash
# 1. create the empty database (run once)
psql -h <host> -U postgres -c "CREATE DATABASE xhrm;"

# 2. generate the PG client and create all tables
npm run db:use-pg
npx prisma db push --schema=src/prisma/schema.postgres.prisma

# 3. seed baseline + reference data
node src/prisma/seed.js
node src/prisma/seedCodeLists.js
```

Notes:
- `schema.postgres.prisma` is derived from `schema.prisma` with Postgres-compatible adjustments
  (native types, lower-cased column maps, globally-unique constraint names). **If you change the MySQL
  schema, mirror the change in the Postgres schema** (or regenerate it from `schema.prisma`).
- Runtime schema/DDL patches (`safeAlter`, some seed scripts) are MySQL-specific and are skipped
  automatically on Postgres — the tables already exist from `prisma db push`.

## 5. Set up the client (`Client/`)

```bash
cd ../Client
npm install
```

**Point the client at the API.** In dev, Vite proxies `/v1/api/hr` and
`/uploads` to `http://localhost:3050` — if your API runs elsewhere, edit the
`target` in [`Client/vite.config.ts`](vite.config.ts).

Run it:

```bash
npm run dev          # dev server on http://<server>:3002 (host 0.0.0.0)
```

For production, build static files and serve them behind your reverse proxy:

```bash
npm run build        # outputs to Client/dist
npm run preview      # optional: preview the production build locally
```

## 6. Production wiring (recommended)

Put both apps behind one reverse proxy on a single hostname so the browser sees
one origin (no CORS, public QR/onboarding links resolve correctly):

- Serve `Client/dist` as the site root (`/`).
- Proxy `/v1/api/hr` and `/uploads` to the API at `http://127.0.0.1:3050`.
- Run the API with a process manager (`pm2 start server.js --name hr-api`) so it
  restarts on reboot. Cron jobs (auto-absent marking, daily digests) run inside
  the API process, so it must stay up.

> The self-onboarding and attendance-kiosk links are built from the server's
> LAN IP / the browser's origin. Behind a real domain they use that domain
> automatically; on a bare server make sure the chosen port is reachable and the
> firewall allows it.

## 7. First login & verification

1. Open the client URL and log in with the seeded **super-admin** account:
   - **Username:** `superadmin@usg.com`
   - **Password:** `pass1234`

   **Change this password immediately after first login.**
2. Go to **Settings → Email Setup** to configure SMTP and send a test email.
3. Sanity-check: `GET http://<server>:3050/v1/api/hr/health` returns
   `{ "status": "ok" }`.
4. Run `npm run lint` in `Client/` (type-check) and confirm the API console shows
   `🚀 Server running on port 3050`.

---

## 8. Offline AI assistant (optional)

The AI features run **fully offline** against a local [Ollama](https://ollama.com)
server — no data ever leaves the machine and there is no API key or cloud account.
Ollama exposes an OpenAI-compatible endpoint that the API talks to for:

- **Assistant** — the in-app chat (answers from your help content, AI Knowledge,
  and active company documents via retrieval / RAG)
- **Drafting** — AI-assisted text (emails, descriptions, etc.)
- **Document OCR** — extract text from uploaded documents
- **Insights** — attrition / analytics summaries

If you skip this section, the rest of the app works normally; AI panels just show
"AI is disabled / unavailable."

### 8.1 Install Ollama

Download and install for your OS from <https://ollama.com/download> (Windows,
macOS, and Linux). It runs as a background service listening on
`http://localhost:11434`. Verify:

```bash
ollama --version
curl http://localhost:11434/api/tags     # returns JSON (an empty model list at first)
```

> Runs on CPU out of the box (a GPU just makes it faster). Budget ~4–6 GB free RAM
> for the default models below, plus disk for the one-time model downloads.

### 8.2 Pull the models

Pull the default chat and embedding models (the embedding model powers knowledge
search and is **required** for the assistant):

```bash
ollama pull llama3.2:3b        # chat model  (OLLAMA_CHAT_MODEL)
ollama pull nomic-embed-text   # embeddings  (OLLAMA_EMBED_MODEL)
```

You can swap in any other Ollama models later — just pull them and set the names
in the env (below) or in **Settings → AI**. (Document OCR needs a **vision-capable**
model, e.g. `ollama pull llama3.2-vision`, if you enable that feature.)

### 8.3 Configure the API

Add these to `Server/.env` (all optional — shown with their built-in defaults, so
you only need `AI_ENABLED=true` if Ollama is on the same host with the default models):

```dotenv
AI_ENABLED=true
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_CHAT_MODEL=llama3.2:3b
OLLAMA_EMBED_MODEL=nomic-embed-text
```

Point `OLLAMA_BASE_URL` at another host if Ollama runs on a separate machine.
Restart the API after changing these.

> These are just bootstrap defaults. At runtime, **Settings → AI** overrides them
> (stored in the DB) and lets an admin toggle each capability — assistant, drafting,
> ocr, insights — independently, without editing `.env`.

### 8.4 Load the knowledge index

The assistant retrieves answers from an embedded index built from your help
content, in-app **AI Knowledge** entries, active company documents, and any files
you drop in [`Server/src/data/knowledge/`](../Server/src/data/knowledge/)
(`.md`, `.txt`, or `.json` — see the README there).

The index **auto-builds on server startup when empty**. After editing knowledge
files or content, rebuild it via **Settings → AI → Reindex knowledge**.

### 8.5 Verify

```bash
curl http://<server>:3050/v1/api/hr/ai/health
```

A healthy response reports `ok: true`, the configured models, and
`chatReady` / `embedReady` = `true` (both become `true` once the models from
step 8.2 are pulled). Then open the in-app **AI Assistant** and ask a question.
