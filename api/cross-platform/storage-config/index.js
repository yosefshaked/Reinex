/* eslint-env node */
/**
 * Storage Configuration Module
 * 
 * Cross-system storage profile management.
 * System-agnostic - reusable by TutTiud, Farm Management System, and future systems.
 */

export {
  validateByosCredentials,
  validateManagedConfig,
  validateStorageProfile,
  normalizeStorageProfile,
  BYOS_PROVIDERS,
} from './validation.js';

/**
 * Storage mode constants
 */
export const STORAGE_MODES = {
  BYOS: 'byos',
  MANAGED: 'managed',
};
