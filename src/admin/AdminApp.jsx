import React from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { Refine } from '@refinedev/core';
import routerProvider from '@refinedev/react-router';
import dataProvider from '@refinedev/simple-rest';
import { adminAuthProvider } from './authProvider.js';
import MfaPage from './MfaPage.jsx';
import SystemHealthView from './SystemHealthView.jsx';
import SupabaseConnectionView from './SupabaseConnectionView.jsx';
import GlobalSettingsView from './modules/GlobalSettingsView.jsx';
import OperationsSupportView from './modules/OperationsSupportView.jsx';
import ProductAnalyticsView from './modules/ProductAnalyticsView.jsx';
import UsersView from './modules/UsersView.jsx';
import ImpersonationQueueView from './modules/ImpersonationQueueView.jsx';
import OrganizationsView from './modules/OrganizationsView.jsx';
import AuditLogView from './modules/AuditLogView.jsx';
import FeatureFlagsView from './modules/FeatureFlagsView.jsx';
import FutureIdeasView from './modules/FutureIdeasView.jsx';
import AnnouncementsView from './modules/AnnouncementsView.jsx';
import IncidentsView from './modules/IncidentsView.jsx';
import KnowledgeBaseView from './modules/KnowledgeBaseView.jsx';
import ComplianceView from './modules/ComplianceView.jsx';
import IntegrationHealthView from './modules/IntegrationHealthView.jsx';
import DataQualityView from './modules/DataQualityView.jsx';
import AdminToolsView from './modules/AdminToolsView.jsx';
import OnboardingPipelineView from './modules/OnboardingPipelineView.jsx';
import EmailLogView from './modules/EmailLogView.jsx';
import OrgPurgeView from './modules/OrgPurgeView.jsx';
import AdminShell from './ui/AdminShell.jsx';
import DashboardView from './ui/DashboardView.jsx';
import ComingSoon from './ui/ComingSoon.jsx';
import { ADMIN_NAV, flattenNav } from './ui/navConfig.js';

const adminDataProvider = dataProvider('/api/system-admin-health');

function AccessDenied() {
  return (
    <div className="mx-auto mt-6 max-w-xl rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-900">
      <h2 className="text-lg font-semibold">Access denied</h2>
      <p className="mt-2 text-sm leading-6">
        Your account is authenticated but is not marked as a system administrator.
      </p>
    </div>
  );
}

function AdminGate() {
  const location = useLocation();
  const [state, setState] = React.useState({ loading: true, result: null });

  React.useEffect(() => {
    let active = true;

    async function runCheck() {
      try {
        const result = await adminAuthProvider.check({ pathname: location.pathname });
        if (!active) return;
        setState({ loading: false, result });
      } catch {
        if (!active) return;
        setState({
          loading: false,
          result: { authenticated: false, redirectTo: '/login' },
        });
      }
    }

    runCheck();
    return () => {
      active = false;
    };
  }, [location.pathname]);

  if (state.loading) {
    return <p className="p-4 text-sm text-slate-500">Validating admin session...</p>;
  }

  if (state.result?.redirectTo) {
    return <Navigate to={state.result.redirectTo} replace />;
  }

  if (!state.result?.authenticated) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}

// Map of path-segment -> element for live modules.
const LIVE_ELEMENTS = {
  'dashboard': <DashboardView />,
  'system-health': <SystemHealthView />,
  'supabase-connection': <SupabaseConnectionView />,
  'mfa': <MfaPage />,
  'global-settings': <GlobalSettingsView />,
  'product-analytics': <ProductAnalyticsView />,
  'users': <UsersView />,
  'impersonation-queue': <ImpersonationQueueView />,
  'organizations': <OrganizationsView />,
  'audit-log': <AuditLogView />,
  'feature-flags': <FeatureFlagsView />,
  'future-ideas': <FutureIdeasView />,
  'announcements': <AnnouncementsView />,
  'incidents': <IncidentsView />,
  'knowledge-base': <KnowledgeBaseView />,
  'compliance': <ComplianceView />,
  'integration-health': <IntegrationHealthView />,
  'data-quality': <DataQualityView />,
  'admin-tools': <AdminToolsView />,
  'onboarding-pipeline': <OnboardingPipelineView />,
  'email-log': <EmailLogView />,
  'org-purge': <OrgPurgeView />,
  // Legacy aggregate view retained while its sub-modules are built out.
  'operations-support': <OperationsSupportView />,
};

