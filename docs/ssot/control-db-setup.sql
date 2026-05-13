-- =================================================================
-- Control DB Base Core (SSOT segment)
-- =================================================================

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS graphql;
CREATE SCHEMA IF NOT EXISTS vault;

CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA graphql;
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA vault;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  slug text,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  supabase_url text,
  supabase_anon_key text,
  policy_links jsonb NOT NULL DEFAULT '{}'::jsonb,
  legal_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  setup_completed boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  dedicated_key_encrypted text,
  dedicated_key_saved_at timestamptz
);

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz,
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS supabase_url text,
  ADD COLUMN IF NOT EXISTS supabase_anon_key text,
  ADD COLUMN IF NOT EXISTS policy_links jsonb,
  ADD COLUMN IF NOT EXISTS legal_settings jsonb,
  ADD COLUMN IF NOT EXISTS setup_completed boolean,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS dedicated_key_encrypted text,
  ADD COLUMN IF NOT EXISTS dedicated_key_saved_at timestamptz;

ALTER TABLE public.organizations
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN created_by SET DEFAULT auth.uid(),
  ALTER COLUMN policy_links SET DEFAULT '{}'::jsonb,
  ALTER COLUMN legal_settings SET DEFAULT '{}'::jsonb,
  ALTER COLUMN setup_completed SET DEFAULT false,
  ALTER COLUMN updated_at SET DEFAULT now();

DO $$ BEGIN ALTER TABLE public.organizations ALTER COLUMN name SET NOT NULL; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.organizations ALTER COLUMN created_at SET NOT NULL; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.organizations ALTER COLUMN created_by SET NOT NULL; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.organizations ALTER COLUMN policy_links SET NOT NULL; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.organizations ALTER COLUMN legal_settings SET NOT NULL; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.organizations ALTER COLUMN setup_completed SET NOT NULL; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.organizations ALTER COLUMN updated_at SET NOT NULL; EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organizations_slug_key'
      AND conrelid = 'public.organizations'::regclass
  ) THEN
    ALTER TABLE public.organizations ADD CONSTRAINT organizations_slug_key UNIQUE (slug);
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.org_memberships (
  org_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  id uuid DEFAULT gen_random_uuid(),
  PRIMARY KEY (org_id, user_id),
  CONSTRAINT org_memberships_role_check CHECK (role IN ('owner', 'admin', 'member'))
);

ALTER TABLE public.org_memberships
  ADD COLUMN IF NOT EXISTS org_id uuid,
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS role text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz,
  ADD COLUMN IF NOT EXISTS id uuid;

ALTER TABLE public.org_memberships
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN id SET DEFAULT gen_random_uuid();

DO $$ BEGIN ALTER TABLE public.org_memberships ALTER COLUMN org_id SET NOT NULL; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.org_memberships ALTER COLUMN user_id SET NOT NULL; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.org_memberships ALTER COLUMN role SET NOT NULL; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.org_memberships ALTER COLUMN created_at SET NOT NULL; EXCEPTION WHEN others THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.org_settings (
  org_id uuid PRIMARY KEY,
  supabase_url text NOT NULL,
  anon_key text NOT NULL,
  metadata jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.org_settings
  ADD COLUMN IF NOT EXISTS org_id uuid,
  ADD COLUMN IF NOT EXISTS supabase_url text,
  ADD COLUMN IF NOT EXISTS anon_key text,
  ADD COLUMN IF NOT EXISTS metadata jsonb,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

ALTER TABLE public.org_settings ALTER COLUMN updated_at SET DEFAULT now();
DO $$ BEGIN ALTER TABLE public.org_settings ALTER COLUMN org_id SET NOT NULL; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.org_settings ALTER COLUMN supabase_url SET NOT NULL; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.org_settings ALTER COLUMN anon_key SET NOT NULL; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.org_settings ALTER COLUMN updated_at SET NOT NULL; EXCEPTION WHEN others THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.org_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  email text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  invited_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  token uuid NOT NULL DEFAULT gen_random_uuid(),
  CONSTRAINT org_invitations_status_check CHECK (status IN ('pending', 'sent', 'accepted', 'expired', 'revoked'))
);

ALTER TABLE public.org_invitations
  ADD COLUMN IF NOT EXISTS org_id uuid,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS invited_by uuid,
  ADD COLUMN IF NOT EXISTS created_at timestamptz,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS token uuid;

ALTER TABLE public.org_invitations
  ALTER COLUMN status SET DEFAULT 'pending',
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN token SET DEFAULT gen_random_uuid();

DO $$ BEGIN ALTER TABLE public.org_invitations ALTER COLUMN org_id SET NOT NULL; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.org_invitations ALTER COLUMN email SET NOT NULL; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.org_invitations ALTER COLUMN status SET NOT NULL; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.org_invitations ALTER COLUMN created_at SET NOT NULL; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.org_invitations ALTER COLUMN token SET NOT NULL; EXCEPTION WHEN others THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY,
  email text,
  full_name text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz
);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS full_name text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

ALTER TABLE public.profiles ALTER COLUMN created_at SET DEFAULT now();
COMMENT ON TABLE public.profiles IS 'Public-facing user profiles, mirroring data from auth.users.';

CREATE TABLE IF NOT EXISTS public.schema_migration_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  ssot_version_hash text NOT NULL,
  db_snapshot_hash_before text,
  db_snapshot_hash_after text,
  summary_counts jsonb,
  patch_plan_json jsonb,
  db_snapshot_before jsonb,
  db_snapshot_after jsonb,
  preflight_results jsonb,
  executed_sql_safe text,
  executed_sql_manual text,
  executed_result_json jsonb,
  approved_by_user_id uuid,
  approval_method text,
  approval_phrase text,
  status text NOT NULL
);

