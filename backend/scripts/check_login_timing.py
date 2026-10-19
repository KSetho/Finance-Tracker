"""SC-004 check: wrong-email and wrong-password sign-ins must look the same.

Creates a throwaway database on the PostgreSQL server in TEST_DATABASE_URL (default: the
docker-compose database), provisions a random owner, fires N failed sign-ins of each kind
in-process, then drops the database. Throttling is raised so every attempt reaches the password
check. Run from backend/:

    python scripts/check_login_timing.py [N]
"""

import logging
import os
import secrets
import statistics
import sys
import time
import uuid
from pathlib import Path

from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.config import Settings  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models import User  # noqa: E402

BACKEND_DIR = Path(__file__).resolve().parent.parent
ADMIN_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+psycopg://finance:finance@localhost:5433/finance"
)
ORIGIN = "http://localhost:5173"
OWNER = "owner@example.com"


def main(samples: int) -> int:
    logging.disable(logging.CRITICAL)  # keep the report readable; 200 expected failures
    name = f"finance_timing_{uuid.uuid4().hex[:10]}"
    admin = create_engine(ADMIN_URL, isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.execute(text(f'CREATE DATABASE "{name}"'))
    url = make_url(ADMIN_URL).set(database=name).render_as_string(hide_password=False)
    try:
        cfg = Config(str(BACKEND_DIR / "alembic.ini"))
        cfg.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
        cfg.set_main_option("sqlalchemy.url", url.replace("%", "%%"))
        command.upgrade(cfg, "head")

        settings = Settings(
            _env_file=None,
            owner_email=OWNER,
            database_url=url,
            secret_key=secrets.token_urlsafe(48),
            frontend_origin=ORIGIN,
            app_env="test",
            login_max_failures_per_ip=10**6,
            login_max_failures_per_account=10**6,
        )
        app = create_app(settings=settings)
        with app.state.session_factory() as db:
            db.add(User(email=OWNER, password_hash=hash_password(secrets.token_urlsafe(16))))
            db.commit()

        client = TestClient(app, headers={"Origin": ORIGIN})
        results: dict[str, list[tuple[int, str, float]]] = {"wrong_password": [], "wrong_email": []}
        for _ in range(samples):
            for kind, email in (("wrong_password", OWNER), ("wrong_email", "stranger@example.com")):
                start = time.perf_counter()
                response = client.post(
                    "/api/v1/auth/login", json={"email": email, "password": "not-the-password"}
                )
                results[kind].append(
                    (response.status_code, response.text, time.perf_counter() - start)
                )

        bodies = {(status, body) for rows in results.values() for status, body, _ in rows}
        medians = {kind: statistics.median(t for *_, t in rows) for kind, rows in results.items()}
        means = {kind: statistics.mean(t for *_, t in rows) for kind, rows in results.items()}
        ratio = max(medians.values()) / min(medians.values())

        print(f"samples per kind: {samples}")
        print(f"distinct (status, body) pairs across all attempts: {len(bodies)}")
        for kind in results:
            print(f"{kind}: median {medians[kind] * 1000:.1f} ms, mean {means[kind] * 1000:.1f} ms")
        print(f"median ratio (slowest/fastest): {ratio:.3f}")

        ok = len(bodies) == 1 and ratio < 1.25
        print("RESULT:", "PASS" if ok else "FAIL")
        return 0 if ok else 1
    finally:
        with admin.connect() as conn:
            conn.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        admin.dispose()


if __name__ == "__main__":
    sys.exit(main(int(sys.argv[1]) if len(sys.argv) > 1 else 100))
