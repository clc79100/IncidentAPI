# CLAUDE.md

Este archivo guía a Claude Code (claude.ai/code) cuando trabaja en este repositorio. Proyecto académico del curso **Sistemas Geo — 2do Parcial**.

## Resumen del proyecto

**IncidentAPI** es un backend REST en NestJS 11 para **reportar y consultar incidentes geolocalizados** (eventos de seguridad, vialidad, emergencias, etc., catalogados en 23 tipos). Cuando se crea un incidente, la API:

1. Lo persiste en PostgreSQL con coordenadas espaciales (PostGIS, SRID 4326).
2. Invalida la caché Redis del listado.
3. Envía un correo HTML con un mapa estático de Mapbox marcando la ubicación.

Permite además consultar todos los incidentes (con caché) o filtrarlos por radio en metros usando consultas geoespaciales nativas. La observabilidad se centraliza en Azure Application Insights vía Winston.

## Stack técnico

- **Framework**: NestJS 11 + TypeScript
- **Base de datos**: PostgreSQL con extensión PostGIS (imagen `postgis/postgis:16-master`)
- **ORM**: TypeORM 0.3 (con migraciones, sin `synchronize`)
- **Caché**: Redis vía `ioredis`
- **Correo**: Nodemailer (SMTP por envs)
- **Mapas**: Mapbox Static Images API (en plantilla HTML del correo)
- **Logging / observabilidad**: Winston + Azure Application Insights
- **Despliegue**: Docker (imagen `node:25-alpine`) publicada a GHCR vía GitHub Actions

## API REST

Prefijo global `/api`, CORS habilitado (`src/main.ts`).

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/api/incidents` | Crea un incidente, invalida caché y envía correo de notificación. |
| `GET`  | `/api/incidents` | Lista todos los incidentes; lee/escribe caché bajo `incidents:all`. |
| `GET`  | `/api/incidents/radius?lat&lon&radiusInMeters` | Búsqueda por radio con `ST_DWithin` (radio en **metros**). |

DTO de entrada `IncidentCDto` (`src/core/interfaces/incident.interface.ts`):

```ts
{ title: string; description: string; lat: number; lon: number; type: IncidentType }
```

## Modelo de datos

- **`Incident`** (`src/core/db/entities/incident.entity.ts`)
  - `id: number` (PK auto)
  - `title: string`
  - `description: string`
  - `location: Point` — PostGIS `geometry(Point, 4326)` con shape GeoJSON `{ type: 'Point', coordinates: [lon, lat] }` (¡lon primero!)
  - `type: IncidentType`
- **`IncidentType`** (`src/core/enums/incident-type.enum.ts`): enum numérico con 23 categorías y metadatos (color, agrupación) usados por la plantilla del correo.
- **`User`** y **`PendingEmails`**: archivos presentes pero vacíos, reservados para extensiones futuras.

## Estructura de carpetas

```
src/
├── incidents/            # Controller, service, DTOs, plantilla del correo
├── cache/                # CacheService (wrapper de ioredis con JSON)
├── email/                # EmailService (Nodemailer)
├── core/
│   ├── db/               # data-source, entities, migrations
│   ├── enums/            # IncidentType
│   ├── interfaces/       # IncidentCDto, EmailOptions
│   └── utils/            # Utilidades (Mapbox, etc.)
├── config/               # envs.ts (env-var), logger.ts (Winston + AppInsights)
├── app.module.ts
└── main.ts
```

## Comandos

```bash
# Dev / build / run
npm run start:dev       # watch mode
npm run start:prod      # corre dist/main (debe construirse antes)
npm run build           # nest build → dist/

# Calidad
npm run lint            # eslint --fix sobre src/, apps/, libs/, test/
npm run format          # prettier write sobre src/ y test/

# Tests (Jest; rootDir es src/, testRegex .*\.spec\.ts$)
npm run test
npm run test:cov
npm run test:e2e        # usa test/jest-e2e.json
npx jest path/to/file.spec.ts          # un solo archivo
npx jest -t "name of test"             # por nombre de test

