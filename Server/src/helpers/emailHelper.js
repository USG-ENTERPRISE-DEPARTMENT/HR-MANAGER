const nodemailer = require('nodemailer');

// Config resolution

async function resolveMailConfig() {
  try {
    const { prisma } = require('./dbQueryHelper');
    const rows = await prisma.$queryRaw`SELECT setting_key, setting_value FROM app_settings WHERE setting_key LIKE 'email_%'`;
    const db = Object.fromEntries(rows.map(r => [r.setting_key, r.setting_value ?? '']));
    return {
      enabled: (db.email_enabled ?? '1') !== '0',
      host:    db.email_smtp_host   || process.env.SMTP_HOST   || 'smtp.gmail.com',
      port:    Number(db.email_smtp_port || process.env.SMTP_PORT || 587),
      secure:  (db.email_smtp_secure || process.env.SMTP_SECURE) === 'true',
      user:    db.email_smtp_user   || process.env.SMTP_USER   || '',
      pass:    db.email_smtp_pass   || process.env.SMTP_PASS   || '',
      from:    db.email_from        || process.env.SMTP_FROM   || db.email_smtp_user || process.env.SMTP_USER || '',
    };
  } catch {
    return {
      enabled: true,
      host:    process.env.SMTP_HOST   || 'smtp.gmail.com',
      port:    Number(process.env.SMTP_PORT || 587),
      secure:  process.env.SMTP_SECURE === 'true',
      user:    process.env.SMTP_USER   || '',
      pass:    process.env.SMTP_PASS   || '',
      from:    process.env.SMTP_FROM   || process.env.SMTP_USER || '',
    };
  }
}

async function resolveBranding() {
  try {
    const { prisma } = require('./dbQueryHelper');
    const [row] = await prisma.$queryRaw`SELECT company_name, company_address, company_logo_url, accent_color FROM payslip_settings LIMIT 1`;
    return {
      name:    row?.company_name    || 'HR System',
      address: row?.company_address || '',
      logoUrl: row?.company_logo_url || '',
      accent:  row?.accent_color    || '#2563eb',
    };
  } catch {
    return { name: 'HR System', address: '', logoUrl: '', accent: '#2563eb' };
  }
}

async function makeTransporter() {
  const cfg = await resolveMailConfig();
  if (!cfg.enabled) return null;
  const transport = nodemailer.createTransport({
    host: cfg.host, port: cfg.port, secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
  });
  return { transport, from: cfg.from };
}

// Per-module notification switch (Settings → Notification Settings). Reads the
// `settings` table (category 'notifications'). Default ON — only an explicit
// '0' disables a module's emails. Never blocks on a lookup failure.
async function notifyEnabled(moduleKey) {
  try {
    const { prisma } = require('./dbQueryHelper');
    const rows = await prisma.$queryRaw`SELECT value FROM settings WHERE name=${`notify_${moduleKey}`} AND category='notifications' LIMIT 1`;
    return !rows.length || rows[0].value !== '0';
  } catch {
    return true;
  }
}

// Shared email shell

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeAccent(color) {
  return /^#[0-9a-f]{6}$/i.test(color || '') ? color : '#2563eb';
}

