# Running the app with Docker

Quick instructions to run the Next.js app in development or production using Docker Compose.

Development (hot-reload):

```bash
docker compose up --build app
```

This builds the image (target `builder`) and mounts the project folder into the container so edits on the host are reflected live. The dev server runs `npm run dev` and is exposed on port `3000`.

Production (build once, run optimized):

```bash
docker compose up --build web
```

This builds the app (runs `npm run build`) and starts the production server via `npm run start` on port `3000`.

Notes:
- If your project uses `pnpm` or `yarn`, adjust the commands in `Dockerfile` and `docker-compose.yml` accordingly.
- If you need to pass environment variables, add them to `docker-compose.yml` or use an `.env` file and reference it.
