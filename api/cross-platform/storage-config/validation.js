/* eslint-env node */
/**
 * Storage Configuration Validation Module
 * 
 * Cross-system validation utilities for storage profiles.
 * System-agnostic - no TutTiud-specific logic.
 */

/**
 * Supported BYOS providers
 */
export const BYOS_PROVIDERS = {
  S3: 's3',
  AZURE: 'azure',
  GCS: 'gcs',
  R2: 'r2',
  GENERIC: 'generic',
};

/**
 * Validates BYOS (Bring Your Own Storage) configuration
 * @param {object} byosConfig - BYOS configuration object
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateByosCredentials(byosConfig) {
  const errors = [];

  if (!byosConfig || typeof byosConfig !== 'object') {
    errors.push('BYOS configuration must be an object');
    return { valid: false, errors };
  }

  // Provider validation
  const validProviders = Object.values(BYOS_PROVIDERS);
  if (!byosConfig.provider || typeof byosConfig.provider !== 'string') {
    errors.push('Provider is required');
  } else if (!validProviders.includes(byosConfig.provider)) {
    errors.push(`Provider must be one of: ${validProviders.join(', ')}`);
  }

  // Endpoint validation
  if (!byosConfig.endpoint || typeof byosConfig.endpoint !== 'string') {
    errors.push('Endpoint URL is required');
  } else {
    const trimmedEndpoint = byosConfig.endpoint.trim();
    if (!trimmedEndpoint) {
      errors.push('Endpoint URL cannot be empty');
    } else if (!trimmedEndpoint.startsWith('https://')) {
      // Security: Require HTTPS to protect credentials in transit
      if (trimmedEndpoint.startsWith('http://')) {
        errors.push('Endpoint must use HTTPS (not HTTP) to protect credentials in transit. Only use HTTP for local development.');
      } else {
        errors.push('Endpoint must be a valid HTTPS URL');
      }
    }
  }

  // Region validation (optional for some providers)
  if (byosConfig.region !== undefined && typeof byosConfig.region !== 'string') {
    errors.push('Region must be a string');
  }

  // Bucket validation
  if (!byosConfig.bucket || typeof byosConfig.bucket !== 'string') {
    errors.push('Bucket name is required');
  } else if (!byosConfig.bucket.trim()) {
    errors.push('Bucket name cannot be empty');
  }

  // Access key validation
  if (!byosConfig.access_key_id || typeof byosConfig.access_key_id !== 'string') {
    errors.push('Access key ID is required');
  } else if (!byosConfig.access_key_id.trim()) {
    errors.push('Access key ID cannot be empty');
  }

  // Secret key validation
  if (!byosConfig.secret_access_key || typeof byosConfig.secret_access_key !== 'string') {
    errors.push('Secret access key is required');
  } else if (!byosConfig.secret_access_key.trim()) {
    errors.push('Secret access key cannot be empty');
  }

  // Public URL validation (optional)
  if (byosConfig.public_url !== undefined && byosConfig.public_url !== null) {
    if (typeof byosConfig.public_url !== 'string') {
      errors.push('Public URL must be a string');
    } else {
      const trimmedUrl = byosConfig.public_url.trim();
      if (trimmedUrl && !trimmedUrl.startsWith('https://')) {
        // Security: Require HTTPS for public URLs
        if (trimmedUrl.startsWith('http://')) {
          errors.push('Public URL must use HTTPS (not HTTP) for security. Only use HTTP for local development.');
        } else {
          errors.push('Public URL must be a valid HTTPS URL');
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validates Managed Storage configuration
 * @param {object} managedConfig - Managed storage configuration object
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateManagedConfig(managedConfig) {
  const errors = [];

  if (!managedConfig || typeof managedConfig !== 'object') {
    errors.push('Managed storage configuration must be an object');
    return { valid: false, errors };
  }

  // Namespace validation
  if (!managedConfig.namespace || typeof managedConfig.namespace !== 'string') {
    errors.push('Namespace is required');
  } else if (!managedConfig.namespace.trim()) {
    errors.push('Namespace cannot be empty');
  } else {
    // Basic format validation: alphanumeric, hyphens, underscores
    const namespacePattern = /^[a-z0-9-_]+$/i;
    if (!namespacePattern.test(managedConfig.namespace)) {
      errors.push('Namespace must contain only alphanumeric characters, hyphens, and underscores');
    }
  }

  // Active status validation
  if (managedConfig.active !== undefined && typeof managedConfig.active !== 'boolean') {
    errors.push('Active status must be a boolean');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validates storage profile structure and mode-specific configuration
 * @param {object} profile - Storage profile object
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateStorageProfile(profile) {
  const errors = [];

  if (!profile || typeof profile !== 'object') {
    errors.push('Storage profile must be an object');
    return { valid: false, errors };
  }

  // Mode validation
  const validModes = ['byos', 'managed'];
  if (!profile.mode || typeof profile.mode !== 'string') {
    errors.push('Storage mode is required');
  } else if (!validModes.includes(profile.mode)) {
    errors.push(`Storage mode must be one of: ${validModes.join(', ')}`);
  }

  // Mode-specific validation
  if (profile.mode === 'byos') {
    if (!profile.byos) {
      errors.push('BYOS configuration is required when mode is "byos"');
    } else {
      const byosValidation = validateByosCredentials(profile.byos);
      errors.push(...byosValidation.errors);
    }
  } else if (profile.mode === 'managed') {
    if (!profile.managed) {
      errors.push('Managed storage configuration is required when mode is "managed"');
    } else {
      const managedValidation = validateManagedConfig(profile.managed);
      errors.push(...managedValidation.errors);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Normalizes a storage profile, ensuring consistent structure
 * @param {object} rawProfile - Raw profile input
 * @returns {object|null} Normalized profile or null if invalid
 */