function emailShell({ branding, preheader = '', body }) {
  const name = escapeHtml(branding.name || 'HR System');
  const address = escapeHtml(branding.address || '');
  const logoUrl = escapeHtml(branding.logoUrl || '');
  const accent = safeAccent(branding.accent);

  const logoHtml = logoUrl
    ? `<img src="${logoUrl}" alt="${name}" width="132" style="width:auto;max-width:132px;max-height:44px;object-fit:contain;display:block;border:0;outline:none;text-decoration:none" />`
    : `<div style="width:44px;height:44px;border-radius:10px;background:${accent};color:#ffffff;font-size:17px;line-height:44px;font-weight:800;text-align:center">${name.charAt(0).toUpperCase()}</div>`;

  const addressHtml = address
    ? `<p style="margin:6px 0 0;font-size:12px;line-height:1.6;color:#94a3b8">${address}</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
  <style>
    body{margin:0;padding:0;background:#eef2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
    table{border-collapse:separate}
    img{border:0;line-height:100%;outline:none;text-decoration:none}
    a{color:${accent}}
    .outer{padding:40px 16px}
    .panel{border-radius:18px;overflow:hidden}
    .content{padding:36px 34px 34px}
    @media(max-width:620px){
      .outer{padding:18px 10px!important}
      .content{padding:28px 22px!important}
      .brand-cell{padding:22px!important}
      .footer-cell{padding:20px 22px!important}
      .fluid{width:100%!important}
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#eef2f7">
  ${preheader ? `<div style="display:none;font-size:1px;color:#eef2f7;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">${escapeHtml(preheader)}</div>` : ''}

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="outer">
        <tr><td align="center">
      <table role="presentation" width="100%" class="panel fluid" style="max-width:620px;background:#ffffff;border:1px solid #dbe3ee;border-radius:18px;overflow:hidden;box-shadow:0 18px 42px rgba(15,23,42,.08)" cellpadding="0" cellspacing="0">

        <!-- Brand -->
        <tr>
          <td class="brand-cell" style="padding:24px 34px;background:#ffffff;border-top:5px solid ${accent};border-bottom:1px solid #e5edf6">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="vertical-align:middle;width:1%;padding-right:14px">${logoHtml}</td>
                <td style="vertical-align:middle">
                  <p style="margin:0;font-size:13px;line-height:1.4;color:#64748b;font-weight:700;text-transform:uppercase">HR Notification</p>
                  <h1 style="margin:2px 0 0;font-size:22px;line-height:1.25;font-weight:800;color:#0f172a">${name}</h1>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td class="content" style="background:#ffffff;padding:36px 34px 34px">
            ${body}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td class="footer-cell" style="background:#f8fafc;border-top:1px solid #e5edf6;padding:22px 34px;text-align:center">
            <p style="margin:0;font-size:13px;color:#475569;font-weight:700">${name}</p>
            ${addressHtml}
            <p style="margin:12px 0 0;font-size:12px;line-height:1.5;color:#94a3b8">This is an automated message. Please do not reply directly to this email.</p>
          </td>
        </tr>

      </table>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// Shared style helpers

function infoTable(rows) {
  const cells = rows.filter(Boolean).map(([label, value]) => `
    <tr>
      <td style="padding:13px 16px;color:#64748b;font-size:13px;line-height:1.5;white-space:nowrap;vertical-align:top;font-weight:700;border-bottom:1px solid #e5edf6">${label}</td>
      <td style="padding:13px 16px 13px 0;font-size:14px;line-height:1.5;color:#0f172a;font-weight:700;border-bottom:1px solid #e5edf6">${value}</td>
    </tr>`).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
    style="border-collapse:collapse;background:#f8fafc;border:1px solid #e5edf6;border-radius:10px;overflow:hidden;margin:22px 0">
    ${cells}
  </table>`;
}

function primaryButton(label, href, accent) {
  return `<a href="${escapeHtml(href)}"
    style="display:inline-block;background:${safeAccent(accent)};color:#ffffff;padding:14px 24px;border-radius:9px;
           text-decoration:none;font-weight:800;font-size:15px;line-height:1.2;margin-top:8px">
    ${escapeHtml(label)} &rarr;
  </a>`;
}

function badge(text, color) {
  return `<span style="display:inline-block;background:${safeAccent(color)};color:#fff;padding:5px 12px;border-radius:999px;font-size:12px;line-height:1.2;font-weight:800">${escapeHtml(text)}</span>`;
}

function greeting(name) {
  return `<p style="margin:0 0 18px;font-size:16px;line-height:1.5;color:#334155">Hello <strong style="color:#0f172a">${escapeHtml(name)}</strong>,</p>`;
}

function muted(text) {
  return `<p style="margin:24px 0 0;font-size:13px;color:#64748b;line-height:1.6">${escapeHtml(text)}</p>`;
}

// Email functions

async function sendWelcomeEmail({ to, name, username, password, loginUrl }) {
  if (!(await notifyEnabled('users'))) return;
  const [t, branding] = await Promise.all([makeTransporter(), resolveBranding()]);
  if (!t) return;

  // Where the user signs in. Falls back to the dev client URL when FRONTEND_URL
  // is not configured (set FRONTEND_URL to the public app URL in production).
  const signInUrl = loginUrl || process.env.FRONTEND_URL || 'http://localhost:3099';

  const body = `
    ${greeting(name)}
    <p style="margin:0 0 24px;font-size:14px;color:#475569;line-height:1.6">
      Your HR system account has been created. Use the credentials below to sign in for the first time.
    </p>
    ${infoTable([
      ['Username', `<span style="font-family:monospace;font-size:13px">${username}</span>`],
      ['Password', `<span style="font-family:monospace;font-size:13px">${password}</span>`],
    ])}
    <div style="margin:24px 0 0">
      ${primaryButton('Sign In', signInUrl, branding.accent)}
    </div>
    <p style="margin:14px 0 0;font-size:12px;color:#94a3b8;line-height:1.5">
      Or paste this link into your browser:<br />
      <a href="${escapeHtml(signInUrl)}" style="color:${branding.accent};word-break:break-all">${escapeHtml(signInUrl)}</a>
    </p>
    <p style="margin:20px 0 0;font-size:13px;color:#ef4444;font-weight:600">
      Important: Please change your password immediately after your first login.
    </p>
    ${muted('If you did not expect this email, please contact your HR administrator immediately.')}
  `;

  await t.transport.sendMail({
    from: t.from, to,
    subject: `Your ${branding.name} Account`,
    html: emailShell({ branding, preheader: `Your account credentials for ${branding.name}`, body }),
  });
}

