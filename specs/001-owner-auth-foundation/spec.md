# Feature Specification: Owner-Only Authentication and Application Foundation

**Feature Branch**: `001-owner-auth-foundation`  
**Created**: 2026-10-17  
**Status**: Draft  
**Input**: User description: "from the constitution and specification I gave in the previous prompt, write the feature specs in increments" — Increment 1 of the Personal Finance Tracker v1.0 roadmap: secure application skeleton with owner-only access (Phase 1 / FR-01).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Owner signs in and reaches the protected app (Priority: P1)

The owner opens the application, sees a login screen, enters their configured email address and password, and is taken to the protected dashboard area. From then on, every request they make is recognized as coming from the signed-in owner, and the app shows who is signed in.

**Why this priority**: Nothing else in the product can be used or safely built without a working, secure sign-in. This is the minimum slice that proves the application is reachable, protected and usable by its single owner.

**Independent Test**: Provision the owner, open the app unauthenticated, confirm only the login screen is reachable, sign in with correct credentials, and confirm the protected area loads and the owner's profile is shown.

**Acceptance Scenarios**:

1. **Given** the owner account is provisioned and the owner is signed out, **When** they open any protected page, **Then** they are redirected to the login screen and no financial data is shown.
2. **Given** the owner is on the login screen, **When** they submit the correct email and password, **Then** they are signed in and taken to the dashboard route.
3. **Given** the owner is signed in, **When** they reload the page or open a new protected page, **Then** they remain signed in and the app shows their email.
4. **Given** the owner enters their email with different capitalization or surrounding spaces, **When** they submit the correct password, **Then** sign-in succeeds because email matching is normalized.
5. **Given** a sign-in request is in progress, **When** the owner presses submit again, **Then** a duplicate request is not sent.

---

### User Story 2 - Everyone else is refused (Priority: P1)

Anyone who is not the owner — a visitor with the wrong email, a visitor with the right email but the wrong password, or a request with no session — is refused access and learns nothing about which part of the credentials was wrong. Repeated failed attempts are slowed down.

**Why this priority**: The service is publicly reachable once deployed, so refusing everyone but the owner is as important as letting the owner in. This is a security requirement, not an enhancement.

**Independent Test**: Attempt sign-in with a different email, with the owner email and a wrong password, and with no session against protected endpoints; confirm all are refused with the same generic message, and that repeated failures trigger throttling.

**Acceptance Scenarios**:

1. **Given** the owner email is configured, **When** someone signs in with any other email, **Then** access is denied with a generic "invalid email or password" message, even if a user record exists for that other email.
2. **Given** the owner email is configured, **When** someone signs in with the owner email and a wrong password, **Then** access is denied with the identical generic message.
3. **Given** no session or an invalid session, **When** a protected request is made, **Then** it is rejected as unauthenticated and no data is returned.
4. **Given** repeated failed sign-in attempts exceed the allowed number within the allowed time window, **When** another attempt is made (even with correct credentials), **Then** it is temporarily refused with a clear "try again later" message.
5. **Given** a public self-registration or public password-reset attempt, **When** it is made, **Then** no such capability exists and nothing about the account is exposed.

---

### User Story 3 - Owner signs out and sessions expire (Priority: P2)

The owner can sign out explicitly, which immediately ends their access. If they leave the app idle or signed in beyond the allowed session lifetime, their session expires and they must sign in again. State-changing requests from other websites cannot act on the owner's behalf.

**Why this priority**: Secure session lifecycle protects the owner on shared or lost devices, but the product is already protected by the sign-in rules in P1 stories.

**Independent Test**: Sign in, sign out, and confirm protected pages and requests are refused afterwards. Separately, let a session pass its lifetime and confirm access is refused with a prompt to sign in again.

**Acceptance Scenarios**:

1. **Given** the owner is signed in, **When** they choose Logout, **Then** the session ends, they return to the login screen, and replaying the old session is refused.
2. **Given** a session has passed its allowed lifetime, **When** the owner makes a request, **Then** it is refused as unauthenticated and the app takes them to the login screen.
3. **Given** the owner is signed in, **When** a state-changing request arrives that did not originate from the app itself, **Then** it is rejected.
4. **Given** the owner signs out on one browser, **When** the same session is used elsewhere, **Then** it is no longer valid.

---

### User Story 4 - Administrator provisions and manages the owner account (Priority: P2)

The person operating the deployment can create the single owner account once, through an administrative procedure and not through the public interface, and can reset the owner's password through a documented administrative procedure. The application can also report that it is running without exposing sensitive details.

**Why this priority**: Without provisioning there is no owner to sign in, but it is a one-time operational task rather than a daily user journey. The health report supports deployment checks.

**Independent Test**: Run provisioning against an empty system and confirm the owner can sign in; run it again and confirm a second owner cannot be created; run the administrative password reset and confirm the old password stops working and the new one works; request the health report without signing in.

**Acceptance Scenarios**:

1. **Given** no owner exists and the owner email is configured, **When** the administrator runs provisioning with a password, **Then** exactly one owner account is created and the password is stored only in a non-reversible form.
2. **Given** an owner already exists, **When** provisioning is run again, **Then** it refuses to create a second account.
3. **Given** the provisioning email does not match the configured owner email, **When** provisioning is run, **Then** it is refused.
4. **Given** the owner has forgotten their password, **When** the administrator runs the documented reset procedure, **Then** the password changes, existing sessions are ended, and no other email can claim the account.
5. **Given** the application is running, **When** anyone requests the health report, **Then** it states the service is up and exposes no secrets, configuration or personal data.

---

### Edge Cases

- The configured owner email is missing or malformed at startup: the application MUST refuse to start or refuse all sign-ins rather than fall back to open access.
- A user record exists whose email differs from the configured owner email (for example, after the configuration was changed): sign-in is still refused.
- The owner account is marked inactive: sign-in is refused with the same generic message.
- Email is submitted with different capitalization, leading/trailing spaces, or empty/oversized values: normalized or rejected with a validation message, never causing a server error.
- Very long or empty passwords are submitted: rejected without revealing password rules for the real account.
- Response timing and wording MUST NOT reveal whether the email or the password was the wrong part.
- Login rate limiting applies per source and per account so that an attacker cannot lock the owner out indefinitely from other sources; the owner can still sign in once the window passes.
- The session expires while the owner is filling in a form: they are asked to sign in again and are not shown a technical error.
- The application is opened on a mobile-width screen: the login screen is usable and legible.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST let the owner sign in with an email address and password.
- **FR-002**: System MUST permit sign-in only for the single email address configured as the owner's, comparing emails after consistent normalization (case and surrounding whitespace).
- **FR-003**: System MUST reject sign-in for any other email, even if a record for it exists, and MUST reject an inactive owner account.
- **FR-004**: System MUST return the same generic failure message and not reveal whether the email or the password was wrong.
- **FR-005**: System MUST NOT offer public registration or public password reset.
- **FR-006**: System MUST store passwords only in a salted, non-reversible form produced by a modern, maintained password-hashing method; plaintext passwords MUST never be stored or logged.
- **FR-007**: System MUST create a secure session on successful sign-in and require a valid session for every protected request, returning an "unauthenticated" response otherwise.
- **FR-008**: System MUST let the owner sign out, immediately invalidating that session.
- **FR-009**: System MUST expire sessions after a defined lifetime and treat expired sessions as unauthenticated.
- **FR-010**: System MUST protect state-changing requests from cross-site forgery.
- **FR-011**: System MUST throttle repeated failed sign-in attempts and tell the user to try again later when throttled.
- **FR-012**: System MUST expose the signed-in owner's profile (at minimum their email) to the app so it can display who is signed in.
- **FR-013**: System MUST provide a one-time administrative procedure to provision the single owner account, refusing a second owner or an email that differs from the configured owner email.
- **FR-014**: System MUST provide a documented administrative procedure to reset the owner's password, which ends existing sessions and cannot be used to assign the account to another email.
- **FR-015**: System MUST provide a health report that needs no sign-in and exposes no sensitive information.
- **FR-016**: System MUST keep secrets and credentials out of source control and out of anything delivered to the browser, supplying them only through deployment-environment configuration.
- **FR-017**: System MUST only accept requests from the application's own approved origin, over a secure connection in production.
- **FR-018**: The application MUST show a login screen at `/login`, redirect signed-out visitors from protected routes to it, redirect signed-in owners away from it, and provide a protected layout with navigation (Dashboard, Transactions, Accounts, Monthly budget, Settings, Logout) whose pages are placeholders in this increment.
- **FR-019**: The login screen MUST show loading, validation-error and authentication-error states, prevent duplicate submissions, and be usable on desktop and mobile with keyboard access.
- **FR-020**: System MUST establish the persistent data store, schema-change (migration) process and automated test setup needed by later increments, including the owner record with unique normalized email, active flag and created/updated timestamps.