ALTER TABLE public.schema_migration_audit
  ADD COLUMN IF NOT EXISTS tenant_id uuid,
  ADD COLUMN IF NOT EXISTS created_at timestamptz,
  ADD COLUMN IF NOT EXISTS ssot_version_hash text,
  ADD COLUMN IF NOT EXISTS db_snapshot_hash_before text,
  ADD COLUMN IF NOT EXISTS db_snapshot_hash_after text,
  ADD COLUMN IF NOT EXISTS summary_counts jsonb,
  ADD COLUMN IF NOT EXISTS patch_plan_json jsonb,
  ADD COLUMN IF NOT EXISTS db_snapshot_before jsonb,
  ADD COLUMN IF NOT EXISTS db_snapshot_after jsonb,
  ADD COLUMN IF NOT EXISTS preflight_results jsonb,
  ADD COLUMN IF NOT EXISTS executed_sql_safe text,
  ADD COLUMN IF NOT EXISTS executed_sql_manual text,
  ADD COLUMN IF NOT EXISTS executed_result_json jsonb,
  ADD COLUMN IF NOT EXISTS approved_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS approval_method text,
  ADD COLUMN IF NOT EXISTS approval_phrase text,
  ADD COLUMN IF NOT EXISTS status text;

ALTER TABLE public.schema_migration_audit ALTER COLUMN created_at SET DEFAULT now();
DO $$ BEGIN ALTER TABLE public.schema_migration_audit ALTER COLUMN tenant_id SET NOT NULL; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.schema_migration_audit ALTER COLUMN created_at SET NOT NULL; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.schema_migration_audit ALTER COLUMN ssot_version_hash SET NOT NULL; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.schema_migration_audit ALTER COLUMN status SET NOT NULL; EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organizations_created_by_fkey' AND conrelid = 'public.organizations'::regclass) THEN
    ALTER TABLE public.organizations ADD CONSTRAINT organizations_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_memberships_org_id_fkey' AND conrelid = 'public.org_memberships'::regclass) THEN
    ALTER TABLE public.org_memberships ADD CONSTRAINT org_memberships_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_memberships_user_id_fkey' AND conrelid = 'public.org_memberships'::regclass) THEN
    ALTER TABLE public.org_memberships ADD CONSTRAINT org_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_settings_org_id_fkey' AND conrelid = 'public.org_settings'::regclass) THEN
    ALTER TABLE public.org_settings ADD CONSTRAINT org_settings_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_invitations_org_id_fkey' AND conrelid = 'public.org_invitations'::regclass) THEN
    ALTER TABLE public.org_invitations ADD CONSTRAINT org_invitations_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_invitations_invited_by_fkey' AND conrelid = 'public.org_invitations'::regclass) THEN
    ALTER TABLE public.org_invitations ADD CONSTRAINT org_invitations_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_id_fkey' AND conrelid = 'public.profiles'::regclass) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'schema_migration_audit_tenant_id_fkey' AND conrelid = 'public.schema_migration_audit'::regclass) THEN
    ALTER TABLE public.schema_migration_audit ADD CONSTRAINT schema_migration_audit_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'schema_migration_audit_approved_by_user_id_fkey' AND conrelid = 'public.schema_migration_audit'::regclass) THEN
    ALTER TABLE public.schema_migration_audit ADD CONSTRAINT schema_migration_audit_approved_by_user_id_fkey FOREIGN KEY (approved_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_org_memberships_org ON public.org_memberships (org_id);
CREATE INDEX IF NOT EXISTS idx_org_memberships_user ON public.org_memberships (user_id);
CREATE INDEX IF NOT EXISTS idx_org_invites_email ON public.org_invitations (email);
CREATE INDEX IF NOT EXISTS idx_org_invites_org ON public.org_invitations (org_id);
CREATE INDEX IF NOT EXISTS schema_migration_audit_tenant_created_idx ON public.schema_migration_audit (tenant_id, created_at DESC);

CREATE OR REPLACE FUNCTION public._add_owner_membership()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.created_by IS NOT NULL THEN
    INSERT INTO public.org_memberships (org_id, user_id, role)
    VALUES (NEW.id, NEW.created_by, 'owner')
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public._set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_membership(p_org_id uuid, p_user_id uuid, p_role text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.org_memberships m
    WHERE m.org_id = p_org_id
      AND m.user_id = auth.uid()
      AND m.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  INSERT INTO public.org_memberships (org_id, user_id, role)
  VALUES (p_org_id, p_user_id, p_role)
  ON CONFLICT (org_id, user_id) DO UPDATE
    SET role = EXCLUDED.role;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_owner_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.org_memberships (org_id, user_id, role)
  VALUES (NEW.id, auth.uid(), 'owner')
  ON CONFLICT (org_id, user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_organization(p_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  INSERT INTO public.organizations (name, created_by)
  VALUES (p_name, auth.uid())
  RETURNING id INTO v_org_id;

  INSERT INTO public.org_memberships (org_id, user_id, role)
  VALUES (v_org_id, auth.uid(), 'owner')
  ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role;

  RETURN v_org_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.current_user_is_org_admin(target_org uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_memberships m
    WHERE m.org_id = target_org
      AND m.user_id = auth.uid()
      AND m.role IN ('owner', 'admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.current_user_is_org_member(target_org uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_memberships m
    WHERE m.org_id = target_org
      AND m.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.get_org_public_keys(p_org_id uuid)
RETURNS TABLE (supabase_url text, anon_key text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.supabase_url, s.anon_key
  FROM public.org_settings s
  WHERE s.org_id = p_org_id;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'name')
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name);
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user() IS 'Creates a profile for new users, pulling data from auth.users.';

CREATE OR REPLACE FUNCTION public.handle_org_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.org_memberships (org_id, user_id, role)
  VALUES (NEW.id, auth.uid(), 'owner')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.organizations_timestamps()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.created_by IS NULL THEN
    NEW.created_by := auth.uid();
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.user_exists(user_email text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM auth.users WHERE lower(email) = lower(user_email)
  );
END;
$$;

ALTER TABLE public.org_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schema_migration_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow members to read org settings" ON public.org_settings;
CREATE POLICY "Allow members to read org settings" ON public.org_settings FOR SELECT TO authenticated USING (public.current_user_is_org_member(org_id));

DROP POLICY IF EXISTS "Org settings admin" ON public.org_settings;
CREATE POLICY "Org settings admin" ON public.org_settings FOR ALL TO authenticated USING (public.current_user_is_org_admin(org_id)) WITH CHECK (public.current_user_is_org_admin(org_id));

DROP POLICY IF EXISTS "Org invitations admin" ON public.org_invitations;
CREATE POLICY "Org invitations admin" ON public.org_invitations FOR ALL TO authenticated USING (public.current_user_is_org_admin(org_id)) WITH CHECK (public.current_user_is_org_admin(org_id));

DROP POLICY IF EXISTS "Org invitations self" ON public.org_invitations;
CREATE POLICY "Org invitations self" ON public.org_invitations FOR SELECT TO authenticated USING (lower(email) = lower(COALESCE(auth.jwt() ->> 'email', '')));

DROP POLICY IF EXISTS "Org invitations self update" ON public.org_invitations;
CREATE POLICY "Org invitations self update" ON public.org_invitations FOR UPDATE TO authenticated USING (lower(email) = lower(COALESCE(auth.jwt() ->> 'email', ''))) WITH CHECK (lower(email) = lower(COALESCE(auth.jwt() ->> 'email', '')));

DROP POLICY IF EXISTS "inv_select" ON public.org_invitations;
CREATE POLICY "inv_select" ON public.org_invitations FOR SELECT TO authenticated USING (invited_by = auth.uid() OR lower(email) = lower(COALESCE(auth.jwt() ->> 'email', '')));

DROP POLICY IF EXISTS "invites_select_basic" ON public.org_invitations;
CREATE POLICY "invites_select_basic" ON public.org_invitations FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.org_memberships m WHERE m.org_id = org_invitations.org_id AND m.user_id = auth.uid()) OR lower(email) = lower(COALESCE(auth.jwt() ->> 'email', '')));

DROP POLICY IF EXISTS "members or creator can read orgs" ON public.organizations;
CREATE POLICY "members or creator can read orgs" ON public.organizations FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.org_memberships m WHERE m.org_id = organizations.id AND m.user_id = auth.uid()) OR created_by = auth.uid());

DROP POLICY IF EXISTS "orgs_insert_authenticated" ON public.organizations;
CREATE POLICY "orgs_insert_authenticated" ON public.organizations FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "orgs_update_by_admins" ON public.organizations;
CREATE POLICY "orgs_update_by_admins" ON public.organizations FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.org_memberships m WHERE m.org_id = organizations.id AND m.user_id = auth.uid() AND m.role IN ('owner', 'admin')));