function ComingSoonRoute({ path }) {
  const flat = React.useMemo(() => flattenNav(), []);
  const item = flat.find((i) => i.to === `/system-admin/${path}`);
  if (!item) return <ComingSoon title={path} subtitle="Not yet configured" />;

  // Per-module planned features so the placeholder shows useful design intent.
  const planned = PLANNED[path] || [];
  return (
    <ComingSoon
      title={item.label}
      subtitle={item.group}
      description={item.description}
      plannedFeatures={planned}
    />
  );
}

const PLANNED = {
  'release-migrations': [
    'Deploy history with commit range, deployer, duration, and outcome',
    'Pending schema migrations with dry-run preview',
    'One-click rollback with typed-confirm gate',
    'Release notes pulled from PR descriptions',
  ],
  'encryption-keys': [
    'List of active API / signing / JWT keys with expiry',
    'Rotation scheduling with advance-warning window',
    'Integration credential vault (read-only audit view)',
    'Emergency revocation with broadcast to dependent services',
  ],
  'organizations': [
    'Searchable table: name, plan, seats, activity, health score',
    'Detail drawer: members, billing status, recent audit events, feature flags',
    'Actions: suspend, resume, force-sync, transfer ownership (all reason-gated)',
    'Direct "Open as this org" for impersonation',
  ],
  'users': [
    'Global user search by name, email, phone, org',
    'Detail drawer: sessions, MFA factors, roles, last activity',
    'Real impersonation with MFA re-challenge + persistent banner + audit entry',
    'Force sign-out across all devices; reset MFA',
  ],
  'onboarding-pipeline': [
    'Kanban of new orgs by onboarding stage (signup → setup → activated)',
    'Stuck-stage alerts with owner assignment',
    'Checklist per org: profile, team, data, first successful action',
    'Conversion funnel analytics via PostHog',
  ],
  'billing': [
    'Internal ledger of plan assignments, overrides, credits',
    'Per-org usage vs. plan limits with trend',
    'Invoice history (internal only — no payment provider yet)',
    'Hooks for future Stripe/Paddle integration',
  ],
  'audit-log': [
    'Full-text + filtered search across every admin & user action',
    'Filter by actor, org, action type, severity, outcome, time range',
    'Row drawer: before/after snapshot, related events, replay context',
    'CSV + JSON export with reason-gated download',
  ],
  'incidents': [
    'Active incident board with severity, owner, customer impact',
    'Post-mortem template linked from resolved incidents',
    'Timeline synthesised from audit log + PostHog error events',
    'Status-page publish hook',
  ],
  'impersonation-queue': [
    'Pending requests, active sessions, completed sessions',
    'Approval workflow for high-sensitivity orgs',
    'Time-boxed sessions with auto-expiry',
    'Live-revoke control for any active session',
  ],
  'email-log': [
    'Outbound email stream: recipient, template, status, provider response',
    'Bounce / complaint tracking with suppression list management',
    'Resend + preview in-context',
    'Per-org summary with delivery rate',
  ],
  'integration-health': [
    'Status per 3rd-party integration (auth providers, email, storage, PostHog, etc.)',
    'Webhook delivery success rate with recent failures',
    'Quota usage vs. plan for each integration',
    'Synthetic health checks run on a schedule',
  ],
  'data-quality': [
    'Orphaned record detection (rows that break referential integrity)',
    'Schema drift between environments',
    'Row-count anomaly alerts',
    'One-click cleanup with dry-run preview',
  ],
  'knowledge-base': [
    'Markdown articles scoped to system admins',
    'Runbook templates (incident response, customer escalation, etc.)',
    'Full-text search with tag filtering',
    'Versioned edits with audit trail',
  ],
  'announcements': [
    'Compose system-wide banner messages with start/end schedule',
    'Target by plan, region, or org list',
    'Acknowledgement tracking',
    'In-product + email channel split',
  ],
  'feature-flags': [
    'Embeds PostHog Feature Flags surface (single source of truth)',
    'Per-org override list with reason + expiry',
    'Flag usage analytics (who is evaluating what)',
    'Replaces anything living in permission_registry',
  ],
  'compliance': [
    'Inbox of data access / deletion / export requests (intake via PostHog Survey)',
    'SLA countdown per request type',
    'Automated evidence gathering hooks (audit-log export, data dump)',
    'Closure record with signed evidence bundle',
  ],
  'future-ideas': [
    'Parking lot for deferred features: Background Jobs Monitor, Cost Analytics, Localisation Console, ...',
    'Upvote / comment model so we can surface the most-wanted next',
    'Links to related existing modules to reduce duplication',
    'Promotes items to the roadmap when ready to build',
  ],
};

