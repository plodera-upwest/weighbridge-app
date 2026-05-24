-- Performance indexes for large weighbridge datasets.
-- Run during a low-traffic maintenance window. CONCURRENTLY keeps tables writable
-- but each statement must run outside a transaction block.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Master-data lookup and searchable dropdown support.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_users_role_active_created_at"
  ON "User" ("role", "active", "createdAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_vehicles_transporter"
  ON "Vehicle" ("transporter");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_vehicles_vehicle_no_trgm"
  ON "Vehicle" USING gin ("vehicleNo" gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_drivers_name"
  ON "Driver" ("name");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_drivers_name_trgm"
  ON "Driver" USING gin ("name" gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_parties_type_name"
  ON "Party" ("type", "name");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_parties_name_trgm"
  ON "Party" USING gin ("name" gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_products_name_trgm"
  ON "Product" USING gin ("name" gin_trgm_ops);

-- Transaction list, dashboards, slip lookup, and date-range reports.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_transactions_status_created_at"
  ON "Transaction" ("status", "createdAt" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_transactions_created_at"
  ON "Transaction" ("createdAt" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_transactions_first_weighed_at"
  ON "Transaction" ("firstWeighedAt" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_transactions_final_weighed_at"
  ON "Transaction" ("finalWeighedAt" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_transactions_vehicle_created_at"
  ON "Transaction" ("vehicleId", "createdAt" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_transactions_driver_created_at"
  ON "Transaction" ("driverId", "createdAt" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_transactions_party_created_at"
  ON "Transaction" ("partyId", "createdAt" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_transactions_operator_created_at"
  ON "Transaction" ("operatorId", "createdAt" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_transactions_status_party_created_at"
  ON "Transaction" ("status", "partyId", "createdAt" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_transactions_transaction_no_trgm"
  ON "Transaction" USING gin ("transactionNo" gin_trgm_ops);

-- Product-wise weighing and product reports.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_product_entries_transaction_sequence"
  ON "ProductWeightEntry" ("transactionId", "sequence");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_product_entries_product_captured_at"
  ON "ProductWeightEntry" ("productId", "capturedAt" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_product_entries_captured_at"
  ON "ProductWeightEntry" ("capturedAt" DESC);

-- Camera, reprint, and audit history.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_camera_images_transaction_captured_at"
  ON "CameraImage" ("transactionId", "capturedAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_camera_images_camera_captured_at"
  ON "CameraImage" ("cameraId", "capturedAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_camera_settings_active_display"
  ON "CameraSetting" ("active", "displayOnSlip", "displayOrder");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_weighbridge_settings_active_order"
  ON "WeighbridgeSetting" ("active", "displayOrder");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_reprint_logs_transaction_created_at"
  ON "ReprintLog" ("transactionId", "createdAt" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_reprint_logs_created_at"
  ON "ReprintLog" ("createdAt" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_audit_logs_created_at"
  ON "AuditLog" ("createdAt" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_audit_logs_user_created_at"
  ON "AuditLog" ("userId", "createdAt" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_audit_logs_action_created_at"
  ON "AuditLog" ("action", "createdAt" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_audit_logs_entity_created_at"
  ON "AuditLog" ("entityType", "entityId", "createdAt" DESC);

-- Recommended post-migration maintenance:
-- VACUUM (ANALYZE) "Transaction";
-- VACUUM (ANALYZE) "ProductWeightEntry";
-- VACUUM (ANALYZE) "AuditLog";
