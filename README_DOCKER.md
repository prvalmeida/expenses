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

Copy `.env.example` to `.env.local` for local runs. For local `docker compose`,
`MONGO_USER` / `MONGO_PASSWORD` override the bundled MongoDB credentials.

## Local development (hot-reload)

```bash
docker compose --profile dev up --build
```

Builds the `builder` stage, mounts the project into the container, and runs
`npm run dev` on port `3000`. A local MongoDB starts alongside it.

## Local production build

```bash
docker compose --profile prod up --build
```

Builds the optimized standalone image (`runner` stage) and serves it on port
`3000`, reading secrets from `.env.local`.

> **`.env.local` is required for the `web` target.** Compose loads it via
> `env_file`, so the `prod` profile fails if the file is missing. Copy
> `.env.example` to `.env.local` and fill in real values before starting.

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
