import { afterEach, expect, test, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { getAppUrl, validateAppConfiguration } from '../server/config';
import { createReadinessHandler } from '../server/services/readiness';
import { sendPasswordResetEmail } from '../server/services/email';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

test('production URL uses the assigned Render origin and respects an explicit custom domain', () => {
  const env = { NODE_ENV: 'production', RENDER: 'true', RENDER_EXTERNAL_URL: 'https://e3-hr-test.onrender.com' };
  expect(getAppUrl(env)).toBe(env.RENDER_EXTERNAL_URL);
  expect(getAppUrl({ ...env, APP_URL: 'https://hr.example.com/' })).toBe('https://hr.example.com');
  expect(getAppUrl({ ...env, RENDER: 'false' })).toBeUndefined();
  expect(() => getAppUrl({ ...env, APP_URL: 'http://hr.example.com' })).toThrow(/HTTPS/);
  for (const APP_URL of ['invalid', 'https://user:pass@example.com', 'https://example.com/subpath', 'https://example.com/?x=1', 'https://example.com/#hash']) {
    expect(() => getAppUrl({ ...env, APP_URL })).toThrow(/APP_URL/);
  }
  vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('APP_URL', ''); vi.stubEnv('RENDER', '');
  expect(() => validateAppConfiguration()).toThrow(/Set APP_URL/);
});

test('password reset email uses the assigned HTTPS deployment URL without sending live email', async () => {
  vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('APP_URL', ''); vi.stubEnv('RENDER', 'true');
  vi.stubEnv('RENDER_EXTERNAL_URL', 'https://e3-hr-test.onrender.com');
  vi.stubEnv('RESEND_API_KEY', 'test-key'); vi.stubEnv('EMAIL_FROM', 'hr@example.com');
  const transport = vi.fn().mockResolvedValue(new Response('{}', { status: 200 })); vi.stubGlobal('fetch', transport);
  await sendPasswordResetEmail('employee@example.com', 'test-token');
  expect(JSON.parse(transport.mock.calls[0][1].body).text).toContain('https://e3-hr-test.onrender.com/reset-password#token=test-token');
});

test('public readiness fails closed for a database outage, hides diagnostics, and recovers', async () => {
  const check = vi.fn().mockRejectedValueOnce(new Error('postgres://secret@host/private-database')).mockResolvedValue(undefined);
  const app = express(); app.get('/readyz', createReadinessHandler(check));
  let server: Server;
  await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  try {
    const address = server!.address(); if (!address || typeof address === 'string') throw new Error('Missing address');
    const endpoint = `http://127.0.0.1:${address.port}/readyz`;
    const unavailable = await fetch(endpoint);
    expect(unavailable.status).toBe(503); expect(unavailable.headers.get('cache-control')).toBe('no-store');
    expect(await unavailable.json()).toEqual({ status: 'unavailable' });
    const ready = await fetch(endpoint); expect(ready.status).toBe(200); expect(await ready.json()).toEqual({ status: 'ready' });
  } finally { await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve())); }
});
