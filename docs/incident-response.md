# BeezMovies incident response

Production is not deployed. These steps are the procedure for a future production incident. Do not run them against a database that is not the affected environment, and do not restore a backup over the live database.

## Workflow

The same sequence is: Detection, Assessment, Containment, Recovery, Verification, Post-incident review.

1. Detect. An admin System alert, a failed `/ready` check, or a backup age alert starts the incident.
2. Confirm. Open `/api/v1/health` and `/api/v1/ready`. Health means the process is alive. Ready means PostgreSQL answered. Redis may be degraded without failing readiness.
3. Classify. Use CRITICAL, HIGH, or MEDIUM from the System page. Do not page on a single cache miss.
4. Contain. Disable the failing feature flag or provider. Do not turn off authentication, authorization, or CORS.
5. Recover. Restart the failed process or restore a spare database. Do not delete catalog rows, users, or roles as a recovery step.
6. Verify. Anonymous homepage, search, one movie, one authorized download, and an admin System check.
7. Document. Record the start, the cause, and the change in the audit log. Do not paste secrets.
8. Prevent. Add a forward migration or a config change through staging. Do not edit the production checkout in place for an ordinary bug.

Maintenance mode is admin-only, requires confirmation, and is never turned on by a single failed request. `/health`, `/ready`, `/auth`, and `/admin` stay available so an operator can turn it off.

## Database outage

`/health` stays 200. `/ready` returns 503. The public site shows the catalog-unavailable state. Contain by leaving the API process up. Recover by restoring PostgreSQL on a spare instance, running `npm run migrate` there, then pointing `DATABASE_URL` at it. Do not terminate database sessions from the application.

## API outage

If `/health` fails, restart the API process. Workers can keep running. Confirm CORS still allows only the site origin and that cookies are `Secure` when `NODE_ENV=production`.

## Worker failure

A stale heartbeat is HIGH, not a public outage. Browse and download keep working. Restart `node workers/src/bootstrap.js`. Dead-letter ingestion jobs stay dead-letter; an admin retries them after the cause is known. Do not loop a poison job.

## Provider outage

Read the last stored provider health. Do not send a burst of checks. Disable that provider in admin. Resolution fails over to the next authorized reference or returns a clean error. Do not proxy an arbitrary URL.

## Search failure

The catalog in PostgreSQL remains the source of truth. Disable search indexing with the feature flag if the worker is harming the database. Public search can keep serving the last good index. Rebuild with the admin reindex job. Do not delete movies to repair search.

## Security incident

Preserve audit and auth events. Revoke sessions from the admin user tools. Do not log cookies, handoff tokens, or provider URLs. Do not ban users from a single failed login. Repeated authentication failures are a signal for an operator, not an automatic block beyond the existing rate limit.

## Credential compromise

Rotate the affected secret in the environment store, then restart the API. Revoke sessions for the affected accounts. Do not commit the new value or print it in logs. A leaked session cookie is contained by revocation. A leaked database or provider password is contained by rotation at the source, then a new environment value.

## Database exposure

Take the database off the public network. Rotate `DATABASE_URL`. Preserve audit rows. Restore from a known backup only onto a spare database, then point the API at it after `npm run migrate`. Do not dump the exposed database into chat or into the repository.

## Provider compromise

Disable that provider in admin. Leave other authorized providers in place. Do not fetch a replacement URL that is not on the approved host list. Rotate the provider credential outside this repository, then store it only in the environment.

## Account takeover

Revoke the account sessions. Require a password reset. Keep the auth events. Do not delete the audit row that records the takeover. If the email itself is controlled by the attacker, deactivate the account from admin user tools.

## Malicious catalog content

Unpublish or archive the movie from the editorial workflow. Do not delete the audit record of the change. Review the ingestion source before the next import. Public pages only show `active` movies.

## Service abuse

Rate limits already cover login, registration, password reset, search, and download resolution. If probing continues, tighten the environment limit or block the source at the network edge. Do not disable anonymous browsing to stop scraping of the public catalog.

## Change management

Development, then tests, then staging, then approval, then production, then the System page. Ordinary bugs do not get patched on the production host. Schema changes are forward-only. A bad migration is repaired by a new migration or by restoring a spare database.

## Scheduled review

Daily: System page, dead-letter count, backup age. Weekly: dependency review, provider health, database size. Monthly: restore a dump into an isolated database, read one movie from it, and review slow-query needs. Do not schedule a job that drops tables, users, or roles.

## Log retention

Application and worker logs: 30 days in production, 14 days in staging. Audit and authentication events: 365 days, and this application does not delete them automatically. Do not retain download histories that identify a person. Download events store a movie, a provider, and a result only.

## PWA recovery

`/sw.js` is not stored by the CDN as a permanent file. If a client has a bad cache, the recovery is to unregister the service worker and reload. Do not replace the bee artwork as a recovery step.

## Alert routing

The System page is the local alert list. An external pager is not configured. Wire CRITICAL alerts (process down, database down, backup overdue, widespread download failure) to a pager only after production exists. HIGH alerts (worker, search, provider) open a ticket. MEDIUM alerts (cache, dead letters, latency) stay on the System page.
