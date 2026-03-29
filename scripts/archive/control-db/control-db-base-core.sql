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