export function normalizeStorageProfile(rawProfile) {
  if (!rawProfile || typeof rawProfile !== 'object') {
    return null;
  }

  const normalized = {
    mode: typeof rawProfile.mode === 'string' ? rawProfile.mode.trim().toLowerCase() : '',
  };

  if (normalized.mode === 'byos' && rawProfile.byos) {
    const byos = {
      provider: typeof rawProfile.byos.provider === 'string' 
        ? rawProfile.byos.provider.trim().toLowerCase() 
        : '',
      endpoint: typeof rawProfile.byos.endpoint === 'string' 
        ? rawProfile.byos.endpoint.trim() 
        : '',
      bucket: typeof rawProfile.byos.bucket === 'string' 
        ? rawProfile.byos.bucket.trim() 
        : '',
      access_key_id: typeof rawProfile.byos.access_key_id === 'string' 
        ? rawProfile.byos.access_key_id.trim() 
        : '',
      secret_access_key: typeof rawProfile.byos.secret_access_key === 'string' 
        ? rawProfile.byos.secret_access_key.trim() 
        : '',
      validated_at: rawProfile.byos.validated_at || null,
    };

    // Only include region if it's a non-empty string
    if (typeof rawProfile.byos.region === 'string' && rawProfile.byos.region.trim()) {
      byos.region = rawProfile.byos.region.trim();
    }

    // Only include public_url if it's a non-empty string
    if (typeof rawProfile.byos.public_url === 'string' && rawProfile.byos.public_url.trim()) {
      byos.public_url = rawProfile.byos.public_url.trim();
    }

    normalized.byos = byos;
  } else if (normalized.mode === 'managed' && rawProfile.managed) {
    normalized.managed = {
      namespace: typeof rawProfile.managed.namespace === 'string' 
        ? rawProfile.managed.namespace.trim() 
        : '',
      active: rawProfile.managed.active === true,
      created_at: rawProfile.managed.created_at || new Date().toISOString(),
    };
  }

  // Include metadata
  normalized.updated_at = rawProfile.updated_at || new Date().toISOString();
  normalized.updated_by = rawProfile.updated_by || null;

  return normalized;
}