DROP POLICY IF EXISTS "orgs_delete_by_owners" ON public.organizations;
CREATE POLICY "orgs_delete_by_owners" ON public.organizations FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.org_memberships m WHERE m.org_id = organizations.id AND m.user_id = auth.uid() AND m.role = 'owner'));

DROP POLICY IF EXISTS "Organizations admin manage" ON public.organizations;
CREATE POLICY "Organizations admin manage" ON public.organizations FOR UPDATE TO authenticated USING (public.current_user_is_org_admin(id)) WITH CHECK (public.current_user_is_org_admin(id));

DROP POLICY IF EXISTS "Organizations admin delete" ON public.organizations;
CREATE POLICY "Organizations admin delete" ON public.organizations FOR DELETE TO authenticated USING (public.current_user_is_org_admin(id));

DROP POLICY IF EXISTS "read own membership" ON public.org_memberships;
CREATE POLICY "read own membership" ON public.org_memberships FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "update own membership" ON public.org_memberships;
CREATE POLICY "update own membership" ON public.org_memberships FOR UPDATE TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "delete own membership" ON public.org_memberships;
CREATE POLICY "delete own membership" ON public.org_memberships FOR DELETE TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can view their own profile." ON public.profiles;
CREATE POLICY "Users can view their own profile." ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update their own profile." ON public.profiles;
CREATE POLICY "Users can update their own profile." ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

