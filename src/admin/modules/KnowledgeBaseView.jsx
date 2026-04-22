import React from 'react';
import { BookOpen, Plus, Trash2, Search, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import ModuleShell from '../ui/ModuleShell.jsx';
import EmptyState from '../ui/EmptyState.jsx';
import StatusBadge from '../ui/StatusBadge.jsx';
import Drawer from '../ui/Drawer.jsx';
import ConfirmActionDialog from '../ui/ConfirmActionDialog.jsx';
import { useAdminModuleView, captureAdminEvent } from '../lib/admin-analytics.js';
import { useAdminStore } from '../lib/useAdminStore.js';

/**
 * Knowledge Base — admin-only markdown articles & runbooks.
 *
 * Persisted in localStorage until a shared knowledge_base schema lands. Keep
 * the tone internal: incident runbooks, customer-escalation scripts, on-call
 * checklists — things you want close at hand but not user-facing.
 */


const SEED = [
  {
    id: 'runbook-supabase-outage',
    title: 'Supabase control-plane outage',
    tags: ['runbook', 'infra'],
    body: `## Symptoms
- Auth failures across orgs
- System Health shows Supabase probe red

## First 5 minutes
1. Check status.supabase.com for incidents
2. Open Audit Log filtered to \`error.*\` events
3. Post Sev 1 incident from Incidents module

## Mitigation
- Flip the \`read_only_mode\` flag in PostHog
- Broadcast the active banner from Announcements
`,
    updated_at: '2026-04-02T10:00:00.000Z',
  },
  {
    id: 'runbook-impersonation-escalation',
    title: 'Customer-requested impersonation',
    tags: ['support', 'security'],
    body: `## Never ask for a password
Use the Users module → Open as user flow. This produces an auditable session with forensic metadata.

## Required context before starting
- Written customer approval (ticket or email)
- Reason string (≥3 chars, stored in audit log)
- Bounded duration (default 30m, max 240m)

## Exiting
Click End impersonation in the banner. The session row flips to \`ended\` and the admin session resumes automatically.
`,
    updated_at: '2026-04-08T10:00:00.000Z',
  },
];


function renderMarkdown(src) {
  // Intentionally minimal — not trying to be a full markdown renderer.
  // Shows headings, lists, inline code. For anything richer, paste into
  // a real markdown editor; this is a triage surface.
  const lines = String(src || '').split(/\r?\n/);
  return lines.map((line, idx) => {
    const key = `l-${idx}`;
    if (/^##\s+/.test(line)) {
      return <h4 key={key} className="mt-3 text-sm font-semibold text-slate-900">{line.replace(/^##\s+/, '')}</h4>;
    }
    if (/^#\s+/.test(line)) {
      return <h3 key={key} className="mt-3 text-base font-semibold text-slate-900">{line.replace(/^#\s+/, '')}</h3>;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      return <li key={key} className="ml-5 list-disc text-sm text-slate-700">{line.replace(/^\s*[-*]\s+/, '')}</li>;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      return <li key={key} className="ml-5 list-decimal text-sm text-slate-700">{line.replace(/^\s*\d+\.\s+/, '')}</li>;
    }
    if (line.trim() === '') {
      return <div key={key} className="h-2" />;
    }
    const withCode = line.split(/(`[^`]+`)/g).map((chunk, i) => {
      if (/^`[^`]+`$/.test(chunk)) {
        return <code key={i} className="rounded bg-slate-100 px-1 font-mono text-[11px]">{chunk.slice(1, -1)}</code>;
      }
      return <React.Fragment key={i}>{chunk}</React.Fragment>;
    });
    return <p key={key} className="text-sm leading-6 text-slate-700">{withCode}</p>;
  });
}

export default function KnowledgeBaseView() {
  useAdminModuleView('knowledge-base');

  const { items: articles, upsert, remove: removeArticle } = useAdminStore('knowledge_base', { seed: SEED });
  const [query, setQuery] = React.useState('');
  const [tagFilter, setTagFilter] = React.useState('');
  const [selected, setSelected] = React.useState(null);
  const [editing, setEditing] = React.useState(null); // null | {id?, title, tags, body}
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  const allTags = React.useMemo(() => {
    const set = new Set();
    articles.forEach((a) => (a.tags || []).forEach((t) => set.add(t)));
    return Array.from(set).sort();
  }, [articles]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return articles.filter((a) => {
      if (tagFilter && !(a.tags || []).includes(tagFilter)) return false;
      if (!q) return true;
      return (
        a.title.toLowerCase().includes(q) ||
        a.body.toLowerCase().includes(q) ||
        (a.tags || []).some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [articles, query, tagFilter]);

  const startNew = () => setEditing({ title: '', tags: '', body: '' });
  const startEdit = (article) => setEditing({
    id: article.id,
    title: article.title,
    tags: (article.tags || []).join(', '),
    body: article.body,
  });

  const saveEdit = () => {
    if (!editing) return;
    const title = editing.title.trim();
    if (!title) return;
    const tags = editing.tags.split(',').map((t) => t.trim()).filter(Boolean);
    if (editing.id) {
      const existing = articles.find((a) => a.id === editing.id);
      upsert({ ...existing, title, tags, body: editing.body, updated_at: new Date().toISOString() });
      captureAdminEvent('kb_article_updated', { id: editing.id });
    } else {
      upsert({ id: `kb-${Date.now().toString(36)}`, title, tags, body: editing.body, updated_at: new Date().toISOString() });
      captureAdminEvent('kb_article_created', { title });
    }
    setEditing(null);
  };

  const deleteSelected = () => {
    if (!selected) return;
    removeArticle(selected.id);
    setDeleteOpen(false);
    setSelected(null);
  };

  return (
    <ModuleShell
      title="Knowledge Base"
      subtitle="Content"
      description="Admin-only runbooks and reference articles. Persisted per browser while a shared schema is pending — treat as scratch until then."
      actions={
        <Button size="sm" onClick={startNew}>
          <Plus className="mr-1.5 h-4 w-4" />
          New article
        </Button>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search titles, body, tags…"
            className="h-9 pl-9"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => setTagFilter('')}
            className={`rounded-full px-2.5 py-1 text-[11px] ${
              !tagFilter ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            All
          </button>
          {allTags.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTagFilter(tagFilter === t ? '' : t)}
              className={`rounded-full px-2.5 py-1 text-[11px] ${
                tagFilter === t ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              #{t}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="h-6 w-6" />}
          title={query || tagFilter ? 'No articles match' : 'No articles yet'}
          description={
            query || tagFilter
              ? 'Try a different search term or clear the tag filter.'
              : 'Write your first runbook to seed the knowledge base.'
          }
          action={!query && !tagFilter ? (
            <Button size="sm" onClick={startNew}>
              <Plus className="mr-1.5 h-4 w-4" />
              New article
            </Button>
          ) : null}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setSelected(a)}
              className="group flex flex-col items-start rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:shadow-md"
            >
              <BookOpen className="h-4 w-4 text-slate-400 group-hover:text-slate-600" />
              <h4 className="mt-2 text-sm font-semibold text-slate-900">{a.title}</h4>
              <p className="mt-1 line-clamp-3 text-xs leading-5 text-slate-600">{a.body}</p>
              {Array.isArray(a.tags) && a.tags.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1">
                  {a.tags.map((t) => (
                    <StatusBadge key={t} tone="info" size="sm">{t}</StatusBadge>
                  ))}
                </div>
              ) : null}
              <p className="mt-3 text-[10px] text-slate-400">
                Updated {new Date(a.updated_at).toLocaleDateString()}
              </p>
            </button>
          ))}
        </div>
      )}

      <Drawer
        open={Boolean(selected)}
        onOpenChange={(open) => { if (!open) setSelected(null); }}
        title={selected?.title || 'Article'}
        description={selected ? `Updated ${new Date(selected.updated_at).toLocaleString()}` : null}
        width="xl"
        footer={
          selected ? (
            <div className="flex w-full items-center justify-between">
              <Button
                size="sm"
                variant="ghost"
                className="text-rose-700 hover:bg-rose-50"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="mr-1.5 h-4 w-4" />
                Delete
              </Button>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => { startEdit(selected); setSelected(null); }}>
                  Edit
                </Button>
              </div>
            </div>
          ) : null
        }
      >
        {selected ? (
          <div className="space-y-3">
            {Array.isArray(selected.tags) && selected.tags.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {selected.tags.map((t) => (
                  <StatusBadge key={t} tone="info" size="sm">
                    <Tag className="h-3 w-3" />
                    {t}
                  </StatusBadge>
                ))}
              </div>
            ) : null}
            <div className="space-y-1">{renderMarkdown(selected.body)}</div>
          </div>
        ) : null}
      </Drawer>

      {editing ? (
        <EditorDialog
          editing={editing}
          onChange={setEditing}
          onCancel={() => setEditing(null)}
          onSave={saveEdit}
        />
      ) : null}

      <ConfirmActionDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        severity="danger"
        title={`Delete "${selected?.title || 'article'}"?`}
        description="The article is stored per-browser so the delete is local. If you have shared it with teammates they still have their copy."
        confirmLabel="Delete article"
        onConfirm={async () => deleteSelected()}
      />
    </ModuleShell>
  );
}

function EditorDialog({ editing, onChange, onCancel, onSave }) {
  const valid = editing.title.trim().length > 2;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-2xl rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-slate-900">
          {editing.id ? 'Edit article' : 'New article'}
        </h3>
        <div className="mt-4 space-y-3">
          <div>
            <Label className="text-xs text-slate-500">Title</Label>
            <Input
              value={editing.title}
              onChange={(e) => onChange({ ...editing, title: e.target.value })}
              className="h-9"
              autoFocus
            />
          </div>
          <div>
            <Label className="text-xs text-slate-500">Tags (comma separated)</Label>
            <Input
              value={editing.tags}
              onChange={(e) => onChange({ ...editing, tags: e.target.value })}
              placeholder="runbook, infra"
              className="h-9"
            />
          </div>
          <div>
            <Label className="text-xs text-slate-500">Body (lightweight markdown)</Label>
            <Textarea
              value={editing.body}
              onChange={(e) => onChange({ ...editing, body: e.target.value })}
              rows={14}
              className="font-mono text-xs"
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
          <Button size="sm" disabled={!valid} onClick={onSave}>
            {editing.id ? 'Save changes' : 'Create article'}
          </Button>
        </div>
      </div>
    </div>
  );
}
