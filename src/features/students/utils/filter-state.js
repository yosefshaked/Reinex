/**
 * Utility for persisting and restoring student list filter state
 * Uses sessionStorage to remember filters when navigating between pages within a session
 */

const STORAGE_PREFIX = 'tuttiud:student-filters';

/**
 * Get storage key for a specific organization and page
 * @param {string} orgId - Organization ID
 * @param {string} page - Page identifier ('admin' or 'instructor')
 * @returns {string} Storage key
 */
function getStorageKey(orgId, page) {
  return `${STORAGE_PREFIX}:${orgId}:${page}`;
}

/**
 * Save filter state to sessionStorage
 * @param {string} orgId - Organization ID
 * @param {string} page - Page identifier ('admin' or 'instructor')
 * @param {Object} filters - Filter state to save
 */
export function saveFilterState(orgId, page, filters) {
  if (!orgId || !page) {
    console.warn('[filter-state] Cannot save filters: missing orgId or page');
    return;
  }

  try {
    const key = getStorageKey(orgId, page);
    const data = JSON.stringify(filters);
    window.sessionStorage.setItem(key, data);
  } catch (error) {
    console.error('[filter-state] Failed to save filter state:', error);
  }
}

/**
 * Load filter state from sessionStorage
 * @param {string} orgId - Organization ID
 * @param {string} page - Page identifier ('admin' or 'instructor')
 * @returns {Object|null} Saved filter state or null if not found
 */
export function loadFilterState(orgId, page) {
  if (!orgId || !page) {
    return null;
  }

  try {
    const key = getStorageKey(orgId, page);
    const data = window.sessionStorage.getItem(key);
    
    if (!data) {
      return null;
    }

    return JSON.parse(data);
  } catch (error) {
    console.error('[filter-state] Failed to load filter state:', error);
    return null;
  }
}

/**
 * Clear filter state from sessionStorage
 * @param {string} orgId - Organization ID
 * @param {string} page - Page identifier ('admin' or 'instructor')
 */
export function clearFilterState(orgId, page) {
  if (!orgId || !page) {
    return;
  }

  try {
    const key = getStorageKey(orgId, page);
    window.sessionStorage.removeItem(key);
  } catch (error) {
    console.error('[filter-state] Failed to clear filter state:', error);
  }
}
