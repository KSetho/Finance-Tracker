"""Owner reports: email a CSV of transactions for a date range."""

from __future__ import annotations

import csv
import io
import logging
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy.orm import Session

from app.core.clock import Clock
from app.core.config import Settings
from app.core.email import PasswordResetSender
from app.core.exceptions import BusinessRuleError, ServiceUnavailable, TooManyAttempts
from app.repositories import report_request_repository, transaction_repository
from app.repositories.transaction_repository import TransactionFilters
from app.services.auth_service import AuthContext
from app.services.transaction_support import build_outs

logger = logging.getLogger("app.reports")

MAX_RANGE_DAYS = 366
CSV_COLUMNS = [
    "date",
    "type",
    "name",
    "amount",
    "account",
    "destination_account",
    "category",
    "description",
    "is_fee",
    "related_transaction_id",
]
ACCEPTED_MESSAGE = "Your transaction CSV report was sent to your email."


def _money(value: Decimal | str) -> str:
    if isinstance(value, Decimal):
        return f"{value:.2f}"
    return str(value)


def build_transactions_csv(outs: list) -> bytes:
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=CSV_COLUMNS, lineterminator="\n")
    writer.writeheader()
    for row in outs:
        writer.writerow(
            {
                "date": row.transaction_date.isoformat(),
                "type": row.type.value if hasattr(row.type, "value") else str(row.type),
                "name": row.name,
                "amount": _money(row.amount),
                "account": row.account.name,
                "destination_account": (
                    row.destination_account.name if row.destination_account else ""
                ),
                "category": row.category.name if row.category else "",
                "description": row.description or "",
                "is_fee": "true" if row.is_fee else "false",
                "related_transaction_id": (
                    str(row.related_transaction_id) if row.related_transaction_id else ""
                ),
            }
        )
    # UTF-8 BOM helps Excel open the file correctly
    return ("\ufeff" + buffer.getvalue()).encode("utf-8")


def email_transactions_csv(
    db: Session,
    settings: Settings,
    clock: Clock,
    sender: PasswordResetSender,
    context: AuthContext,
    *,
    start_date: date,
    end_date: date,
    source_ip: str,
) -> dict[str, str]:
    if settings.email_provider == "disabled":
        raise ServiceUnavailable("Email delivery is required to send a report.")

    if start_date > end_date:
        raise BusinessRuleError("validation_error", "The start date is after the end date.")

    inclusive_days = (end_date - start_date).days + 1
    if inclusive_days > MAX_RANGE_DAYS:
        raise BusinessRuleError(
            "range_too_long",
            f"Choose a range of at most {MAX_RANGE_DAYS} days.",
        )

    now = clock.now()
    window_start = now - timedelta(minutes=settings.report_window_minutes)
    if (
        report_request_repository.count_for_user_since(db, context.user_id, window_start)
        >= settings.report_max_requests
        or report_request_repository.count_for_source_since(db, source_ip, window_start)
        >= settings.report_max_requests
    ):
        raise TooManyAttempts(retry_after=settings.report_window_minutes * 60)

    filters = TransactionFilters(start_date=start_date, end_date=end_date)
    rows = list(transaction_repository.list_all(db, context.user_id, filters))
    if not rows:
        raise BusinessRuleError(
            "no_transactions",
            "No transactions in that date range. Choose different dates.",
        )
    outs = build_outs(db, context.user_id, rows)
    csv_bytes = build_transactions_csv(outs)
    filename = f"transactions_{start_date.isoformat()}_to_{end_date.isoformat()}.csv"

    try:
        sender.send_transaction_csv_report(
            context.user.email,
            start_date=start_date,
            end_date=end_date,
            csv_bytes=csv_bytes,
            filename=filename,
        )
    except Exception:
        logger.exception(
            "transaction_csv_email_failed user_id=%s source_ip=%s",
            context.user_id,
            source_ip,
        )
        raise ServiceUnavailable(
            "Could not send the report email. Try again later."
        ) from None

    report_request_repository.create(
        db, user_id=context.user_id, source_ip=source_ip, now=now
    )
    db.commit()
    logger.info(
        "transaction_csv_sent user_id=%s rows=%s source_ip=%s",
        context.user_id,
        len(outs),
        source_ip,
    )
    return {"message": ACCEPTED_MESSAGE}