DROP POLICY IF EXISTS "Allow service role access on schema_migration_audit" ON public.schema_migration_audit;
CREATE POLICY "Allow service role access on schema_migration_audit" ON public.schema_migration_audit FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.org_invitations TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.org_memberships TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.org_settings TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.organizations TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.profiles TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.schema_migration_audit TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public._add_owner_membership() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._set_updated_at() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.add_membership(uuid, uuid, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.add_owner_membership() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_organization(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_is_org_admin(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_is_org_member(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_org_public_keys(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.handle_org_owner() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.organizations_timestamps() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_exists(text) TO anon, authenticated, service_role;

CREATE OR REPLACE TRIGGER trg_add_owner_membership AFTER INSERT ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.add_owner_membership();
CREATE OR REPLACE TRIGGER trg_org_owner AFTER INSERT ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.handle_org_owner();
CREATE OR REPLACE TRIGGER trg_org_owner_after_insert AFTER INSERT ON public.organizations FOR EACH ROW EXECUTE FUNCTION public._add_owner_membership();
CREATE OR REPLACE TRIGGER trg_org_settings_updated_at BEFORE UPDATE ON public.org_settings FOR EACH ROW EXECUTE FUNCTION public._set_updated_at();
CREATE OR REPLACE TRIGGER trg_org_updated_at BEFORE UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public._set_updated_at();
CREATE OR REPLACE TRIGGER trg_orgs_timestamps BEFORE INSERT OR UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.organizations_timestamps();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'auth' AND c.relname = 'users'
  ) THEN
    EXECUTE 'DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users';
    EXECUTE 'CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user()';
  END IF;
EXCEPTION WHEN others THEN NULL; END $$;



-- Control DB: Global Permissions Registry
-- This table defines all available permissions across the system with their default values
-- Use this as the source of truth for initializing org_settings.permissions

CREATE TABLE IF NOT EXISTS public.permission_registry (
  permission_key TEXT PRIMARY KEY,
  display_name_en TEXT NOT NULL,
  display_name_he TEXT NOT NULL,
  description_en TEXT,
  description_he TEXT,
  -- Store defaults as JSONB to allow boolean, number, or string defaults
  default_value JSONB NOT NULL DEFAULT 'false'::jsonb,
  category TEXT NOT NULL, -- 'backup', 'branding', 'features', etc.
  requires_approval BOOLEAN NOT NULL DEFAULT true, -- Whether enabling requires admin approval
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotent migration: convert legacy BOOLEAN default_value to JSONB if needed
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'permission_registry' AND column_name = 'default_value' AND data_type <> 'jsonb'
  ) THEN
    -- First, drop the default constraint if it exists
    ALTER TABLE public.permission_registry ALTER COLUMN default_value DROP DEFAULT;
    -- Convert existing boolean values to jsonb
    ALTER TABLE public.permission_registry ALTER COLUMN default_value TYPE jsonb USING to_jsonb(default_value);
    -- Re-add the default
    ALTER TABLE public.permission_registry ALTER COLUMN default_value SET DEFAULT 'false'::jsonb;
  END IF;
END;
$$;

-- Create index on category for filtering
CREATE INDEX IF NOT EXISTS idx_permission_registry_category ON public.permission_registry(category);

-- Enable Row Level Security
ALTER TABLE public.permission_registry ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Allow authenticated users to read permission registry
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'permission_registry' 
    AND policyname = 'Allow authenticated users to read permission registry'
  ) THEN
    CREATE POLICY "Allow authenticated users to read permission registry"
      ON public.permission_registry
      FOR SELECT
      TO public
      USING (auth.role() = 'authenticated');
  END IF;
END;
$$;

-- RLS Policy: Only service role can modify permission registry
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'permission_registry' 
    AND policyname = 'Only service role can modify permission registry'
  ) THEN
    CREATE POLICY "Only service role can modify permission registry"
      ON public.permission_registry
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END;
$$;

-- Insert default permissions
INSERT INTO public.permission_registry (
  permission_key,
  display_name_en,
  display_name_he,
  description_en,
  description_he,
  default_value,
  category,
  requires_approval
) VALUES
  (
    'backup_local_enabled',
    'Local Backup',
    'גיבוי מקומי',
    'Allow organization to create encrypted local backups',
    'אפשר לארגון ליצור גיבויים מוצפנים מקומיים',
    'false'::jsonb,
    'backup',
    true
  ),
  (
    'backup_oauth_enabled',
    'Cloud Backup (OAuth)',
    'גיבוי ענן (Google Drive, OneDrive)',
    'Allow organization to backup to cloud storage providers',
    'אפשר לארגון לגבות לספקי אחסון ענן',
    'false'::jsonb,
    'backup',
    true
  ),
  (
    'logo_enabled',
    'Custom Logo',
    'לוגו מותאם אישית',
    'Allow organization to upload and use a custom logo',
    'אפשר לארגון להעלות ולהשתמש בלוגו מותאם אישית',
    'false'::jsonb,
    'branding',
    true
  ),
  -- Preconfigured answers feature toggle (enabled/disabled)
  (
    'session_form_preanswers_enabled',
    'Session Form: Preconfigured Answers',
    'טופס מפגש: תשובות מוכנות מראש',
    'Allow organizations to configure predefined answer lists for text/textarea questions',
    'אפשר לארגון להגדיר רשימות תשובות מוכנות לשאלות טקסט/טקסט חופשי',
    'true'::jsonb,
    'features',
    false
  ),
  -- Preconfigured answers cap per question (numeric)
  (
    'session_form_preanswers_cap',
    'Session Form: Preanswers Cap',
    'טופס מפגש: תקרת תשובות מוכנות',
    'Maximum number of preconfigured answers allowed per question (text/textarea)',
    'מספר מרבי של תשובות מוכנות לשאלה (טקסט/טקסט חופשי)',
    '50'::jsonb,
    'features',
    false
  ),
  -- Invitation expiry seconds configuration (global, control-level)
  (
    'invitation_expiry_seconds',
    'Invitation Expiry Seconds',
    'שניות תוקף הזמנה',
    'Number of seconds until invitation links expire (global). Overrides Supabase auth config if set.',
    'מספר שניות עד פקיעת קישורי הזמנה (גלובלי). דורס את הגדרת Supabase אם מוגדר.',
    'null'::jsonb,
    'features',
    false
  ),
  -- PDF Export feature (premium)
  (
    'can_export_pdf_reports',
    'Export PDF Reports',
    'ייצוא דוחות PDF',
    'Allow organization to export student session records to professional PDF documents',
    'אפשר לארגון לייצא רישומי מפגשים של תלמידים למסמכי PDF מקצועיים',
    'false'::jsonb,
    'features',
    true
  ),
  -- Custom logo on PDF exports (premium)
  (
    'can_use_custom_logo_on_exports',
    'Custom Logo on Exports',
    'לוגו מותאם אישית בייצוא',
    'Allow organization to display their custom logo alongside TutTiud logo on PDF exports',
    'אפשר לארגון להציג את הלוגו המותאם שלהם לצד לוגו TutTiud בייצוא PDF',
    'false'::jsonb,
    'branding',
    true
  ),
  (
    'can_reupload_legacy_reports',
    'Re-upload Legacy Session Reports',
    'העלאה חוזרת של דוחות עבר',
    'Allow organization admins/owners to upload legacy session records for a student more than once (subsequent uploads replace previous legacy data).',
    'מאפשר למנהלי ובעלי הארגון להעלות מחדש נתוני מפגשי עבר לתלמיד יותר מפעם אחת (העלאה חדשה מחליפה נתונים קודמים).',
    'false'::jsonb,
    'features',
    true
  ),
  -- Storage grace period before deletion (in days)
  (
    'storage_grace_period_days',
    'Storage Grace Period (Days)',
    'תקופת חסד לאחסון (ימים)',
    'Number of days users have to download files after storage is disconnected before permanent deletion',
    'מספר הימים שיש למשתמשים להוריד קבצים לאחר ניתוק האחסון לפני מחיקה סופית',
    '30'::jsonb,
    'storage',
    false
  )
ON CONFLICT (permission_key) DO UPDATE SET
  display_name_en = EXCLUDED.display_name_en,
  display_name_he = EXCLUDED.display_name_he,
  description_en = EXCLUDED.description_en,
  description_he = EXCLUDED.description_he,
  default_value = EXCLUDED.default_value,
  category = EXCLUDED.category,
  requires_approval = EXCLUDED.requires_approval,
  updated_at = NOW();

-- Helper function to get default permissions as JSON
CREATE OR REPLACE FUNCTION public.get_default_permissions()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT jsonb_object_agg(permission_key, default_value)
  INTO result
  FROM public.permission_registry;
  
  RETURN COALESCE(result, '{}'::jsonb);
END;
$$;

-- Helper function to initialize org permissions if null/empty and merge missing ones
CREATE OR REPLACE FUNCTION public.initialize_org_permissions(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  current_permissions JSONB;
  default_permissions JSONB;
  merged_permissions JSONB;
  permission_key TEXT;
  default_value JSONB;
BEGIN
  -- Get current permissions
  SELECT permissions
  INTO current_permissions
  FROM public.org_settings
  WHERE org_id = p_org_id;
  
  -- Get default permissions from registry
  default_permissions := public.get_default_permissions();
  
  -- If permissions is null or empty, use defaults
  IF current_permissions IS NULL OR 
     current_permissions = '{}'::jsonb OR 
     jsonb_typeof(current_permissions) = 'null' OR
     (SELECT COUNT(*) FROM jsonb_object_keys(current_permissions)) = 0 THEN
    
    -- Update org_settings with defaults
    UPDATE public.org_settings
    SET 
      permissions = default_permissions,
      updated_at = NOW()
    WHERE org_id = p_org_id;
    
    RETURN default_permissions;
  END IF;
  
  -- Otherwise, merge: start with current permissions, add missing ones from defaults
  merged_permissions := current_permissions;
  
  -- Loop through each permission in the registry
  FOR permission_key, default_value IN 
    SELECT key, value 
    FROM jsonb_each(default_permissions)
  LOOP
    -- If this permission key doesn't exist in current permissions, add it
    IF NOT (merged_permissions ? permission_key) THEN
      merged_permissions := jsonb_set(
        merged_permissions,
        ARRAY[permission_key],
        default_value,
        true
      );
    END IF;
  END LOOP;
  
  -- Update org_settings with merged permissions
  UPDATE public.org_settings
  SET 
    permissions = merged_permissions,
    updated_at = NOW()
  WHERE org_id = p_org_id;
  
  RETURN merged_permissions;
END;
$$;

-- Example usage:
-- Get all default permissions:
-- SELECT public.get_default_permissions();

-- Initialize permissions for an org:
-- SELECT public.initialize_org_permissions('your-org-uuid-here');

-- Query permissions by category:
-- SELECT * FROM public.permission_registry WHERE category = 'backup';

-- Grant necessary permissions (adjust as needed for your setup)
-- These grants are idempotent - they won't error if already granted
DO $$
BEGIN
  GRANT SELECT ON public.permission_registry TO authenticated;
  GRANT EXECUTE ON FUNCTION public.get_default_permissions() TO authenticated;
  GRANT EXECUTE ON FUNCTION public.initialize_org_permissions(UUID) TO authenticated;
EXCEPTION
  WHEN OTHERS THEN
    -- Ignore errors if already granted
    NULL;
END;
$$;



-- Control DB: Storage Access Permission
-- Defines the storage_access_level permission in the permissions_registry
-- This permission controls access to storage configuration features

-- Insert storage permission definition into permissions_registry
INSERT INTO public.permission_registry (
  permission_key,
  display_name_en,
  display_name_he,
  description_en,
  description_he,
  default_value,
  category,
  requires_approval
) VALUES (
  'storage_access_level',
  'Storage Configuration Access',
  'גישה להגדרות אחסון',
  'Determines if the organization can configure storage and which modes are available. Options: false (locked), "byos_only" (BYOS only), "managed_only" (Managed only), "all" (both modes).',
  'קובע האם הארגון יכול להגדיר אחסון ואילו מצבים זמינים. אפשרויות: false (נעול), "byos_only" (BYOS בלבד), "managed_only" (מנוהל בלבד), "all" (שני המצבים).',
  'false'::jsonb,
  'storage',
  true
) ON CONFLICT (permission_key) DO UPDATE SET
  display_name_en = EXCLUDED.display_name_en,
  display_name_he = EXCLUDED.display_name_he,
  description_en = EXCLUDED.description_en,
  description_he = EXCLUDED.description_he,
  default_value = EXCLUDED.default_value,
  category = EXCLUDED.category,
  requires_approval = EXCLUDED.requires_approval,
  updated_at = NOW();

-- Add helpful comment
COMMENT ON COLUMN public.permission_registry.permission_key IS 
  'Unique identifier for the permission. For storage_access_level, valid values in org_settings.permissions are: false, "byos_only", "managed_only", "all"';



-- Control Plane Database Schema Updates for Backup/Restore Feature
-- Version: 2.0
-- Date: 2025-01
-- Description: Adds permissions and backup_history columns to org_settings

-- ============================================================================
-- 1. Add permissions column to org_settings
-- ============================================================================
-- This column stores JSON configuration for feature permissions like:
-- { "backup_local_enabled": true, "backup_oauth_enabled": false, "logo_enabled": true }

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'org_settings'
      AND column_name = 'permissions'
  ) THEN
    ALTER TABLE public.org_settings
      ADD COLUMN permissions jsonb DEFAULT '{}'::jsonb;
    
    RAISE NOTICE 'Added permissions column to org_settings';
  ELSE
    RAISE NOTICE 'Column permissions already exists on org_settings';
  END IF;
END $$;

-- ============================================================================
-- 2. Add backup_history column to org_settings
-- ============================================================================
-- Stores array of backup/restore operations with structure:
-- [
--   {
--     "type": "backup|restore",
--     "status": "completed|failed",
--     "timestamp": "2025-01-15T10:30:00Z",
--     "initiated_by": "user-uuid",
--     "size_bytes": 1024000,
--     "error_message": "optional error text"
--   }
-- ]

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'org_settings'
      AND column_name = 'backup_history'
  ) THEN
    ALTER TABLE public.org_settings
      ADD COLUMN backup_history jsonb DEFAULT '[]'::jsonb;
    
    RAISE NOTICE 'Added backup_history column to org_settings';
  ELSE
    RAISE NOTICE 'Column backup_history already exists on org_settings';
  END IF;
END $$;

-- ============================================================================
-- Comments for documentation
-- ============================================================================
COMMENT ON COLUMN public.org_settings.permissions IS 'Feature permission flags (backup_local_enabled, logo_enabled, etc.)';
COMMENT ON COLUMN public.org_settings.backup_history IS 'Array of backup/restore operations with timestamps and status';



-- Control Plane Database Schema Updates for Custom Logo Feature
-- Version: 1.0
-- Date: 2025-10
-- Description: Adds logo_url column to org_settings for custom branding

-- ============================================================================
-- 1. Add logo_url column to org_settings
-- ============================================================================
-- This column stores the URL to the organization's custom logo
-- Format: Public image URL (https://example.com/logo.png)

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'org_settings'
      AND column_name = 'logo_url'
  ) THEN
    ALTER TABLE public.org_settings
      ADD COLUMN logo_url text DEFAULT NULL;
    
    RAISE NOTICE 'Added logo_url column to org_settings';
  ELSE
    RAISE NOTICE 'Column logo_url already exists on org_settings';
  END IF;
END $$;

-- ============================================================================
-- Comments for documentation
-- ============================================================================
COMMENT ON COLUMN public.org_settings.logo_url IS 'Organization custom logo URL (public image URL)';



-- Control Plane Database Schema Updates for Storage Profile Feature
-- Version: 1.0
-- Date: 2025-11
-- Description: Adds storage_profile column to org_settings for cross-system storage configuration

-- ============================================================================
-- 1. Add storage_profile column to org_settings
-- ============================================================================
-- This column stores the organization's storage configuration:
-- {
--   "mode": "byos" | "managed",
--   "byos": {
--     "provider": "s3" | "azure" | "gcs",
--     "endpoint": "https://...",
--     "region": "us-east-1",
--     "bucket": "bucket-name",
--     "access_key_id": "encrypted-key",
--     "secret_access_key": "encrypted-secret",
--     "public_url": "https://files.example.com" (optional, for public CDN/custom domain),
--     "validated_at": "2025-11-22T10:30:00Z"
--   },
--   "managed": {
--     "namespace": "org-abc-123",
--     "active": true,
--     "created_at": "2025-11-22T10:30:00Z"
--   },
--   "updated_at": "2025-11-22T10:30:00Z",
--   "updated_by": "user-uuid"
-- }

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'org_settings'
      AND column_name = 'storage_profile'
  ) THEN
    ALTER TABLE public.org_settings
      ADD COLUMN storage_profile jsonb DEFAULT NULL;
    
    RAISE NOTICE 'Added storage_profile column to org_settings';
  ELSE
    RAISE NOTICE 'Column storage_profile already exists on org_settings';
  END IF;
