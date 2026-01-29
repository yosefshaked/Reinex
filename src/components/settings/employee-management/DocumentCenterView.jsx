import React, { useCallback, useEffect, useState, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar.jsx';
import { Badge } from '@/components/ui/badge';
import { Loader2, Search, ChevronLeft, AlertCircle, CheckCircle2 } from 'lucide-react';
import { authenticatedFetch } from '@/lib/api-client';
import { fetchSettingsValue } from '@/features/settings/api/settings.js';
import InstructorDocumentsSection from '../InstructorDocumentsSection.jsx';
import { useInstructors } from '@/hooks/useOrgData.js';

const REQUEST = { idle: 'idle', loading: 'loading', error: 'error' };

export default function DocumentCenterView({ session, orgId, canLoad }) {
  const { instructors, loadingInstructors, instructorsError, refetchInstructors } = useInstructors({
    includeInactive: true,
    orgId,
    session,
    enabled: canLoad,
  });
  const [definitions, setDefinitions] = useState([]);
  const [allDocuments, setAllDocuments] = useState([]);
  const [loadState, setLoadState] = useState(REQUEST.idle);
  const [loadError, setLoadError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedInstructor, setSelectedInstructor] = useState(null);
  
  // Use a ref to track selected instructor ID for refresh without causing dependency loops
  const selectedInstructorIdRef = useRef(null);

  const loadDefinitionsAndDocs = useCallback(async () => {
    if (!canLoad || loadingInstructors) {
      return;
    }

    setLoadState(REQUEST.loading);
    setLoadError('');

    try {
      const settingsData = await fetchSettingsValue({ session, orgId, key: 'instructor_document_definitions' });
      setDefinitions(Array.isArray(settingsData?.value) ? settingsData.value : []);

      const docRequests = instructors.map((instructor) => {
        const docsParams = new URLSearchParams({
          org_id: orgId,
          entity_type: 'instructor',
          entity_id: instructor.id,
        });
        return authenticatedFetch(`documents?${docsParams.toString()}`, { session })
          .catch((err) => {
            console.error('Failed to load instructor documents', err);
            return { documents: [] };
          });
      });

      const docsPayloads = await Promise.all(docRequests);
      const allDocs = docsPayloads.flatMap((payload) => Array.isArray(payload?.documents) ? payload.documents : []);
      setAllDocuments(allDocs);

      if (selectedInstructorIdRef.current) {
        const updated = instructors.find(i => i.id === selectedInstructorIdRef.current);
        if (updated) {
          setSelectedInstructor(updated);
        }
      }

      setLoadState(REQUEST.idle);
    } catch (error) {
      console.error('Failed to load data', error);
      setLoadError(error?.message || 'טעינת הנתונים נכשלה.');
      setLoadState(REQUEST.error);
      setDefinitions([]);
      setAllDocuments([]);
    }
  }, [canLoad, loadingInstructors, instructors, orgId, session]);

  useEffect(() => {
    if (!canLoad) {
      setDefinitions([]);
      setAllDocuments([]);
      setSelectedInstructor(null);
      selectedInstructorIdRef.current = null;
      setLoadState(REQUEST.idle);
      setLoadError('');
      return;
    }

    if (!loadingInstructors) {
      void loadDefinitionsAndDocs();
    }
  }, [canLoad, loadingInstructors, loadDefinitionsAndDocs]);

  const handleSelectInstructor = (instructor) => {
    selectedInstructorIdRef.current = instructor?.id || null;
    setSelectedInstructor(instructor);
  };

  const handleBack = () => {
    selectedInstructorIdRef.current = null;
    setSelectedInstructor(null);
  };

  const isLoading = loadState === REQUEST.loading || loadingInstructors;
  const combinedError = loadError || instructorsError;

  const filteredInstructors = instructors.filter((instructor) => {
    const query = searchQuery.toLowerCase();
    const name = (instructor.name || '').toLowerCase();
    const email = (instructor.email || '').toLowerCase();
    return name.includes(query) || email.includes(query);
  });

  const getInitials = (name) => {
    if (!name) return '?';
    const parts = name.split(' ').filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  // Calculate document status for each instructor
  const getDocumentStatus = (instructor) => {
    const instructorTypes = Array.isArray(instructor?.instructor_types) ? instructor.instructor_types : [];
    
    // Get documents for this instructor from allDocuments state
    const instructorFiles = allDocuments.filter(doc => doc.entity_id === instructor.id);
    
    // Filter definitions relevant to this instructor
    const relevantDefinitions = definitions.filter(def => {
      if (!def.target_instructor_types || def.target_instructor_types.length === 0) return true;
      if (instructorTypes.length === 0) return false;
      return def.target_instructor_types.some(targetType => instructorTypes.includes(targetType));
    });

    const mandatoryDefs = relevantDefinitions.filter(d => d.is_mandatory);
    const uploadedDefIds = new Set(
      instructorFiles.filter(f => f.definition_id).map(f => f.definition_id)
    );

    const missingMandatory = mandatoryDefs.filter(d => !uploadedDefIds.has(d.id));

    return {
      totalRequired: mandatoryDefs.length,
      completed: mandatoryDefs.length - missingMandatory.length,
      hasMissing: missingMandatory.length > 0,
    };
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="mr-3 text-sm text-slate-600">טוען נתונים...</span>
      </div>
    );
  }

  if (combinedError) {
    return (
      <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">
        {combinedError}
      </div>
    );
  }

  // Detail View
  if (selectedInstructor) {
    return (
      <div className="space-y-6" dir="rtl">
        <div className="flex items-center gap-3 mb-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleBack}
            className="gap-2 h-10"
          >
            <ChevronLeft className="h-4 w-4" />
            חזרה לרשימה
          </Button>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4 p-3 sm:p-4 border rounded-lg bg-slate-50">
          <Avatar className="h-16 w-16 shrink-0">
            <AvatarFallback className="bg-purple-100 text-purple-700 text-xl">
              {getInitials(selectedInstructor.name || selectedInstructor.email)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-base sm:text-lg break-words">
              {selectedInstructor.name || selectedInstructor.email}
            </div>
            <div className="text-sm text-muted-foreground break-words">
              {selectedInstructor.email}
            </div>
          </div>
        </div>

        <InstructorDocumentsSection
          instructor={selectedInstructor}
          session={session}
          orgId={orgId}
          onRefresh={async () => {
            await refetchInstructors();
            await loadDefinitionsAndDocs();
          }}
        />
      </div>
    );
  }

  // List View
  return (
    <div className="space-y-4" dir="rtl">
      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          type="text"
          placeholder="חיפוש לפי שם או אימייל..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pr-10"
          dir="rtl"
        />
      </div>

      {filteredInstructors.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-8">
          {searchQuery ? 'לא נמצאו תוצאות' : 'אין עובדים להצגה'}
        </p>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {filteredInstructors.map((instructor) => {
            const status = getDocumentStatus(instructor);
            return (
              <div
                key={instructor.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 p-3 sm:p-4 border rounded-lg bg-white hover:bg-slate-50 transition-colors cursor-pointer"
                onClick={() => handleSelectInstructor(instructor)}
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <Avatar className="h-10 w-10 shrink-0">
                    <AvatarFallback className="bg-purple-100 text-purple-700">
                      {getInitials(instructor.name || instructor.email)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">
                      {instructor.name || instructor.email || instructor.id}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {instructor.email || '—'}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-2">
                  {status.totalRequired > 0 && (
                    <div className="flex items-center gap-1.5">
                      {status.hasMissing ? (
                        <>
                          <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
                          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-300">
                            {status.completed}/{status.totalRequired}
                          </Badge>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-300">
                            הושלם
                          </Badge>
                        </>
                      )}
                    </div>
                  )}
                  <ChevronLeft className="h-5 w-5 text-muted-foreground shrink-0" />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
