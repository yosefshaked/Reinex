/* eslint-env node */

/**
 * Fetch default permissions from the permission_registry table
 * @param {object} supabaseClient - Supabase admin client
 * @returns {Promise<object>} - Object with permission keys and default values
 */
export async function getDefaultPermissions(supabaseClient) {
  try {
    const { data, error } = await supabaseClient
      .rpc('get_default_permissions');
    
    if (error) {
      console.error('Failed to fetch default permissions:', error);
      return null;
    }
    
    // Coerce primitive JSONB values that may have been inserted as strings
    const raw = data || {};
    const result = {};
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === 'string') {
        const t = v.trim().toLowerCase();
        if (t === 'true') {
          result[k] = true;
          continue;
        }
        if (t === 'false') {
          result[k] = false;
          continue;
        }
        const num = Number(t);
        if (!Number.isNaN(num)) {
          result[k] = num;
          continue;
        }
      }
      result[k] = v;
    }
    return result;
  } catch (err) {
    console.error('Error fetching default permissions:', err);
    return null;
  }
}

/**
 * Initialize org permissions using the database function
 * @param {object} supabaseClient - Supabase admin client
 * @param {string} orgId - Organization UUID
 * @returns {Promise<object>} - Initialized permissions object
 */
export async function initializeOrgPermissions(supabaseClient, orgId) {
  try {
    const { data, error } = await supabaseClient
      .rpc('initialize_org_permissions', { p_org_id: orgId });
    
    if (error) {
      console.error('Failed to initialize org permissions:', error);
      return null;
    }
    
    return data || {};
  } catch (err) {
    console.error('Error initializing org permissions:', err);
    return null;
  }
}

/**
 * Ensure org has permissions initialized, returns current or initialized permissions
 * @param {object} supabaseClient - Supabase admin client
 * @param {string} orgId - Organization UUID
 * @returns {Promise<object>} - Permissions object
 */
export async function ensureOrgPermissions(supabaseClient, orgId) {
  // First try to get current permissions
  const { data: orgSettings, error: fetchError } = await supabaseClient
    .from('org_settings')
    .select('permissions')
    .eq('org_id', orgId)
    .single();

  if (fetchError) {
    console.error('Failed to fetch org settings:', fetchError);
    return null;
  }

  const current = orgSettings?.permissions;

  // If empty/null initialize entirely from defaults via DB helper
  if (!current || typeof current !== 'object' || Object.keys(current).length === 0) {
    return await initializeOrgPermissions(supabaseClient, orgId);
  }

  // Fetch defaults from registry to backfill any missing keys
  const defaults = await getDefaultPermissions(supabaseClient);
  const merged = { ...current };
  let changed = false;

  if (defaults && typeof defaults === 'object') {
    for (const [key, defVal] of Object.entries(defaults)) {
      if (!Object.prototype.hasOwnProperty.call(merged, key)) {
        merged[key] = defVal;
        changed = true;
      }
    }
  }

  // Persist only if we actually added new keys
  if (changed) {
    const { error: updateError } = await supabaseClient
      .from('org_settings')
      .update({ permissions: merged, updated_at: new Date().toISOString() })
      .eq('org_id', orgId);
    if (updateError) {
      console.error('Failed to persist merged org permissions:', updateError);
      // return best-effort merged view even if persist failed
      return merged;
    }
  }

  return merged;
}

/**
 * Get all permissions from registry with metadata
 * @param {object} supabaseClient - Supabase admin client
 * @param {string} category - Optional category filter
 * @returns {Promise<Array>} - Array of permission objects with metadata
 */
export async function getPermissionRegistry(supabaseClient, category = null) {
  try {
    let query = supabaseClient
      .from('permission_registry')
      .select('*')
      .order('category', { ascending: true })
      .order('permission_key', { ascending: true });
    
    if (category) {
      query = query.eq('category', category);
    }
    
    const { data, error } = await query;
    
    if (error) {
      console.error('Failed to fetch permission registry:', error);
      return [];
    }
    
    return data || [];
  } catch (err) {
    console.error('Error fetching permission registry:', err);
    return [];
  }
}
