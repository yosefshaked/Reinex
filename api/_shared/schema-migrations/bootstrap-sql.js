/* eslint-env node */

export const SCHEMA_MIGRATION_BOOTSTRAP_SQL = String.raw`
-- Bootstrap: enable schema migration introspection + executor
-- Safe to run multiple times.

CREATE OR REPLACE FUNCTION public.schema_introspection_v1()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result jsonb;
BEGIN
  result := jsonb_build_object(
    'generated_at', NOW(),
    'schema', 'public',
    'tables', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'name', c.relname,
          'columns', (
            SELECT COALESCE(jsonb_agg(
              jsonb_build_object(
                'name', a.attname,
                'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
                'nullable', NOT a.attnotnull,
                'default', pg_get_expr(ad.adbin, ad.adrelid)
              ) ORDER BY a.attnum
            ), '[]'::jsonb)
            FROM pg_attribute a
            LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
            WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
          ),
          'primary_key', (
            SELECT COALESCE(jsonb_agg(att.attname ORDER BY ord.ordinality), '[]'::jsonb)
            FROM pg_index i
            JOIN unnest(i.indkey) WITH ORDINALITY AS ord(attnum, ordinality) ON TRUE
            JOIN pg_attribute att ON att.attrelid = c.oid AND att.attnum = ord.attnum
            WHERE i.indrelid = c.oid AND i.indisprimary
          )
        )
      ), '[]'::jsonb)
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
    ),
    'indexes', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'table', tablename,
          'name', indexname,
          'definition', indexdef
        )
      ), '[]'::jsonb)
      FROM pg_indexes
      WHERE schemaname = 'public'
    ),
    'constraints', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'table', cls.relname,
          'name', con.conname,
          'type', con.contype,
          'definition', pg_get_constraintdef(con.oid)
        )
      ), '[]'::jsonb)
      FROM pg_constraint con
      JOIN pg_class cls ON cls.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = cls.relnamespace
      WHERE n.nspname = 'public'
    ),
    'rls', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'table', c.relname,
          'enabled', c.relrowsecurity
        )
      ), '[]'::jsonb)
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
    ),
    'policies', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'table', p.tablename,
          'name', p.policyname,
          'command', p.cmd,
          'roles', p.roles,
          'using', p.qual,
          'check', p.with_check
        )
      ), '[]'::jsonb)
      FROM pg_policies p
      WHERE p.schemaname = 'public'
    ),
    'views', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'name', c.relname,
          'definition', pg_get_viewdef(c.oid, true)
        )
      ), '[]'::jsonb)
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'v'
    ),
    'extensions', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'name', extname,
          'schema', n.nspname,
          'version', extversion
        )
      ), '[]'::jsonb)
      FROM pg_extension e
      JOIN pg_namespace n ON n.oid = e.extnamespace
    )
  );

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.schema_run_selects_v1(queries text[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  q text;
  row jsonb;
  results jsonb := '[]'::jsonb;
  upper_q text;
  result_row record;
BEGIN
  IF queries IS NULL OR array_length(queries, 1) IS NULL THEN
    RETURN results;
  END IF;

  FOREACH q IN ARRAY queries LOOP
    upper_q := upper(trim(coalesce(q, '')));
    IF upper_q = '' THEN
      CONTINUE;
    END IF;
    IF position(';' in q) > 0 THEN
      RAISE EXCEPTION 'query_contains_semicolon';
    END IF;
    IF NOT upper_q LIKE 'SELECT%' THEN
      RAISE EXCEPTION 'only_select_allowed';
    END IF;

    BEGIN
      EXECUTE q INTO result_row;
      row := jsonb_build_object('query', q, 'ok', true, 'result', to_jsonb(result_row));
    EXCEPTION WHEN OTHERS THEN
      row := jsonb_build_object('query', q, 'ok', false, 'error', SQLERRM);
    END;

    results := results || jsonb_build_array(row);
  END LOOP;

  RETURN results;
END;
$$;

CREATE OR REPLACE FUNCTION public.schema_execute_statements_v1(
  statements text[],
  allow_destructive boolean DEFAULT false,
  confirmation_phrase text DEFAULT null
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  stmt text;
  upper_stmt text;
  row jsonb;
  results jsonb := '[]'::jsonb;
  safe_ok boolean;
BEGIN
  IF statements IS NULL OR array_length(statements, 1) IS NULL THEN
    RETURN results;
  END IF;

  IF allow_destructive THEN
    IF confirmation_phrase IS DISTINCT FROM 'ALLOW DESTRUCTIVE CHANGES' THEN
      RAISE EXCEPTION 'destructive_confirmation_required';
    END IF;
  END IF;

  FOREACH stmt IN ARRAY statements LOOP
    upper_stmt := upper(trim(coalesce(stmt, '')));
    IF upper_stmt = '' THEN
      CONTINUE;
    END IF;

    IF NOT allow_destructive THEN
      safe_ok := (
        upper_stmt LIKE 'CREATE TABLE IF NOT EXISTS %' OR
        upper_stmt LIKE 'ALTER TABLE % ADD COLUMN IF NOT EXISTS %' OR
        upper_stmt LIKE 'CREATE INDEX IF NOT EXISTS %' OR
        upper_stmt LIKE 'CREATE UNIQUE INDEX IF NOT EXISTS %' OR
        upper_stmt LIKE 'ALTER TABLE % ENABLE ROW LEVEL SECURITY%' OR
        upper_stmt LIKE 'CREATE POLICY %' OR
        upper_stmt LIKE 'ALTER TABLE % ADD CONSTRAINT %' OR
        upper_stmt LIKE 'CREATE EXTENSION IF NOT EXISTS %' OR
        upper_stmt LIKE 'CREATE OR REPLACE VIEW %'
      );

      IF NOT safe_ok THEN
        RAISE EXCEPTION 'statement_not_allowed_in_safe_mode';
      END IF;

      IF upper_stmt LIKE '%DROP %' OR upper_stmt LIKE '%RENAME %' OR upper_stmt LIKE '%ALTER COLUMN % TYPE %' THEN
        RAISE EXCEPTION 'statement_contains_destructive_keywords';
      END IF;
    END IF;

    BEGIN
      EXECUTE stmt;
      row := jsonb_build_object('statement', stmt, 'ok', true);
    EXCEPTION WHEN OTHERS THEN
      row := jsonb_build_object('statement', stmt, 'ok', false, 'error', SQLERRM);
    END;

    results := results || jsonb_build_array(row);
  END LOOP;

  RETURN jsonb_build_object('statements', results);
END;
$$;

REVOKE ALL ON FUNCTION public.schema_introspection_v1() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.schema_run_selects_v1(text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.schema_execute_statements_v1(text[], boolean, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.schema_introspection_v1() TO service_role;
GRANT EXECUTE ON FUNCTION public.schema_run_selects_v1(text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.schema_execute_statements_v1(text[], boolean, text) TO service_role;
`;
