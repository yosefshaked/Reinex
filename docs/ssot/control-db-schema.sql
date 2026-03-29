--
-- PostgreSQL database dump
--

-- \restrict tnolj5DYZ3nCfsS03bxIFj5oDJCEujH9Ca1Ll7RpfzZ3aE9M1zavbhneJ1y2svk

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
-- SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: SCHEMA "public"; Type: COMMENT; Schema: -; Owner: pg_database_owner
--

COMMENT ON SCHEMA "public" IS 'standard public schema';


--
-- Name: pg_graphql; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";


--
-- Name: EXTENSION "pg_graphql"; Type: COMMENT; Schema: -; Owner: 
--

-- COMMENT ON EXTENSION "pg_graphql" IS 'pg_graphql: GraphQL support';


--
-- Name: pg_stat_statements; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";


--
-- Name: EXTENSION "pg_stat_statements"; Type: COMMENT; Schema: -; Owner: 
--

-- COMMENT ON EXTENSION "pg_stat_statements" IS 'track planning and execution statistics of all SQL statements executed';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";


--
-- Name: EXTENSION "pgcrypto"; Type: COMMENT; Schema: -; Owner: 
--

-- COMMENT ON EXTENSION "pgcrypto" IS 'cryptographic functions';


--
-- Name: supabase_vault; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";


--
-- Name: EXTENSION "supabase_vault"; Type: COMMENT; Schema: -; Owner: 
--

-- COMMENT ON EXTENSION "supabase_vault" IS 'Supabase Vault Extension';


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: 
--

-- COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: _add_owner_membership(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."_add_owner_membership"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if new.created_by is not null then
    insert into public.org_memberships(org_id, user_id, role)
    values (new.id, new.created_by, 'owner')
    on conflict do nothing;
  end if;
  return new;
end$$;


ALTER FUNCTION "public"."_add_owner_membership"() OWNER TO "postgres";

--
-- Name: _set_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."_set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at := now();
  return new;
end$$;


ALTER FUNCTION "public"."_set_updated_at"() OWNER TO "postgres";

--
-- Name: add_membership("uuid", "uuid", "text"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."add_membership"("p_org_id" "uuid", "p_user_id" "uuid", "p_role" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not exists (
    select 1 from public.org_memberships m
    where m.org_id = p_org_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  ) then
    raise exception 'not_authorized';
  end if;

  insert into public.org_memberships (org_id, user_id, role)
  values (p_org_id, p_user_id, p_role);
end;
$$;


ALTER FUNCTION "public"."add_membership"("p_org_id" "uuid", "p_user_id" "uuid", "p_role" "text") OWNER TO "postgres";

--
-- Name: add_owner_membership(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."add_owner_membership"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  insert into public.org_memberships (org_id, user_id, role)
  values (new.id, auth.uid(), 'owner')
  on conflict (org_id, user_id) do nothing;
  return new;
end; $$;


ALTER FUNCTION "public"."add_owner_membership"() OWNER TO "postgres";

--
-- Name: create_organization("text"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."create_organization"("p_name" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_org_id uuid;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated';
  end if;

  -- יוצר ארגון חדש
  insert into public.organizations (name, created_by)
  values (p_name, auth.uid())
  returning id into v_org_id;

  -- מוסיף חברות Owner; אם כבר קיימת - אל תיפול
  insert into public.org_memberships (org_id, user_id, role)
  values (v_org_id, auth.uid(), 'owner')
  on conflict (org_id, user_id) do update
    set role = excluded.role;  -- או DO NOTHING אם לא רוצים לשדרג role

  return v_org_id;
end;
$$;


ALTER FUNCTION "public"."create_organization"("p_name" "text") OWNER TO "postgres";

--
-- Name: current_user_is_org_admin("uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."current_user_is_org_admin"("target_org" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.org_memberships m
    where m.org_id = target_org
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  );
$$;


ALTER FUNCTION "public"."current_user_is_org_admin"("target_org" "uuid") OWNER TO "postgres";

--
-- Name: current_user_is_org_member("uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."current_user_is_org_member"("target_org" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.org_memberships m
    where m.org_id = target_org
      and m.user_id = auth.uid()
  );
$$;


ALTER FUNCTION "public"."current_user_is_org_member"("target_org" "uuid") OWNER TO "postgres";

--
-- Name: get_default_permissions(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."get_default_permissions"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
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


ALTER FUNCTION "public"."get_default_permissions"() OWNER TO "postgres";

--
-- Name: get_org_public_keys("uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."get_org_public_keys"("p_org_id" "uuid") RETURNS TABLE("supabase_url" "text", "anon_key" "text")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select s.supabase_url, s.anon_key
  from public.org_settings s
  where s.org_id = p_org_id;
$$;


ALTER FUNCTION "public"."get_org_public_keys"("p_org_id" "uuid") OWNER TO "postgres";

--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'name'
  );
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";

--
-- Name: FUNCTION "handle_new_user"(); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION "public"."handle_new_user"() IS 'Creates a profile for new users, pulling data from auth.users.';


--
-- Name: handle_org_owner(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."handle_org_owner"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  insert into public.org_memberships (org_id, user_id, role)
  values (new.id, auth.uid(), 'owner')
  on conflict do nothing;
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_org_owner"() OWNER TO "postgres";

--
-- Name: initialize_org_permissions("uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."initialize_org_permissions"("p_org_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql"
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


ALTER FUNCTION "public"."initialize_org_permissions"("p_org_id" "uuid") OWNER TO "postgres";

--
-- Name: log_audit_event("uuid", "uuid", "text", "text", "text", "text", "text", "text", "jsonb", "jsonb"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."log_audit_event"("p_org_id" "uuid", "p_user_id" "uuid", "p_user_email" "text", "p_user_role" "text", "p_action_type" "text", "p_action_category" "text", "p_resource_type" "text" DEFAULT NULL::"text", "p_resource_id" "text" DEFAULT NULL::"text", "p_details" "jsonb" DEFAULT NULL::"jsonb", "p_metadata" "jsonb" DEFAULT NULL::"jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
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


ALTER FUNCTION "public"."log_audit_event"("p_org_id" "uuid", "p_user_id" "uuid", "p_user_email" "text", "p_user_role" "text", "p_action_type" "text", "p_action_category" "text", "p_resource_type" "text", "p_resource_id" "text", "p_details" "jsonb", "p_metadata" "jsonb") OWNER TO "postgres";

--
-- Name: FUNCTION "log_audit_event"("p_org_id" "uuid", "p_user_id" "uuid", "p_user_email" "text", "p_user_role" "text", "p_action_type" "text", "p_action_category" "text", "p_resource_type" "text", "p_resource_id" "text", "p_details" "jsonb", "p_metadata" "jsonb"); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION "public"."log_audit_event"("p_org_id" "uuid", "p_user_id" "uuid", "p_user_email" "text", "p_user_role" "text", "p_action_type" "text", "p_action_category" "text", "p_resource_type" "text", "p_resource_id" "text", "p_details" "jsonb", "p_metadata" "jsonb") IS 'Helper function to create audit log entries.
Use this from API endpoints to log admin actions.
Example: SELECT public.log_audit_event(org_id, user_id, email, role, ''storage.grace_period_started'', ''storage'', ''storage_profile'', org_id::text, jsonb_build_object(''grace_days'', 30));';


--
-- Name: organizations_timestamps(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."organizations_timestamps"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;
  new.updated_at := now();
  return new;
end; $$;


ALTER FUNCTION "public"."organizations_timestamps"() OWNER TO "postgres";

--
-- Name: user_exists("text"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."user_exists"("user_email" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  return exists(select 1 from auth.users where email = user_email);
end;
$$;


ALTER FUNCTION "public"."user_exists"("user_email" "text") OWNER TO "postgres";

--
-- Name: user_verification_state("text"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."user_verification_state"("user_email" "text") RETURNS TABLE("user_exists" boolean, "email_confirmed" boolean, "last_sign_in_at" timestamp with time zone)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth', 'extensions'
    AS $_$
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
$_$;


ALTER FUNCTION "public"."user_verification_state"("user_email" "text") OWNER TO "postgres";

--
-- Name: FUNCTION "user_verification_state"("user_email" "text"); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION "public"."user_verification_state"("user_email" "text") IS 'Returns a single row indicating whether a user exists in auth.users and whether their email is confirmed.';


SET default_tablespace = '';

SET default_table_access_method = "heap";

--
-- Name: active_routing; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."active_routing" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid",
    "category" "text" NOT NULL,
    "routing_info" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "expires_at" timestamp with time zone,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "metadata" "jsonb"
);

ALTER TABLE ONLY "public"."active_routing" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."active_routing" OWNER TO "postgres";

--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "user_email" "text",
    "user_role" "text" NOT NULL,
    "action_type" "text" NOT NULL,
    "action_category" "text" NOT NULL,
    "resource_type" "text",
    "resource_id" "text",
    "details" "jsonb",
    "metadata" "jsonb",
    "performed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone
);


ALTER TABLE "public"."audit_log" OWNER TO "postgres";

--
-- Name: TABLE "audit_log"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."audit_log" IS 'Audit log for tracking critical system and organization admin actions.
Required for legal compliance and dispute resolution.
Retention: 7 years for compliance (can be configured via expires_at).';


--
-- Name: org_invitations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."org_invitations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "invited_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone,
    "token" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    CONSTRAINT "org_invitations_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'sent'::"text", 'accepted'::"text", 'expired'::"text", 'revoked'::"text"])))
);


ALTER TABLE "public"."org_invitations" OWNER TO "postgres";

--
-- Name: org_memberships; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."org_memberships" (
    "org_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "id" "uuid" DEFAULT "gen_random_uuid"(),
    CONSTRAINT "org_memberships_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'admin'::"text", 'member'::"text"])))
);


ALTER TABLE "public"."org_memberships" OWNER TO "postgres";

--
-- Name: org_settings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."org_settings" (
    "org_id" "uuid" NOT NULL,
    "supabase_url" "text" NOT NULL,
    "anon_key" "text" NOT NULL,
    "metadata" "jsonb",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "permissions" "jsonb" DEFAULT '{}'::"jsonb",
    "backup_history" "jsonb" DEFAULT '[]'::"jsonb",
    "logo_url" "text",
    "storage_profile" "jsonb",
    "storage_grace_ends_at" timestamp with time zone
);


ALTER TABLE "public"."org_settings" OWNER TO "postgres";

--
-- Name: COLUMN "org_settings"."permissions"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."org_settings"."permissions" IS 'Feature permission flags (backup_local_enabled, logo_enabled, etc.)';


--
-- Name: COLUMN "org_settings"."backup_history"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."org_settings"."backup_history" IS 'Array of backup/restore operations with timestamps and status';


--
-- Name: COLUMN "org_settings"."logo_url"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."org_settings"."logo_url" IS 'Organization custom logo URL (public image URL)';


--
-- Name: COLUMN "org_settings"."storage_profile"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."org_settings"."storage_profile" IS 'Cross-system storage configuration (BYOS or Managed Storage). Used by TutTiud and future systems for file storage operations. Structure: { mode: "byos"|"managed", byos?: {...}, managed?: {...} }';


--
-- Name: COLUMN "org_settings"."storage_grace_ends_at"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."org_settings"."storage_grace_ends_at" IS 'Timestamp when storage grace period ends and files should be permanently deleted. 
Set when storage_access_level changes to read_only_grace. 
Null when storage is active or fully disconnected.';


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."organizations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "slug" "text",
    "created_by" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "supabase_url" "text",
    "supabase_anon_key" "text",
    "policy_links" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "legal_settings" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "setup_completed" boolean DEFAULT false NOT NULL,
    "verified_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "dedicated_key_encrypted" "text",
    "dedicated_key_saved_at" timestamp with time zone
);


ALTER TABLE "public"."organizations" OWNER TO "postgres";

--
-- Name: permission_registry; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."permission_registry" (
    "permission_key" "text" NOT NULL,
    "display_name_en" "text" NOT NULL,
    "display_name_he" "text" NOT NULL,
    "description_en" "text",
    "description_he" "text",
    "default_value" "jsonb" DEFAULT 'false'::"jsonb" NOT NULL,
    "category" "text" NOT NULL,
    "requires_approval" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."permission_registry" OWNER TO "postgres";

--
-- Name: COLUMN "permission_registry"."permission_key"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."permission_registry"."permission_key" IS 'Unique identifier for the permission. For storage_access_level, valid values in org_settings.permissions are: false, "byos_only", "managed_only", "all"';


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "email" "text",
    "full_name" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";

--
-- Name: TABLE "profiles"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."profiles" IS 'Public-facing user profiles, mirroring data from auth.users.';


--
-- Name: schema_migration_audit; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."schema_migration_audit" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ssot_version_hash" "text" NOT NULL,
    "db_snapshot_hash_before" "text",
    "db_snapshot_hash_after" "text",
    "summary_counts" "jsonb",
    "patch_plan_json" "jsonb",
    "db_snapshot_before" "jsonb",
    "db_snapshot_after" "jsonb",
    "preflight_results" "jsonb",
    "executed_sql_safe" "text",
    "executed_sql_manual" "text",
    "executed_result_json" "jsonb",
    "approved_by_user_id" "uuid",
    "approval_method" "text",
    "approval_phrase" "text",
    "status" "text" NOT NULL
);


ALTER TABLE "public"."schema_migration_audit" OWNER TO "postgres";

--
-- Name: active_routing active_routing_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."active_routing"
    ADD CONSTRAINT "active_routing_pkey" PRIMARY KEY ("id");


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id");


--
-- Name: org_invitations org_invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."org_invitations"
    ADD CONSTRAINT "org_invitations_pkey" PRIMARY KEY ("id");


--
-- Name: org_memberships org_memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."org_memberships"
    ADD CONSTRAINT "org_memberships_pkey" PRIMARY KEY ("org_id", "user_id");


--
-- Name: org_settings org_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."org_settings"
    ADD CONSTRAINT "org_settings_pkey" PRIMARY KEY ("org_id");


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_pkey" PRIMARY KEY ("id");


--
-- Name: organizations organizations_slug_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_slug_key" UNIQUE ("slug");


--
-- Name: permission_registry permission_registry_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."permission_registry"
    ADD CONSTRAINT "permission_registry_pkey" PRIMARY KEY ("permission_key");


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");


--
-- Name: schema_migration_audit schema_migration_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."schema_migration_audit"
    ADD CONSTRAINT "schema_migration_audit_pkey" PRIMARY KEY ("id");


--
-- Name: active_routing_category_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "active_routing_category_idx" ON "public"."active_routing" USING "btree" ("category");


--
-- Name: active_routing_expires_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "active_routing_expires_at_idx" ON "public"."active_routing" USING "btree" ("expires_at") WHERE ("expires_at" IS NOT NULL);


--
-- Name: active_routing_routing_info_gin_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "active_routing_routing_info_gin_idx" ON "public"."active_routing" USING "gin" ("routing_info");


--
-- Name: idx_audit_log_action_category; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_audit_log_action_category" ON "public"."audit_log" USING "btree" ("action_category");


--
-- Name: idx_audit_log_action_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_audit_log_action_type" ON "public"."audit_log" USING "btree" ("action_type");


--
-- Name: idx_audit_log_expires_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_audit_log_expires_at" ON "public"."audit_log" USING "btree" ("expires_at") WHERE ("expires_at" IS NOT NULL);


--
-- Name: idx_audit_log_org_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_audit_log_org_id" ON "public"."audit_log" USING "btree" ("org_id");


--
-- Name: idx_audit_log_org_time; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_audit_log_org_time" ON "public"."audit_log" USING "btree" ("org_id", "performed_at" DESC);


--
-- Name: idx_audit_log_performed_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_audit_log_performed_at" ON "public"."audit_log" USING "btree" ("performed_at" DESC);


--
-- Name: idx_audit_log_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_audit_log_user_id" ON "public"."audit_log" USING "btree" ("user_id");


--
-- Name: idx_org_invites_email; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_org_invites_email" ON "public"."org_invitations" USING "btree" ("email");


--
-- Name: idx_org_invites_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_org_invites_org" ON "public"."org_invitations" USING "btree" ("org_id");


--
-- Name: idx_org_memberships_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_org_memberships_org" ON "public"."org_memberships" USING "btree" ("org_id");


--
-- Name: idx_org_memberships_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_org_memberships_user" ON "public"."org_memberships" USING "btree" ("user_id");


--
-- Name: idx_org_settings_storage_grace_ends_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_org_settings_storage_grace_ends_at" ON "public"."org_settings" USING "btree" ("storage_grace_ends_at") WHERE ("storage_grace_ends_at" IS NOT NULL);


--
-- Name: idx_permission_registry_category; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_permission_registry_category" ON "public"."permission_registry" USING "btree" ("category");


--
-- Name: schema_migration_audit_tenant_created_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "schema_migration_audit_tenant_created_idx" ON "public"."schema_migration_audit" USING "btree" ("tenant_id", "created_at" DESC);


--
-- Name: organizations trg_add_owner_membership; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_add_owner_membership" AFTER INSERT ON "public"."organizations" FOR EACH ROW EXECUTE FUNCTION "public"."add_owner_membership"();


--
-- Name: organizations trg_org_owner; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_org_owner" AFTER INSERT ON "public"."organizations" FOR EACH ROW EXECUTE FUNCTION "public"."handle_org_owner"();


--
-- Name: organizations trg_org_owner_after_insert; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_org_owner_after_insert" AFTER INSERT ON "public"."organizations" FOR EACH ROW EXECUTE FUNCTION "public"."_add_owner_membership"();


--
-- Name: org_settings trg_org_settings_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_org_settings_updated_at" BEFORE UPDATE ON "public"."org_settings" FOR EACH ROW EXECUTE FUNCTION "public"."_set_updated_at"();


--
-- Name: organizations trg_org_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_org_updated_at" BEFORE UPDATE ON "public"."organizations" FOR EACH ROW EXECUTE FUNCTION "public"."_set_updated_at"();


--
-- Name: organizations trg_orgs_timestamps; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_orgs_timestamps" BEFORE INSERT OR UPDATE ON "public"."organizations" FOR EACH ROW EXECUTE FUNCTION "public"."organizations_timestamps"();


--
-- Name: active_routing active_routing_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."active_routing"
    ADD CONSTRAINT "active_routing_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id");


--
-- Name: org_invitations org_invitations_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."org_invitations"
    ADD CONSTRAINT "org_invitations_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: org_invitations org_invitations_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."org_invitations"
    ADD CONSTRAINT "org_invitations_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;


--
-- Name: org_memberships org_memberships_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."org_memberships"
    ADD CONSTRAINT "org_memberships_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;


--
-- Name: org_memberships org_memberships_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."org_memberships"
    ADD CONSTRAINT "org_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: org_settings org_settings_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."org_settings"
    ADD CONSTRAINT "org_settings_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;


--
-- Name: organizations organizations_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: schema_migration_audit schema_migration_audit_approved_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."schema_migration_audit"
    ADD CONSTRAINT "schema_migration_audit_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: schema_migration_audit schema_migration_audit_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."schema_migration_audit"
    ADD CONSTRAINT "schema_migration_audit_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;


--
-- Name: permission_registry Allow authenticated users to read permission registry; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Allow authenticated users to read permission registry" ON "public"."permission_registry" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));


--
-- Name: org_settings Allow members to read org settings; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Allow members to read org settings" ON "public"."org_settings" FOR SELECT TO "authenticated" USING ("public"."current_user_is_org_member"("org_id"));


--
-- Name: schema_migration_audit Allow service role access on schema_migration_audit; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Allow service role access on schema_migration_audit" ON "public"."schema_migration_audit" TO "service_role" USING (true) WITH CHECK (true);


--
-- Name: active_routing Only service role can access active routing; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Only service role can access active routing" ON "public"."active_routing" TO "service_role" USING (true) WITH CHECK (true);


--
-- Name: audit_log Only service role can modify audit logs; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Only service role can modify audit logs" ON "public"."audit_log" TO "service_role" USING (true) WITH CHECK (true);


--
-- Name: permission_registry Only service role can modify permission registry; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Only service role can modify permission registry" ON "public"."permission_registry" TO "service_role" USING (true) WITH CHECK (true);


--
-- Name: org_invitations Org invitations admin; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Org invitations admin" ON "public"."org_invitations" TO "authenticated" USING ("public"."current_user_is_org_admin"("org_id")) WITH CHECK ("public"."current_user_is_org_admin"("org_id"));


--
-- Name: org_invitations Org invitations self; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Org invitations self" ON "public"."org_invitations" FOR SELECT TO "authenticated" USING (("lower"("email") = "lower"(COALESCE(("auth"."jwt"() ->> 'email'::"text"), ''::"text"))));


--
-- Name: org_invitations Org invitations self update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Org invitations self update" ON "public"."org_invitations" FOR UPDATE TO "authenticated" USING (("lower"("email") = "lower"(COALESCE(("auth"."jwt"() ->> 'email'::"text"), ''::"text")))) WITH CHECK (("lower"("email") = "lower"(COALESCE(("auth"."jwt"() ->> 'email'::"text"), ''::"text"))));


--
-- Name: org_settings Org settings admin; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Org settings admin" ON "public"."org_settings" TO "authenticated" USING ("public"."current_user_is_org_admin"("org_id")) WITH CHECK ("public"."current_user_is_org_admin"("org_id"));


--
-- Name: organizations Organizations admin delete; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Organizations admin delete" ON "public"."organizations" FOR DELETE TO "authenticated" USING ("public"."current_user_is_org_admin"("id"));


--
-- Name: organizations Organizations admin manage; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Organizations admin manage" ON "public"."organizations" FOR UPDATE TO "authenticated" USING ("public"."current_user_is_org_admin"("id")) WITH CHECK ("public"."current_user_is_org_admin"("id"));


--
-- Name: audit_log Users can read audit logs for their orgs; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can read audit logs for their orgs" ON "public"."audit_log" FOR SELECT TO "authenticated" USING (("org_id" IN ( SELECT "org_memberships"."org_id"
   FROM "public"."org_memberships"
  WHERE ("org_memberships"."user_id" = "auth"."uid"()))));


--
-- Name: profiles Users can update their own profile.; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can update their own profile." ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "id"));


--
-- Name: profiles Users can view their own profile.; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can view their own profile." ON "public"."profiles" FOR SELECT USING (("auth"."uid"() = "id"));


--
-- Name: active_routing; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."active_routing" ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_log; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."audit_log" ENABLE ROW LEVEL SECURITY;

--
-- Name: org_memberships delete own membership; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "delete own membership" ON "public"."org_memberships" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));


--
-- Name: org_invitations inv_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "inv_select" ON "public"."org_invitations" FOR SELECT USING ((("invited_by" = "auth"."uid"()) OR ("email" = "auth"."email"())));


--
-- Name: org_invitations invites_select_basic; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "invites_select_basic" ON "public"."org_invitations" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."org_memberships" "m"
  WHERE (("m"."org_id" = "org_invitations"."org_id") AND ("m"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))) OR ("lower"("email") = "lower"(("auth"."jwt"() ->> 'email'::"text")))));


--
-- Name: organizations members or creator can read orgs; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "members or creator can read orgs" ON "public"."organizations" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."org_memberships" "m"
  WHERE (("m"."org_id" = "organizations"."id") AND ("m"."user_id" = "auth"."uid"())))) OR ("created_by" = "auth"."uid"())));


