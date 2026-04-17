import {
  activateOrg,
  clearOrg,
  waitOrgReady,
  getOrgOrThrow,
  getCurrentOrg,
} from '@/lib/org-runtime.js';

export function activateRuntimeOrg(config) {
  return activateOrg(config);
}

export function clearRuntimeOrg() {
  clearOrg();
}

export function waitRuntimeOrgReady() {
  return waitOrgReady();
}

export function getRuntimeOrgOrThrow() {
  return getOrgOrThrow();
}

export function getRuntimeOrg() {
  return getCurrentOrg();
}
