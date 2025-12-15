/**
 * useDocuments Hook - Unified document management for students, instructors, organizations
 * Fetches documents from Documents table via /api/documents endpoint
 * Replaces prop-based file arrays from Students.files, Instructors.files
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/auth/AuthContext.jsx';
import { useOrg } from '@/org/OrgContext.jsx';

export function useDocuments(entityType, entityId) {
  const { session } = useAuth();
  const { activeOrgId } = useOrg();
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  /**
   * Fetch documents for the entity
   */
  const fetchDocuments = useCallback(async () => {
    if (!session?.access_token || !activeOrgId || !entityId) {
      console.warn('[WARN-FRONTEND] useDocuments: Missing required context', {
        hasToken: !!session?.access_token,
        hasOrgId: !!activeOrgId,
        hasEntityId: !!entityId
      });
      setDocuments([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const url = `/api/documents?entity_type=${entityType}&entity_id=${entityId}&org_id=${activeOrgId}`;

      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'X-Supabase-Authorization': `Bearer ${session.access_token}`,
          'x-supabase-authorization': `Bearer ${session.access_token}`,
          'x-supabase-auth': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        console.error('[ERROR-FRONTEND] Response not OK, reading error...');
        let errorData;
        try {
          const text = await response.text();
          errorData = text ? JSON.parse(text) : {};
        } catch (parseError) {
          console.error('[ERROR-FRONTEND] Failed to parse error response:', parseError);
          errorData = {};
        }
        throw new Error(errorData.error || errorData.message || `HTTP ${response.status}`);
      }

      // Read response text first to debug empty body issue
      const responseText = await response.text();

      if (!responseText || responseText.length === 0) {
        console.warn('[WARN-FRONTEND] Response body is empty despite 200 status');
        setDocuments([]);
        return;
      }

      const data = JSON.parse(responseText);

      setDocuments(data.documents || []);
    } catch (err) {
      console.error('[ERROR-FRONTEND] Documents fetch error:', {
        message: err.message,
        stack: err.stack
      });
      setError(err.message);
      setDocuments([]);
    } finally {
      setLoading(false);
    }
  }, [session?.access_token, activeOrgId, entityType, entityId]);

  /**
   * Upload a new document
   */
  const uploadDocument = useCallback(async (file, metadata = {}) => {
    if (!session?.access_token || !activeOrgId || !entityId) {
      throw new Error('Missing authentication or context');
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('entity_type', entityType);
    formData.append('entity_id', entityId);
    formData.append('org_id', activeOrgId);

    if (metadata.custom_name) {
      formData.append('custom_name', metadata.custom_name);
    }
    if (metadata.relevant_date) {
      formData.append('relevant_date', metadata.relevant_date);
    }
    if (metadata.expiration_date) {
      formData.append('expiration_date', metadata.expiration_date);
    }
    if (metadata.definition_id) {
      formData.append('definition_id', metadata.definition_id);
    }

    const response = await fetch('/api/documents', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'X-Supabase-Authorization': `Bearer ${session.access_token}`,
        'x-supabase-authorization': `Bearer ${session.access_token}`,
        'x-supabase-auth': `Bearer ${session.access_token}`
      },
      body: formData
    });

    if (!response.ok) {
      let errorData;
      try {
        const text = await response.text();
        errorData = text ? JSON.parse(text) : {};
      } catch {
        errorData = {};
      }
      throw new Error(errorData.error || errorData.message || `HTTP ${response.status}`);
    }

    const data = await response.json();
    
    // Refresh documents list
    await fetchDocuments();
    
    return data.file;
  }, [session?.access_token, activeOrgId, entityType, entityId, fetchDocuments]);

  /**
   * Update document metadata
   */
  const updateDocument = useCallback(async (documentId, updates) => {
    if (!session?.access_token || !activeOrgId) {
      throw new Error('Missing authentication or context');
    }

    const response = await fetch(`/api/documents/${documentId}?org_id=${activeOrgId}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'X-Supabase-Authorization': `Bearer ${session.access_token}`,
        'x-supabase-authorization': `Bearer ${session.access_token}`,
        'x-supabase-auth': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(updates)
    });

    if (!response.ok) {
      let errorData;
      try {
        const text = await response.text();
        errorData = text ? JSON.parse(text) : {};
      } catch {
        errorData = {};
      }
      throw new Error(errorData.error || errorData.message || `HTTP ${response.status}`);
    }

    // Refresh documents list
    await fetchDocuments();
  }, [session?.access_token, activeOrgId, fetchDocuments]);

  /**
   * Delete a document
   */
  const deleteDocument = useCallback(async (documentId) => {
    if (!session?.access_token || !activeOrgId) {
      throw new Error('Missing authentication or context');
    }

    const response = await fetch(`/api/documents/${documentId}?org_id=${activeOrgId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'X-Supabase-Authorization': `Bearer ${session.access_token}`,
        'x-supabase-authorization': `Bearer ${session.access_token}`,
        'x-supabase-auth': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      let errorData;
      try {
        const text = await response.text();
        errorData = text ? JSON.parse(text) : {};
      } catch {
        errorData = {};
      }
      throw new Error(errorData.error || errorData.message || `HTTP ${response.status}`);
    }

    // Refresh documents list
    await fetchDocuments();
  }, [session?.access_token, activeOrgId, fetchDocuments]);

  /**
   * Get download URL for a document
   * @param {string} documentId - Document ID
   * @param {boolean} preview - If true, returns URL with inline disposition (preview). If false, attachment (download).
   * @returns {string} Download URL
   */
  const getDownloadUrl = useCallback(async (documentId, preview = false) => {
    if (!session?.access_token || !activeOrgId) {
      const error = 'Missing authentication or context';
      throw new Error(error);
    }

    const previewParam = preview ? '&preview=true' : '';
    const url = `/api/documents-download?document_id=${documentId}&org_id=${activeOrgId}${previewParam}`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'X-Supabase-Authorization': `Bearer ${session.access_token}`,
        'x-supabase-authorization': `Bearer ${session.access_token}`,
        'x-supabase-auth': `Bearer ${session.access_token}`
      }
    });

    if (!response.ok) {
      let errorData;
      try {
        const text = await response.text();
        errorData = text ? JSON.parse(text) : {};
      } catch {
        errorData = {};
      }
      const errorMsg = errorData.error || errorData.message || `HTTP ${response.status}`;
      throw new Error(errorMsg);
    }

    const data = await response.json();
    
    return data.url; // Return just the URL string
  }, [session?.access_token, activeOrgId]);

  // Auto-fetch on mount and when dependencies change
  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  return {
    documents,
    loading,
    error,
    fetchDocuments,
    uploadDocument,
    updateDocument,
    deleteDocument,
    getDownloadUrl
  };
}
