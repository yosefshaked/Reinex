import {
  LayoutDashboard,
  HeartPulse,
  Database,
  Rocket,
  KeyRound,
  Building2,
  Users,
  UserPlus,
  Receipt,
  FileSearch,
  AlertTriangle,
  UserCheck,
  Mail,
  Activity,
  Gauge,
  BookOpen,
  Megaphone,
  BarChart3,
  Flag,
  ShieldCheck,
  Settings,
  ShieldEllipsis,
  Sparkles,
} from 'lucide-react';

/**
 * System-admin navigation — grouped IA shared by the sidebar and router.
 *
 * Each item carries:
 *   to: absolute route
 *   label: display label
 *   icon: lucide icon component
 *   status: 'live' | 'coming-soon' — drives badge rendering
 *   description: one-liner for Dashboard tiles and tooltips
 */
export const ADMIN_NAV = [
  {
    group: 'Overview',
    items: [
      {
        to: '/system-admin/dashboard',
        label: 'Dashboard',
        icon: LayoutDashboard,
        status: 'live',
        description: 'High-level health, activity, and alerts across the platform.',
      },
    ],
  },
  {
    group: 'Platform',
    items: [
      {
        to: '/system-admin/system-health',
        label: 'System Health',
        icon: HeartPulse,
        status: 'live',
        description: 'Live probes, error rates, and infrastructure status.',
      },
      {
        to: '/system-admin/supabase-connection',
        label: 'Supabase Connection',
        icon: Database,
        status: 'live',
        description: 'Validate the database connection and configuration.',
      },
      {
        to: '/system-admin/release-migrations',
        label: 'Release & Migrations',
        icon: Rocket,
        status: 'coming-soon',
        description: 'Track deploys, schema migrations, and rollback plans.',
      },
      {
        to: '/system-admin/encryption-keys',
        label: 'Encryption & Keys',
        icon: KeyRound,
        status: 'coming-soon',
        description: 'Manage API keys, signing keys, and secret rotation.',
      },
    ],
  },
  {
    group: 'Customers',
    items: [
      {
        to: '/system-admin/organizations',
        label: 'Organizations',
        icon: Building2,
        status: 'live',
        description: 'Browse, inspect, and take action on customer organizations.',
      },
      {
        to: '/system-admin/users',
        label: 'Users',
        icon: Users,
        status: 'live',
        description: 'Search, inspect, and impersonate any user.',
      },
      {
        to: '/system-admin/onboarding-pipeline',
        label: 'Onboarding Pipeline',
        icon: UserPlus,
        status: 'coming-soon',
        description: 'Track every new org from sign-up to activation.',
      },
      {
        to: '/system-admin/billing',
        label: 'Billing',
        icon: Receipt,
        status: 'coming-soon',
        description: 'Internal billing ledger, plan assignments, and invoices.',
      },
    ],
  },
  {
    group: 'Operations',
    items: [
      {
        to: '/system-admin/audit-log',
        label: 'Audit Log',
        icon: FileSearch,
        status: 'live',
        description: 'Every administrative action, filterable and exportable.',
      },
      {
        to: '/system-admin/incidents',
        label: 'Incidents',
        icon: AlertTriangle,
        status: 'live',
        description: 'Track, triage, and post-mortem production incidents.',
      },
      {
        to: '/system-admin/impersonation-queue',
        label: 'Impersonation Queue',
        icon: UserCheck,
        status: 'live',
        description: 'Approvals, active sessions, and history of impersonations.',
      },
      {
        to: '/system-admin/email-log',
        label: 'Email Log',
        icon: Mail,
        status: 'coming-soon',
        description: 'Outbound email delivery, bounces, and resend controls.',
      },
      {
        to: '/system-admin/integration-health',
        label: 'Integration Health',
        icon: Activity,
        status: 'coming-soon',
        description: 'Status of third-party integrations and webhooks.',
      },
      {
        to: '/system-admin/data-quality',
        label: 'Data Quality',
        icon: Gauge,
        status: 'coming-soon',
        description: 'Data quality checks, orphan detection, and cleanup.',
      },
    ],
  },
  {
    group: 'Content',
    items: [
      {
        to: '/system-admin/knowledge-base',
        label: 'Knowledge Base',
        icon: BookOpen,
        status: 'live',
        description: 'Internal runbooks and admin-only articles.',
      },
      {
        to: '/system-admin/announcements',
        label: 'Announcements',
        icon: Megaphone,
        status: 'live',
        description: 'System-wide announcements and maintenance notices.',
      },
    ],
  },
  {
    group: 'Insights',
    items: [
      {
        to: '/system-admin/product-analytics',
        label: 'Product Analytics',
        icon: BarChart3,
        status: 'live',
        description: 'Product usage via PostHog embeds.',
      },
      {
        to: '/system-admin/feature-flags',
        label: 'Feature Flags',
        icon: Flag,
        status: 'live',
        description: 'Rollout controls powered by PostHog feature flags.',
      },
      {
        to: '/system-admin/compliance',
        label: 'Compliance Requests',
        icon: ShieldCheck,
        status: 'live',
        description: 'Data access, deletion, and DSAR requests via PostHog surveys.',
      },
    ],
  },
  {
    group: 'Settings',
    items: [
      {
        to: '/system-admin/global-settings',
        label: 'Global Settings',
        icon: Settings,
        status: 'live',
        description: 'System-wide configuration values.',
      },
      {
        to: '/system-admin/mfa',
        label: 'MFA Management',
        icon: ShieldEllipsis,
        status: 'live',
        description: 'Enroll and manage your admin MFA factors.',
      },
    ],
  },
  {
    group: 'Backlog',
    items: [
      {
        to: '/system-admin/future-ideas',
        label: 'Future Ideas',
        icon: Sparkles,
        status: 'live',
        description: 'Parked features and suggestions (e.g. Background Jobs Monitor).',
      },
    ],
  },
];

export function flattenNav() {
  const out = [];
  for (const group of ADMIN_NAV) {
    for (const item of group.items) {
      out.push({ ...item, group: group.group });
    }
  }
  return out;
}
