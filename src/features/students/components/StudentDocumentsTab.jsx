import React from 'react';
import StudentDocumentsSection from '@/features/students/components/StudentDocumentsSection.jsx';

/**
 * Documents tab: wraps the existing StudentDocumentsSection with the same props.
 *
 * @param {Object} props
 * @param {Object} props.student
 * @param {Object} props.session
 * @param {string} props.orgId
 * @param {Function} props.onRefresh
 */
export default function StudentDocumentsTab({ student, session, orgId, onRefresh }) {
  return <StudentDocumentsSection student={student} session={session} orgId={orgId} onRefresh={onRefresh} />;
}