### Key Entities *(include if feature involves data)*

- **Owner (user)**: The single person allowed to use the system. Has a unique normalized email, a non-reversible password credential, an active flag, and created/updated timestamps. Owns all financial data in later increments.
- **Session**: A time-limited proof that the owner has signed in, tied to the owner, created on sign-in, invalidated on sign-out or expiry.
- **Owner configuration**: The deployment-level setting naming the one email address allowed to authenticate. It is the authority; the stored user record is never trusted on its own.
- **Sign-in attempt record**: A short-lived count of recent failures per source (and per account) used to throttle brute-force attempts.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The owner can go from the login screen to the signed-in dashboard in under 15 seconds on first use.
- **SC-002**: 100% of requests for protected data without a valid session are refused, verified by an automated check covering every protected route.
- **SC-003**: 100% of sign-in attempts with any email other than the configured owner email are refused, including when a matching user record exists.
- **SC-004**: Failed sign-in responses for a wrong email and a wrong password are indistinguishable in content and visibly similar in timing across at least 100 sampled attempts.
- **SC-005**: After the allowed number of failed attempts is exceeded, further attempts are refused until the window elapses; the owner regains access within that window without administrator help.
- **SC-006**: After sign-out or expiry, 100% of reuse attempts of the old session are refused.
- **SC-007**: No password, secret or database credential appears in source control, logs, browser-delivered files or responses, confirmed by a review before release.
- **SC-008**: A new environment can be set up to the point of a working owner sign-in by following the written provisioning steps in under 30 minutes.
- **SC-009**: The login and protected layout are fully usable on phones from 320 px wide (portrait and landscape) up to desktop screens: no horizontal scrolling, every tap target at least 44 px, no text under 12 px, nothing clipped, and operable by keyboard alone.

## Assumptions

- Exactly one owner exists; there are no roles, shared users or multiple sessions policy beyond allowing the owner to be signed in on more than one device.
- Session lifetime and throttling thresholds use sensible defaults (for example, sessions lasting a bounded number of days, and a small number of failures per window triggering throttling); exact values are tuning decisions for planning and are configurable.
- Password recovery is administrative only in v1; a secure email-based recovery flow is a possible later addition and out of scope here.
- The owner chooses a strong password at provisioning; password strength rules apply at provisioning/reset, not at sign-in.
- A phone is the owner's primary device, so every screen is designed for a 320–414 px portrait phone first and then adapted to larger screens. Primary actions must be reachable with one thumb.
- The navigation destinations beyond the dashboard are placeholders until later increments deliver their content.
- Display conventions (dates as `DD MMM YYYY`, amounts as `GH₵`) are established in later increments that show financial data.
- Later increments depend on this one. The planned increments are listed in `specs/roadmap.md`.
