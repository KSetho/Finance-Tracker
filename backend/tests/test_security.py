import hashlib
import hmac

from app.core import security


def test_password_hash_is_argon2id_and_salted():
    first = security.hash_password("correct horse battery")
    second = security.hash_password("correct horse battery")
    assert first.startswith("$argon2id$")
    assert first != second


def test_verify_password():
    hashed = security.hash_password("correct horse battery")
    assert security.verify_password(hashed, "correct horse battery") is True
    assert security.verify_password(hashed, "wrong") is False
    assert security.verify_password("not-a-hash", "anything") is False


def test_needs_rehash_for_weaker_parameters():
    from argon2 import PasswordHasher

    weak = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1).hash("pw")
    assert security.needs_rehash(weak) is True
    assert security.needs_rehash(security.hash_password("pw")) is False


def test_dummy_hash_is_verifiable_hash_that_matches_nothing_real():
    dummy = security.dummy_hash()
    assert dummy.startswith("$argon2id$")
    assert security.verify_password(dummy, "anything-else") is False


def test_session_token_is_high_entropy_and_unique():
    a, b = security.new_session_token(), security.new_session_token()
    assert a != b
    assert len(a) >= 43  # 32 random bytes, urlsafe base64


def test_hash_token_is_sha256_hex_and_deterministic():
    token = "abc"
    assert security.hash_token(token) == hashlib.sha256(b"abc").hexdigest()
    assert security.hash_token(token) == security.hash_token(token)


def test_csrf_token_is_hmac_bound_to_session_and_secret():
    secret = "s" * 40
    expected = hmac.new(secret.encode(), b"tok", hashlib.sha256).hexdigest()
    assert security.csrf_token_for("tok", secret) == expected
    assert security.csrf_token_for("tok", "t" * 40) != expected
    assert security.csrf_token_for("other", secret) != expected


def test_safe_equal():
    assert security.safe_equal("abc", "abc") is True
    assert security.safe_equal("abc", "abd") is False
    assert security.safe_equal("", "abc") is False
