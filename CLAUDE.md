# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

NestJS 11 (TypeScript) REST API for reporting geolocated incidents. Uses PostgreSQL + PostGIS for spatial queries, Redis for caching, Nodemailer for notification emails, and Winston + Azure Application Insights for logging. Global route prefix is `/api` and CORS is enabled (`src/main.ts`).

## Commands

```bash
# Dev / build / run
npm run start:dev       # watch mode
npm run start:prod      # runs dist/main (must build first)
npm run build           # nest build → dist/

# Quality
npm run lint            # eslint --fix over src/, apps/, libs/, test/
npm run format          # prettier write over src/ and test/

# Tests (Jest; rootDir is src/, testRegex .*\.spec\.ts$)
npm run test
npm run test:cov
npm run test:e2e        # uses test/jest-e2e.json
npx jest path/to/file.spec.ts          # single file
npx jest -t "name of test"             # by test name

# TypeORM migrations (the typeorm script runs `npm run build` first,
# because data-source.ts points migrations at dist/core/db/migrations/*)
npm run migration:generate -- src/core/db/migrations/<Name>
npm run migration:run

# Full stack (api + postgis + redis)
docker compose up
```

All env vars in `src/config/envs.ts` are declared `required()` via `env-var` — the app will fail fast at boot if any are missing. See `compose.yaml` for the full list (PORT, DB_*, REDIS_*, MAILER_*, MAPBOX_TOKEN, APPINSIGHTS_CONNECTION_STRING).

## Architecture

### Module graph
`AppModule` wires three feature modules plus TypeORM: `EmailModule`, `IncidentsModule`, `CacheModule`, and `TypeOrmModule.forRoot(dataSourceOptions)`. `CacheModule` and `EmailModule` are re-imported by `IncidentsModule` so their services can be injected there.

### Path aliases
Imports use bare `src/...` paths (e.g. `from 'src/config/envs'`) via `tsconfig.json` `baseUrl: "./"`. Keep new imports consistent with this style.

### Database / geospatial
- `Incident` entity (`src/core/db/entities/incident.entity.ts`) stores location as PostGIS `geometry(Point, 4326)`. TypeORM's `Point` uses GeoJSON shape: `{ type: 'Point', coordinates: [lon, lat] }` — note the **lon-first** order, which is opposite to the `lat, lon` used in the HTTP API surface.
- `synchronize: false` — schema is managed **only** via migrations in `src/core/db/migrations/`. The data source loads compiled migrations from `dist/core/db/migrations/*`, which is why `npm run typeorm` builds first.
- Radius search uses PostGIS `ST_DWithin(location::geography, ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography, radius)` so `radius` is in **meters**.
- Compose uses the `postgis/postgis:16-master` image — plain `postgres` won't work because the entity requires the PostGIS extension.

### Caching
- `CacheService` (`src/cache/cache.service.ts`) is a thin `ioredis` wrapper providing `get<T>`/`set`/`delete` with JSON (de)serialization.
- `IncidentsService.getIncidents()` caches the full list under key `incidents:all` with **no TTL**; `createIncident()` invalidates that key after a write. If you add mutations (update/delete) they must also invalidate this key or stale reads will persist indefinitely.
- `IncidentsService` currently instantiates its own raw `Redis` client in addition to injecting `CacheService`, and uses the raw client to write the cache entry on miss. Prefer extending `CacheService` rather than adding more raw clients.

### Logging / observability
`src/config/logger.ts` initializes Application Insights as a side effect at import time (`appInsights.setup(...).start()`) and exposes a Winston `logger` whose custom transport forwards every record to AppInsights via `trackTrace`. Importing the logger anywhere implicitly boots AppInsights — don't introduce a second `appInsights.setup` call.

### Email
`EmailService.sendEmail` uses a Nodemailer transport configured from `MAILER_*` envs. Note: `IncidentsService.createIncident` currently sends to a **hardcoded recipient** (`devjdfr@gmail.com`); if the recipient needs to be dynamic, change it there.

## Deployment

`.github/workflows/build.yml` builds and pushes a Docker image to GHCR on push to `main`. The `Dockerfile` is a single-stage `node:25-alpine` build that runs `npm install` + `npm run build` and starts `node dist/main.js`.
