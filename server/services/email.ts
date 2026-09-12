export function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM && process.env.APP_URL);
}

export async function sendPasswordResetEmail(to: string, token: string) {
  if (!emailConfigured()) throw new Error('Password reset email is not configured');
  const url = new URL('/reset-password', process.env.APP_URL);
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') throw new Error('APP_URL must use HTTPS');
  url.hash = new URLSearchParams({ token }).toString();
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject: 'Reset your E3 HR password',
      text: `Reset your password: ${url.toString()}\n\nThis link expires in one hour and can only be used once. If you did not request this, ignore this email.` }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Email delivery failed (${response.status})`);
}