END $$;

-- ============================================================================
-- Comments for documentation
-- ============================================================================
COMMENT ON COLUMN public.org_settings.storage_profile IS 
  'Cross-system storage configuration (BYOS or Managed Storage). Used by TutTiud and future systems for file storage operations. Structure: { mode: "byos"|"managed", byos?: {...}, managed?: {...} }';



-- Control DB: Storage Grace Period Tracking
-- Adds column to track when storage files should be deleted

-- Add storage_grace_ends_at column to org_settings
ALTER TABLE public.org_settings
ADD COLUMN IF NOT EXISTS storage_grace_ends_at TIMESTAMPTZ;

-- Add index for finding orgs with expired grace periods
CREATE INDEX IF NOT EXISTS idx_org_settings_storage_grace_ends_at 
ON public.org_settings(storage_grace_ends_at) 
WHERE storage_grace_ends_at IS NOT NULL;

-- Comment for documentation
COMMENT ON COLUMN public.org_settings.storage_grace_ends_at IS 
'Timestamp when storage grace period ends and files should be permanently deleted. 
Set when storage_access_level changes to read_only_grace. 
Null when storage is active or fully disconnected.';



-- Control DB: Audit Log for System and Org Admin Actions
-- Tracks critical actions for legal compliance and dispute resolution