--
-- Name: org_invitations; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."org_invitations" ENABLE ROW LEVEL SECURITY;

--
-- Name: org_memberships; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."org_memberships" ENABLE ROW LEVEL SECURITY;

--
-- Name: org_settings; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."org_settings" ENABLE ROW LEVEL SECURITY;

--
-- Name: organizations; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."organizations" ENABLE ROW LEVEL SECURITY;

--
-- Name: organizations orgs_delete_by_owners; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "orgs_delete_by_owners" ON "public"."organizations" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."org_memberships" "m"
  WHERE (("m"."org_id" = "organizations"."id") AND ("m"."user_id" = "auth"."uid"()) AND ("m"."role" = 'owner'::"text")))));


--
-- Name: organizations orgs_insert_authenticated; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "orgs_insert_authenticated" ON "public"."organizations" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() IS NOT NULL));


--
-- Name: organizations orgs_update_by_admins; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "orgs_update_by_admins" ON "public"."organizations" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."org_memberships" "m"
  WHERE (("m"."org_id" = "organizations"."id") AND ("m"."user_id" = "auth"."uid"()) AND ("m"."role" = ANY (ARRAY['owner'::"text", 'admin'::"text"]))))));


--
-- Name: permission_registry; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."permission_registry" ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;

--
-- Name: org_memberships read own membership; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "read own membership" ON "public"."org_memberships" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));


