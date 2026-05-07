"""Liveness probe: ensures Redis and Mongo are reachable."""
import os
import sys

import redis
from pymongo import MongoClient


def check() -> int:
    try:
        r = redis.Redis(
            host=os.getenv("REDIS_HOST", "redis"),
            port=int(os.getenv("REDIS_PORT", "6379")),
            socket_connect_timeout=3,
        )
        r.ping()
        m = MongoClient(os.environ["MONGO_URI"], serverSelectionTimeoutMS=3000)
        m.admin.command("ping")
        return 0
    except Exception as exc:
        print(f"healthcheck failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(check())
