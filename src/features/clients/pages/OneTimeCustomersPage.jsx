import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import PageLayout from '@/components/ui/PageLayout.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Badge } from '@/components/ui/badge.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Loader2, Search, UserRound, Phone, Mail } from 'lucide-react';
import { useOrg } from '@/org/OrgContext.jsx';
import { useSupabase } from '@/context/SupabaseContext.jsx';
import { useClientProfiles } from '@/hooks/useOrgData.js';
import { authenticatedFetch } from '@/lib/api-client.js';
import { normalizeMembershipRole, isAdminOrOffice } from '@/features/students/utils/endpoints.js';
import CreateClientProfileDialog from '@/features/clients/components/CreateClientProfileDialog.jsx';
import ClientBillingWorkspace from '@/features/clients/components/ClientBillingWorkspace.jsx';
import DetailTabsShell from '@/components/ui/DetailTabsShell.jsx';
import OneTimeCustomerHeader from '@/features/clients/components/OneTimeCustomerHeader.jsx';
import OneTimeCustomerOverviewTab from '@/features/clients/components/OneTimeCustomerOverviewTab.jsx';
import SubjectFormsTab from '@/features/students/components/SubjectFormsTab.jsx';

function renderDisplayName(profile) {
  return profile?.full_name || [profile?.first_name, profile?.middle_name, profile?.last_name].filter(Boolean).join(' ').trim() || 'ללא שם';
}

export default function OneTimeCustomersPage() {
  const { clientProfileId, tab: tabParam } = useParams();
  const navigate = useNavigate();
  const { activeOrg, activeOrgId } = useOrg();
  const { session } = useSupabase();
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [detailState, setDetailState] = useState('idle');
  const [detailProfile, setDetailProfile] = useState(null);
  const [detailError, setDetailError] = useState('');

  const membershipRole = normalizeMembershipRole(activeOrg?.membership?.role || '');
  const canManage = isAdminOrOffice(membershipRole);
  const canFetch = Boolean(session && activeOrgId && canManage);
  const activeTab = tabParam || 'overview';

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

  const loadDetailProfile = useCallback(async () => {
    if (!clientProfileId || !canFetch) return;
    setDetailState('loading');
    setDetailError('');
    try {
      const profile = await authenticatedFetch(`client-profiles/${clientProfileId}`, {
        session,
        params: { org_id: activeOrgId },
      });
      setDetailProfile(profile || null);
      setDetailState('idle');
    } catch (error) {
      console.error('Failed to load one-time customer profile', error);
      setDetailProfile(null);
      setDetailState('error');
      setDetailError(error?.message || 'טעינת כרטיס הלקוח/ה נכשלה.');
    }
  }, [activeOrgId, canFetch, clientProfileId, session]);

  useEffect(() => {
    if (clientProfileId && canFetch) {
      void loadDetailProfile();
    } else {
      setDetailProfile(null);
      setDetailState('idle');
      setDetailError('');
    }
  }, [canFetch, clientProfileId, loadDetailProfile]);

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
    const tabs = [
      {
        key: 'overview',
        label: 'סקירה',
        content: <OneTimeCustomerOverviewTab clientProfile={detailProfile} />,
      },
      {
        key: 'financial',
        label: 'כספים',
        content: <ClientBillingWorkspace clientProfile={detailProfile} />,
      },
      {
        key: 'forms',
        label: 'טפסים',
        content: (
          <SubjectFormsTab
            clientProfileId={detailProfile?.id || clientProfileId}
            clientProfile={detailProfile}
            canEdit={canManage}
          />
        ),
      },
    ];

    return (
      <PageLayout
        title="כרטיס לקוח/ה חד-פעמי/ת"
        subtitle="פרופיל לקוח/ה שאינו/ה תלמיד/ה פעיל/ה, עם גישה לטפסים, לשיעורים חד-פעמיים ולמעקב כספי."
      >
        <div className="space-y-6">
          {detailState === 'loading' ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <div className="flex items-center justify-center gap-2">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span>טוענים את כרטיס הלקוח/ה...</span>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {detailState !== 'loading' && (detailError || clientProfilesError) ? (
            <Card className="border-destructive/30">
              <CardContent className="py-12 text-center text-destructive">
                {detailError || clientProfilesError}
              </CardContent>
            </Card>
          ) : null}

          {detailState !== 'loading' && !detailError && !detailProfile ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                כרטיס הלקוח/ה לא נמצא.
              </CardContent>
            </Card>
          ) : null}

          {detailState !== 'loading' && !detailError && detailProfile ? (
            <DetailTabsShell
              header={<OneTimeCustomerHeader clientProfile={detailProfile} canManage={canManage} />}
              activeTab={activeTab}
              onTabChange={(nextTab) => navigate(`/one-time-customers/${clientProfileId}/${nextTab}`)}
              tabs={tabs}
            />
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
                    <Link to={`/one-time-customers/${profile.id}/overview`}>פתח כרטיס</Link>
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
              navigate(`/one-time-customers/${profile.id}/overview`);
            }
          }}
        />
      </div>
    </PageLayout>
  );
}
