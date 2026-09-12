import { afterEach, expect, test, vi } from 'vitest';
import { emailConfigured, sendPasswordResetEmail } from '../server/services/email';
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
test('Resend receives the reset link; no live email is sent in tests', async () => {
  vi.stubEnv('APP_URL', 'https://hr.example.com'); vi.stubEnv('RESEND_API_KEY', 'test-key'); vi.stubEnv('EMAIL_FROM', 'HR <hr@example.com>');
  const transport = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', transport);
  await sendPasswordResetEmail('employee@example.com', 'test-token');
  const [url, request] = transport.mock.calls[0];
  expect(url).toBe('https://api.resend.com/emails');
  const body = JSON.parse(request.body);
  expect(body.to).toEqual(['employee@example.com']);
  expect(body.text).toContain('https://hr.example.com/reset-password#token=test-token');
});
test('email fails clearly when configuration or delivery is unavailable', async () => {
  vi.stubEnv('RESEND_API_KEY', ''); expect(emailConfigured()).toBe(false);
  await expect(sendPasswordResetEmail('employee@example.com', 'token')).rejects.toThrow(/configured/);
  vi.stubEnv('APP_URL', 'https://hr.example.com'); vi.stubEnv('RESEND_API_KEY', 'test-key'); vi.stubEnv('EMAIL_FROM', 'hr@example.com');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })));
  await expect(sendPasswordResetEmail('employee@example.com', 'token')).rejects.toThrow(/503/);
});
