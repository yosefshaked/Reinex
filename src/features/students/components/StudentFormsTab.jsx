import React from 'react';
import SubjectFormsTab from '@/features/students/components/SubjectFormsTab.jsx';

export default function StudentFormsTab({ studentId, student, canEdit = false }) {
  return (
    <SubjectFormsTab
      studentId={studentId}
      student={student}
      canEdit={canEdit}
    />
  );
}