// Routes the new nav points at that need to render something.
const COMING_SOON_PATHS = [
  'release-migrations',
  'encryption-keys',
  'billing',
];

export default function AdminApp() {
  // Refine resource list — derived from ADMIN_NAV so the two never drift.
  const resources = React.useMemo(() => {
    return ADMIN_NAV.flatMap((group) =>
      group.items.map((item) => ({
        name: item.to.replace('/system-admin/', ''),
        list: item.to,
        meta: { label: item.label, parent: group.group },
      })),
    );
  }, []);

  return (
    <Refine
      authProvider={adminAuthProvider}
      dataProvider={adminDataProvider}
      routerProvider={routerProvider}
      resources={resources}
      options={{
        syncWithLocation: true,
        warnWhenUnsavedChanges: false,
      }}
    >
      <Routes>
        <Route element={<AdminGate />}>
          <Route index element={<Navigate to="/system-admin/dashboard" replace />} />
          <Route element={<AdminShell />}>
            <Route path="dashboard" element={LIVE_ELEMENTS['dashboard']} />
            <Route path="system-health" element={LIVE_ELEMENTS['system-health']} />
            <Route path="supabase-connection" element={LIVE_ELEMENTS['supabase-connection']} />
            <Route path="mfa" element={LIVE_ELEMENTS['mfa']} />
            <Route path="global-settings" element={LIVE_ELEMENTS['global-settings']} />
            <Route path="product-analytics" element={LIVE_ELEMENTS['product-analytics']} />
            <Route path="users" element={LIVE_ELEMENTS['users']} />
            <Route path="impersonation-queue" element={LIVE_ELEMENTS['impersonation-queue']} />
            <Route path="organizations" element={LIVE_ELEMENTS['organizations']} />
            <Route path="audit-log" element={LIVE_ELEMENTS['audit-log']} />
            <Route path="feature-flags" element={LIVE_ELEMENTS['feature-flags']} />
            <Route path="future-ideas" element={LIVE_ELEMENTS['future-ideas']} />
            <Route path="announcements" element={LIVE_ELEMENTS['announcements']} />
            <Route path="incidents" element={LIVE_ELEMENTS['incidents']} />
            <Route path="knowledge-base" element={LIVE_ELEMENTS['knowledge-base']} />
            <Route path="compliance" element={LIVE_ELEMENTS['compliance']} />
            <Route path="integration-health" element={LIVE_ELEMENTS['integration-health']} />
            <Route path="data-quality" element={LIVE_ELEMENTS['data-quality']} />
            <Route path="admin-tools" element={LIVE_ELEMENTS['admin-tools']} />
            <Route path="onboarding-pipeline" element={LIVE_ELEMENTS['onboarding-pipeline']} />
            <Route path="email-log" element={LIVE_ELEMENTS['email-log']} />

            {/* Legacy aggregate view kept reachable while sub-modules are built. */}
            <Route path="operations-support" element={LIVE_ELEMENTS['operations-support']} />

            {/* Coming-soon placeholders — designed, queued for wiring. */}
            {COMING_SOON_PATHS.map((p) => (
              <Route key={p} path={p} element={<ComingSoonRoute path={p} />} />
            ))}

            <Route path="forbidden" element={<AccessDenied />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/system-admin" replace />} />
      </Routes>
    </Refine>
  );
}
