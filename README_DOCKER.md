# Running the app with Docker

Quick instructions to run the Next.js app in development or production using
Docker, and to deploy the production image to a cloud container host.

## Configuration & secrets

The app reads all configuration from **runtime** environment variables — nothing
is baked into the image. Required:

| Var | Purpose |
| --- | --- |
| `MONGODB_URI` | MongoDB connection string |
| `OPENAI_API_KEY` | OpenAI key — required for receipt parsing |
| `PDF_KEY` | CPF do titular (somente números) |

Copy `.env.example` to `.env.local` for local runs.

To override the bundled MongoDB credentials for local `docker compose`, set
`MONGO_USER` / `MONGO_PASSWORD` in a **root `.env` file** (or export them in your
shell) — *not* in `.env.local`. Compose resolves `${...}` interpolation from the
host environment and the root `.env` only; `.env.local` is loaded via `env_file`,
which affects the container's runtime env but never the Compose file itself.

## Local development (hot-reload)

```bash
docker compose --profile dev up --build
```

Builds the `dev` stage (full dependency tree, no production build), mounts the
project into the container, and runs `npm run dev` on port `3000`. A local
MongoDB starts alongside it.

The container's `node_modules` lives in an anonymous volume that is seeded from
the image the first time the container is created. If you changed dependencies —
or are coming from an older image — drop it so it is re-seeded:
`docker compose --profile dev down -v` (this also drops `mongo-data`) or
`docker volume rm` the anonymous volume listed by `docker volume ls -f dangling=true`.

## Local production build

```bash
docker compose --profile prod up --build
```

Builds the optimized standalone image (`runner` stage) and serves it on port
`3000`, reading secrets — including `MONGODB_URI` — from `.env.local`.

> **`.env.local` is required for the `web` target.** Compose loads it via
> `env_file`, so the `prod` profile fails if the file is missing. Copy
> `.env.example` to `.env.local` and fill in real values before starting.

`MONGODB_URI` is intentionally not set in the `web` service's `environment`
block: Compose gives `environment` precedence over `env_file`, so a hardcoded
value there would silently override the connection string you put in
`.env.local`. To target the bundled compose MongoDB, set it in `.env.local` to
`mongodb://admin:password@mongodb:27017/expenses?authSource=admin` (matching your
`MONGO_USER` / `MONGO_PASSWORD`).

The `app` (dev) and `web` (prod) services live in mutually exclusive Compose
profiles (`dev` / `prod`) because both bind host port `3000` — run one profile
at a time. A bare `docker compose up` (no `--profile`) starts only `mongodb`.
Against an empty database, seed the category collection once the app is up:
`curl -X POST http://localhost:3000/api/categories/seed`.

## Stopping

```bash
docker compose down --remove-orphans
```

A bare `docker compose down` only tears down services in the **active** profile
set, so it leaves the profiled `app`/`web` container running — which then blocks
network removal with `network ... has active endpoints`. Use `--remove-orphans`
(profile-agnostic, recommended) or match the profile you started with
(`docker compose --profile dev down` / `--profile prod down`). Add `-v` only if
you also want to drop the `mongo-data` volume (destroys the local database).

## Cloud deployment

The `runner` stage produces a small, non-root, health-checked image using
Next.js [standalone output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output).
It binds to `0.0.0.0` and honors the platform-provided `$PORT`.

```bash
docker build --target runner -t expenses:latest .
docker run --rm -p 3000:3000 --env-file .env.local expenses:latest
```

Notes for cloud hosts:

- **Do not** use the bundled `mongodb` compose service — point `MONGODB_URI` at a
  managed database (MongoDB Atlas, DocumentDB, etc.).
- Inject `MONGODB_URI`, `OPENAI_API_KEY`, and `PDF_KEY` via the platform's secret
  manager (Cloud Run secrets, ECS task secrets, Fly secrets), not into the image.
- The image exposes a `HEALTHCHECK` on `/`; wire it to the platform's liveness/
  readiness probe if desired.

## Releasing

Released images are published to `ghcr.io/prvalmeida/expenses` by
`.github/workflows/ci.yml`.

```bash
git checkout main && git pull
git tag v1.2.3          # must be an annotated or lightweight tag on main
git push origin v1.2.3
```

The tag **must be reachable from `main`** — the `verify-tag` job fails the run
otherwise, and neither the image nor the release is produced. Tags containing a
hyphen (`v2.0.0-rc.1`) are marked as prereleases and do **not** move `latest`.

Pull a published image with:

```bash
docker pull ghcr.io/prvalmeida/expenses:1.2.3
docker run --rm -p 3000:3000 --env-file .env.local ghcr.io/prvalmeida/expenses:1.2.3
```

### One-time setup after the first tag

The first GHCR push creates a **private package owned by the user, not the
repo**, so later runs fail with a permissions error until it is linked. This is
invisible from the workflow file and bites exactly once:

1. Open the package at `https://github.com/users/prvalmeida/packages/container/expenses/settings`.
2. Under **Manage Actions access**, add the `prvalmeida/expenses` repository with
   the `Write` role.
3. Under **Danger Zone → Change visibility**, set the package to public if it
   should be pullable without a GHCR login.