async function sendLeaveEmail({ to, employeeName, action, leaveType, dateStart, dateEnd, reason }) {
  if (!(await notifyEnabled('leave'))) return;
  const [t, branding] = await Promise.all([makeTransporter(), resolveBranding()]);
  if (!t) return;

  const labels  = { submitted: 'Leave Application Submitted', approved: 'Leave Approved', rejected: 'Leave Rejected', cancelled: 'Leave Cancelled' };
  const colors  = { submitted: '#3b82f6', approved: '#22c55e', rejected: '#ef4444', cancelled: '#f59e0b' };
  const subject = labels[action] ?? `Leave Update`;
  const color   = colors[action] ?? '#6b7280';

  const body = `
    ${greeting(employeeName)}
    <p style="margin:0 0 4px;font-size:14px;color:#475569">Your leave application status has been updated:</p>
    <p style="margin:0 0 20px">${badge(action.charAt(0).toUpperCase() + action.slice(1), color)}</p>
    ${infoTable([
      ['Leave Type', leaveType],
      ['From',       dateStart],
      ['To',         dateEnd],
      reason ? ['Reason', reason] : null,
    ])}
    ${muted('If you have questions about this decision, please contact your HR administrator.')}
  `;

  await t.transport.sendMail({
    from: t.from, to, subject,
    html: emailShell({ branding, preheader: subject, body }),
  });
}

async function sendSchedulingInvite({ to, candidateName, jobTitle, slots, link, expiresAt }) {
  if (!(await notifyEnabled('recruitment'))) return;
  const [t, branding] = await Promise.all([makeTransporter(), resolveBranding()]);
  if (!t) return;

  const slotItems = slots.map(slot => {
    const label = new Date(slot).toLocaleString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
    return `<li style="padding:10px 0;border-bottom:1px solid #e2e8f0;list-style:none;font-size:13px;color:#334155">Date: ${label}</li>`;
  }).join('');

  const expiryNote = expiresAt
    ? muted(`This scheduling link expires on ${new Date(expiresAt).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}.`)
    : '';

  const body = `
    ${greeting(candidateName)}
    <p style="margin:0 0 24px;font-size:14px;color:#475569;line-height:1.6">
      Congratulations! You have been shortlisted for the <strong>${jobTitle}</strong> position.
      Please select a convenient time for your interview from the available slots below.
    </p>
    <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Available Slots</p>
    <ul style="padding:0;margin:0 0 28px;border-top:1px solid #e2e8f0">${slotItems}</ul>
    <div style="text-align:center;padding:8px 0 4px">
      ${primaryButton('Choose Your Slot', link, branding.accent)}
    </div>
    ${expiryNote}
  `;

  await t.transport.sendMail({
    from: t.from, to,
    subject: `Interview Invitation - ${jobTitle}`,
    html: emailShell({ branding, preheader: `You've been shortlisted for ${jobTitle}`, body }),
  });
}

async function sendInterviewConfirmation({ to, name, jobTitle, level, datetime, location, interviewers, icsContent }) {
  if (!(await notifyEnabled('recruitment'))) return;
  const [t, branding] = await Promise.all([makeTransporter(), resolveBranding()]);
  if (!t) return;

  const body = `
    ${greeting(name)}
    <p style="margin:0 0 24px;font-size:14px;color:#475569;line-height:1.6">
      Your interview has been confirmed. Please find the details below. A calendar invite is attached to this email.
    </p>
    ${infoTable([
      ['Position',     jobTitle],
      level        ? ['Round',        level]        : null,
      ['Date &amp; Time', datetime],
      location     ? ['Location',     location]     : null,
      interviewers ? ['Interviewers', interviewers] : null,
    ])}
    ${muted('If you need to reschedule or have any questions, please contact your HR administrator as soon as possible.')}
  `;

  await t.transport.sendMail({
    from: t.from, to,
    subject: `Interview Confirmed - ${jobTitle}`,
    html: emailShell({ branding, preheader: `Your interview for ${jobTitle} is confirmed`, body }),
    attachments: [{ filename: 'interview.ics', content: icsContent, contentType: 'text/calendar' }],
  });
}

