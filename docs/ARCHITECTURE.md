# AI Task Platform — Architecture

## 1. System overview

```
                                ┌─────────────┐
                  HTTPS         │   Ingress   │   nginx + TLS
            ────────────────────│   /  /api   │
                                └──────┬──────┘
                          ┌────────────┴────────────┐
                          ▼                          ▼
                   ┌──────────────┐          ┌──────────────┐
                   │  Frontend    │          │   Backend    │
                   │  (React/Vite │          │  (Express,   │
                   │   served by  │          │   JWT auth,  │
                   │   nginx)     │          │   helmet,    │
                   │  3 replicas  │          │   ratelimit) │
                   └──────────────┘          │  3 replicas  │
                                             └──────┬───────┘
                                                    │ LPUSH / read
                                ┌───────────────────┼────────────────┐
                                ▼                   ▼                ▼
                        ┌──────────────┐    ┌──────────────┐  ┌─────────────┐
                        │   MongoDB    │    │    Redis     │  │   Worker    │
                        │ (StatefulSet,│    │ (StatefulSet,│  │  (Python)   │
                        │   PVC 5Gi)   │    │   PVC 1Gi,   │  │   HPA 2-10  │
                        └──────────────┘    │  AOF on)     │  └──────┬──────┘
                                            └──────┬───────┘         │ BRPOP
                                                   └─────────────────┘
```

Request flow for a task:
1. User submits a task in the UI.
2. Frontend calls `POST /api/tasks` with JWT.
3. Backend validates input, creates a `pending` task in MongoDB,
   and `LPUSH`es `{taskId}` onto the Redis list `tasks:queue`.
4. Backend returns the task immediately. UI polls `GET /api/tasks/:id`
   every 2 seconds.
5. A worker pod's `BRPOP` returns the job. Worker sets the task to
   `running`, runs the operation, and sets the final state to `success`
   or `failed`, appending log lines along the way.
6. Frontend's next poll surfaces the updated state.

Why a Redis list instead of BullMQ or RabbitMQ? BullMQ is Node-only; the
spec requires a Python worker, and a plain list with `BRPOP` is the
simplest cross-language pattern that still gives blocking pops, no
busy-wait, and durability if AOF is on. We trade off some BullMQ niceties
(retry backoff, delayed jobs) for clean interop. Retries are added at
the worker layer if needed (catch + re-LPUSH with attempt counter).

## 2. Worker scaling strategy

**Horizontal, stateless workers.** Each worker pod is a single Python
process that runs `BRPOP` against `tasks:queue`. Adding replicas adds
parallelism — Redis's `BRPOP` is atomic, so two workers never claim the
same job.

**Autoscaling.** A `HorizontalPodAutoscaler` keeps replicas between 2 and
10 based on CPU (target 70%) and memory (target 80%). For real workloads
we'd switch to **KEDA** with a `redis-list` scaler driven by queue depth
— that's the right signal for queue work; CPU lags. The HPA is the
assignment-friendly version that works without an extra controller.

**Graceful shutdown.** `worker.py` traps `SIGTERM` and finishes the
current job before exiting, so rolling deploys never abandon work
mid-flight. `terminationGracePeriodSeconds` defaults to 30s in k8s,
which is enough for the supported operations.

**Job lifecycle invariants.**
- A task is `pending` only between `LPUSH` and `BRPOP`.
- The DB write to flip `pending → running` is the worker's "I own this"
  signal. If a worker dies after `BRPOP` but before the DB update, the
  task stays `pending` in the DB but the job is gone from Redis. We
  detect this with a periodic reconciler (out of scope for v1, planned)
  that re-queues `pending` tasks older than N minutes.

## 3. Handling 100k tasks / day

100,000 tasks/day ≈ 1.16 tasks/sec average, with realistic peaks of
~10x that (~12 RPS) during business hours. A single worker handles
roughly 100 tasks/sec for our string operations (CPU-trivial), so we
are wildly over-provisioned even at peak. The bottlenecks are elsewhere:

| Bottleneck | Mitigation |
| ---------- | ---------- |
| Mongo write amplification (each task writes ~3-5 docs through its lifetime) | Use indexed updates only (we do); batch log appends if needed |
| Redis memory if backlog spikes | Cap input size at 10 KB (already enforced); set Redis `maxmemory` + `noeviction` so we fail fast instead of silently dropping |
| Frontend polling at 2s × N users | Switch to SSE / WebSockets in a future iteration; current cost is ~50 RPS per 100 active users on a single backend pod, well within budget |
| Auth route abuse | Rate limit (already in place: 20/15min on `/api/auth/*`) |