CREATE TABLE IF NOT EXISTS public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  user_id UUID NOT NULL,
  user_email TEXT,
  user_role TEXT NOT NULL, -- 'system_admin', 'owner', 'admin', 'member'
  action_type TEXT NOT NULL, -- 'storage.grace_period_started', 'storage.files_deleted', 'storage.migrated_to_byos', etc.
  action_category TEXT NOT NULL, -- 'storage', 'backup', 'permissions', 'membership', etc.
  resource_type TEXT, -- 'storage_profile', 'files', 'permissions', 'org_settings', etc.
  resource_id TEXT, -- ID of affected resource if applicable
  details JSONB, -- Structured details about the action
  metadata JSONB, -- Additional context (IP address, user agent, etc.)
  performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ -- Optional expiration for log retention policies
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_audit_log_org_id ON public.audit_log(org_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON public.audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action_type ON public.audit_log(action_type);
CREATE INDEX IF NOT EXISTS idx_audit_log_action_category ON public.audit_log(action_category);
CREATE INDEX IF NOT EXISTS idx_audit_log_performed_at ON public.audit_log(performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_expires_at ON public.audit_log(expires_at) WHERE expires_at IS NOT NULL;

-- Composite index for common queries (org + time range)
CREATE INDEX IF NOT EXISTS idx_audit_log_org_time ON public.audit_log(org_id, performed_at DESC);

-- Enable Row Level Security
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only read audit logs for their own organizations
-- (Must verify membership via org_members join)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'audit_log' 
    AND policyname = 'Users can read audit logs for their orgs'
  ) THEN
    CREATE POLICY "Users can read audit logs for their orgs"
      ON public.audit_log
      FOR SELECT
      TO authenticated
      USING (
        org_id IN (
          SELECT org_id FROM public.org_memberships 
          WHERE user_id = auth.uid()
        )
      );
  END IF;
END;
$$;

-- RLS Policy: Only service role can insert/modify audit logs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'audit_log' 
    AND policyname = 'Only service role can modify audit logs'
  ) THEN
    CREATE POLICY "Only service role can modify audit logs"
      ON public.audit_log
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END;
$$;