--
-- Name: schema_migration_audit; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."schema_migration_audit" ENABLE ROW LEVEL SECURITY;

--
-- Name: org_memberships update own membership; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "update own membership" ON "public"."org_memberships" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"()));


--
-- Name: supabase_realtime; Type: PUBLICATION; Schema: -; Owner: postgres
--

-- CREATE PUBLICATION "supabase_realtime" WITH (publish = 'insert, update, delete, truncate');


ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";

--
-- Name: SCHEMA "public"; Type: ACL; Schema: -; Owner: pg_database_owner
--

GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";


--
-- Name: FUNCTION "armor"("bytea"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."armor"("bytea") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."armor"("bytea") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."armor"("bytea") TO "dashboard_user";


--
-- Name: FUNCTION "armor"("bytea", "text"[], "text"[]); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."armor"("bytea", "text"[], "text"[]) FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."armor"("bytea", "text"[], "text"[]) TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."armor"("bytea", "text"[], "text"[]) TO "dashboard_user";


--
-- Name: FUNCTION "crypt"("text", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."crypt"("text", "text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."crypt"("text", "text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."crypt"("text", "text") TO "dashboard_user";


--
-- Name: FUNCTION "dearmor"("text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."dearmor"("text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."dearmor"("text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."dearmor"("text") TO "dashboard_user";


--
-- Name: FUNCTION "decrypt"("bytea", "bytea", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."decrypt"("bytea", "bytea", "text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."decrypt"("bytea", "bytea", "text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."decrypt"("bytea", "bytea", "text") TO "dashboard_user";


--
-- Name: FUNCTION "decrypt_iv"("bytea", "bytea", "bytea", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."decrypt_iv"("bytea", "bytea", "bytea", "text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."decrypt_iv"("bytea", "bytea", "bytea", "text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."decrypt_iv"("bytea", "bytea", "bytea", "text") TO "dashboard_user";


--
-- Name: FUNCTION "digest"("bytea", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."digest"("bytea", "text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."digest"("bytea", "text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."digest"("bytea", "text") TO "dashboard_user";


--
-- Name: FUNCTION "digest"("text", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."digest"("text", "text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."digest"("text", "text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."digest"("text", "text") TO "dashboard_user";


--
-- Name: FUNCTION "encrypt"("bytea", "bytea", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."encrypt"("bytea", "bytea", "text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."encrypt"("bytea", "bytea", "text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."encrypt"("bytea", "bytea", "text") TO "dashboard_user";


--
-- Name: FUNCTION "encrypt_iv"("bytea", "bytea", "bytea", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."encrypt_iv"("bytea", "bytea", "bytea", "text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."encrypt_iv"("bytea", "bytea", "bytea", "text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."encrypt_iv"("bytea", "bytea", "bytea", "text") TO "dashboard_user";


--
-- Name: FUNCTION "gen_random_bytes"(integer); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."gen_random_bytes"(integer) FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."gen_random_bytes"(integer) TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."gen_random_bytes"(integer) TO "dashboard_user";


--
-- Name: FUNCTION "gen_random_uuid"(); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."gen_random_uuid"() FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."gen_random_uuid"() TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."gen_random_uuid"() TO "dashboard_user";


--
-- Name: FUNCTION "gen_salt"("text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."gen_salt"("text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."gen_salt"("text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."gen_salt"("text") TO "dashboard_user";


--
-- Name: FUNCTION "gen_salt"("text", integer); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."gen_salt"("text", integer) FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."gen_salt"("text", integer) TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."gen_salt"("text", integer) TO "dashboard_user";


--
-- Name: FUNCTION "hmac"("bytea", "bytea", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."hmac"("bytea", "bytea", "text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."hmac"("bytea", "bytea", "text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."hmac"("bytea", "bytea", "text") TO "dashboard_user";


--
-- Name: FUNCTION "hmac"("text", "text", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."hmac"("text", "text", "text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."hmac"("text", "text", "text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."hmac"("text", "text", "text") TO "dashboard_user";


--
-- Name: FUNCTION "pg_stat_statements"("showtext" boolean, OUT "userid" "oid", OUT "dbid" "oid", OUT "toplevel" boolean, OUT "queryid" bigint, OUT "query" "text", OUT "plans" bigint, OUT "total_plan_time" double precision, OUT "min_plan_time" double precision, OUT "max_plan_time" double precision, OUT "mean_plan_time" double precision, OUT "stddev_plan_time" double precision, OUT "calls" bigint, OUT "total_exec_time" double precision, OUT "min_exec_time" double precision, OUT "max_exec_time" double precision, OUT "mean_exec_time" double precision, OUT "stddev_exec_time" double precision, OUT "rows" bigint, OUT "shared_blks_hit" bigint, OUT "shared_blks_read" bigint, OUT "shared_blks_dirtied" bigint, OUT "shared_blks_written" bigint, OUT "local_blks_hit" bigint, OUT "local_blks_read" bigint, OUT "local_blks_dirtied" bigint, OUT "local_blks_written" bigint, OUT "temp_blks_read" bigint, OUT "temp_blks_written" bigint, OUT "shared_blk_read_time" double precision, OUT "shared_blk_write_time" double precision, OUT "local_blk_read_time" double precision, OUT "local_blk_write_time" double precision, OUT "temp_blk_read_time" double precision, OUT "temp_blk_write_time" double precision, OUT "wal_records" bigint, OUT "wal_fpi" bigint, OUT "wal_bytes" numeric, OUT "jit_functions" bigint, OUT "jit_generation_time" double precision, OUT "jit_inlining_count" bigint, OUT "jit_inlining_time" double precision, OUT "jit_optimization_count" bigint, OUT "jit_optimization_time" double precision, OUT "jit_emission_count" bigint, OUT "jit_emission_time" double precision, OUT "jit_deform_count" bigint, OUT "jit_deform_time" double precision, OUT "stats_since" timestamp with time zone, OUT "minmax_stats_since" timestamp with time zone); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."pg_stat_statements"("showtext" boolean, OUT "userid" "oid", OUT "dbid" "oid", OUT "toplevel" boolean, OUT "queryid" bigint, OUT "query" "text", OUT "plans" bigint, OUT "total_plan_time" double precision, OUT "min_plan_time" double precision, OUT "max_plan_time" double precision, OUT "mean_plan_time" double precision, OUT "stddev_plan_time" double precision, OUT "calls" bigint, OUT "total_exec_time" double precision, OUT "min_exec_time" double precision, OUT "max_exec_time" double precision, OUT "mean_exec_time" double precision, OUT "stddev_exec_time" double precision, OUT "rows" bigint, OUT "shared_blks_hit" bigint, OUT "shared_blks_read" bigint, OUT "shared_blks_dirtied" bigint, OUT "shared_blks_written" bigint, OUT "local_blks_hit" bigint, OUT "local_blks_read" bigint, OUT "local_blks_dirtied" bigint, OUT "local_blks_written" bigint, OUT "temp_blks_read" bigint, OUT "temp_blks_written" bigint, OUT "shared_blk_read_time" double precision, OUT "shared_blk_write_time" double precision, OUT "local_blk_read_time" double precision, OUT "local_blk_write_time" double precision, OUT "temp_blk_read_time" double precision, OUT "temp_blk_write_time" double precision, OUT "wal_records" bigint, OUT "wal_fpi" bigint, OUT "wal_bytes" numeric, OUT "jit_functions" bigint, OUT "jit_generation_time" double precision, OUT "jit_inlining_count" bigint, OUT "jit_inlining_time" double precision, OUT "jit_optimization_count" bigint, OUT "jit_optimization_time" double precision, OUT "jit_emission_count" bigint, OUT "jit_emission_time" double precision, OUT "jit_deform_count" bigint, OUT "jit_deform_time" double precision, OUT "stats_since" timestamp with time zone, OUT "minmax_stats_since" timestamp with time zone) FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."pg_stat_statements"("showtext" boolean, OUT "userid" "oid", OUT "dbid" "oid", OUT "toplevel" boolean, OUT "queryid" bigint, OUT "query" "text", OUT "plans" bigint, OUT "total_plan_time" double precision, OUT "min_plan_time" double precision, OUT "max_plan_time" double precision, OUT "mean_plan_time" double precision, OUT "stddev_plan_time" double precision, OUT "calls" bigint, OUT "total_exec_time" double precision, OUT "min_exec_time" double precision, OUT "max_exec_time" double precision, OUT "mean_exec_time" double precision, OUT "stddev_exec_time" double precision, OUT "rows" bigint, OUT "shared_blks_hit" bigint, OUT "shared_blks_read" bigint, OUT "shared_blks_dirtied" bigint, OUT "shared_blks_written" bigint, OUT "local_blks_hit" bigint, OUT "local_blks_read" bigint, OUT "local_blks_dirtied" bigint, OUT "local_blks_written" bigint, OUT "temp_blks_read" bigint, OUT "temp_blks_written" bigint, OUT "shared_blk_read_time" double precision, OUT "shared_blk_write_time" double precision, OUT "local_blk_read_time" double precision, OUT "local_blk_write_time" double precision, OUT "temp_blk_read_time" double precision, OUT "temp_blk_write_time" double precision, OUT "wal_records" bigint, OUT "wal_fpi" bigint, OUT "wal_bytes" numeric, OUT "jit_functions" bigint, OUT "jit_generation_time" double precision, OUT "jit_inlining_count" bigint, OUT "jit_inlining_time" double precision, OUT "jit_optimization_count" bigint, OUT "jit_optimization_time" double precision, OUT "jit_emission_count" bigint, OUT "jit_emission_time" double precision, OUT "jit_deform_count" bigint, OUT "jit_deform_time" double precision, OUT "stats_since" timestamp with time zone, OUT "minmax_stats_since" timestamp with time zone) TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."pg_stat_statements"("showtext" boolean, OUT "userid" "oid", OUT "dbid" "oid", OUT "toplevel" boolean, OUT "queryid" bigint, OUT "query" "text", OUT "plans" bigint, OUT "total_plan_time" double precision, OUT "min_plan_time" double precision, OUT "max_plan_time" double precision, OUT "mean_plan_time" double precision, OUT "stddev_plan_time" double precision, OUT "calls" bigint, OUT "total_exec_time" double precision, OUT "min_exec_time" double precision, OUT "max_exec_time" double precision, OUT "mean_exec_time" double precision, OUT "stddev_exec_time" double precision, OUT "rows" bigint, OUT "shared_blks_hit" bigint, OUT "shared_blks_read" bigint, OUT "shared_blks_dirtied" bigint, OUT "shared_blks_written" bigint, OUT "local_blks_hit" bigint, OUT "local_blks_read" bigint, OUT "local_blks_dirtied" bigint, OUT "local_blks_written" bigint, OUT "temp_blks_read" bigint, OUT "temp_blks_written" bigint, OUT "shared_blk_read_time" double precision, OUT "shared_blk_write_time" double precision, OUT "local_blk_read_time" double precision, OUT "local_blk_write_time" double precision, OUT "temp_blk_read_time" double precision, OUT "temp_blk_write_time" double precision, OUT "wal_records" bigint, OUT "wal_fpi" bigint, OUT "wal_bytes" numeric, OUT "jit_functions" bigint, OUT "jit_generation_time" double precision, OUT "jit_inlining_count" bigint, OUT "jit_inlining_time" double precision, OUT "jit_optimization_count" bigint, OUT "jit_optimization_time" double precision, OUT "jit_emission_count" bigint, OUT "jit_emission_time" double precision, OUT "jit_deform_count" bigint, OUT "jit_deform_time" double precision, OUT "stats_since" timestamp with time zone, OUT "minmax_stats_since" timestamp with time zone) TO "dashboard_user";


--
-- Name: FUNCTION "pg_stat_statements_info"(OUT "dealloc" bigint, OUT "stats_reset" timestamp with time zone); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."pg_stat_statements_info"(OUT "dealloc" bigint, OUT "stats_reset" timestamp with time zone) FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."pg_stat_statements_info"(OUT "dealloc" bigint, OUT "stats_reset" timestamp with time zone) TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."pg_stat_statements_info"(OUT "dealloc" bigint, OUT "stats_reset" timestamp with time zone) TO "dashboard_user";


--
-- Name: FUNCTION "pg_stat_statements_reset"("userid" "oid", "dbid" "oid", "queryid" bigint, "minmax_only" boolean); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."pg_stat_statements_reset"("userid" "oid", "dbid" "oid", "queryid" bigint, "minmax_only" boolean) FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."pg_stat_statements_reset"("userid" "oid", "dbid" "oid", "queryid" bigint, "minmax_only" boolean) TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."pg_stat_statements_reset"("userid" "oid", "dbid" "oid", "queryid" bigint, "minmax_only" boolean) TO "dashboard_user";


--
-- Name: FUNCTION "pgp_armor_headers"("text", OUT "key" "text", OUT "value" "text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."pgp_armor_headers"("text", OUT "key" "text", OUT "value" "text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."pgp_armor_headers"("text", OUT "key" "text", OUT "value" "text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."pgp_armor_headers"("text", OUT "key" "text", OUT "value" "text") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_key_id"("bytea"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."pgp_key_id"("bytea") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."pgp_key_id"("bytea") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."pgp_key_id"("bytea") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_pub_decrypt"("bytea", "bytea"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."pgp_pub_decrypt"("bytea", "bytea") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."pgp_pub_decrypt"("bytea", "bytea") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."pgp_pub_decrypt"("bytea", "bytea") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_pub_decrypt"("bytea", "bytea", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."pgp_pub_decrypt"("bytea", "bytea", "text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."pgp_pub_decrypt"("bytea", "bytea", "text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."pgp_pub_decrypt"("bytea", "bytea", "text") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_pub_decrypt"("bytea", "bytea", "text", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."pgp_pub_decrypt"("bytea", "bytea", "text", "text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."pgp_pub_decrypt"("bytea", "bytea", "text", "text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."pgp_pub_decrypt"("bytea", "bytea", "text", "text") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_pub_decrypt_bytea"("bytea", "bytea"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."pgp_pub_decrypt_bytea"("bytea", "bytea") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."pgp_pub_decrypt_bytea"("bytea", "bytea") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."pgp_pub_decrypt_bytea"("bytea", "bytea") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_pub_decrypt_bytea"("bytea", "bytea", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."pgp_pub_decrypt_bytea"("bytea", "bytea", "text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."pgp_pub_decrypt_bytea"("bytea", "bytea", "text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."pgp_pub_decrypt_bytea"("bytea", "bytea", "text") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_pub_decrypt_bytea"("bytea", "bytea", "text", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."pgp_pub_decrypt_bytea"("bytea", "bytea", "text", "text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."pgp_pub_decrypt_bytea"("bytea", "bytea", "text", "text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."pgp_pub_decrypt_bytea"("bytea", "bytea", "text", "text") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_pub_encrypt"("text", "bytea"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."pgp_pub_encrypt"("text", "bytea") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."pgp_pub_encrypt"("text", "bytea") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."pgp_pub_encrypt"("text", "bytea") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_pub_encrypt"("text", "bytea", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."pgp_pub_encrypt"("text", "bytea", "text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."pgp_pub_encrypt"("text", "bytea", "text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."pgp_pub_encrypt"("text", "bytea", "text") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_pub_encrypt_bytea"("bytea", "bytea"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."pgp_pub_encrypt_bytea"("bytea", "bytea") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."pgp_pub_encrypt_bytea"("bytea", "bytea") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."pgp_pub_encrypt_bytea"("bytea", "bytea") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_pub_encrypt_bytea"("bytea", "bytea", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."pgp_pub_encrypt_bytea"("bytea", "bytea", "text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."pgp_pub_encrypt_bytea"("bytea", "bytea", "text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."pgp_pub_encrypt_bytea"("bytea", "bytea", "text") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_sym_decrypt"("bytea", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."pgp_sym_decrypt"("bytea", "text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."pgp_sym_decrypt"("bytea", "text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."pgp_sym_decrypt"("bytea", "text") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_sym_decrypt"("bytea", "text", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."pgp_sym_decrypt"("bytea", "text", "text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."pgp_sym_decrypt"("bytea", "text", "text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."pgp_sym_decrypt"("bytea", "text", "text") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_sym_decrypt_bytea"("bytea", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."pgp_sym_decrypt_bytea"("bytea", "text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."pgp_sym_decrypt_bytea"("bytea", "text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."pgp_sym_decrypt_bytea"("bytea", "text") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_sym_decrypt_bytea"("bytea", "text", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."pgp_sym_decrypt_bytea"("bytea", "text", "text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."pgp_sym_decrypt_bytea"("bytea", "text", "text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."pgp_sym_decrypt_bytea"("bytea", "text", "text") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_sym_encrypt"("text", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."pgp_sym_encrypt"("text", "text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."pgp_sym_encrypt"("text", "text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."pgp_sym_encrypt"("text", "text") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_sym_encrypt"("text", "text", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."pgp_sym_encrypt"("text", "text", "text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."pgp_sym_encrypt"("text", "text", "text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."pgp_sym_encrypt"("text", "text", "text") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_sym_encrypt_bytea"("bytea", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."pgp_sym_encrypt_bytea"("bytea", "text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."pgp_sym_encrypt_bytea"("bytea", "text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."pgp_sym_encrypt_bytea"("bytea", "text") TO "dashboard_user";


--
-- Name: FUNCTION "pgp_sym_encrypt_bytea"("bytea", "text", "text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."pgp_sym_encrypt_bytea"("bytea", "text", "text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."pgp_sym_encrypt_bytea"("bytea", "text", "text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."pgp_sym_encrypt_bytea"("bytea", "text", "text") TO "dashboard_user";


--
-- Name: FUNCTION "uuid_generate_v1"(); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."uuid_generate_v1"() FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."uuid_generate_v1"() TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."uuid_generate_v1"() TO "dashboard_user";


--
-- Name: FUNCTION "uuid_generate_v1mc"(); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."uuid_generate_v1mc"() FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."uuid_generate_v1mc"() TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."uuid_generate_v1mc"() TO "dashboard_user";


--
-- Name: FUNCTION "uuid_generate_v3"("namespace" "uuid", "name" "text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."uuid_generate_v3"("namespace" "uuid", "name" "text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."uuid_generate_v3"("namespace" "uuid", "name" "text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."uuid_generate_v3"("namespace" "uuid", "name" "text") TO "dashboard_user";


--
-- Name: FUNCTION "uuid_generate_v4"(); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."uuid_generate_v4"() FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."uuid_generate_v4"() TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."uuid_generate_v4"() TO "dashboard_user";


--
-- Name: FUNCTION "uuid_generate_v5"("namespace" "uuid", "name" "text"); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."uuid_generate_v5"("namespace" "uuid", "name" "text") FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."uuid_generate_v5"("namespace" "uuid", "name" "text") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."uuid_generate_v5"("namespace" "uuid", "name" "text") TO "dashboard_user";


--
-- Name: FUNCTION "uuid_nil"(); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."uuid_nil"() FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."uuid_nil"() TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."uuid_nil"() TO "dashboard_user";


--
-- Name: FUNCTION "uuid_ns_dns"(); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."uuid_ns_dns"() FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."uuid_ns_dns"() TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."uuid_ns_dns"() TO "dashboard_user";


--
-- Name: FUNCTION "uuid_ns_oid"(); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."uuid_ns_oid"() FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."uuid_ns_oid"() TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."uuid_ns_oid"() TO "dashboard_user";


--
-- Name: FUNCTION "uuid_ns_url"(); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."uuid_ns_url"() FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."uuid_ns_url"() TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."uuid_ns_url"() TO "dashboard_user";


--
-- Name: FUNCTION "uuid_ns_x500"(); Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON FUNCTION "extensions"."uuid_ns_x500"() FROM "postgres";
-- GRANT ALL ON FUNCTION "extensions"."uuid_ns_x500"() TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "extensions"."uuid_ns_x500"() TO "dashboard_user";


--
-- Name: FUNCTION "graphql"("operationName" "text", "query" "text", "variables" "jsonb", "extensions" "jsonb"); Type: ACL; Schema: graphql_public; Owner: supabase_admin
--

-- GRANT ALL ON FUNCTION "graphql_public"."graphql"("operationName" "text", "query" "text", "variables" "jsonb", "extensions" "jsonb") TO "postgres";
-- GRANT ALL ON FUNCTION "graphql_public"."graphql"("operationName" "text", "query" "text", "variables" "jsonb", "extensions" "jsonb") TO "anon";
-- GRANT ALL ON FUNCTION "graphql_public"."graphql"("operationName" "text", "query" "text", "variables" "jsonb", "extensions" "jsonb") TO "authenticated";
-- GRANT ALL ON FUNCTION "graphql_public"."graphql"("operationName" "text", "query" "text", "variables" "jsonb", "extensions" "jsonb") TO "service_role";


--
-- Name: FUNCTION "_add_owner_membership"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."_add_owner_membership"() TO "anon";
GRANT ALL ON FUNCTION "public"."_add_owner_membership"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."_add_owner_membership"() TO "service_role";


--
-- Name: FUNCTION "_set_updated_at"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."_set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."_set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."_set_updated_at"() TO "service_role";


--
-- Name: FUNCTION "add_membership"("p_org_id" "uuid", "p_user_id" "uuid", "p_role" "text"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."add_membership"("p_org_id" "uuid", "p_user_id" "uuid", "p_role" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."add_membership"("p_org_id" "uuid", "p_user_id" "uuid", "p_role" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."add_membership"("p_org_id" "uuid", "p_user_id" "uuid", "p_role" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_membership"("p_org_id" "uuid", "p_user_id" "uuid", "p_role" "text") TO "service_role";


--
-- Name: FUNCTION "add_owner_membership"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."add_owner_membership"() TO "anon";
GRANT ALL ON FUNCTION "public"."add_owner_membership"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_owner_membership"() TO "service_role";


--
-- Name: FUNCTION "create_organization"("p_name" "text"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."create_organization"("p_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_organization"("p_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."create_organization"("p_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_organization"("p_name" "text") TO "service_role";


--
-- Name: FUNCTION "current_user_is_org_admin"("target_org" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."current_user_is_org_admin"("target_org" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."current_user_is_org_admin"("target_org" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_is_org_admin"("target_org" "uuid") TO "service_role";


--
-- Name: FUNCTION "current_user_is_org_member"("target_org" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."current_user_is_org_member"("target_org" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."current_user_is_org_member"("target_org" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_is_org_member"("target_org" "uuid") TO "service_role";


--
-- Name: FUNCTION "get_default_permissions"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."get_default_permissions"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_default_permissions"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_default_permissions"() TO "service_role";


--
-- Name: FUNCTION "get_org_public_keys"("p_org_id" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."get_org_public_keys"("p_org_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_org_public_keys"("p_org_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_org_public_keys"("p_org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_org_public_keys"("p_org_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "handle_new_user"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";


--
-- Name: FUNCTION "handle_org_owner"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."handle_org_owner"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_org_owner"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_org_owner"() TO "service_role";


--
-- Name: FUNCTION "initialize_org_permissions"("p_org_id" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."initialize_org_permissions"("p_org_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."initialize_org_permissions"("p_org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."initialize_org_permissions"("p_org_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "log_audit_event"("p_org_id" "uuid", "p_user_id" "uuid", "p_user_email" "text", "p_user_role" "text", "p_action_type" "text", "p_action_category" "text", "p_resource_type" "text", "p_resource_id" "text", "p_details" "jsonb", "p_metadata" "jsonb"); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."log_audit_event"("p_org_id" "uuid", "p_user_id" "uuid", "p_user_email" "text", "p_user_role" "text", "p_action_type" "text", "p_action_category" "text", "p_resource_type" "text", "p_resource_id" "text", "p_details" "jsonb", "p_metadata" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."log_audit_event"("p_org_id" "uuid", "p_user_id" "uuid", "p_user_email" "text", "p_user_role" "text", "p_action_type" "text", "p_action_category" "text", "p_resource_type" "text", "p_resource_id" "text", "p_details" "jsonb", "p_metadata" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_audit_event"("p_org_id" "uuid", "p_user_id" "uuid", "p_user_email" "text", "p_user_role" "text", "p_action_type" "text", "p_action_category" "text", "p_resource_type" "text", "p_resource_id" "text", "p_details" "jsonb", "p_metadata" "jsonb") TO "service_role";


--
-- Name: FUNCTION "organizations_timestamps"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."organizations_timestamps"() TO "anon";
GRANT ALL ON FUNCTION "public"."organizations_timestamps"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."organizations_timestamps"() TO "service_role";


--
-- Name: FUNCTION "user_exists"("user_email" "text"); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."user_exists"("user_email" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."user_exists"("user_email" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_exists"("user_email" "text") TO "service_role";


--
-- Name: FUNCTION "user_verification_state"("user_email" "text"); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."user_verification_state"("user_email" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."user_verification_state"("user_email" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_verification_state"("user_email" "text") TO "service_role";


--
-- Name: FUNCTION "_crypto_aead_det_decrypt"("message" "bytea", "additional" "bytea", "key_id" bigint, "context" "bytea", "nonce" "bytea"); Type: ACL; Schema: vault; Owner: supabase_admin
--

-- GRANT ALL ON FUNCTION "vault"."_crypto_aead_det_decrypt"("message" "bytea", "additional" "bytea", "key_id" bigint, "context" "bytea", "nonce" "bytea") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "vault"."_crypto_aead_det_decrypt"("message" "bytea", "additional" "bytea", "key_id" bigint, "context" "bytea", "nonce" "bytea") TO "service_role";


--
-- Name: FUNCTION "create_secret"("new_secret" "text", "new_name" "text", "new_description" "text", "new_key_id" "uuid"); Type: ACL; Schema: vault; Owner: supabase_admin
--

-- GRANT ALL ON FUNCTION "vault"."create_secret"("new_secret" "text", "new_name" "text", "new_description" "text", "new_key_id" "uuid") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "vault"."create_secret"("new_secret" "text", "new_name" "text", "new_description" "text", "new_key_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "update_secret"("secret_id" "uuid", "new_secret" "text", "new_name" "text", "new_description" "text", "new_key_id" "uuid"); Type: ACL; Schema: vault; Owner: supabase_admin
--

-- GRANT ALL ON FUNCTION "vault"."update_secret"("secret_id" "uuid", "new_secret" "text", "new_name" "text", "new_description" "text", "new_key_id" "uuid") TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON FUNCTION "vault"."update_secret"("secret_id" "uuid", "new_secret" "text", "new_name" "text", "new_description" "text", "new_key_id" "uuid") TO "service_role";


--
-- Name: TABLE "pg_stat_statements"; Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON TABLE "extensions"."pg_stat_statements" FROM "postgres";
-- GRANT ALL ON TABLE "extensions"."pg_stat_statements" TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON TABLE "extensions"."pg_stat_statements" TO "dashboard_user";


--
-- Name: TABLE "pg_stat_statements_info"; Type: ACL; Schema: extensions; Owner: postgres
--

-- REVOKE ALL ON TABLE "extensions"."pg_stat_statements_info" FROM "postgres";
-- GRANT ALL ON TABLE "extensions"."pg_stat_statements_info" TO "postgres" WITH GRANT OPTION;
-- GRANT ALL ON TABLE "extensions"."pg_stat_statements_info" TO "dashboard_user";


--
-- Name: TABLE "active_routing"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."active_routing" TO "service_role";


--
-- Name: TABLE "audit_log"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."audit_log" TO "anon";
GRANT ALL ON TABLE "public"."audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_log" TO "service_role";


--
-- Name: TABLE "org_invitations"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."org_invitations" TO "anon";
GRANT ALL ON TABLE "public"."org_invitations" TO "authenticated";
GRANT ALL ON TABLE "public"."org_invitations" TO "service_role";


--
-- Name: TABLE "org_memberships"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."org_memberships" TO "anon";
GRANT ALL ON TABLE "public"."org_memberships" TO "authenticated";
GRANT ALL ON TABLE "public"."org_memberships" TO "service_role";


--
-- Name: TABLE "org_settings"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."org_settings" TO "anon";
GRANT ALL ON TABLE "public"."org_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."org_settings" TO "service_role";


--
-- Name: TABLE "organizations"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."organizations" TO "anon";
GRANT ALL ON TABLE "public"."organizations" TO "authenticated";
GRANT ALL ON TABLE "public"."organizations" TO "service_role";


--
-- Name: TABLE "permission_registry"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."permission_registry" TO "anon";
GRANT ALL ON TABLE "public"."permission_registry" TO "authenticated";
GRANT ALL ON TABLE "public"."permission_registry" TO "service_role";


--
-- Name: TABLE "profiles"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";


--
-- Name: TABLE "schema_migration_audit"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."schema_migration_audit" TO "anon";
GRANT ALL ON TABLE "public"."schema_migration_audit" TO "authenticated";
GRANT ALL ON TABLE "public"."schema_migration_audit" TO "service_role";


--
-- Name: TABLE "secrets"; Type: ACL; Schema: vault; Owner: supabase_admin
--

-- GRANT SELECT,REFERENCES,DELETE,TRUNCATE ON TABLE "vault"."secrets" TO "postgres" WITH GRANT OPTION;
-- GRANT SELECT,DELETE ON TABLE "vault"."secrets" TO "service_role";


--
-- Name: TABLE "decrypted_secrets"; Type: ACL; Schema: vault; Owner: supabase_admin
--

-- GRANT SELECT,REFERENCES,DELETE,TRUNCATE ON TABLE "vault"."decrypted_secrets" TO "postgres" WITH GRANT OPTION;
-- GRANT SELECT,DELETE ON TABLE "vault"."decrypted_secrets" TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";


--
-- Name: issue_graphql_placeholder; Type: EVENT TRIGGER; Schema: -; Owner: supabase_admin
--

-- CREATE EVENT TRIGGER "issue_graphql_placeholder" ON "sql_drop"
--          WHEN TAG IN ('DROP EXTENSION')
--    EXECUTE FUNCTION "extensions"."set_graphql_placeholder"();


-- ALTER EVENT TRIGGER "issue_graphql_placeholder" OWNER TO "supabase_admin";

--
-- Name: issue_pg_cron_access; Type: EVENT TRIGGER; Schema: -; Owner: supabase_admin
--

-- CREATE EVENT TRIGGER "issue_pg_cron_access" ON "ddl_command_end"
--          WHEN TAG IN ('CREATE EXTENSION')
--    EXECUTE FUNCTION "extensions"."grant_pg_cron_access"();


-- ALTER EVENT TRIGGER "issue_pg_cron_access" OWNER TO "supabase_admin";

--
-- Name: issue_pg_graphql_access; Type: EVENT TRIGGER; Schema: -; Owner: supabase_admin
--

-- CREATE EVENT TRIGGER "issue_pg_graphql_access" ON "ddl_command_end"
--          WHEN TAG IN ('CREATE FUNCTION')
--    EXECUTE FUNCTION "extensions"."grant_pg_graphql_access"();


-- ALTER EVENT TRIGGER "issue_pg_graphql_access" OWNER TO "supabase_admin";

--
-- Name: issue_pg_net_access; Type: EVENT TRIGGER; Schema: -; Owner: supabase_admin
--

-- CREATE EVENT TRIGGER "issue_pg_net_access" ON "ddl_command_end"
--          WHEN TAG IN ('CREATE EXTENSION')
--    EXECUTE FUNCTION "extensions"."grant_pg_net_access"();


-- ALTER EVENT TRIGGER "issue_pg_net_access" OWNER TO "supabase_admin";

--
-- Name: pgrst_ddl_watch; Type: EVENT TRIGGER; Schema: -; Owner: supabase_admin
--

-- CREATE EVENT TRIGGER "pgrst_ddl_watch" ON "ddl_command_end"
--    EXECUTE FUNCTION "extensions"."pgrst_ddl_watch"();


-- ALTER EVENT TRIGGER "pgrst_ddl_watch" OWNER TO "supabase_admin";

--
-- Name: pgrst_drop_watch; Type: EVENT TRIGGER; Schema: -; Owner: supabase_admin
--

-- CREATE EVENT TRIGGER "pgrst_drop_watch" ON "sql_drop"
--    EXECUTE FUNCTION "extensions"."pgrst_drop_watch"();


-- ALTER EVENT TRIGGER "pgrst_drop_watch" OWNER TO "supabase_admin";

--
-- PostgreSQL database dump complete
--

-- \unrestrict tnolj5DYZ3nCfsS03bxIFj5oDJCEujH9Ca1Ll7RpfzZ3aE9M1zavbhneJ1y2svk

