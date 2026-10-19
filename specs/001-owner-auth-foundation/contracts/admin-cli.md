# Contract: Administrative CLI

Run from `backend/` with the production or local environment loaded:

```bash
python -m app.cli <command> [options]
```

Passwords are never accepted as command-line arguments. They are read with a hidden interactive
prompt (entered twice) or, for automation, from standard input with `--password-stdin`. Minimum
length is 7 characters. Passwords are never printed or logged.

## `provision-owner`

Creates the single owner account.

| Option | Required | Description |
|---|---|---|
| `--email <address>` | yes | Must equal `OWNER_EMAIL` after normalization |
| `--password-stdin` | no | Read the password from stdin instead of prompting |

Behavior and exit codes:

| Condition | Result | Exit |
|---|---|---|
| No users exist, email matches `OWNER_EMAIL`, password valid | Owner created with an Argon2id hash | 0 |
| A user already exists | Refused: "An owner already exists." | 1 |
| Email differs from `OWNER_EMAIL` | Refused: "Email does not match OWNER_EMAIL." | 1 |
| Password shorter than 7 characters or prompts differ | Refused | 1 |
| `OWNER_EMAIL` or other required config invalid | Refused with the config error | 2 |

## `reset-owner-password`

Sets a new password for the existing owner.

| Option | Required | Description |
|---|---|---|
| `--password-stdin` | no | Read the new password from stdin instead of prompting |

Behavior: in one database transaction, update the owner's password hash and revoke all of the
owner's sessions. The command takes no email argument, so it cannot reassign the account to a
different email. It refuses if no owner exists.

| Condition | Result | Exit |
|---|---|---|
| Owner exists, password valid | Hash updated, all sessions revoked | 0 |
| No owner exists | Refused: "No owner exists. Run provision-owner first." | 1 |
| Stored owner email differs from `OWNER_EMAIL` | Refused: "Stored owner email does not match OWNER_EMAIL." | 1 |
| Password invalid | Refused | 1 |
| Config invalid | Refused with the config error | 2 |

## Documentation requirement

The procedure, including how to run it against the production database, is documented in
`backend/README.md` and `quickstart.md`.
