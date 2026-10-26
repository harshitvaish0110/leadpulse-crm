/**
 * LeadPulse — Outbound email.
 *
 * EMAIL_DRIVER:
 *   ethereal (dev default) — fake inbox; the preview URL is logged and returned
 *   smtp                   — nodemailer with SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS
 *   resend                 — HTTPS API (RESEND_API_KEY); use this where SMTP ports are blocked
 *   log    (test default)  — nothing leaves the process
 * Without EMAIL_DRIVER, a Resend key (from .env or saved in Settings) selects resend.
 */

'use strict';

const { logger } = require('./logger');
const axios = require('axios');
const nodemailer = require('nodemailer');
const { secret } = require('./secrets');

const driver = () => process.env.EMAIL_DRIVER
  || (process.env.NODE_ENV === 'test' ? 'log' : secret('RESEND_API_KEY') ? 'resend' : 'ethereal');
const from = () => process.env.EMAIL_FROM || 'LeadPulse <noreply@leadpulse.dev>';

let transportPromise = null;

function transport() {
  transportPromise ??= (async () => {
    switch (driver()) {
      case 'log':
        return nodemailer.createTransport({ jsonTransport: true });
      case 'smtp':
        return nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: Number(process.env.SMTP_PORT || 587),
          secure: Number(process.env.SMTP_PORT) === 465,
          auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
        });
      default: {
        const account = await nodemailer.createTestAccount();
        return nodemailer.createTransport({ host: account.smtp.host, port: account.smtp.port, secure: account.smtp.secure, auth: { user: account.user, pass: account.pass } });
      }
    }
  })().catch((err) => {
    transportPromise = null; // retry on the next send
    throw err;
  });
  return transportPromise;
}

/**
 * @param {{ to: string, subject: string, text: string, html?: string, replyTo?: string }} message
 * @returns {Promise<{ id: string|null, previewUrl: string|null }>}
 */
async function sendEmail({ to, subject, text, html, replyTo }) {
  if (driver() === 'resend') {
    const { data } = await axios.post('https://api.resend.com/emails',
      { from: from(), to: [to], subject, text, html, reply_to: replyTo },
      { headers: { Authorization: `Bearer ${secret('RESEND_API_KEY')}` }, timeout: 15_000 });
    return { id: data?.id ?? null, previewUrl: null };
  }

  const info = await (await transport()).sendMail({ from: from(), to, subject, text, html, replyTo });
  const previewUrl = nodemailer.getTestMessageUrl(info) || null;
  if (previewUrl) logger.info({ event: 'email_preview', previewUrl }, 'Email preview available');
  return { id: info.messageId ?? null, previewUrl };
}

module.exports = { sendEmail, emailDriver: driver, emailFrom: from };
