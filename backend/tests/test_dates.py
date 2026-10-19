from datetime import UTC, date, datetime

import pytest

from app.core.dates import (
    accra_today,
    add_months,
    format_month,
    month_of,
    month_range,
    parse_month,
)


class FixedClock:
    def __init__(self, moment: datetime):
        self._moment = moment

    def now(self) -> datetime:
        return self._moment


def test_accra_today_uses_ghana_time():
    assert accra_today(FixedClock(datetime(2026, 10, 31, 23, 30, tzinfo=UTC))) == date(2026, 10, 31)
    assert accra_today(FixedClock(datetime(2026, 11, 1, 0, 5, tzinfo=UTC))) == date(2026, 11, 1)


def test_parse_month_returns_first_day():
    assert parse_month("2026-10") == date(2026, 10, 1)
    assert parse_month("2026-01") == date(2026, 1, 1)


@pytest.mark.parametrize(
    "bad", ["2026-13", "2026-00", "26-1", "", "2026-1", "2026-10-01", "abcd-ef"]
)
def test_parse_month_rejects_malformed(bad):
    with pytest.raises(ValueError):
        parse_month(bad)


def test_month_range_is_half_open_and_handles_december():
    assert month_range(date(2026, 10, 1)) == (date(2026, 10, 1), date(2026, 11, 1))
    assert month_range(date(2026, 12, 1)) == (date(2026, 12, 1), date(2027, 1, 1))
    assert month_range(date(2026, 12, 17)) == (date(2026, 12, 1), date(2027, 1, 1))


def test_month_of_and_format_month_round_trip():
    assert month_of(date(2026, 10, 17)) == date(2026, 10, 1)
    assert format_month(date(2026, 10, 17)) == "2026-10"
    assert parse_month(format_month(date(2026, 2, 9))) == date(2026, 2, 1)


def test_add_months_crosses_year_boundaries():
    assert add_months(date(2026, 10, 17), 0) == date(2026, 10, 1)
    assert add_months(date(2026, 10, 17), 3) == date(2027, 1, 1)
    assert add_months(date(2026, 1, 31), -1) == date(2025, 12, 1)
    assert add_months(date(2026, 10, 1), -11) == date(2025, 11, 1)