-- Helper function to create audit log entries
CREATE OR REPLACE FUNCTION public.log_audit_event(
  p_org_id UUID,
  p_user_id UUID,
  p_user_email TEXT,
  p_user_role TEXT,
  p_action_type TEXT,
  p_action_category TEXT,
  p_resource_type TEXT DEFAULT NULL,
  p_resource_id TEXT DEFAULT NULL,
  p_details JSONB DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  log_id UUID;
BEGIN
  INSERT INTO public.audit_log (
    org_id,
    user_id,
    user_email,
    user_role,
    action_type,
    action_category,
    resource_type,
    resource_id,
    details,
    metadata,
    performed_at
  ) VALUES (
    p_org_id,
    p_user_id,
    p_user_email,
    p_user_role,
    p_action_type,
    p_action_category,
    p_resource_type,
    p_resource_id,
    p_details,
    p_metadata,
    NOW()
  )
  RETURNING id INTO log_id;
  
  RETURN log_id;
END;
$$;

-- Comment for documentation
COMMENT ON TABLE public.audit_log IS 
'Audit log for tracking critical system and organization admin actions.
Required for legal compliance and dispute resolution.
Retention: 7 years for compliance (can be configured via expires_at).';

COMMENT ON FUNCTION public.log_audit_event IS 
'Helper function to create audit log entries.
Use this from API endpoints to log admin actions.
Example: SELECT public.log_audit_event(org_id, user_id, email, role, ''storage.grace_period_started'', ''storage'', ''storage_profile'', org_id::text, jsonb_build_object(''grace_days'', 30));';

-- Example audit action types (for reference):
-- Storage actions:
--   - storage.configured (initial setup)
--   - storage.updated (changed mode or credentials)
--   - storage.disconnected (manually disconnected)
--   - storage.grace_period_started (payment lapsed)
--   - storage.files_deleted (grace period expired)
--   - storage.migrated_to_byos (migrated from managed to BYOS)
--   - storage.bulk_download (downloaded all files)
--
-- Permission actions:
--   - permission.enabled (feature enabled)
--   - permission.disabled (feature disabled)
--
-- Membership actions:
--   - member.invited
--   - member.removed
--   - member.role_changed
--
-- Backup actions:
--   - backup.created
--   - backup.restored



-- Control DB auth utilities
-- Provides user verification state lookup for invitations and onboarding flows.
-- Run this script against the control database.

create or replace function public.user_verification_state(user_email text)
returns table(
  user_exists boolean,
  email_confirmed boolean,
  last_sign_in_at timestamptz
)
language sql
security definer
set search_path = public, auth, extensions
as $$
  with u as (
    select email, email_confirmed_at, last_sign_in_at
    from auth.users
    where lower(email) = lower($1)
    limit 1
  )
  select true as user_exists,
         (u.email_confirmed_at is not null) as email_confirmed,
         u.last_sign_in_at
  from u
  union all
  select false as user_exists,
         false as email_confirmed,
         null::timestamptz as last_sign_in_at
  where not exists (select 1 from u)
  limit 1;
$$;

comment on function public.user_verification_state(text) is
  'Returns a single row indicating whether a user exists in auth.users and whether their email is confirmed.';



-- Control DB: Invitation Expiry Configuration
-- Provides a function to read Supabase auth config for OTP expiry settings
-- and calculate invitation expiration timestamps with smart precedence

-- Function to get MAILER_OTP_EXP from Supabase auth config
-- Returns expiry in seconds (Supabase stores as seconds)
CREATE OR REPLACE FUNCTION public.get_auth_otp_expiry_seconds()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  expiry_seconds INTEGER;
BEGIN
  -- Read MAILER_OTP_EXP from auth.config
  -- Default is 86400 seconds (24 hours) if not configured
  SELECT COALESCE(
    (config->'MAILER_OTP_EXP')::text::integer,
    86400
  ) INTO expiry_seconds
  FROM auth.config
  WHERE id = 1  -- Supabase auth config typically uses id=1
  LIMIT 1;
  
  -- If no config row exists, return 24h default
  IF expiry_seconds IS NULL THEN
    expiry_seconds := 86400;
  END IF;
  
  RETURN expiry_seconds;
END;
$$;

-- Function to calculate invitation expiry timestamp with smart precedence
-- Precedence order:
-- 1. permission_registry.invitation_expiry_seconds (if set and > 0)
-- 2. auth.config MAILER_OTP_EXP (read via get_auth_otp_expiry_seconds)
-- 3. Hardcoded 24 hours fallback (86400 seconds)
CREATE OR REPLACE FUNCTION public.calculate_invitation_expiry(org_id UUID)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  custom_seconds INTEGER;
  auth_seconds INTEGER;
  expiry_seconds INTEGER;
BEGIN
  -- Check for global override in permission_registry (seconds)
  SELECT CASE
           WHEN jsonb_typeof(default_value) = 'number' THEN (default_value)::text::integer
           ELSE NULL
         END
  INTO custom_seconds
  FROM public.permission_registry
  WHERE permission_key = 'invitation_expiry_seconds'
  LIMIT 1;

  -- Use custom seconds if set and valid
  IF custom_seconds IS NOT NULL AND custom_seconds > 0 THEN
    expiry_seconds := custom_seconds;
  ELSE
    -- Fall back to Supabase auth config (seconds)
    auth_seconds := public.get_auth_otp_expiry_seconds();
    expiry_seconds := COALESCE(auth_seconds, 86400);
  END IF;

  -- Return current timestamp + calculated seconds
  RETURN NOW() + (expiry_seconds || ' seconds')::INTERVAL;
END;
$$;

-- Grant execute to authenticated users (BFF endpoints will call this)
GRANT EXECUTE ON FUNCTION public.get_auth_otp_expiry_seconds() TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_invitation_expiry(UUID) TO authenticated;

-- Example usage:
-- SELECT public.calculate_invitation_expiry('your-org-uuid-here');
-- SELECT public.get_auth_otp_expiry_seconds(); -- returns seconds from auth.config



-- Control DB: Global Active Routing Table
-- Supports /submit and future easy-access workflows across tenants.

CREATE TABLE IF NOT EXISTS public.active_routing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid,
  category text NOT NULL,
  routing_info jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb
);

-- Fast JSON lookups (identity, otp, submission id, etc.)
CREATE INDEX IF NOT EXISTS active_routing_routing_info_gin_idx
  ON public.active_routing
  USING GIN (routing_info);

-- Optional supporting indexes for common access patterns
CREATE INDEX IF NOT EXISTS active_routing_category_idx
  ON public.active_routing (category);

CREATE INDEX IF NOT EXISTS active_routing_expires_at_idx
  ON public.active_routing (expires_at)
  WHERE expires_at IS NOT NULL;

