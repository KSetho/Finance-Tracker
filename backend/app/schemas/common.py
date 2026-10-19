"""Shared schema types. Money is exact: Decimal in Python, a two-decimal string in JSON."""

import math
import re
from decimal import Decimal
from typing import Annotated

from pydantic import AfterValidator, BeforeValidator, PlainSerializer

PAGE_SIZE_DEFAULT = 20
PAGE_SIZE_MAX = 100

_TWO_PLACES = Decimal("0.01")
_MAX_ABS = Decimal(10) ** 12  # 12 integer digits, matching NUMERIC(14,2)
_PLAIN_NUMBER = re.compile(r"^-?\d+(\.\d+)?$")


def _to_money(value: object) -> Decimal:
    if value is None or isinstance(value, bool):
        raise ValueError("Enter an amount.")
    if isinstance(value, Decimal):
        number = value
    elif isinstance(value, int):
        number = Decimal(value)
    elif isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("Enter a valid amount.")
        number = Decimal(repr(value))  # repr keeps binary artifacts visible so they are rejected
    elif isinstance(value, str):
        if not _PLAIN_NUMBER.match(value):
            raise ValueError("Enter a valid amount.")
        number = Decimal(value)
    else:
        raise ValueError("Enter a valid amount.")
    if not number.is_finite():
        raise ValueError("Enter a valid amount.")
    if number != number.quantize(_TWO_PLACES):
        raise ValueError("Amounts can have at most two decimal places.")
    if abs(number) >= _MAX_ABS:
        raise ValueError("That amount is too large.")
    return number.quantize(_TWO_PLACES)


def _positive(value: Decimal) -> Decimal:
    if value <= 0:
        raise ValueError("Amount must be greater than zero.")
    return value


def _non_negative(value: Decimal) -> Decimal:
    if value < 0:
        raise ValueError("Amount cannot be negative.")
    return value


def format_money(value: Decimal) -> str:
    return format(value.quantize(_TWO_PLACES), "f")


Money = Annotated[
    Decimal,
    BeforeValidator(_to_money),
    PlainSerializer(format_money, return_type=str, when_used="json"),
]
PositiveMoney = Annotated[Money, AfterValidator(_positive)]
NonNegativeMoney = Annotated[Money, AfterValidator(_non_negative)]
