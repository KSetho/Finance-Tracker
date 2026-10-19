from decimal import Decimal

import pytest
from pydantic import BaseModel, ValidationError

from app.schemas.common import Money, NonNegativeMoney, PositiveMoney


class Any(BaseModel):
    value: Money


class Positive(BaseModel):
    value: PositiveMoney


class NonNegative(BaseModel):
    value: NonNegativeMoney


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("150", "150.00"),
        ("150.5", "150.50"),
        (150.25, "150.25"),
        (150, "150.00"),
        ("0.00", "0.00"),
        ("-200.00", "-200.00"),
        ("999999999999.99", "999999999999.99"),
        (Decimal("12.3"), "12.30"),
    ],
)
def test_money_accepts_and_normalizes_to_two_decimals(raw, expected):
    model = Any(value=raw)
    assert isinstance(model.value, Decimal)
    assert model.model_dump(mode="json")["value"] == expected
    assert model.model_dump_json() == f'{{"value":"{expected}"}}'


@pytest.mark.parametrize(
    "raw",
    [
        "1.234",
        "0.001",
        "abc",
        "",
        "  ",
        "NaN",
        "Infinity",
        "-Infinity",
        "1e3",
        "1,000.00",
        "1000000000000.00",  # 13 integer digits
        0.30000000000000004,  # binary float artifact
        None,
        True,
    ],
)
def test_money_rejects_bad_values(raw):
    with pytest.raises(ValidationError):
        Any(value=raw)


def test_positive_money_rejects_zero_and_negatives():
    assert Positive(value="0.01").value == Decimal("0.01")
    for bad in ("0", "0.00", "-1.00"):
        with pytest.raises(ValidationError):
            Positive(value=bad)


def test_non_negative_money_allows_zero_only():
    assert NonNegative(value="0.00").value == Decimal("0.00")
    with pytest.raises(ValidationError):
        NonNegative(value="-0.01")


def test_money_never_becomes_float():
    values = [Any(value=v).value for v in ("0.10", "0.20", 0.5, 7)]
    assert all(type(v) is Decimal for v in values)
    assert values[0] + values[1] == Decimal("0.30")


# ---- constitution principles I and II: money is exact, and only one module adds it up ---------

import re  # noqa: E402
from pathlib import Path  # noqa: E402

APP = Path(__file__).resolve().parent.parent / "app"
ALLOWED_TO_SUM = {APP / "services" / "accounting.py"}


def _python_files():
    return [p for p in APP.rglob("*.py") if "__pycache__" not in p.parts]


def test_only_the_accounting_module_sums_money():
    summing = re.compile(r"\bfunc\.sum\(|(?<![\w.])sum\(")
    offenders = [
        f"{path.relative_to(APP)}:{number}"
        for path in _python_files()
        if path not in ALLOWED_TO_SUM
        for number, line in enumerate(path.read_text().splitlines(), 1)
        if summing.search(line) and not line.lstrip().startswith("#")
    ]
    assert offenders == []


def test_no_floats_are_used_to_convert_money():
    offenders = [
        f"{path.relative_to(APP)}:{number}"
        for path in _python_files()
        for number, line in enumerate(path.read_text().splitlines(), 1)
        if re.search(r"(?<![\w.])float\(", line)
    ]
    assert offenders == []


def test_the_budget_and_dashboard_services_do_no_money_arithmetic_of_their_own():
    for name in ("budget_service.py", "dashboard_service.py"):
        text = (APP / "services" / name).read_text()
        assert not re.search(
            r"(amount|spent|income|expenses|allowance|balance)\w*\s*[-+*/]\s*\w", text
        ), name
