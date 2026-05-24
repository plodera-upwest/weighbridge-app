# Database Performance Plan

## Current Runtime Finding

The checked-in Prisma schema targets PostgreSQL, but the current Express server still reads and writes `data/runtime-db.json` through `readDb()` and `writeDb()`. That JSON repository is acceptable for a prototype, but it will not remain fast at hundreds of thousands or millions of records because each request loads and scans the full file in memory.

The PostgreSQL migration in `database/migrations/20260521090000_performance_indexes/migration.sql` prepares the production schema for high-volume use. The backend should be switched from the JSON repository to Prisma/PostgreSQL before production-scale data is loaded.

## Implemented Index Strategy

High-volume transaction access:

- `Transaction(status, createdAt desc)` for open/in-progress/completed dashboards and lists.
- `Transaction(createdAt desc)` for date-range reports.
- `Transaction(firstWeighedAt desc)` and `Transaction(finalWeighedAt desc)` for weighment date reports.
- `Transaction(vehicleId, createdAt desc)` for vehicle-wise reports.
- `Transaction(driverId, createdAt desc)` for driver/operator workflows.
- `Transaction(partyId, createdAt desc)` for customer/supplier reports.
- `Transaction(operatorId, createdAt desc)` for operator reports.
- `Transaction(status, partyId, createdAt desc)` for combined status/customer filters.

Product/camera/audit history:

- `ProductWeightEntry(transactionId, sequence)` for slip detail loading.
- `ProductWeightEntry(productId, capturedAt desc)` for product-wise reports.
- `CameraImage(transactionId, capturedAt)` for slip camera evidence.
- `ReprintLog(transactionId, createdAt desc)` and `ReprintLog(createdAt desc)`.
- `AuditLog(createdAt desc)`, `AuditLog(userId, createdAt desc)`, `AuditLog(action, createdAt desc)`, and `AuditLog(entityType, entityId, createdAt desc)`.

Search/dropdowns:

- `pg_trgm` indexes for vehicle number, driver name, party name, product name, and transaction number.

## API Pagination And Filtering

The current JSON backend now supports optional pagination/filtering on:

- `GET /api/transactions?page=1&limit=100`
- `GET /api/transactions?status=COMPLETED&dateFrom=2026-05-01&dateTo=2026-05-21`
- `GET /api/transactions?partyId=...&vehicleId=...&productId=...&search=...`
- `GET /api/audit-logs?page=1&limit=100&action=LOGIN`
- `GET /api/vehicles|drivers|parties|products?page=1&limit=100&search=...`
- `GET /api/reports/:type/export?dateFrom=...&dateTo=...&status=...`

For backwards compatibility, endpoints still return the existing array shape when no pagination/filter query parameters are provided.

## EXPLAIN ANALYZE Checks

After migrating to PostgreSQL and loading realistic data, run:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, "transactionNo", status, "createdAt", "vehicleId", "partyId"
FROM "Transaction"
WHERE status = 'COMPLETED'
  AND "createdAt" >= now() - interval '30 days'
ORDER BY "createdAt" DESC
LIMIT 100;

EXPLAIN (ANALYZE, BUFFERS)
SELECT t.id, t."transactionNo", t."createdAt", p.name
FROM "ProductWeightEntry" e
JOIN "Transaction" t ON t.id = e."transactionId"
JOIN "Product" p ON p.id = e."productId"
WHERE e."productId" = $1
  AND e."capturedAt" >= $2
ORDER BY e."capturedAt" DESC
LIMIT 100;

EXPLAIN (ANALYZE, BUFFERS)
SELECT id, "createdAt", action, "entityType", "entityId"
FROM "AuditLog"
WHERE "entityType" = 'TRANSACTION'
  AND "entityId" = $1
ORDER BY "createdAt" DESC
LIMIT 100;
```

Healthy plans should use `Index Scan`, `Bitmap Index Scan`, or small `Nested Loop` plans with low buffer reads. Large `Seq Scan` plans on `Transaction`, `ProductWeightEntry`, or `AuditLog` need investigation.

## Maintenance

Run after large imports or index deployment:

```sql
VACUUM (ANALYZE) "Transaction";
VACUUM (ANALYZE) "ProductWeightEntry";
VACUUM (ANALYZE) "AuditLog";
VACUUM (ANALYZE) "CameraImage";
```

Recommended PostgreSQL settings for production:

- Enable autovacuum and monitor dead tuples.
- Use PgBouncer or Prisma connection pooling in production.
- Keep API pagination limits bounded; avoid unbounded report exports in the UI.
- Export very large reports asynchronously rather than holding one HTTP request open.

## Future Partitioning

When `Transaction`, `ProductWeightEntry`, `CameraImage`, or `AuditLog` reaches multi-million-row scale, partition by time:

- `Transaction` by `createdAt`, monthly or quarterly.
- `ProductWeightEntry` by `capturedAt`.
- `AuditLog` by `createdAt`.
- `CameraImage` by `capturedAt`.

Partitioning should be introduced before tables become difficult to rewrite. It is intentionally not applied in this migration because converting existing Prisma-managed tables to partitions changes table ownership and constraints, and should be a planned production cutover.

## Archive Policy

Suggested archive thresholds:

- Keep completed transactions online for 2-3 years, depending on audit requirements.
- Keep audit logs online for 1-2 years, then archive to cheaper storage.
- Store camera binaries/object snapshots outside PostgreSQL; keep only references and metadata in the database.

Archive jobs should move old rows in batches ordered by date, followed by `VACUUM (ANALYZE)` on affected tables.
