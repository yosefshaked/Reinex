import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';
import InstructorMenu from './InstructorMenu.jsx';
import DirectoryView from './DirectoryView.jsx';
import ProfileEditorView from './ProfileEditorView.jsx';
import DocumentCenterView from './DocumentCenterView.jsx';

const VIEW_TITLES = {
  menu: 'ניהול עובדים',
  directory: 'ניהול מצבת כוח אדם',
  profiles: 'עריכת פרטים אישיים',
  documents: 'מרכז מסמכים',
};

export default function InstructorManagementHub({ session, orgId, activeOrgHasConnection, tenantClientReady }) {
  const [currentView, setCurrentView] = useState('menu');

  const canLoad = Boolean(session && orgId && activeOrgHasConnection && tenantClientReady);

  if (!activeOrgHasConnection || !tenantClientReady) {
    return (
      <Card className="w-full border-0 shadow-lg bg-white/80">
        <CardHeader>
          <CardTitle>ניהול עובדים</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-600">נדרש חיבור Supabase פעיל כדי לנהל עובדים.</p>
        </CardContent>
      </Card>
    );
  }

  const handleNavigate = (view) => {
    setCurrentView(view);
  };

  const handleBack = () => {
    setCurrentView('menu');
  };

  return (
    <Card className="w-full border-0 shadow-lg bg-white/80">
      <CardHeader>
        <div className="flex items-center justify-between gap-2" dir="rtl">
          <CardTitle className="text-base sm:text-lg truncate">{VIEW_TITLES[currentView]}</CardTitle>
          {currentView !== 'menu' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleBack}
              className="gap-2 h-10"
            >
              <span className="hidden sm:inline">חזרה לתפריט</span>
              <span className="sm:hidden">חזרה</span>
              <ArrowRight className="h-4 w-4 rotate-180" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent dir="rtl">
        {currentView === 'menu' && (
          <InstructorMenu onNavigate={handleNavigate} />
        )}
        {currentView === 'directory' && (
          <DirectoryView
            session={session}
            orgId={orgId}
            canLoad={canLoad}
          />
        )}
        {currentView === 'profiles' && (
          <ProfileEditorView
            session={session}
            orgId={orgId}
            canLoad={canLoad}
          />
        )}
        {currentView === 'documents' && (
          <DocumentCenterView
            session={session}
            orgId={orgId}
            canLoad={canLoad}
          />
        )}
      </CardContent>
    </Card>
  );
}
