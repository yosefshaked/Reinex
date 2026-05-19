/* eslint-env node */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { logEmailSent, sendAndLogBrevoEmail } from './email-log.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('logEmailSent', () => {
  it('swallows synchronous logging failures', async () => {
    const supabase = {
      from() {
        throw new Error('email_log_table_unavailable');
      },
    };

    await assert.doesNotReject(() => logEmailSent(supabase, {
      emailType: 'form_submission',
      toEmail: 'test@example.com',
    }));
  });
});

describe('sendAndLogBrevoEmail', () => {
  it('resolves when Brevo send succeeds even if email_log insert rejects', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      text: async () => JSON.stringify({ messageId: 'msg-1' }),
    });

    const supabase = {
      from() {
        return {
          insert() {
            return Promise.reject(new Error('email_log_insert_failed'));
          },
        };
      },
    };

    const result = await sendAndLogBrevoEmail(
      supabase,
      {
        to: 'test@example.com',
        subject: 'Test email',
        textContent: 'Hello',
      },
      {
        BREVO_API_KEY: 'key',
        BREVO_SENDER_EMAIL: 'sender@example.com',
      },
      null,
      { emailType: 'form_submission', orgId: 'org-1' },
    );

    assert.deepEqual(result, { messageId: 'msg-1' });
  });
});
