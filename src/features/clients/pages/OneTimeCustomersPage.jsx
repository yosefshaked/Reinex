import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import PageLayout from '@/components/ui/PageLayout.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Badge } from '@/components/ui/badge.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Phone, Mail, Search, UserRound, ArrowLeft, FileText } from 'lucide-react';
import { useOrg } from '@/org/OrgContext.jsx';
import { useSupabase } from '@/context/SupabaseContext.jsx';
import { useClientProfiles } from '@/hooks/useOrgData.js';
import { normalizeMembershipRole, isAdminOrOffice } from '@/features/students/utils/endpoints.js';
import SendFormDialog from '@/features/students/components/SendFormDialog.jsx';
import CreateClientProfileDialog from '@/features/clients/components/CreateClientProfileDialog.jsx';
import ClientBillingWorkspace from '@/features/clients/components/ClientBillingWorkspace.jsx';

function renderDisplayName(profile) {
  return profile?.full_name || [profile?.first_name, profile?.middle_name, profile?.last_name].filter(Boolean).join(' ').trim() || 'ללא שם';
}

export default function OneTimeCustomersPage() {
  const { clientProfileId } = useParams();
  const navigate = useNavigate();
  const { activeOrg, activeOrgId, activeOrgHasConnection, tenantClientReady } = useOrg();
  const { session } = useSupabase();
  const [search, setSearch] = useState('');
  const [sendFormOpen, setSendFormOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const membershipRole = normalizeMembershipRole(activeOrg?.membership?.role || '');
  const canManage = isAdminOrOffice(membershipRole);
  const canFetch = Boolean(session && activeOrgId && activeOrgHasConnection && tenantClientReady && canManage);

  const { clientProfiles, loadingClientProfiles, clientProfilesError, refetchClientProfiles } = useClientProfiles({
    enabled: canFetch,
    orgId: activeOrgId,
    session,
    status: 'non_student',
    search: clientProfileId ? '' : search.trim(),
    extraParams: { segment: 'one_time_customers' },
  });

  const sortedProfiles = useMemo(() => (
    [...clientProfiles].sort((left, right) => renderDisplayName(left).localeCompare(renderDisplayName(right), 'he'))
  ), [clientProfiles]);

  const selectedProfile = useMemo(
    () => (clientProfileId ? sortedProfiles.find((profile) => profile.id === clientProfileId) || null : null),
    [clientProfileId, sortedProfiles],
  );

  if (!canManage) {
    return (
      <PageLayout title="לקוחות חד-פעמיים">
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            אין לך הרשאה לצפות בלקוחות חד-פעמיים.
          </CardContent>
        </Card>
      </PageLayout>
    );
  }

  if (clientProfileId) {
    return (
      <PageLayout
        title="כרטיס לקוח/ה חד-פעמי/ת"
        subtitle="פרופיל לקוח/ה שאינו/ה תלמיד/ה פעיל/ה, עם גישה לטפסים, לשיעורים חד-פעמיים ולמעקב כספי."
        actions={(
          <Button asChild variant="outline" size="sm" className="gap-2">
            <Link to="/one-time-customers">
              <ArrowLeft className="h-4 w-4" />
              חזרה לרשימה
            </Link>
          </Button>
        )}
      >
        <div className="space-y-6">
          {loadingClientProfiles ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                טוענים את כרטיס הלקוח/ה...
              </CardContent>
            </Card>
          ) : null}

          {!loadingClientProfiles && clientProfilesError ? (
            <Card className="border-destructive/30">
              <CardContent className="py-12 text-center text-destructive">
                {clientProfilesError}
              </CardContent>
            </Card>
          ) : null}

          {!loadingClientProfiles && !clientProfilesError && !selectedProfile ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                כרטיס הלקוח/ה לא נמצא.
              </CardContent>
            </Card>
          ) : null}

          {!loadingClientProfiles && !clientProfilesError && selectedProfile ? (
            <>
              <Card className="border-border/70 shadow-sm">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <CardTitle className="text-xl">{renderDisplayName(selectedProfile)}</CardTitle>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Badge variant="secondary">לקוח/ה חד-פעמי/ת</Badge>
                        <Badge variant="outline">ללא כרטיס תלמיד/ה</Badge>
                      </div>
                    </div>
                    <Button type="button" size="sm" className="gap-2" onClick={() => setSendFormOpen(true)}>
                      <FileText className="h-4 w-4" />
                      שלח טופס
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-3 text-sm">
                    <div className="flex items-center gap-2">
                      <UserRound className="h-4 w-4 text-muted-foreground" />
                      <span>{selectedProfile.identity_number || 'ללא תעודת זהות'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Phone className="h-4 w-4 text-muted-foreground" />
                      <span>{selectedProfile.phone || 'ללא טלפון'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Mail className="h-4 w-4 text-muted-foreground" />
                      <span>{selectedProfile.email || 'ללא אימייל'}</span>
                    </div>
                  </div>
                  <div className="space-y-3 text-sm">
                    <div>סטטוס תהליך: <span className="font-medium">{selectedProfile.onboarding_status || 'not_started'}</span></div>
                    {selectedProfile.guardian ? (
                      <div>איש קשר: <span className="font-medium">{renderDisplayName(selectedProfile.guardian)}</span></div>
                    ) : null}
                    {Array.isArray(selectedProfile.tags) && selectedProfile.tags.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {selectedProfile.tags.map((tag) => (
                          <Badge key={`${selectedProfile.id}-${tag}`} variant="outline">{tag}</Badge>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </CardContent>
              </Card>

              <SendFormDialog
                open={sendFormOpen}
                onOpenChange={setSendFormOpen}
                clientProfile={selectedProfile}
                onSent={() => {
                  void refetchClientProfiles();
                }}
              />

              <ClientBillingWorkspace clientProfile={selectedProfile} />
            </>
          ) : null}
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title="לקוחות חד-פעמיים"
      subtitle="לקוחות עם היסטוריה של טפסים או מפגשים חד-פעמיים, בלי להפוך אותם אוטומטית לתלמידים."
      actions={(
        <Button type="button" onClick={() => setCreateOpen(true)}>
          צור לקוח/ה חד-פעמי/ת
        </Button>
      )}
    >
      <div className="space-y-6">
        <Card className="border-border/70 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">חיפוש וגילוי</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative max-w-xl">
              <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="pr-9"
                placeholder="חפשו לפי שם, טלפון, תעודת זהות או אימייל"
              />
            </div>
            <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
              <div>{sortedProfiles.length} פרופילים זמינים בתצוגה זו</div>
              <Button type="button" variant="outline" size="sm" onClick={() => refetchClientProfiles()}>
                רענון
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {loadingClientProfiles ? (
            <Card className="md:col-span-2 xl:col-span-3">
              <CardContent className="py-12 text-center text-muted-foreground">
                טוענים לקוחות חד-פעמיים...
              </CardContent>
            </Card>
          ) : null}

          {!loadingClientProfiles && clientProfilesError ? (
            <Card className="md:col-span-2 xl:col-span-3 border-destructive/30">
              <CardContent className="py-12 text-center text-destructive">
                {clientProfilesError}
              </CardContent>
            </Card>
          ) : null}

          {!loadingClientProfiles && !clientProfilesError && sortedProfiles.length === 0 ? (
            <Card className="md:col-span-2 xl:col-span-3">
              <CardContent className="py-12 text-center text-muted-foreground">
                לא נמצאו לקוחות חד-פעמיים לפי הסינון הנוכחי.
              </CardContent>
            </Card>
          ) : null}

          {!loadingClientProfiles && !clientProfilesError ? sortedProfiles.map((profile) => (
            <Card key={profile.id} className="border-border/70 shadow-sm">
              <CardHeader className="space-y-3 pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">{renderDisplayName(profile)}</CardTitle>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {profile.identity_number || 'ללא תעודת זהות'}
                    </div>
                  </div>
                  <Badge variant="secondary">חד-פעמי/ת</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <UserRound className="h-4 w-4" />
                  <span>{profile.onboarding_status === 'approved' ? 'מוכן/ה להמשך טיפול' : 'ללא כרטיס תלמיד/ה'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <span>{profile.phone || 'ללא טלפון'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <span>{profile.email || 'ללא אימייל'}</span>
                </div>
                {profile.guardian ? (
                  <div className="rounded-xl bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                    איש קשר: {renderDisplayName(profile.guardian)}{profile.guardian.relationship ? ` • ${profile.guardian.relationship}` : ''}
                  </div>
                ) : null}
                <div className="flex items-center justify-between gap-2">
                  <Button asChild variant="outline" size="sm">
                    <Link to={`/one-time-customers/${profile.id}`}>פתח כרטיס</Link>
                  </Button>
                  {Array.isArray(profile.tags) && profile.tags.length > 0 ? (
                    <div className="flex flex-wrap justify-end gap-2">
                      {profile.tags.slice(0, 2).map((tag) => (
                        <Badge key={`${profile.id}-${tag}`} variant="outline">{tag}</Badge>
                      ))}
                    </div>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          )) : null}
        </div>
        <CreateClientProfileDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          session={session}
          orgId={activeOrgId}
          createdFrom="one_time_customers_page"
          onSuccess={(profile) => {
            void refetchClientProfiles();
            if (profile?.id) {
              navigate(`/one-time-customers/${profile.id}`);
            }
          }}
        />
      </div>
    </PageLayout>
  );
}
