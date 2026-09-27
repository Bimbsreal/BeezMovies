# Authentication and sessions

PostgreSQL is the source of truth for accounts, sessions, roles, and authentication events. The browser keeps only an HttpOnly session cookie. Search indexes, Redis, and the service worker are not identity stores.

## Account lifecycle

`users.account_status` is one of:

- `pending_verification` — created by registration. Sign-in is allowed so the product can be used before email delivery exists. `email_verified_at` stays null until verification.
- `active` — set when a verification token is accepted, or assigned to the local development admin.
- `suspended` — sign-in and existing sessions are rejected.
- `deactivated` — same rejection as suspended.

There is no free-form status. `deleted_at` archives an account without removing audit rows. Foreign keys use `ON DELETE RESTRICT`.

Email is stored as entered and as `normalized_email`: trim, Unicode NFKC, then lowercase. The unique index ignores archived rows.

## Passwords

Passwords are hashed with Argon2id before insert:

- memory cost `19456` (19 MiB)
- time cost `2`
- parallelism `1`

These are the OWASP Argon2id baseline and are appropriate for this local Node process. The database rejects a `password_hash` that does not start with `$argon2id$`. Plaintext, MD5, SHA-1, and reversible encryption are not used. Password fields are not written to logs or audit metadata.

## Sessions

`POST /api/v1/auth/login` creates a row in `sessions` and sets `beezmovies_session`.

- The cookie value is 32 random bytes, base64url.
- The database stores only its SHA-256 hash.
- Cookie flags: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age` of 14 days. `Secure` is set when `NODE_ENV=production`. Local HTTP does not set `Secure`, because that flag would drop the cookie on `http://localhost`.
- `expires_at` is absolute. Logout, single revoke, revoke-all, and password reset set `revoked_at`.
- Expired and revoked cookies are rejected with `SESSION_EXPIRED` or `SESSION_REVOKED`.

`POST /api/v1/auth/sessions/:sessionId/revoke` revokes one session owned by the current user. `POST /api/v1/auth/sessions/revoke-all` revokes every session for that user. That is the foundation for a later "Log out of all devices" control.

## CSRF

Authentication uses a cookie, so cross-site requests are the threat.

1. `SameSite=Lax` withholds the cookie on cross-site POST.
2. CORS allows credentials only for origins in `CORS_ORIGIN`. The allowed origin is reflected; `*` is never used with credentials.
3. Every unsafe `/api/v1` method must send `X-BeezMovies-Request: 1`. A foreign page cannot add that header without a CORS preflight, and the preflight fails for origins outside the allowlist.

Together, a foreign site cannot perform a cookie-authenticated mutation. A separate CSRF cookie is not required for this same-site local frontend and API.

## Email verification and password reset

Tokens are random, stored as SHA-256, single-use, and expiring. Verification lasts 24 hours. Reset lasts 30 minutes. Issuing a new token retires older unused tokens of the same kind.

Email is not sent. Outside production, `developmentOnly.emailVerificationToken` or `developmentOnly.passwordResetToken` is included in the JSON response so local tests can finish the flow. Production responses never include that object. Tokens are not written to logs. The reset query string is stripped from request logs.

`POST /api/v1/auth/forgot-password` returns the same `{ "status": "ok" }` whether or not the email exists. In local development the optional token is present only when an account exists; that difference is development-only.

Registration returns `409 ACCOUNT_EXISTS` for a duplicate normalized email. Login returns the same `401 INVALID_CREDENTIALS` for an unknown email and a wrong password.

## Authorization

Roles and permissions are tables. The seeded roles are `user` and `admin`. The seeded permission is `admin.access`, granted only to `admin`.

- `requireAuth` loads the session and rejects missing, expired, revoked, suspended, and deactivated sessions.
- `requirePermission('slug')` checks permissions loaded from the user's roles.
- `requireAdmin` is `requirePermission('admin.access')`. A future role can receive that permission in data, without a new controller check.

`GET /api/v1/admin/me` is the protected admin probe. It returns the same safe profile as `/auth/me`. It is not an admin dashboard.

## API

| Method | Path | Auth |
| --- | --- | --- |
| POST | `/api/v1/auth/register` | Public |
| POST | `/api/v1/auth/login` | Public |
| POST | `/api/v1/auth/logout` | Cookie if present |
| GET | `/api/v1/auth/me` | Session |
| POST | `/api/v1/auth/forgot-password` | Public |
| POST | `/api/v1/auth/reset-password` | Public, single-use token |
| POST | `/api/v1/auth/verify-email` | Public, single-use token |
| POST | `/api/v1/auth/resend-verification` | Session |
| POST | `/api/v1/auth/sessions/:sessionId/revoke` | Session |
| POST | `/api/v1/auth/sessions/revoke-all` | Session |
| GET | `/api/v1/admin/me` | Admin |

Responses use the Phase 1 error body. Auth and admin responses send `Cache-Control: private, no-store`. Profile JSON omits `password_hash`, the session token, and reset tokens except the marked development field.

Credential routes use a tighter in-memory rate limit: 10 attempts per 15 minutes in production, 50 in local development. The limiter is skipped when `NODE_ENV=test` so the suite can exercise accounts. Health and readiness stay on the shared API limiter and are still excluded from it.

## Local admin

`npm run seed` upserts `admin@beezmovies.local` with password `BeezLocalAdmin1` and the `admin` role. The seed refuses `NODE_ENV=production`. That password is a local fixture, not a deployed credential.

## PWA

The service worker does not cache cross-origin API calls, `/api/`, requests with `Authorization`, or the account and auth pages. Session secrets are not written to `localStorage`, IndexedDB, or Cache Storage. The installed app uses the same cookie session as the browser tab.

## Migration

`database/migrations/006_identity.sql` adds users, roles, permissions, role assignments, sessions, verification tokens, reset tokens, and `auth_events`. It does not change catalog tables. Apply it with `npm run migrate`.
