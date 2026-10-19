"""Calendar helpers. Months are calendar months in Ghana time (Africa/Accra)."""

import re
from datetime import date
from zoneinfo import ZoneInfo

from app.core.clock import Clock

ACCRA = ZoneInfo("Africa/Accra")
_MONTH = re.compile(r"^(\d{4})-(0[1-9]|1[0-2])$")


def accra_today(clock: Clock) -> date:
    return clock.now().astimezone(ACCRA).date()


def parse_month(value: str) -> date:
    """'2026-10' -> date(2026, 10, 1). Raises ValueError for anything else."""
    match = _MONTH.match(value)
    if not match:
        raise ValueError("Month must look like YYYY-MM.")
    return date(int(match.group(1)), int(match.group(2)), 1)


def month_of(value: date) -> date:
    return value.replace(day=1)


def month_range(value: date) -> tuple[date, date]:
    """Half-open [first day, first day of next month) for the month containing value."""
    start = month_of(value)
    end = date(start.year + 1, 1, 1) if start.month == 12 else date(start.year, start.month + 1, 1)
    return start, end


def format_month(value: date) -> str:
    return f"{value.year:04d}-{value.month:02d}"


def add_months(value: date, months: int) -> date:
    """First day of the month `months` away from the month containing value (negative = earlier)."""
    index = value.year * 12 + (value.month - 1) + months
    return date(index // 12, index % 12 + 1, 1)
