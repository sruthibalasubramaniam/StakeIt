/**
 * Email readiness check for whichever transport is configured.
 *
 *   node scripts/email-check.js                 # config only
 *   node scripts/email-check.js you@example.com # …and send one test message
 *
 * Prints no secrets and exits non-zero when delivery cannot work.
 */
require('dotenv').config();

const provider = (process.env.EMAIL_PROVIDER || 'resend').toLowerCase();
const enabled = process.env.EMAIL_ENABLED === 'true';
const from = process.env.EMAIL_FROM;
const recipient = process.argv[2];

const subject = 'Stake It — delivery check';
const text = 'If you can read this, email delivery is working.';
const html = '<p>If you can read this, email delivery is working.</p>';

const ok = (label, value) => console.log(`${label.padEnd(18)}:`, value);

async function checkResend() {
  const key = process.env.RESEND_API_KEY;
  ok('RESEND_API_KEY', key ? `set (${key.length} chars)` : 'MISSING');
  if (!key) return false;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [recipient || 'delivered@resend.dev'], subject, text, html }),
  });
  const body = await response.text();
  console.log('\nResend send:', response.status, body.slice(0, 300));
  return response.ok;
}

async function checkSmtp() {
  const nodemailer = require('nodemailer');
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = Number(process.env.SMTP_PORT || 465);
  const secure = (process.env.SMTP_SECURE ?? 'true') === 'true';
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  ok('SMTP_HOST', `${host}:${port} (secure=${secure})`);
  ok('SMTP_USER', user || 'MISSING');
  ok('SMTP_PASS', pass ? `set (${pass.replace(/\s/g, '').length} chars)` : 'MISSING');
  if (!user || !pass) {
    console.log('\nSet SMTP_USER and SMTP_PASS (a Gmail App Password, not the account password).');
    return false;
  }

  const transport = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 15000,
  });

  try {
    await transport.verify();
    console.log('\nSMTP login: OK');
  } catch (error) {
    console.log('\nSMTP login FAILED:', error.code || '', (error.response || error.message || '').slice(0, 250));
    return false;
  }

  if (!recipient) return true;

  try {
    const info = await transport.sendMail({ from, to: recipient, subject, text, html });
    console.log('SMTP send:', 'OK', info.messageId);
    return true;
  } catch (error) {
    console.log('SMTP send FAILED:', error.code || '', (error.response || error.message || '').slice(0, 250));
    return false;
  }
}

(async () => {
  ok('EMAIL_ENABLED', enabled);
  ok('EMAIL_PROVIDER', provider);
  ok('EMAIL_FROM', from || 'MISSING');
  ok('APP_URL', process.env.APP_URL || 'MISSING');

  if (!from) {
    console.log('\nEMAIL_FROM is required (format: "Name <address@domain>").');
    process.exit(1);
  }

  const success = provider === 'smtp' ? await checkSmtp() : await checkResend();

  if (!success) {
    console.log('\nHints:');
    if (provider === 'smtp') {
      console.log('  • Gmail needs 2-Step Verification and an App Password (16 chars).');
      console.log('  • The From address must be the authenticated account, or Gmail rejects it.');
    } else {
      console.log('  • Resend needs a verified domain; gmail.com can never be verified.');
    }
  }

  process.exitCode = success ? 0 : 1;
})();
