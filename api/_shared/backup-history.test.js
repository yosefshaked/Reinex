/* eslint-env node */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  appendBackupHistory,
  findLatestCompletedBackup,
  isManagedBackupFilename,
  summarizeBackupHistory,
} from './backup-history.js';

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_ORG_ID = '22222222-2222-2222-2222-222222222222';

test('findLatestCompletedBackup only accepts completed managed backup files for the target org', () => {
  const now = new Date('2026-05-14T10:00:00.000Z').getTime();
  const history = [
    {
      type: 'backup',
      status: 'completed',
      timestamp: '2026-05-14T09:00:00.000Z',
      filename: `backups/${OTHER_ORG_ID}/2026-05-14.enc`,
    },
    {
      type: 'local_export',
      status: 'completed',
      timestamp: '2026-05-14T09:30:00.000Z',
      filename: `backups/${ORG_ID}/2026-05-14.enc`,
    },
    {
      type: 'backup',
      status: 'failed',
      timestamp: '2026-05-14T09:45:00.000Z',
      filename: `backups/${ORG_ID}/2026-05-14.enc`,
    },
    {
      type: 'backup',
      status: 'completed',
      timestamp: '2026-05-14T08:00:00.000Z',
      filename: `backups/${ORG_ID}/2026-05-14.enc`,
    },
  ];

  const result = findLatestCompletedBackup(history, {
    orgId: ORG_ID,
    now,
    maxAgeMs: 30 * 24 * 60 * 60 * 1000,
  });

  assert.equal(result.completed.length, 1);
  assert.equal(result.recent?.filename, `backups/${ORG_ID}/2026-05-14.enc`);
});

test('findLatestCompletedBackup distinguishes old history from recent restorable history', () => {
  const result = findLatestCompletedBackup([
    {
      type: 'backup',
      status: 'completed',
      timestamp: '2026-03-01T08:00:00.000Z',
      filename: `backups/${ORG_ID}/2026-03-01.enc`,
    },
  ], {
    orgId: ORG_ID,
    now: new Date('2026-05-14T10:00:00.000Z').getTime(),
    maxAgeMs: 30 * 24 * 60 * 60 * 1000,
  });

  assert.equal(result.latest?.filename, `backups/${ORG_ID}/2026-03-01.enc`);
  assert.equal(result.recent, null);
});

test('isManagedBackupFilename enforces the managed encrypted backup path format', () => {
  assert.equal(isManagedBackupFilename(`backups/${ORG_ID}/2026-05-14.enc`, ORG_ID), true);
  assert.equal(isManagedBackupFilename(`exports/${ORG_ID}/2026-05-14.enc`, ORG_ID), false);
  assert.equal(isManagedBackupFilename(`backups/${ORG_ID}/2026-05-14.json`, ORG_ID), false);
  assert.equal(isManagedBackupFilename(`backups/${OTHER_ORG_ID}/2026-05-14.enc`, ORG_ID), false);
});

test('summarizeBackupHistory normalizes timestamp-compatible entries for admin display', () => {
  const summary = summarizeBackupHistory([
    {
      type: 'backup',
      status: 'completed',
      created_at: '2026-05-14T08:00:00.000Z',
      filename: `backups/${ORG_ID}/2026-05-14.enc`,
    },
  ]);

  assert.equal(summary.count, 1);
  assert.equal(summary.latest.timestamp, '2026-05-14T08:00:00.000Z');
  assert.equal(summary.entries[0].filename, `backups/${ORG_ID}/2026-05-14.enc`);
});

test('appendBackupHistory appends through organizations.backup_history and trims old rows', async () => {
  const calls = [];
  const existingHistory = Array.from({ length: 100 }, (_, index) => ({
    type: 'backup',
    status: 'completed',
    timestamp: `2026-05-${String(index + 1).padStart(2, '0')}T08:00:00.000Z`,
    filename: `backups/${ORG_ID}/2026-05-${String(index + 1).padStart(2, '0')}.enc`,
  }));

  const supabase = {
    from(table) {
      calls.push(['from', table]);
      return {
        select(columns) {
          calls.push(['select', columns]);
          return {
            eq(column, value) {
              calls.push(['eq', column, value]);
              return {
                async maybeSingle() {
                  return { data: { backup_history: existingHistory }, error: null };
                },
              };
            },
          };
        },
        update(payload) {
          calls.push(['update', payload]);
          return {
            eq(column, value) {
              calls.push(['update-eq', column, value]);
              return { error: null };
            },
          };
        },
      };
    },
  };

  const nextEntry = {
    type: 'backup',
    status: 'completed',
    timestamp: '2026-06-01T08:00:00.000Z',
    filename: `backups/${ORG_ID}/2026-06-01.enc`,
  };

  const updated = await appendBackupHistory(supabase, ORG_ID, nextEntry);
  assert.equal(updated.length, 100);
  assert.deepEqual(updated.at(-1), nextEntry);

  const updateCall = calls.find((call) => call[0] === 'update');
  assert.equal(updateCall[1].backup_history.length, 100);
  assert.deepEqual(updateCall[1].backup_history.at(-1), nextEntry);
});
