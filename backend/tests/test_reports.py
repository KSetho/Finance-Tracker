import csv
import io
from datetime import date, timedelta

import pytest

from app.services.report_service import CSV_COLUMNS, build_transactions_csv
from tests.conftest import OWNER_EMAIL, OWNER_PASSWORD
from tests.test_transactions import add_expense, add_income

REPORT = "/api/v1/reports/transactions-csv"
TRANSFERS = "/api/v1/transfers"
ACCOUNTS = "/api/v1/accounts"


class RecordingSender:
    def __init__(self, error: Exception | None = None):
        self.error = error
        self.reports: list[dict] = []

    def send_password_reset(self, *args, **kwargs) -> None:
        raise AssertionError("password reset should not be called")

    def send_data_wipe_code(self, *args, **kwargs) -> None:
        raise AssertionError("data wipe should not be called")

    def send_transaction_csv_report(
        self,
        recipient: str,
        *,
        start_date: date,
        end_date: date,
        csv_bytes: bytes,
        filename: str,
    ) -> None:
        if self.error:
            raise self.error
        self.reports.append(
            {
                "recipient": recipient,
                "start_date": start_date,
                "end_date": end_date,
                "csv_bytes": csv_bytes,
                "filename": filename,
            }
        )


def install_sender(client, sender=None) -> RecordingSender:
    sender = sender or RecordingSender()
    client.app.state.password_reset_sender = sender
    return sender


def parse_csv(csv_bytes: bytes) -> list[dict[str, str]]:
    text = csv_bytes.decode("utf-8-sig")
    return list(csv.DictReader(io.StringIO(text)))


@pytest.fixture
def client(make_client):
    return make_client(email_provider="smtp")


@pytest.fixture
def api(auth_client, worked_example):
    return auth_client


def test_build_transactions_csv_header_only_when_empty():
    raw = build_transactions_csv([])
    assert raw.startswith(b"\xef\xbb\xbf")
    rows = parse_csv(raw)
    assert rows == []
    header = raw.decode("utf-8-sig").splitlines()[0].split(",")
    assert header == CSV_COLUMNS


def test_report_requires_auth(client):
    assert (
        client.post(
            REPORT, json={"start_date": "2026-10-01", "end_date": "2026-10-31"}
        ).status_code
        == 401
    )


def test_report_requires_email_provider(make_client, owner):
    client = make_client(email_provider="disabled")
    login = client.post(
        "/api/v1/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD}
    )
    client.headers["X-CSRF-Token"] = login.json()["csrf_token"]
    response = client.post(
        REPORT, json={"start_date": "2026-10-01", "end_date": "2026-10-31"}
    )
    assert response.status_code == 503


def test_report_emails_csv_with_all_types_in_range(api):
    sender = install_sender(api)
    accounts = {a["name"]: a["id"] for a in api.get(ACCOUNTS).json()["items"]}

    assert add_income(api, amount="100.00", **{"transaction_date": "2026-10-05"}).status_code == 201
    assert add_expense(api, amount="20.00", **{"transaction_date": "2026-10-06"}).status_code == 201
    # fee + parent expense
    assert (
        add_expense(
            api,
            amount="50.00",
            category="Family",
            fee_amount="2.00",
            transaction_date="2026-10-07",
        ).status_code
        == 201
    )
    assert (
        api.post(
            TRANSFERS,
            json={
                "name": "To MoMo",
                "amount": "10.00",
                "transaction_date": "2026-10-08",
                "source_account_id": accounts["Bank"],
                "destination_account_id": accounts["MoMo"],
            },
        ).status_code
        == 201
    )
    # outside range
    assert add_expense(api, amount="9.00", **{"transaction_date": "2026-09-30"}).status_code == 201
    assert add_expense(api, amount="9.00", **{"transaction_date": "2026-11-01"}).status_code == 201

    response = api.post(
        REPORT, json={"start_date": "2026-10-01", "end_date": "2026-10-31"}
    )
    assert response.status_code == 202
    assert "sent to your email" in response.json()["message"].lower()
    assert len(sender.reports) == 1
    report = sender.reports[0]
    assert report["recipient"] == OWNER_EMAIL
    assert report["filename"] == "transactions_2026-10-01_to_2026-10-31.csv"
    rows = parse_csv(report["csv_bytes"])
    types = sorted(r["type"] for r in rows)
    assert "income" in types
    assert "expense" in types
    assert "transfer" in types
    assert any(r["is_fee"] == "true" for r in rows)
    assert all("2026-10-" in r["date"] for r in rows)
    assert all(r["date"] >= "2026-10-01" and r["date"] <= "2026-10-31" for r in rows)


def test_empty_range_rejected_without_sending(api):
    sender = install_sender(api)
    response = api.post(
        REPORT, json={"start_date": "2025-01-01", "end_date": "2025-01-31"}
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "no_transactions"
    assert sender.reports == []


def test_range_too_long_rejected(api):
    install_sender(api)
    start = date(2025, 1, 1)
    end = start + timedelta(days=366)  # 367 inclusive days
    response = api.post(
        REPORT,
        json={"start_date": start.isoformat(), "end_date": end.isoformat()},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "range_too_long"


def test_report_throttled_after_max(api):
    sender = install_sender(api)
    body = {"start_date": "2026-10-01", "end_date": "2026-10-31"}
    for _ in range(5):
        assert api.post(REPORT, json=body).status_code == 202
    limited = api.post(REPORT, json=body)
    assert limited.status_code == 429
    assert len(sender.reports) == 5


def test_email_failure_returns_503(api):
    install_sender(api, RecordingSender(error=RuntimeError("smtp down")))
    response = api.post(
        REPORT, json={"start_date": "2026-10-01", "end_date": "2026-10-31"}
    )
    assert response.status_code == 503
