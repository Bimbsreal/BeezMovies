# Changelog

## 1.0.0-rc.1

Release candidate. Not a production deployment.

- Public Netflix-style browse, search, movie pages, and authorized download stay anonymous.
- Optional accounts, admin CMS, analytics, ingestion, and content-rights status are in the application.
- Migration sequence is `001_foundation.sql` through `018_content_rights.sql`.
- Production and staging use separate environment examples. Production startup rejects the development database, the development handoff fixture, localhost service URLs, and public secret names.
- `npm run seed` refuses production, `beezmovies_staging`, and `beezmovies_production`.
- `npm run seed:staging` loads catalog text only when `BEEZ_SEED_TARGET=staging` and the database name is `beezmovies_staging`. It does not create the development admin.
- `npm run seed:production` always refuses. Production catalog rows come from authorized ingestion.
- No production host, CDN, certificate, backup, or restore has been recorded.
