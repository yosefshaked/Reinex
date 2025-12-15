/**
 * Unified documents duplicate check API client
 * 
 * Supports checking for duplicate files before upload across all entity types:
 * - Student documents
 * - Instructor documents
 * - Organization documents
 */

/**
 * Check for duplicate files before upload
 * 
 * @param {Object} params
 * @param {string} params.entityType - 'student' | 'instructor' | 'organization'
 * @param {string} params.entityId - Student/instructor UUID or org_id
 * @param {File} params.file - File to check (from input element)
 * @param {string} params.orgId - Organization ID (required for student/instructor, ignored for org)
 * @param {string} params.sessionToken - Bearer token for authentication
 * @param {AbortSignal} [params.signal] - Optional AbortSignal for cancellation
 * @returns {Promise<Object>} { hash, has_duplicates, duplicates }
 */
export async function checkDocumentDuplicate({
  entityType,
  entityId,
  file,
  orgId,
  sessionToken,
  signal,
}) {
  if (!entityType || !entityId || !file || !orgId || !sessionToken) {
    throw new Error('Missing required parameters for duplicate check');
  }

  const formData = new FormData();
  formData.append('file', file);
  
  // org_id is needed for all types (except organization where entityId IS orgId)
  if (entityType !== 'organization') {
    formData.append('org_id', orgId);
  }

  try {
    const response = await fetch(
      `/api/documents-check?entity_type=${entityType}&entity_id=${entityId}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${sessionToken}`,
          'X-Supabase-Authorization': `Bearer ${sessionToken}`,
          'x-supabase-authorization': `Bearer ${sessionToken}`,
          'x-supabase-auth': `Bearer ${sessionToken}`,
        },
        body: formData,
        signal,
      }
    );

    const data = await response.json();

    if (!response.ok) {
      const errorMessage = data?.message || data?.error || `HTTP ${response.status}`;
      throw new Error(errorMessage);
    }

    return data;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw error; // Let caller handle abort
    }
    throw new Error(`Failed to check duplicates: ${error.message}`);
  }
}