For 10x growth (1M/day), we'd:
1. Move workers behind KEDA with queue-depth scaling.
2. Shard Redis with Sentinel or move to Redis Cluster.
3. Add a Mongo replica set with reads from secondaries for the dashboard query.
4. Cap log array length per task (e.g., last 100 lines) to bound document growth.

## 4. Database indexing strategy

The `Task` collection is indexed for the two queries we actually run:

| Index | Why |
| ----- | --- |
| `{ user: 1, createdAt: -1 }` | Powers the dashboard list (`GET /api/tasks` filtered by user, sorted newest first) |
| `{ status: 1, createdAt: -1 }` | Powers the future reconciler that finds stale `pending` tasks |
| `{ user: 1 }` (single-field, in the model) | Quick user lookups, also used for cascade cleanup if a user is deleted |

The `User` collection has `{ email: 1 }` unique — the only query path
into it (login + duplicate-email check on register).

We deliberately do **not** index `result` or `logs`. They're large,
mutable, and never queried by content. Indexing them would balloon
the index size for no benefit.

## 5. Handling Redis failure

Redis is a single point of failure for new task submissions. Failure
modes and our handling:

| Failure | What happens | Mitigation |
| ------- | ------------ | ---------- |
| Redis pod restarts (k8s OOMKill, eviction) | Pending submissions in flight error out; AOF replay restores queued jobs | StatefulSet + PVC + AOF persistence keep the queue durable across restarts |
| Redis network partition | Backend's `enqueue` throws; we return 503 to the user, **but the task row is already created in MongoDB with status `pending`** | A reconciler job re-queues `pending` tasks once Redis recovers |
| Redis runs out of memory | `LPUSH` returns OOM error | We set `maxmemory` and `noeviction` so we fail loudly. The backend returns 503 immediately; we don't lose data |
| Redis data corruption | AOF replay on the next restart should recover | Daily Redis snapshot backups (RDB) to object storage |

For production-grade availability we'd run Redis Sentinel (3 nodes,
1 master + 2 replicas with automatic failover) or managed Redis. The
current single-node StatefulSet is fine for this assignment but would
not be acceptable for a real production deployment.

**Crucial design choice:** the task row is written to Mongo *before*
the Redis enqueue. This means we never lose a task record even if Redis
is unreachable — at worst, the task sits in `pending` until a reconciler
picks it up. The opposite ordering (enqueue first, write second) would
have created a window where a worker could pop a job for a task that
doesn't exist in the DB.

## 6. Staging and production deployment

Two Argo CD applications, two Kustomize overlays, one base.

```
infra-repo/overlays/
├── staging/    → ai-tasks-staging   namespace, prefix `stg-`,
│                 1 replica each, DEBUG logs, staging.* host, `staging` image tag
└── production/ → ai-tasks           namespace, default replicas,
                  INFO logs, ai-tasks.* host, image tag bumped by CI
```

**Promotion flow:**

1. Push to `main` in the app repo.
2. CI builds + pushes images tagged with the short commit SHA.
3. CI patches `overlays/production/kustomization.yaml` with the new SHA
   and commits to the infra repo.
4. Argo CD's `ai-tasks-production` Application sees the commit, syncs,
   rolls out new pods.

**Staging promotion** (manual, intentional):

- A separate workflow (or a manual `kustomize edit set image` PR) bumps
  the staging overlay's tag. We don't auto-bump staging on every commit
  because staging is meant for QA — let humans choose what lands there.

**Rollback:**

- `git revert` the offending infra commit. Argo CD redeploys the
  previous good image within ~30 seconds.
- Or use Argo CD's UI: select the previous Sync, click `Sync to this revision`.
- Or `kubectl rollout undo deploy/backend -n ai-tasks` for an immediate
  hot-rollback while we debug.

**Environment isolation:**

- Different namespaces (`ai-tasks` vs `ai-tasks-staging`).
- Separate Mongo + Redis StatefulSets per namespace — no shared data.
- Separate ingress hosts and TLS certs.
- Separate secrets (each cluster generates its own JWT secret).
- The same container images run in both — environment differences live
  entirely in ConfigMaps, not in the binary, so we test in staging
  exactly what runs in production.

## 7. Open work / explicit non-goals

- **Stale-job reconciler** is documented above but not implemented in
  v1. For this assignment scope it's acceptable; a real production
  system needs it.
- **Real-time updates** use polling (2s). Fine for the demo, would be
  SSE in a future iteration.
- **Audit logging** of who-ran-what beyond what's in the `Task.logs`
  array is out of scope.
- **Multi-region** is out of scope.
