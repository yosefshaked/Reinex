export const SETUP_SQL_SCRIPT = `-- =================================================================
-- TutTiud Tenant Database Setup Script
-- =================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pgjwt" WITH SCHEMA extensions;
CREATE SCHEMA IF NOT EXISTS tuttiud;

CREATE TABLE IF NOT EXISTS tuttiud."Instructors" (
  "id" uuid NOT NULL PRIMARY KEY,
  "name" text NOT NULL,
  "email" text,
  "phone" text,
  "is_active" boolean DEFAULT true,
  "notes" text,
  "metadata" jsonb
);
ALTER TABLE tuttiud."Instructors"
  ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE tuttiud."Instructors"
  DROP CONSTRAINT IF EXISTS "Instructors_id_fkey";

-- Ensure instructor_types (array) column exists (idempotent)
ALTER TABLE tuttiud."Instructors"
  ADD COLUMN IF NOT EXISTS "instructor_types" uuid[];

-- Migrate legacy instructor_type (text) to instructor_types (uuid[]) if column exists
DO $$
DECLARE
  has_old_column boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'tuttiud'
      AND table_name = 'Instructors'
      AND column_name = 'instructor_type'
  ) INTO has_old_column;

  IF has_old_column THEN
    -- Copy non-null values from instructor_type to instructor_types as single-element arrays
    UPDATE tuttiud."Instructors"
    SET "instructor_types" = ARRAY["instructor_type"::uuid]
    WHERE "instructor_type" IS NOT NULL
      AND "instructor_type" != ''
      AND "instructor_types" IS NULL;

    -- Drop the old column
    ALTER TABLE tuttiud."Instructors" DROP COLUMN "instructor_type";
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS tuttiud."Students" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "name" text NOT NULL,
  "national_id" text,
  "contact_info" text,
  "contact_name" text,
  "contact_phone" text,
  "assigned_instructor_id" uuid REFERENCES tuttiud."Instructors"("id"),
  "default_day_of_week" integer,
  "default_session_time" time with time zone,
  "default_service" text,
  "tags" uuid[],
  "notes" text,
  "metadata" jsonb
);

-- Ensure all new columns exist (idempotent)
ALTER TABLE tuttiud."Students"
  ADD COLUMN IF NOT EXISTS "contact_name" text,
  ADD COLUMN IF NOT EXISTS "contact_phone" text,
  ADD COLUMN IF NOT EXISTS "default_day_of_week" integer,
  ADD COLUMN IF NOT EXISTS "default_session_time" time with time zone,
  ADD COLUMN IF NOT EXISTS "default_service" text,
  ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true;

UPDATE tuttiud."Students"
SET "is_active" = true
WHERE "is_active" IS NULL;

ALTER TABLE tuttiud."Students"
  DROP CONSTRAINT IF EXISTS "Students_assigned_instructor_id_fkey";

-- MIGRATION: If tags column exists and is text[], convert to uuid[]
DO $$
DECLARE
  tags_oid oid;
  tags_type text;
BEGIN
  SELECT atttypid INTO tags_oid
  FROM pg_attribute
  WHERE attrelid = 'tuttiud."Students"'::regclass
    AND attname = 'tags';

  IF tags_oid IS NOT NULL THEN
    SELECT typname INTO tags_type FROM pg_type WHERE oid = tags_oid;
    -- In PostgreSQL, array types have underscore prefix: text[] = '_text', uuid[] = '_uuid'
    IF tags_type = '_text' THEN
      -- Migrate text[] to uuid[] safely
      ALTER TABLE tuttiud."Students"
        ADD COLUMN IF NOT EXISTS "__tags_uuid" uuid[];

      UPDATE tuttiud."Students"
      SET "__tags_uuid" = (
        CASE
          WHEN tags IS NULL THEN NULL
          ELSE ARRAY(
            SELECT NULLIF(trim(t), '')::uuid
            FROM unnest(tags) AS t
            WHERE trim(t) ~* '^[0-9a-fA-F-]{36}$'
          )
        END
      );

      ALTER TABLE tuttiud."Students" DROP COLUMN "tags";
      ALTER TABLE tuttiud."Students" RENAME COLUMN "__tags_uuid" TO "tags";
    END IF;
  END IF;
END
$$;

-- If tags column does not exist, add it as uuid[]
ALTER TABLE tuttiud."Students"
  ADD COLUMN IF NOT EXISTS "tags" uuid[];
ALTER TABLE tuttiud."Students"
  ADD COLUMN IF NOT EXISTS "national_id" text,
  ADD COLUMN IF NOT EXISTS "contact_name" text,
  ADD COLUMN IF NOT EXISTS "contact_phone" text,
  ADD COLUMN IF NOT EXISTS "default_day_of_week" integer,
  ADD COLUMN IF NOT EXISTS "default_session_time" time with time zone,
  ADD COLUMN IF NOT EXISTS "default_service" text,
  ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true;

UPDATE tuttiud."Students"
SET "is_active" = true
WHERE "is_active" IS NULL;
ALTER TABLE tuttiud."Students"
  DROP CONSTRAINT IF EXISTS "Students_assigned_instructor_id_fkey";
DO $$
DECLARE
  has_user_id boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'tuttiud'
      AND table_name = 'Instructors'
      AND column_name = 'user_id'
  ) INTO has_user_id;

  IF has_user_id THEN
    UPDATE tuttiud."Students" s
    SET assigned_instructor_id = i.user_id
    FROM tuttiud."Instructors" i
    WHERE s.assigned_instructor_id = i.id
      AND i.user_id IS NOT NULL
      AND s.assigned_instructor_id IS DISTINCT FROM i.user_id;

    UPDATE tuttiud."Instructors"
    SET id = user_id
    WHERE user_id IS NOT NULL
      AND id IS DISTINCT FROM user_id;
  END IF;
END;
$$;
ALTER TABLE tuttiud."Instructors"
  DROP COLUMN IF EXISTS "user_id";
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'tuttiud'
      AND table_name = 'Students'
      AND constraint_name = 'Students_assigned_instructor_id_fkey'
  ) THEN
    ALTER TABLE tuttiud."Students"
      ADD CONSTRAINT "Students_assigned_instructor_id_fkey"
      FOREIGN KEY ("assigned_instructor_id") REFERENCES tuttiud."Instructors"("id");
  END IF;
END;
$$;
CREATE TABLE IF NOT EXISTS tuttiud."SessionRecords" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "date" date NOT NULL,
  "student_id" uuid REFERENCES tuttiud."Students"("id"),
  "instructor_id" uuid REFERENCES tuttiud."Instructors"("id"),
  "service_context" text,
  "content" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz DEFAULT now(),
  "deleted" boolean NOT NULL DEFAULT false,
  "deleted_at" timestamptz,
  "is_legacy" boolean NOT NULL DEFAULT false,
  "metadata" jsonb
);
-- Allow loose reports: student_id may be NULL (idempotent)
ALTER TABLE tuttiud."SessionRecords"
  ALTER COLUMN "student_id" DROP NOT NULL;
ALTER TABLE tuttiud."SessionRecords"
  ADD COLUMN IF NOT EXISTS "service_context" text,
  ADD COLUMN IF NOT EXISTS "content" jsonb,
  ADD COLUMN IF NOT EXISTS "deleted" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "is_legacy" boolean NOT NULL DEFAULT false;
DO $$
DECLARE
  column_type text;
  record_row RECORD;
  parsed jsonb;
BEGIN
  SELECT data_type INTO column_type
  FROM information_schema.columns
  WHERE table_schema = 'tuttiud'
    AND table_name = 'SessionRecords'
    AND column_name = 'content';

  IF column_type IS NOT NULL AND column_type <> 'jsonb' THEN
    ALTER TABLE tuttiud."SessionRecords"
      ADD COLUMN IF NOT EXISTS "__content_jsonb" jsonb;

    FOR record_row IN
      SELECT "id", "content"
      FROM tuttiud."SessionRecords"
    LOOP
      IF record_row.content IS NULL THEN
        parsed := NULL;
      ELSE
        BEGIN
          parsed := record_row.content::jsonb;
        EXCEPTION WHEN others THEN
          parsed := to_jsonb(record_row.content);
        END;
      END IF;

      UPDATE tuttiud."SessionRecords"
      SET "__content_jsonb" = parsed
      WHERE "id" = record_row.id;
    END LOOP;

    ALTER TABLE tuttiud."SessionRecords" DROP COLUMN "content";
    ALTER TABLE tuttiud."SessionRecords" RENAME COLUMN "__content_jsonb" TO "content";
  END IF;
END;
$$;
CREATE TABLE IF NOT EXISTS tuttiud."Settings" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "key" text NOT NULL UNIQUE,
  "settings_value" jsonb NOT NULL,
  "metadata" jsonb
);
ALTER TABLE tuttiud."Settings"
  ADD COLUMN IF NOT EXISTS "metadata" jsonb;

-- =================================================================
-- Documents Table (Polymorphic File Storage)
-- =================================================================
CREATE TABLE IF NOT EXISTS tuttiud."Documents" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "entity_type" text NOT NULL CHECK ("entity_type" IN ('student', 'instructor', 'organization')),
  "entity_id" uuid NOT NULL,
  "name" text NOT NULL,
  "original_name" text NOT NULL,
  "relevant_date" date,
  "expiration_date" date,
  "resolved" boolean DEFAULT false,
  "url" text,
  "path" text NOT NULL,
  "storage_provider" text,
  "uploaded_at" timestamptz NOT NULL DEFAULT now(),
  "uploaded_by" uuid,
  "definition_id" uuid,
  "definition_name" text,
  "size" bigint,
  "type" text,
  "hash" text,
  "metadata" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- Ensure id column has DEFAULT gen_random_uuid() (for existing tables created without it)
ALTER TABLE tuttiud."Documents"
  ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- Indexes for performance
CREATE INDEX IF NOT EXISTS "Documents_entity_idx" ON tuttiud."Documents" ("entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "Documents_uploaded_at_idx" ON tuttiud."Documents" ("uploaded_at");
CREATE INDEX IF NOT EXISTS "Documents_expiration_idx" ON tuttiud."Documents" ("expiration_date") WHERE "expiration_date" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "Documents_hash_idx" ON tuttiud."Documents" ("hash") WHERE "hash" IS NOT NULL;

-- NOTE: Legacy file migration has been removed.
-- The Documents table is the source of truth for all file metadata.
-- Legacy endpoints (student-files, instructor-files) have been replaced with /api/documents.
-- If you have existing deployments with data in Students.files or Instructors.files columns,
-- you must manually migrate that data to the Documents table before removing those columns.
-- For fresh deployments, no migration is needed - Documents table is the only storage mechanism.

-- =================================================================
-- Documents Table RLS Policies
-- =================================================================
ALTER TABLE tuttiud."Documents" ENABLE ROW LEVEL SECURITY;

-- Policy: Allow authenticated users and app_user role to view documents
DROP POLICY IF EXISTS "Documents_view_policy" ON tuttiud."Documents";
CREATE POLICY "Documents_view_policy" ON tuttiud."Documents"
  FOR SELECT
  TO authenticated, app_user
  USING (true);

-- Policy: Allow authenticated users and app_user role to insert documents
DROP POLICY IF EXISTS "Documents_insert_policy" ON tuttiud."Documents";
CREATE POLICY "Documents_insert_policy" ON tuttiud."Documents"
  FOR INSERT
  TO authenticated, app_user
  WITH CHECK (true);

-- Policy: Allow authenticated users and app_user role to update documents
DROP POLICY IF EXISTS "Documents_update_policy" ON tuttiud."Documents";
CREATE POLICY "Documents_update_policy" ON tuttiud."Documents"
  FOR UPDATE
  TO authenticated, app_user
  USING (true)
  WITH CHECK (true);

-- Policy: Allow authenticated users and app_user role to delete documents
DROP POLICY IF EXISTS "Documents_delete_policy" ON tuttiud."Documents";
CREATE POLICY "Documents_delete_policy" ON tuttiud."Documents"
  FOR DELETE
  TO authenticated, app_user
  USING (true);

CREATE INDEX IF NOT EXISTS "SessionRecords_student_date_idx" ON tuttiud."SessionRecords" ("student_id", "date");
CREATE INDEX IF NOT EXISTS "SessionRecords_instructor_idx" ON tuttiud."SessionRecords" ("instructor_id");

-- Part 3: Row Level Security (RLS) Setup - NOW IDEMPOTENT

-- Enable RLS on all tables
ALTER TABLE tuttiud."Instructors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE tuttiud."Students" ENABLE ROW LEVEL SECURITY;
ALTER TABLE tuttiud."SessionRecords" ENABLE ROW LEVEL SECURITY;
ALTER TABLE tuttiud."Settings" ENABLE ROW LEVEL SECURITY;

-- Policies for "Instructors"
DROP POLICY IF EXISTS "Allow full access to authenticated users on Instructors" ON tuttiud."Instructors";
CREATE POLICY "Allow full access to authenticated users on Instructors" ON tuttiud."Instructors" FOR ALL TO authenticated, app_user USING (true) WITH CHECK (true);

-- Policies for "Students"
DROP POLICY IF EXISTS "Allow full access to authenticated users on Students" ON tuttiud."Students";
CREATE POLICY "Allow full access to authenticated users on Students" ON tuttiud."Students" FOR ALL TO authenticated, app_user USING (true) WITH CHECK (true);

-- Policies for "SessionRecords"
DROP POLICY IF EXISTS "Allow full access to authenticated users on SessionRecords" ON tuttiud."SessionRecords";
CREATE POLICY "Allow full access to authenticated users on SessionRecords" ON tuttiud."SessionRecords" FOR ALL TO authenticated, app_user USING (true) WITH CHECK (true);

-- Policies for "Settings"
DROP POLICY IF EXISTS "Allow full access to authenticated users on Settings" ON tuttiud."Settings";
CREATE POLICY "Allow full access to authenticated users on Settings" ON tuttiud."Settings" FOR ALL TO authenticated, app_user USING (true) WITH CHECK (true);


-- Part 4: Application Role and Permissions (No Changes)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user;
  END IF;
END
$$;
GRANT USAGE ON SCHEMA tuttiud TO app_user;
GRANT ALL ON ALL TABLES IN SCHEMA tuttiud TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA tuttiud GRANT ALL ON TABLES TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA tuttiud TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA tuttiud GRANT USAGE, SELECT ON SEQUENCES TO app_user;
GRANT app_user TO postgres, authenticated, anon;


-- Part 5: Diagnostics Function (Extended for MVP checks)
CREATE OR REPLACE FUNCTION tuttiud.setup_assistant_diagnostics()
RETURNS TABLE (check_name text, success boolean, details text)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  required_tables constant text[] := array['Instructors', 'Students', 'SessionRecords', 'Settings'];
  required_indexes constant text[] := array[
    'SessionRecords|SessionRecords_student_date_idx',
    'SessionRecords|SessionRecords_instructor_idx'
  ];
  required_policies constant text[] := array[
    'Instructors|Allow full access to authenticated users on Instructors',
    'Students|Allow full access to authenticated users on Students',
    'SessionRecords|Allow full access to authenticated users on SessionRecords',
    'Settings|Allow full access to authenticated users on Settings'
  ];
  table_name text;
  policy_spec text;
  policy_parts text[];
  policy_table text;
  policy_name text;
  index_spec text;
  index_parts text[];
  index_table text;
  index_name text;
BEGIN
  success := EXISTS(SELECT 1 FROM pg_namespace WHERE nspname = 'tuttiud');
  check_name := 'Schema "tuttiud" exists';
  details := CASE WHEN success THEN 'OK' ELSE 'Schema "tuttiud" not found.' END;
  RETURN NEXT;
  success := EXISTS(SELECT 1 FROM pg_roles WHERE rolname = 'app_user');
  check_name := 'Role "app_user" exists';
  details := CASE WHEN success THEN 'OK' ELSE 'Role "app_user" not found.' END;
  RETURN NEXT;
  FOREACH table_name IN ARRAY required_tables LOOP
    success := to_regclass('tuttiud.' || quote_ident(table_name)) IS NOT NULL;
    check_name := 'Table "' || table_name || '" exists';
    details := CASE WHEN success THEN 'OK' ELSE 'Table ' || table_name || ' is missing.' END;
    RETURN NEXT;
  END LOOP;
  FOREACH table_name IN ARRAY required_tables LOOP
    success := EXISTS(
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'tuttiud'
        AND c.relname = table_name
        AND c.relrowsecurity = true
    );
    check_name := 'RLS enabled on "' || table_name || '"';
    details := CASE WHEN success THEN 'OK' ELSE 'RLS is not enabled on ' || table_name || '.' END;
    RETURN NEXT;
  END LOOP;
  FOREACH policy_spec IN ARRAY required_policies LOOP
    policy_parts := string_to_array(policy_spec, '|');
    policy_table := policy_parts[1];
    policy_name := policy_parts[2];
    success := EXISTS(
      SELECT 1
      FROM pg_policies p
      WHERE p.schemaname = 'tuttiud'
        AND p.tablename = policy_table
        AND p.policyname = policy_name
    );
    check_name := 'Policy "' || policy_name || '" on "' || policy_table || '" exists';
    details := CASE WHEN success THEN 'OK' ELSE 'Policy ' || policy_name || ' is missing.' END;
    RETURN NEXT;
  END LOOP;
  FOREACH index_spec IN ARRAY required_indexes LOOP
    index_parts := string_to_array(index_spec, '|');
    index_table := index_parts[1];
    index_name := index_parts[2];
    success := EXISTS(
      SELECT 1
      FROM pg_indexes i
      WHERE i.schemaname = 'tuttiud'
        AND i.tablename = index_table
        AND i.indexname = index_name
    );
    check_name := 'Index "' || index_name || '" on "' || index_table || '" exists';
    details := CASE WHEN success THEN 'OK' ELSE 'Index ' || index_name || ' is missing.' END;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- Helper function to remove a specific tag UUID from all students
CREATE OR REPLACE FUNCTION tuttiud.remove_tag_from_students(tag_to_remove uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE tuttiud."Students"
  SET tags = array_remove(tags, tag_to_remove)
  WHERE tags @> ARRAY[tag_to_remove];
END;
$$;

-- Ensure RPC permissions
GRANT EXECUTE ON FUNCTION tuttiud.remove_tag_from_students(uuid) TO authenticated, service_role;


-- Part 6: Generate the Application-Specific JWT (No Changes)
SELECT extensions.sign(
  json_build_object(
    'role', 'app_user',
    'exp', (EXTRACT(EPOCH FROM (NOW() + INTERVAL '5 year')))::integer,
    'iat', (EXTRACT(EPOCH FROM NOW()))::integer
  ),
  'YOUR_SUPER_SECRET_AND_LONG_JWT_SECRET_HERE'
) AS "APP_DEDICATED_KEY (COPY THIS BACK TO THE APP)";
`;