# Migraciones TypeORM (el script typeorm corre `npm run build` primero,
# porque data-source.ts apunta a dist/core/db/migrations/*)
npm run migration:generate -- src/core/db/migrations/<Name>
npm run migration:run
docker exec -it IncidentAPI npm run migration:run

# Stack completo (api + postgis + redis)
docker compose up
```

## Variables de entorno

Todas las variables en `src/config/envs.ts` están declaradas `required()` vía `env-var` — la app falla rápido al boot si falta cualquiera. Lista completa en `compose.yaml`: `PORT`, `DB_*`, `REDIS_*`, `MAILER_*`, `MAPBOX_TOKEN`, `APPINSIGHTS_CONNECTION_STRING`.

## Arquitectura y gotchas

### Module graph
`AppModule` cablea tres módulos de feature más TypeORM: `EmailModule`, `IncidentsModule`, `CacheModule`, y `TypeOrmModule.forRoot(dataSourceOptions)`. `CacheModule` y `EmailModule` se reimportan en `IncidentsModule` para inyectar sus servicios allí.

### Path aliases
Los imports usan rutas planas `src/...` (ej. `from 'src/config/envs'`) gracias a `tsconfig.json` `baseUrl: "./"`. Mantén nuevos imports consistentes con este estilo.

### Base de datos / geoespacial
- `Incident.location` usa GeoJSON con orden **lon-first** (`[lon, lat]`), opuesto al `lat, lon` del API HTTP.
- `synchronize: false` — el esquema se gestiona **solo** vía migraciones en `src/core/db/migrations/`. El data source carga migraciones compiladas desde `dist/core/db/migrations/*`, por eso `npm run typeorm` construye primero.
- La búsqueda por radio usa `ST_DWithin(location::geography, ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography, radius)` con `radius` en **metros**.
- Compose usa `postgis/postgis:16-master` — un `postgres` plano no funciona porque la entidad requiere la extensión PostGIS.

### Caché
- `CacheService` (`src/cache/cache.service.ts`) es un wrapper delgado sobre `ioredis` con `get<T>` / `set` / `delete` y (de)serialización JSON.
- `IncidentsService.getIncidents()` cachea la lista completa bajo `incidents:all` **sin TTL**; `createIncident()` invalida esa clave después de escribir. Si agregas mutaciones (update/delete), también deben invalidar esta clave o las lecturas obsoletas persistirán indefinidamente.
- `IncidentsService` actualmente instancia su propio cliente `Redis` raw (líneas 29-32) además de inyectar `CacheService`, y usa el cliente raw para escribir la entrada de caché en miss. **Deuda técnica**: extender `CacheService` antes que añadir más clientes raw.

### Logging / observabilidad
`src/config/logger.ts` inicializa Application Insights como side effect al importar (`appInsights.setup(...).start()`) y expone un `logger` Winston cuyo transporte personalizado reenvía cada registro a AppInsights vía `trackTrace`. **Importar el logger en cualquier lugar arranca AppInsights implícitamente** — no introduzcas una segunda llamada a `appInsights.setup`.

### Email
`EmailService.sendEmail` usa un transporte de Nodemailer configurado desde envs `MAILER_*`. **Nota**: `IncidentsService.createIncident` envía a un **destinatario hardcoded** (`testx8239@gmail.com`, `src/incidents/incidents.service.ts:114`); si necesitas destinatario dinámico, cámbialo allí.

## Pruebas

Cobertura mínima: solo existe `src/app.controller.spec.ts` (test trivial del controller raíz). **No hay tests para `IncidentsService` ni para los endpoints de incidentes** — ten en cuenta esto al cambiar lógica crítica (geo, caché, email).

## Despliegue

`.github/workflows/build.yml` construye y publica una imagen Docker en GHCR en cada push a `main`. El `Dockerfile` es un build single-stage `node:25-alpine` que corre `npm install` + `npm run build` y arranca `node dist/main.js`.

> Issue conocido: en el workflow hay un typo `ghrc.io` que debería ser `ghcr.io` — verifica antes de depender del tag publicado.
