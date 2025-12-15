import { parseSessionFormConfig } from './form-config.js';
import { extractQuestionsForVersion } from './version-lookup.js';

/**
 * Extract questions for a specific form version from session form config
 * Handles both legacy array format and new versioned format with current/history
 * Returns normalized questions (with key, label, etc.) ready for use in UI
 * 
 * @param {*} formConfig - The session form configuration (from Settings)
 * @param {number|null} version - The form version to retrieve (null/undefined = use current)
 * @returns {Array} Array of normalized question objects
 */
export function getQuestionsForVersion(formConfig, version) {
  // Use shared lookup logic to extract raw questions
  const rawQuestions = extractQuestionsForVersion(formConfig, version);
  
  // Normalize the questions for frontend use (adds key field, etc.)
  return parseSessionFormConfig(rawQuestions);
}

/**
 * Extract form version from session metadata
 * 
 * @param {Object} session - Session record object
 * @returns {number|null} The form version number, or null if not found
 */
export function getSessionFormVersion(session) {
  return session?.metadata?.form_version ?? null;
}
