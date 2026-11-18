// SMS via the central notification service.
//
//   SMS_API_URL        e.g. http://10.32.11.90:8185/api/v1/notification/send/sms
//   SMS_ACTIVITY_CODE  activity code issued by the notification service
//   SMS_COUNTRY_CODE   optional, e.g. +232 — replaces a leading 0 on local numbers (stored as 076xxxxxx)
//
// sendSms is fire-and-forget: it never throws. When SMS_API_URL or SMS_ACTIVITY_CODE is unset,
// nothing is sent.

const TIMEOUT_MS = 10000;

function normalizePhone(raw) {
  let p = String(raw ?? '').replace(/[\s\-()]/g, '');
  if (!p) return '';
  if (p.startsWith('+')) return p;
  if (p.startsWith('00')) return `+${p.slice(2)}`;
  const cc = (process.env.SMS_COUNTRY_CODE || '').trim();
  if (p.startsWith('0') && cc) return `${cc.startsWith('+') ? cc : `+${cc}`}${p.slice(1)}`;
  return p;
}

async function sendSms(recipient, body) {
  const url  = process.env.SMS_API_URL;
  const code = process.env.SMS_ACTIVITY_CODE;
  const to   = normalizePhone(recipient);
  // Skip placeholders like "076" — a real number has at least 8 digits.
  if (!url || !code || !body || to.replace(/\D/g, '').length < 8) return;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activity_code: code, sms_recipient: to, sms_msg_body: body }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[sms] to ${to} failed: HTTP ${res.status} ${text.slice(0, 200)}`);
    }
  } catch (err) {
    console.error(`[sms] to ${to} failed:`, err.message);
  }
}

module.exports = { sendSms, normalizePhone };
