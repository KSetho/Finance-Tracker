import pytest

ACCOUNTS = "/api/v1/accounts"
TX = "/api/v1/transactions"


def ids(client):
    accounts = {a["name"]: a["id"] for a in client.get(ACCOUNTS).json()["items"]}
    cats = {
        (c["category_type"], c["name"]): c["id"]
        for c in client.get("/api/v1/categories").json()["items"]
    }
    return accounts, cats


def add(client, kind, name, amount, on, account, category):
    accounts, cats = ids(client)
    body = {
        "name": name,
        "amount": amount,
        "transaction_date": on,
        "account_id": accounts[account],
        "category_id": cats[(kind, category)] if category else None,
    }
    path = "income" if kind == "income" else "expenses"
    response = client.post(f"{TX}/{path}", json=body)
    assert response.status_code == 201, response.text
    return response.json()


@pytest.fixture
def api(auth_client, worked_example, clock):
    c = auth_client
    rows = [
        ("income", "Salary", "3000.00", "2026-10-01", "Bank", "Salary"),
        ("expense", "Groceries", "150.00", "2026-10-05", "Bank", "Food"),
        ("expense", "Taxi", "40.00", "2026-10-10", "MoMo", "Transport"),
        ("expense", "Weekly groceries", "90.00", "2026-10-20", "Bank", "Food"),
        ("income", "Gift", "100.00", "2026-11-02", "MoMo", "Gift"),
        ("expense", "Airtime", "10.00", "2026-11-03", "MoMo", "Bills"),
    ]
    for row in rows:
        add(c, *row)
        clock.advance(seconds=1)
    return c


def names(response):
    assert response.status_code == 200, response.text
    return [item["name"] for item in response.json()["items"]]


def test_default_order_is_newest_first(api):
    assert names(api.get(TX)) == [
        "Airtime",
        "Gift",
        "Weekly groceries",
        "Taxi",
        "Groceries",
        "Salary",
    ]


def test_same_day_entries_are_ordered_by_creation_time_newest_first(api, clock):
    add(api, "expense", "First today", "1.00", "2026-11-03", "Bank", "Food")
    clock.advance(seconds=5)
    add(api, "expense", "Second today", "2.00", "2026-11-03", "Bank", "Food")
    top = names(api.get(TX))[:3]
    assert top == ["Second today", "First today", "Airtime"]


def test_response_shape(api):
    body = api.get(TX, params={"page_size": 1}).json()
    assert set(body) == {"items", "page", "page_size", "total"}
    assert (body["page"], body["page_size"], body["total"]) == (1, 1, 6)
    item = body["items"][0]
    assert item["account"]["name"] == "MoMo"
    assert item["category"]["name"] == "Bills"
    assert item["type"] == "expense"
    assert item["amount"] == "10.00"


def test_date_range_is_inclusive(api):
    response = api.get(TX, params={"start_date": "2026-10-05", "end_date": "2026-10-20"})
    assert names(response) == ["Weekly groceries", "Taxi", "Groceries"]


def test_start_after_end_is_a_validation_error(api):
    response = api.get(TX, params={"start_date": "2026-11-01", "end_date": "2026-10-01"})
    assert response.status_code == 422


def test_type_filter(api):
    assert names(api.get(TX, params={"type": "income"})) == ["Gift", "Salary"]
    assert len(names(api.get(TX, params={"type": "expense"}))) == 4
    assert names(api.get(TX, params={"type": "transfer"})) == []


def test_category_filter(api):
    _, cats = ids(api)
    response = api.get(TX, params={"category_id": cats[("expense", "Food")]})
    assert names(response) == ["Weekly groceries", "Groceries"]


def test_account_filter_matches_source_or_destination(api):
    accounts, _ = ids(api)
    response = api.get(TX, params={"account_id": accounts["MoMo"]})
    assert names(response) == ["Airtime", "Gift", "Taxi"]


@pytest.mark.parametrize("term", ["grocer", "GROCER", "Grocer"])
def test_name_search_ignores_case(api, term):
    assert names(api.get(TX, params={"q": term})) == ["Weekly groceries", "Groceries"]


def test_search_treats_percent_and_underscore_literally(api):
    assert names(api.get(TX, params={"q": "%"})) == []
    assert names(api.get(TX, params={"q": "G_ft"})) == []


def test_filters_combine(api):
    response = api.get(TX, params={"q": "groceries", "start_date": "2026-10-10"})
    assert names(response) == ["Weekly groceries"]


def test_sort_by_amount(api):
    asc = names(api.get(TX, params={"sort_by": "amount", "sort_order": "asc"}))
    assert asc == ["Airtime", "Taxi", "Weekly groceries", "Gift", "Groceries", "Salary"]
    desc = names(api.get(TX, params={"sort_by": "amount", "sort_order": "desc"}))
    assert desc == list(reversed(asc))


def test_sort_by_date_ascending(api):
    asc = names(api.get(TX, params={"sort_order": "asc"}))
    assert asc[0] == "Salary" and asc[-1] == "Airtime"


def test_pagination_with_totals(api):
    page1 = api.get(TX, params={"page_size": 2, "page": 1}).json()
    page2 = api.get(TX, params={"page_size": 2, "page": 2}).json()
    page3 = api.get(TX, params={"page_size": 2, "page": 3}).json()
    page4 = api.get(TX, params={"page_size": 2, "page": 4}).json()
    assert [i["name"] for i in page1["items"]] == ["Airtime", "Gift"]
    assert [i["name"] for i in page2["items"]] == ["Weekly groceries", "Taxi"]
    assert [i["name"] for i in page3["items"]] == ["Groceries", "Salary"]
    assert page4["items"] == []
    assert {p["total"] for p in (page1, page2, page3, page4)} == {6}


def test_default_page_size_is_20(api):
    assert api.get(TX).json()["page_size"] == 20


@pytest.mark.parametrize(
    "params",
    [
        {"page": 0},
        {"page_size": 0},
        {"page_size": 101},
        {"start_date": "nope"},
        {"end_date": "2026-13-01"},
        {"type": "bogus"},
        {"sort_by": "name"},
        {"sort_order": "sideways"},
        {"category_id": "not-a-uuid"},
        {"q": "x" * 121},
    ],
)
def test_bad_parameters_are_422(api, params):
    assert api.get(TX, params=params).status_code == 422


def test_empty_result(api):
    body = api.get(TX, params={"q": "zzz"}).json()
    assert body["items"] == [] and body["total"] == 0


def test_requires_a_session(auth_client):
    auth_client.cookies.clear()
    assert auth_client.get(TX).status_code == 401
