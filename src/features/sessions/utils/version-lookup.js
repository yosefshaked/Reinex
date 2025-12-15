/**
 * Shared utility for extracting questions from versioned session form config
 * This contains the core version lookup logic without normalization
 * Can be used by both frontend and backend
 */

/**
 * Extract raw questions array for a specific form version
 * Returns the raw questions array without normalization
 * 
 * @param {*} formConfig - The session form configuration (from Settings)
 * @param {number|null} version - The form version to retrieve (null/undefined = use current)
 * @returns {Array} Raw array of question objects from the database
 */
export function extractQuestionsForVersion(formConfig, version) {
  if (!formConfig) {
    return [];
  }

  // Parse if string
  let config = formConfig;
  if (typeof formConfig === 'string') {
    try {
      config = JSON.parse(formConfig);
    } catch {
      return [];
    }
  }

  // Legacy format: array of questions (no versioning)
  if (Array.isArray(config)) {
    return config;
  }

  // New format: object with current and optional history
  if (config && typeof config === 'object') {
    // If no version specified or version is null/undefined, use current
    if (version === null || version === undefined) {
      // Handle nested structure: config.current.questions
      if (config.current && typeof config.current === 'object' && Array.isArray(config.current.questions)) {
        return config.current.questions;
      }
      // Handle legacy: config.current as array
      if (Array.isArray(config.current)) {
        return config.current;
      }
      // Handle flat legacy: config.questions
      if (Array.isArray(config.questions)) {
        return config.questions;
      }
      return [];
    }

    // Check if requested version matches current version
    if (config.current && typeof config.current === 'object') {
      const currentVersion = config.current.version ?? config.version;
      if (currentVersion === version) {
        // Handle nested structure
        if (Array.isArray(config.current.questions)) {
          return config.current.questions;
        }
        // Handle legacy structure
        if (Array.isArray(config.current)) {
          return config.current;
        }
      }
    }

    // Search in history for the requested version
    if (Array.isArray(config.history)) {
      for (const historyEntry of config.history) {
        if (historyEntry.version === version && Array.isArray(historyEntry.questions)) {
          return historyEntry.questions;
        }
      }
    }

    // Fallback to current if version not found
    if (config.current && typeof config.current === 'object' && Array.isArray(config.current.questions)) {
      return config.current.questions;
    }
    if (Array.isArray(config.current)) {
      return config.current;
    }
    if (Array.isArray(config.questions)) {
      return config.questions;
    }
  }

  return [];
}
