import React from 'react';
import { Lightbulb, Plus, ThumbsUp, Trash2, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import ModuleShell from '../ui/ModuleShell.jsx';
import EmptyState from '../ui/EmptyState.jsx';
import StatusBadge from '../ui/StatusBadge.jsx';
import MetricCard from '../ui/MetricCard.jsx';
import { useAdminModuleView, captureAdminEvent } from '../lib/admin-analytics.js';
import { useAdminStore } from '../lib/useAdminStore.js';

/**
 * Future Ideas — a parking lot for deferred modules and concepts.
 *
 * Uses localStorage as a zero-backend store so the surface is immediately
 * useful during the admin-console buildout. When an idea is ready to graduate
 * it gets promoted to the roadmap and lifted out of here.
 */


const SEED_IDEAS = [
  {
    id: 'background-jobs-monitor',
    title: 'Background Jobs Monitor',
    description: 'Surface queue depth, retries, and long-running workers across all environments.',
    tags: ['observability', 'infra'],
    upvotes: 3,
    notes: 'Likely a wrapper over Temporal / a future job runner — deferred until we pick one.',
    created_at: '2026-03-02T10:00:00.000Z',
  },
  {
    id: 'cost-analytics',
    title: 'Cost Analytics',
    description: 'Per-org + per-module spend (Supabase rows, storage GB, PostHog events, email).',
    tags: ['finops', 'billing'],
    upvotes: 5,
    notes: 'Blocked on Billing module landing first so we have a home for chargeback views.',
    created_at: '2026-03-08T10:00:00.000Z',
  },
  {
    id: 'localisation-console',
    title: 'Localisation Console',
    description: 'Manage translation keys, missing-string alerts, and per-locale override preview.',
    tags: ['i18n', 'content'],
    upvotes: 2,
    notes: 'Consider adopting a 3rd-party (Lokalise, Phrase) before building.',
    created_at: '2026-03-12T10:00:00.000Z',
  },
  {
    id: 'ai-support-assistant',
    title: 'AI Support Assistant',
    description: 'In-context summaries of impersonation sessions + suggested next steps.',
    tags: ['support', 'ai'],
    upvotes: 6,
    notes: 'Needs impersonation telemetry schema stable first. Tie to PostHog replay.',
    created_at: '2026-03-25T10:00:00.000Z',
  },
];

export default function FutureIdeasView() {
  useAdminModuleView('future-ideas');

  const { items: ideas, upsert, remove: removeIdea } = useAdminStore('future_ideas', { seed: SEED_IDEAS });
  const [draft, setDraft] = React.useState({ title: '', description: '', tags: '' });
  const [sortKey, setSortKey] = React.useState('upvotes');

  const sorted = React.useMemo(() => {
    const copy = [...ideas];
    if (sortKey === 'upvotes') {
      copy.sort((a, b) => (b.upvotes || 0) - (a.upvotes || 0));
    } else {
      copy.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }
    return copy;
  }, [ideas, sortKey]);

  const addIdea = () => {
    const title = draft.title.trim();
    if (!title) return;
    const tags = draft.tags.split(',').map((t) => t.trim()).filter(Boolean);
    upsert({
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      title,
      description: draft.description.trim(),
      tags,
      upvotes: 1,
      notes: '',
      created_at: new Date().toISOString(),
    });
    setDraft({ title: '', description: '', tags: '' });
    captureAdminEvent('future_idea_added', {
      title_length: title.length,
      description_length: draft.description.trim().length,
      tag_count: tags.length,
    });
  };

  const upvote = (id) => {
    const idea = ideas.find((i) => i.id === id);
    if (idea) upsert({ ...idea, upvotes: (idea.upvotes || 0) + 1 });
  };

  const totalVotes = ideas.reduce((sum, i) => sum + (i.upvotes || 0), 0);

  return (
    <ModuleShell
      title="Future Ideas"
      subtitle="Roadmap"
      description="Parking lot for modules and concepts we have deferred. Upvotes signal demand; promote an item by giving it a roadmap slot and moving it out. Persisted per-browser — no backend yet."
      actions={
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span>Sort:</span>
          <Button
            size="sm"
            variant={sortKey === 'upvotes' ? 'default' : 'outline'}
            onClick={() => setSortKey('upvotes')}
          >
            Top-voted
          </Button>
          <Button
            size="sm"
            variant={sortKey === 'recent' ? 'default' : 'outline'}
            onClick={() => setSortKey('recent')}
          >
            Recent
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <MetricCard label="Ideas" value={ideas.length} />
        <MetricCard label="Total upvotes" value={totalVotes} />
        <MetricCard label="Avg per idea" value={ideas.length ? (totalVotes / ideas.length).toFixed(1) : 0} />
      </div>

      <article className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Add an idea</h3>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="md:col-span-1">
            <Label className="text-xs text-slate-500">Title</Label>
            <Input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="Cost Analytics dashboard"
              className="h-9"
            />
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs text-slate-500">Tags</Label>
            <Input
              value={draft.tags}
              onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
              placeholder="finops, billing"
              className="h-9"
            />
          </div>
          <div className="md:col-span-3">
            <Label className="text-xs text-slate-500">Description</Label>
            <Textarea
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              placeholder="What problem does this solve, and who benefits?"
              rows={2}
            />
          </div>
        </div>
        <div className="mt-3 flex justify-end">
          <Button size="sm" onClick={addIdea} disabled={!draft.title.trim()}>
            <Plus className="mr-1.5 h-4 w-4" />
            Add idea
          </Button>
        </div>
      </article>

      {sorted.length === 0 ? (
        <EmptyState
          icon={<Lightbulb className="h-6 w-6" />}
          title="No ideas parked yet"
          description="Use the form above to capture a future module or concept you do not want to forget."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {sorted.map((idea) => (
            <article
              key={idea.id}
              className="rounded-xl border border-slate-200 bg-white p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h4 className="truncate text-sm font-semibold text-slate-900">{idea.title}</h4>
                  <p className="mt-1 text-xs leading-5 text-slate-600">
                    {idea.description || '—'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button size="sm" variant="outline" onClick={() => upvote(idea.id)}>
                    <ThumbsUp className="mr-1.5 h-3.5 w-3.5" />
                    {idea.upvotes || 0}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => removeIdea(idea.id)}
                    className="text-slate-400 hover:text-rose-600"
                    aria-label="Remove idea"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              {Array.isArray(idea.tags) && idea.tags.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1">
                  {idea.tags.map((tag) => (
                    <StatusBadge key={tag} tone="info" size="sm">{tag}</StatusBadge>
                  ))}
                </div>
              ) : null}
              {idea.notes ? (
                <div className="mt-3 flex items-start gap-2 rounded-md bg-slate-50 p-2 text-[11px] text-slate-600">
                  <MessageSquare className="mt-0.5 h-3 w-3 shrink-0" />
                  <p className="leading-4">{idea.notes}</p>
                </div>
              ) : null}
              <p className="mt-3 text-[10px] text-slate-400">
                Added {new Date(idea.created_at).toLocaleDateString()}
              </p>
            </article>
          ))}
        </div>
      )}
    </ModuleShell>
  );
}
