"""Administrative commands: python -m app.cli <provision-owner|reset-owner-password>.

Passwords are read from a hidden prompt or stdin, never from command-line arguments, and are
never printed. Exit codes: 0 success, 1 refused, 2 configuration or connection error (argparse
usage errors also exit 2).
"""

import argparse
import getpass
import logging
import sys
from collections.abc import Sequence
from typing import TextIO

from pydantic import ValidationError
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker

from app.core.clock import Clock, SystemClock
from app.core.config import Settings, get_settings
from app.db.session import make_engine, make_session_factory
from app.services import auth_service
from app.services.auth_service import OwnerAdminError

logger = logging.getLogger("app.cli")


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m app.cli", description=__doc__.splitlines()[0])
    commands = parser.add_subparsers(dest="command", required=True)

    provision = commands.add_parser("provision-owner", help="create the single owner account")
    provision.add_argument("--email", required=True, help="must equal OWNER_EMAIL")
    provision.add_argument("--password-stdin", action="store_true", help="read password from stdin")

    reset = commands.add_parser("reset-owner-password", help="set a new owner password")
    reset.add_argument("--password-stdin", action="store_true", help="read password from stdin")
    return parser


def _read_password(from_stdin: bool, stdin: TextIO | None) -> str:
    if from_stdin:
        return (stdin or sys.stdin).readline().rstrip("\r\n")
    password = getpass.getpass("Password: ")
    if getpass.getpass("Confirm password: ") != password:
        raise OwnerAdminError("Passwords do not match.")
    return password


def _load_settings() -> Settings | None:
    try:
        return get_settings()
    except ValidationError as exc:
        print("Configuration error:", file=sys.stderr)
        for problem in exc.errors():
            location = ".".join(str(part) for part in problem["loc"])
            print(f"  {location}: {problem['msg']}", file=sys.stderr)  # never echo input values
        return None


def main(
    argv: Sequence[str] | None = None,
    *,
    settings: Settings | None = None,
    session_factory: sessionmaker[Session] | None = None,
    clock: Clock | None = None,
    stdin: TextIO | None = None,
) -> int:
    args = _build_parser().parse_args(argv)

    settings = settings or _load_settings()
    if settings is None:
        return 2
    clock = clock or SystemClock()
    if session_factory is None:
        session_factory = make_session_factory(make_engine(settings))

    try:
        password = _read_password(args.password_stdin, stdin)
        with session_factory() as db:
            if args.command == "provision-owner":
                auth_service.provision_owner(
                    db, settings, clock, email=args.email, password=password
                )
                logger.info("owner_provisioned")
                print(f"Owner account created for {settings.owner_email}.")
            else:
                auth_service.reset_owner_password(db, settings, clock, password=password)
                logger.info("owner_password_reset")
                print("Owner password updated and all sessions ended.")
    except OwnerAdminError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    except OperationalError:
        print("Could not connect to the database. Check DATABASE_URL.", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