async function sendCandidateStageEmail({ to, candidateName, stageName, jobTitle }) {
  if (!(await notifyEnabled('recruitment'))) return;
  const [t, branding] = await Promise.all([makeTransporter(), resolveBranding()]);
  if (!t) return;

  const body = `
    ${greeting(candidateName)}
    <p style="margin:0 0 24px;font-size:14px;color:#475569;line-height:1.6">
      We are pleased to inform you that your application${jobTitle ? ` for <strong>${jobTitle}</strong>` : ''} has progressed to the next stage.
    </p>
    ${infoTable([
      ['Current Stage', `${badge(stageName, branding.accent)}`],
      jobTitle ? ['Position', jobTitle] : null,
    ])}
    <p style="margin:20px 0 0;font-size:14px;color:#475569;line-height:1.6">
      Our team will be in touch shortly with the next steps. Thank you for your continued interest.
    </p>
    ${muted('If you have questions, please contact your HR administrator.')}
  `;

  await t.transport.sendMail({
    from: t.from, to,
    subject: `Application Update - ${stageName}${jobTitle ? ` - ${jobTitle}` : ''}`,
    html: emailShell({ branding, preheader: `Your application has moved to ${stageName}`, body }),
  });
}

function buildIcs({ uid, summary, dtstart, dtend, location, organizerEmail, attendeeEmail }) {
  const fmt = d => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//HR System//EN',
    'BEGIN:VEVENT',
    `UID:${uid}@hr`,
    `DTSTART:${fmt(new Date(dtstart))}`,
    `DTEND:${fmt(new Date(dtend))}`,
    `SUMMARY:${summary}`,
    location       ? `LOCATION:${location}`              : '',
    organizerEmail ? `ORGANIZER:MAILTO:${organizerEmail}` : '',
    attendeeEmail  ? `ATTENDEE:MAILTO:${attendeeEmail}`   : '',
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
}

async function sendDisciplinaryEmail({ to, name, incidentType, incidentDate, description, severity, actionTaken }) {
  if (!to) return;
  if (!(await notifyEnabled('employees'))) return;
  const [t, branding] = await Promise.all([makeTransporter(), resolveBranding()]);
  if (!t) return;

  const severityColors = { Low: '#64748b', Medium: '#f59e0b', High: '#f97316', Critical: '#ef4444' };
  const color   = severityColors[severity] ?? '#64748b';
  const subject = `Disciplinary Notice - ${incidentType}`;

  const fmtDate = d => { try { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return d; } };

  const body = `
    ${greeting(name)}
    <p style="margin:0 0 16px;font-size:14px;color:#475569;line-height:1.6">
      This is to formally notify you of a disciplinary record that has been raised against you:
    </p>
    <p style="margin:0 0 20px">${badge(severity + ' Severity', color)}</p>
    ${infoTable([
      ['Incident Type',  incidentType],
      ['Incident Date',  fmtDate(incidentDate)],
      actionTaken ? ['Action Taken', actionTaken] : null,
    ])}
    <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#374151">Details</p>
    <p style="margin:0 0 20px;font-size:13px;color:#4b5563;line-height:1.6;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 16px">${description}</p>
    ${muted('If you wish to appeal or discuss this matter, please contact your HR administrator. This is an official record and should be treated in confidence.')}
  `;

  await t.transport.sendMail({
    from: t.from, to,
    subject,
    html: emailShell({ branding, preheader: subject, body }),
  });
}

