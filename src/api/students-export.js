import { getAuthClient } from '@/lib/supabase-manager.js';

/**
 * Export student session records to PDF
 * @param {string} studentId - Student UUID
 * @param {string} orgId - Organization UUID
 * @returns {Promise<Blob>} PDF blob
 */
export async function exportStudentPdf(studentId, orgId) {
  if (!studentId) {
    throw new Error('Student ID is required');
  }
  if (!orgId) {
    throw new Error('Organization ID is required');
  }

  // Get auth token
  const authClient = getAuthClient();
  const { data, error } = await authClient.auth.getSession();

  if (error || !data?.session?.access_token) {
    throw new Error('Authentication token not found.');
  }

  const token = data.session.access_token;

  const response = await fetch('/api/students-export', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'authorization': `Bearer ${token}`,
      'X-Supabase-Authorization': `Bearer ${token}`,
      'x-supabase-authorization': `Bearer ${token}`,
      'x-supabase-auth': `Bearer ${token}`,
    },
    body: JSON.stringify({
      student_id: studentId,
      org_id: orgId,
    }),
  });

  if (!response.ok) {
    let errorMessage = 'Failed to export PDF';
    try {
      const errorData = await response.json();
      errorMessage = errorData?.message || errorData?.description || errorMessage;
    } catch {
      // If response is not JSON, use default message
    }
    throw new Error(errorMessage);
  }

  return await response.blob();
}

/**
 * Download PDF blob as file
 * @param {Blob} blob - PDF blob
 * @param {string} filename - Desired filename
 */
export function downloadPdfBlob(blob, filename) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}