-- Ensure org-scoped routing rows reference a valid organization.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'active_routing_org_id_fkey'
      AND conrelid = 'public.active_routing'::regclass
  ) THEN
    ALTER TABLE public.active_routing
      ADD CONSTRAINT active_routing_org_id_fkey
      FOREIGN KEY (org_id)
      REFERENCES public.organizations(id);
  END IF;
END;
$$;

-- Canonical permission registry sync
-- Source aligned with: C:/Users/Admin/Downloads/permission_registry_rows (1).sql
INSERT INTO public.permission_registry (
  permission_key,
  display_name_en,
  display_name_he,
  description_en,
  description_he,
  default_value,
  category,
  requires_approval
) VALUES
  (
    'backup_local_enabled',
    'Local Backup',
    'גיבוי מקומי',
    'Allow organization to create encrypted local backups',
    'אפשר לארגון ליצור גיבויים מוצפנים מקומיים',
    'false'::jsonb,
    'backup',
    true
  ),
  (
    'backup_oauth_enabled',
    'Cloud Backup (OAuth)',
    'גיבוי ענן (Google Drive, OneDrive)',
    'Allow organization to backup to cloud storage providers',
    'אפשר לארגון לגבות לספקי אחסון ענן',
    'false'::jsonb,
    'backup',
    true
  ),
  (
    'can_export_pdf_reports',
    'Export PDF Reports',
    'ייצוא דוחות PDF',
    'Allow organization to export student session records to professional PDF documents',
    'אפשר לארגון לייצא רישומי מפגשים של תלמידים למסמכי PDF מקצועיים',
    'false'::jsonb,
    'features',
    true
  ),
  (
    'can_reupload_legacy_reports',
    'Re-upload Legacy Session Reports',
    'העלאה חוזרת של דוחות עבר',
    'Allow organization admins/owners to upload legacy session records for a student more than once (subsequent uploads replace previous legacy data).',
    'מאפשר למנהלי ובעלי הארגון להעלות מחדש נתוני מפגשי עבר לתלמיד יותר מפעם אחת (העלאה חדשה מחליפה נתונים קודמים).',
    'false'::jsonb,
    'features',
    true
  ),
  (
    'can_use_custom_logo_on_exports',
    'Custom Logo on Exports',
    'לוגו מותאם ביצוא',
    'Allow organization to display their custom logo alongside TutTiud logo on PDF exports',
    'אפשר לארגון להציג את הלוגו המותאם שלו לצד לוגו TutTiud ביצוא PDF',
    'false'::jsonb,
    'branding',
    true
  ),
  (
    'invitation_expiry_seconds',
    'Invitation Expiry Seconds',
    'שניות תוקף הזמנה',
    'Number of seconds until invitation links expire (global). Overrides Supabase auth config if set.',
    'מספר שניות עד פקיעת קישורי הזמנה (גלובלי). דורס את הגדרת Supabase אם מוגדר.',
    '3639'::jsonb,
    'features',
    false
  ),
  (
    'logo_enabled',
    'Custom Logo',
    'לוגו מותאם אישית',
    'Allow organization to upload and use a custom logo',
    'אפשר לארגון להעלות ולהשתמש בלוגו מותאם אישית',
    'false'::jsonb,
    'branding',
    true
  ),
  (
    'session_form_preanswers_cap',
    'Session Form: Preanswers Cap',
    'טופס מפגש: תקרת תשובות מוכנות',
    'Maximum number of preconfigured answers allowed per question (text/textarea)',
    'מספר מרבי של תשובות מוכנות לשאלה (טקסט/טקסט חופשי)',
    '5'::jsonb,
    'features',
    false
  ),
  (
    'session_form_preanswers_enabled',
    'Session Form: Preconfigured Answers',
    'טופס מפגש: תשובות מוכנות מראש',
    'Allow organizations to configure predefined answer lists for text/textarea questions',
    'אפשר לארגון להגדיר רשימות תשובות מוכנות לשאלות טקסט/טקסט חופשי',
    'true'::jsonb,
    'features',
    false
  ),
  (
    'storage_access_level',
    'Storage Configuration Access',
    'גישה להגדרות אחסון',
    'Determines if the organization can configure storage and which modes are available. Options: false (locked), "byos_only" (BYOS only), "managed_only" (Managed only), "all" (both modes).',
    'קובע האם הארגון יכול להגדיר אחסון ואילו מצבים זמינים. אפשרויות: false (נעול), "byos_only" (BYOS בלבד), "managed_only" (מנוהל בלבד), "all" (שני המצבים).',
    'false'::jsonb,
    'storage',
    true
  ),
  (
    'storage_grace_period_days',
    'Storage Grace Period (Days)',
    'תקופת חסד לאחסון (ימים)',
    'Number of days users have to download files after storage is disconnected before permanent deletion',
    'מספר הימים שיש למשתמשים להוריד קבצים לאחר ניתוק האחסון לפני מחיקה סופית',
    '3'::jsonb,
    'storage',
    false
  )
ON CONFLICT (permission_key) DO UPDATE SET
  display_name_en = EXCLUDED.display_name_en,
  display_name_he = EXCLUDED.display_name_he,
  description_en = EXCLUDED.description_en,
  description_he = EXCLUDED.description_he,
  default_value = EXCLUDED.default_value,
  category = EXCLUDED.category,
  requires_approval = EXCLUDED.requires_approval,
  updated_at = NOW();

-- Security hardening: this table stores sensitive routing and OTP context.
-- Access is intended only through backend code running with service_role.
ALTER TABLE public.active_routing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.active_routing FORCE ROW LEVEL SECURITY;

-- Restrict direct table grants for client roles.
REVOKE ALL ON TABLE public.active_routing FROM PUBLIC;
REVOKE ALL ON TABLE public.active_routing FROM anon;
REVOKE ALL ON TABLE public.active_routing FROM authenticated;

-- Ensure service_role can manage routing rows through PostgREST/REST APIs.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.active_routing TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'active_routing'
      AND policyname = 'Only service role can access active routing'
  ) THEN
    CREATE POLICY "Only service role can access active routing"
      ON public.active_routing
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END;
$$;
