-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "UploadFolder" AS ENUM ('AVATARS', 'CHAT', 'THUMBNAILS', 'SOUNDS');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Repair uploads columns if a previous attempt created them with UUID types.
DO $$ BEGIN
  ALTER TABLE IF EXISTS "uploads" DROP CONSTRAINT IF EXISTS "uploads_uploaded_by_id_fkey";
  ALTER TABLE IF EXISTS "uploads" ALTER COLUMN "id" TYPE TEXT USING "id"::text;
  ALTER TABLE IF EXISTS "uploads" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;
  ALTER TABLE IF EXISTS "uploads" ALTER COLUMN "uploaded_by_id" TYPE TEXT USING "uploaded_by_id"::text;
EXCEPTION
  WHEN undefined_table THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "uploads" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "folder" "UploadFolder" NOT NULL,
    "filename" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploaded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uploads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "uploads_folder_idx" ON "uploads"("folder");
CREATE INDEX IF NOT EXISTS "uploads_uploaded_by_id_idx" ON "uploads"("uploaded_by_id");
CREATE INDEX IF NOT EXISTS "uploads_created_at_idx" ON "uploads"("created_at");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "uploads" ADD CONSTRAINT "uploads_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;