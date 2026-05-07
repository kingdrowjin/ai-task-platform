"""AI Task Platform - Python worker.

Pops jobs from a Redis list, processes the operation, and updates the
MongoDB task document with status, result, and logs.
"""
import json
import logging
import os
import signal
import sys
import time
from datetime import datetime, timezone

import redis
from bson import ObjectId
from dotenv import load_dotenv
from pymongo import MongoClient
from pymongo.errors import PyMongoError

from operations import run_operation

load_dotenv()

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=LOG_LEVEL,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("worker")

MONGO_URI = os.environ["MONGO_URI"]
REDIS_HOST = os.getenv("REDIS_HOST", "redis")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
QUEUE_KEY = os.getenv("QUEUE_KEY", "tasks:queue")
WORKER_ID = os.getenv("WORKER_ID", "worker")
POLL_TIMEOUT = int(os.getenv("POLL_TIMEOUT", "5"))

_running = True


def _shutdown(signum, _frame):
    global _running
    log.info("received signal %s, shutting down", signum)
    _running = False


signal.signal(signal.SIGTERM, _shutdown)
signal.signal(signal.SIGINT, _shutdown)


def now() -> datetime:
    return datetime.now(timezone.utc)


def connect_redis() -> redis.Redis:
    while _running:
        try:
            client = redis.Redis(
                host=REDIS_HOST,
                port=REDIS_PORT,
                socket_keepalive=True,
                health_check_interval=30,
                decode_responses=True,
            )
            client.ping()
            log.info("redis connected at %s:%s", REDIS_HOST, REDIS_PORT)
            return client
        except redis.RedisError as exc:
            log.warning("redis connection failed: %s — retrying in 5s", exc)
            time.sleep(5)
    sys.exit(0)


def connect_mongo() -> MongoClient:
    client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=10000)
    client.admin.command("ping")
    log.info("mongo connected")
    return client


def append_log(tasks_col, task_id: ObjectId, message: str) -> None:
    line = f"{now().isoformat()} [{WORKER_ID}] {message}"
    tasks_col.update_one({"_id": task_id}, {"$push": {"logs": line}})


def process_job(tasks_col, payload: dict) -> None:
    task_id_str = payload.get("taskId")
    if not task_id_str:
        log.error("job missing taskId: %s", payload)
        return

    try:
        task_id = ObjectId(task_id_str)
    except Exception:
        log.error("invalid taskId: %s", task_id_str)
        return

    task = tasks_col.find_one({"_id": task_id})
    if not task:
        log.error("task not found: %s", task_id_str)
        return

    log.info("processing task %s op=%s", task_id_str, task.get("operation"))

    tasks_col.update_one(
        {"_id": task_id},
        {
            "$set": {"status": "running", "startedAt": now()},
            "$push": {"logs": f"{now().isoformat()} [{WORKER_ID}] Worker picked up task"},
        },
    )

    try:
        result = run_operation(task["operation"], task["input"])
        tasks_col.update_one(
            {"_id": task_id},
            {
                "$set": {
                    "status": "success",
                    "result": result,
                    "finishedAt": now(),
                },
                "$push": {"logs": f"{now().isoformat()} [{WORKER_ID}] Completed successfully"},
            },
        )
        log.info("task %s success", task_id_str)
    except Exception as exc:
        tasks_col.update_one(
            {"_id": task_id},
            {
                "$set": {
                    "status": "failed",
                    "error": str(exc),
                    "finishedAt": now(),
                },
                "$push": {"logs": f"{now().isoformat()} [{WORKER_ID}] FAILED: {exc}"},
            },
        )
        log.exception("task %s failed", task_id_str)


def main() -> None:
    log.info("worker starting id=%s queue=%s", WORKER_ID, QUEUE_KEY)
    redis_client = connect_redis()
    mongo_client = connect_mongo()
    db = mongo_client.get_default_database()
    tasks_col = db["tasks"]

    while _running:
        try:
            popped = redis_client.brpop(QUEUE_KEY, timeout=POLL_TIMEOUT)
            if popped is None:
                continue
            _key, raw = popped
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                log.error("invalid job payload: %s", raw)
                continue
            process_job(tasks_col, payload)
        except redis.ConnectionError as exc:
            log.warning("redis connection lost: %s — reconnecting", exc)
            redis_client = connect_redis()
        except PyMongoError as exc:
            log.error("mongo error: %s", exc)
            time.sleep(2)
        except Exception:
            log.exception("unexpected error in worker loop")
            time.sleep(1)

    log.info("worker stopped cleanly")


if __name__ == "__main__":
    main()
