import React from 'react';
import StudentBillingWorkspace from '@/features/students/components/StudentBillingWorkspace.jsx';

export default function StudentFinancialTab({ studentId, student = null }) {
  return (
    <StudentBillingWorkspace
      studentId={studentId}
      student={student}
    />
  );
}
