# AI Task Platform — Application Repo

Small AI task processing platform: users submit text-processing jobs, a Python
worker runs them asynchronously, and the React UI reflects status and result.

This repo holds the **application code**. Kubernetes manifests live in
[`ai-task-platform-infra`](https://github.com/kingdrowjin/ai-task-platform-infra).

## Stack

| Component | Tech                          |
| --------- | ----------------------------- |
| Frontend  | React 18 + Vite, served by nginx |
| Backend   | Node.js 20 + Express          |
| Worker    | Python 3.12                   |
| Database  | MongoDB 7                     |
| Queue     | Redis 7 (LPUSH / BRPOP list)  |

## Supported operations

`uppercase`, `lowercase`, `reverse`, `word_count`.

## Run locally with docker-compose

```bash
cp .env.example .env
# Edit .env and set a real JWT_SECRET (e.g. `openssl rand -hex 32`)

docker compose up --build
```

Then open:

- Frontend: http://localhost:5173
- Backend health: http://localhost:4000/health/livez

Register an account on the frontend, create a task, watch it move from
`pending → running → success` (or `failed`) in real time.

## Run services individually (dev)

Backend:
```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

Worker:
```bash
cd worker
cp .env.example .env
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python worker.py
```

Frontend:
```bash
cd frontend
npm install
npm run dev
```

You'll need MongoDB and Redis running locally (use the docker-compose `mongo`
and `redis` services, or install natively).

## API surface

| Method | Path                | Auth | Purpose                       |
| ------ | ------------------- | ---- | ----------------------------- |
| POST   | `/api/auth/register`| No   | Register new user             |
| POST   | `/api/auth/login`   | No   | Login, returns JWT            |
| POST   | `/api/tasks`        | Yes  | Create task, queues for worker |
| GET    | `/api/tasks`        | Yes  | List current user's tasks     |
| GET    | `/api/tasks/:id`    | Yes  | Task detail (status, logs, result) |
| GET    | `/health/livez`     | No   | Liveness probe                |
| GET    | `/health/readyz`    | No   | Readiness probe (db + redis)  |

## Security

- Passwords hashed with bcrypt (cost 12).
- JWT auth with shared secret stored in a Kubernetes Secret (or `.env` locally).
- `helmet` middleware on all routes.
- Rate limiting: 20 req / 15 min on `/api/auth/*`, 120 req / min on the rest of `/api`.
- No secrets in repo — `.env.example` ships placeholders only.
- Containers run as non-root. Backend & frontend use read-only root filesystem in k8s.

## CI/CD

`.github/workflows/ci.yml` runs on every push to `main`:

1. Lint (eslint for JS, ruff for Python).
2. Build multi-arch images for backend, worker, frontend.
3. Push to GHCR with two tags: `latest` and the short commit SHA.
4. Check out the infra repo, run `kustomize edit set image` to bump the
   production overlay's image tags, and commit the change.
5. Argo CD sees the infra commit and rolls out the new images automatically.

Required secrets in the GitHub repo:

- `INFRA_REPO_TOKEN` — fine-grained PAT with write access to the infra repo
  (or use a GitHub App token in production).

## Deployment

See the infra repo's README for k3s / Argo CD setup. Short version: install
Argo CD, apply `argocd/application-production.yaml`, push code, watch it
deploy itself.

## Architecture document

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for scaling strategy,
high-volume handling, indexing, Redis failure modes, and staging/prod
deployment topology.
