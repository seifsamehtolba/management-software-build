# Deployment and Ops Runbook

## Environment Variables
- `DATABASE_URL`: PostgreSQL connection string.
- `NEXTAUTH_SECRET`: Secret used to sign NextAuth JWT/session data.
- `NEXTAUTH_URL`: Public application base URL.
- `ETA_API_URL`: ETA provider base URL.
- `ETA_API_KEY`: ETA provider API key/token.
- `ETA_TIMEOUT_MS`: ETA submit timeout in milliseconds.

## Pre-Deploy Checklist
1. Install dependencies: `npm ci`
2. Run unit tests: `npm run test -- --run`
3. Run lint: `npm run lint`
4. Build app: `npm run build`
5. Confirm env vars exist in target environment.

## Database Migration Runbook
1. Create and review migration locally:
   - `npx prisma migrate dev --name <migration_name>`
2. Validate build and runtime paths.
3. Deploy migration in target environment:
   - `npx prisma migrate deploy`
4. Regenerate Prisma client if needed:
   - `npx prisma generate`

## Backup Strategy
- Use daily automated PostgreSQL backups (full snapshot).
- Keep point-in-time recovery (PITR) enabled when provider supports it.
- Retain at least 14 daily backups and 8 weekly backups.
- Run monthly restore drills in a staging database and verify key tables:
  - `Sale`, `SaleItem`, `Payment`, `StockLevel`, `RepairTicket`, `PurchaseOrder`.

## Incident Quick Actions
- **Sync queue growth**: inspect `/settings` sync panel for conflicts/failed items and retry/resolve.
- **ETA failures**: inspect `GET /api/eta/invoices` and trigger `POST /api/eta/invoices/retry`.
- **Auth/session issues**: verify `NEXTAUTH_SECRET` and URL consistency across environments.