async function sendEmployeeLifecycleEmail({ to, name, action, reason, effectiveDate }) {
  if (!to) return;
  if (!(await notifyEnabled('employees'))) return;
  const [t, branding] = await Promise.all([makeTransporter(), resolveBranding()]);
  if (!t) return;

  const meta = {
    SUSPENDED:  { subject: 'Employment Suspension Notice',  color: '#f59e0b', label: 'Suspended'  },
    TERMINATED: { subject: 'Employment Termination Notice', color: '#ef4444', label: 'Terminated' },
    RESIGNED:   { subject: 'Resignation Confirmation',      color: '#64748b', label: 'Resigned'   },
    REINSTATED: { subject: 'Reinstatement Confirmation',    color: '#22c55e', label: 'Reinstated' },
  };
  const m = meta[action] ?? { subject: 'Employment Status Update', color: '#6b7280', label: action };

  const body = `
    ${greeting(name)}
    <p style="margin:0 0 20px;font-size:14px;color:#475569;line-height:1.6">
      This is to inform you that your employment status has been updated:
    </p>
    <p style="margin:0 0 20px">${badge(m.label, m.color)}</p>
    ${infoTable([
      effectiveDate ? ['Effective Date', effectiveDate] : null,
      reason        ? ['Reason',         reason]        : null,
    ])}
    ${muted('If you have questions about this update, please contact the HR administrator.')}
  `;

  await t.transport.sendMail({
    from: t.from, to,
    subject: m.subject,
    html: emailShell({ branding, preheader: m.subject, body }),
  });
}

async function sendPerformanceEmail({ to, name, action, cycleName, dueDate, employeeName }) {
  if (!to) return;
  if (!(await notifyEnabled('performance'))) return;
  const [t, branding] = await Promise.all([makeTransporter(), resolveBranding()]);
  if (!t) return;

  const fmtDate = d => { try { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return d ?? '-'; } };

  const meta = {
    CYCLE_STARTED:     { subject: 'Performance Review - Self Assessment Open', color: '#3b82f6', msg: 'A new performance review cycle has started. Please complete your self-assessment by the due date below.' },
    SUPERVISOR_NOTIFY: { subject: 'Performance Review - Subordinate Self-Assessment Submitted', color: '#8b5cf6', msg: `${employeeName ?? 'An employee'} has submitted their self-assessment. Please log in to review and submit your assessment.` },
    HR_NOTIFY:         { subject: 'Performance Review - Supervisor Assessment Submitted', color: '#f59e0b', msg: 'A supervisor has submitted their review. Please complete the final HR sign-off.' },
    REVIEW_COMPLETED:  { subject: 'Performance Review - Completed', color: '#22c55e', msg: 'Your performance review has been completed. You can log in to view your final scores and development plan.' },
  };
  const m = meta[action] ?? { subject: 'Performance Review Update', color: '#6b7280', msg: '' };

  const body = `
    ${greeting(name)}
    <p style="margin:0 0 20px;font-size:14px;color:#475569;line-height:1.6">${m.msg}</p>
    ${infoTable([
      ['Cycle',    cycleName ?? '-'],
      dueDate ? ['Due Date', fmtDate(dueDate)] : null,
    ])}
    ${muted('Please log in to the HR system to take action. If you have questions, contact the HR administrator.')}
  `;

  await t.transport.sendMail({
    from: t.from, to, subject: m.subject,
    html: emailShell({ branding, preheader: m.subject, body }),
  });
}

async function sendDocumentExpiryEmail({ to, employeeName, docType, expiryDate }) {
  if (!(await notifyEnabled('documents'))) return;
  const [t, branding] = await Promise.all([makeTransporter(), resolveBranding()]);
  if (!t) return;

  const fmtDate = d => { try { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return d ?? '-'; } };

  const subject = `Document Expiry Notice - ${docType}`;
  const body = `
    ${greeting(employeeName)}
    <p style="margin:0 0 20px;font-size:14px;color:#475569;line-height:1.6">
      This is an automated notice that one of your employee documents has expired and requires renewal.
    </p>
    ${infoTable([
      ['Document Type', docType],
      ['Expiry Date',   `<span style="color:#ef4444;font-weight:700">${fmtDate(expiryDate)}</span>`],
    ])}
    <p style="margin:20px 0 0;font-size:13px;color:#ef4444;font-weight:600">
      Important: Please renew this document and submit the updated copy to HR as soon as possible.
    </p>
    ${muted('If you have already renewed this document, please provide the updated copy to your HR department.')}
  `;

  await t.transport.sendMail({
    from: t.from, to, subject,
    html: emailShell({ branding, preheader: subject, body }),
  });
}

module.exports = { sendWelcomeEmail, sendLeaveEmail, sendSchedulingInvite, sendInterviewConfirmation, buildIcs, sendCandidateStageEmail, sendEmployeeLifecycleEmail, sendDisciplinaryEmail, sendPerformanceEmail, sendDocumentExpiryEmail, notifyEnabled };
