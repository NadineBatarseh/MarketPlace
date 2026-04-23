-- Add isPublish boolean column to products table
-- TRUE is the default so all existing products remain visible
ALTER TABLE products ADD COLUMN IF NOT EXISTS "isPublish" BOOLEAN NOT NULL DEFAULT TRUE;

-- Backfill any NULLs that existed before the DEFAULT was applied
UPDATE products SET "isPublish" = TRUE WHERE "isPublish" IS NULL;
