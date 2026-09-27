# BeezMovies operations

This is the operator guide for the controls that already exist. It does not deploy the site, store movie files, or add a second application.

The admin page is `/admin/operations`. The public site does not show these checks. Health probes stay at `/health/live` and `/health/ready` and do not include database names, pool sizes, or secrets.

## Monitoring

`/admin/operations` reports APPLICATION, DATABASE, CACHE, QUEUE, WORKERS, SEARCH, MEDIA PROVIDERS, CDN, and PWA. Each is HEALTHY, DEGRADED, DOWN, or NOT CONFIGURED. NOT CONFIGURED means the dependency was never set up. It is not an outage.

CDN is NOT CONFIGURED until a real edge exists. Cache is DEGRADED when Redis is unreachable, and the catalog still reads PostgreSQL. A stopped worker is NOT CONFIGURED until a heartbeat exists, then DOWN if that heartbeat is older than 60 seconds. Browse and download keep working.

Notifications on that page are open CRITICAL and HIGH incidents only. Ordinary warnings stay on the System page.

## Incidents

States are DETECTED, INVESTIGATING, MITIGATING, RESOLVED, and POSTMORTEM. A record stores the case code, severity, service, start time, resolution time, and the administrator who changes it. A postmortem requires impact, cause, mitigation, and prevention. Notes do not store passwords or visitor identifiers.

An administrator can open an incident by hand. Scan opens at most three new incidents, and only for a database outage, download failures, a failed or overdue backup, search unavailable, a provider outage, a stale worker, or a queue backlog of 100 or more. A second scan does not open a duplicate while one of those is still open. The worker repeats that scan at most every 15 minutes.

## Backups

Backup status stays NOT CONFIGURED until an administrator records a success or failure. A failed backup, a backup older than 26 hours, a zero-byte backup, or a failed restore test is DOWN. A size that is under one fifth or over five times the previous size is DEGRADED. No backup has been recorded on this machine, and no restore has been run. Do not invent a successful backup from this screen.

## Deployments

The safe path is: dependency update, build, tests, security scan, staging, regression, production approval, then deployment. Do not upgrade production dependencies without that path. The CI workflow records approval and does not deploy. Rollback is the previous build. Do not run a down migration.

Small percentage rollout is not available. There is no edge that can split traffic. The available controls are the existing flags for ingestion, search indexing, and advertising. Those flags do not grant access. Authorization still checks the session.

After a real production release, record the version, time, migration, health, and error counts in the operations note. This release candidate has `deployedAt` null.

## Provider failures

Provider health is the stored status from the media sweep. The sweep checks one stale reference at a time and waits 15 minutes between checks. An unavailable provider is ranked below a healthy one. Movie pages still render. Download resolution uses the next authorized reference or returns a clean unavailable response. Do not send a burst of checks.

## Queue management

Jobs are PostgreSQL rows. The board shows pending depth and the oldest pending job. Dead-letter jobs are a warning, not an automatic retry. Retry and cancel stay on `/admin/ingestion` and require confirmation. A quality action queues at most 10 artwork refreshes for published movies that have an external id and no poster. It does not delete or merge catalog rows.

## Database procedures

The board shows connection count, lock waits, and database size when PostgreSQL answers. Slow-query statistics are not installed, and this application does not turn them on by itself. Do not run destructive maintenance from the admin UI. Migrations stay forward-only through `npm run migrate`.

## Maintenance mode

Maintenance mode is off by default. Turning it on requires confirmation on the System page. Public catalog reads then return 503 with the maintenance message. Homepage and movie pages show that message. Health, authentication, and admin routes stay available so an administrator can turn it off. Do not enable it for a cache miss or a single failed download.

## Retention

Application logs are not shipped off this machine. The documented targets are 30 days in production and 14 days in staging. Analytics raw events and latency samples are pruned after 14 days. Search text is pruned after 30 days. Daily aggregates stay 400 days. Audit and authentication events are kept for security review and are not deleted by account deletion. Download events store a movie, a provider, and a result. They do not store a person.

## Cost

Database size is the only infrastructure figure this host can measure. Compute, CDN, cache, worker, and provider charges are null until a host reports them. Do not estimate them.

## Performance

API latency on the board is the last hour of stored samples. There is no previous production release to compare, so regression stays null. Do not treat a development-server paint time as a release regression.
