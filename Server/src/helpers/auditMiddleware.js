// Prisma middleware that automatically writes a rich audit-log row for every model
// create / update / delete, capturing field-level before→after diffs. Registered once on the
// shared Prisma client (lib/prisma.js).
//
// Safety: ALL logging is wrapped — if anything here throws, the original write still returns
// normally (audit logging must never break an operation). Recursion is avoided because the audit
// INSERT is a raw query (no `model`), so the `!model` guard below skips it — this holds for any
// raw variant ($executeRaw / $executeRawUnsafe alike).
const { currentActor } = require('../middleware/requestContext');

// Models we never auto-audit: the audit table itself, auth/session noise, embeddings, notifications.
const SKIP_MODELS = new Set([
  'auditlogs', 'refresh_tokens', 'refreshtokens', 'sessions',
  'ai_embeddings', 'ai_messages', 'ai_attrition_scores',
  'notifications', 'model_has_permissions', 'model_has_roles', 'role_has_permissions',
]);

// Fields too large/noisy/sensitive to record in a diff.
const SKIP_FIELDS = new Set([
  'profile_imagebase64', 'signature_base64', 'profile_image', 'signature',
  'password', 'remember_token', 'token', 'content', 'meta',
  'createdAt', 'updatedAt', 'created_at', 'updated_at',
]);

const AUDIT_ACTIONS = new Set(['create', 'update', 'delete', 'upsert']);

// Friendlier module labels for the common models; falls back to a capitalised model name.
const MODULE_LABELS = {
  employee: 'Employees', users: 'Users', codeListValue: 'Code Lists', codeList: 'Code Lists',
  companyStructure: 'Company', leavetype: 'Leave', leavegroup: 'Leave', employeeleaves: 'Leave',
  performance_review: 'Performance', performance_goal: 'Performance', salarycomponent: 'Salary',
  notches: 'Salary', paygrades: 'Salary', settings: 'Settings', roles: 'Roles', permissions: 'Permissions',
};

// BigInt-safe JSON: audited rows carry BigInt ids/FKs, which JSON.stringify cannot serialise
// natively (it throws). Emit them as strings so the audit detail is never dropped.
const jsonStringifySafe = (v) => JSON.stringify(v, (_k, val) => (typeof val === 'bigint' ? val.toString() : val));

const lcFirst = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const moduleLabel = (model) => MODULE_LABELS[model] || MODULE_LABELS[lcFirst(model)] || (model.charAt(0).toUpperCase() + model.slice(1));

function norm(v) {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') { try { return JSON.stringify(v); } catch { return String(v); } }
  return String(v);
}

// Compact, audit-friendly snapshot of a record (drops skipped/huge fields).
function snapshot(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SKIP_FIELDS.has(k)) continue;
    if (typeof v === 'string' && v.length > 300) continue; // skip large blobs
    out[k] = v instanceof Date ? v.toISOString() : v;
  }
  return out;
}

function diff(before, after) {
  const changes = {};
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const k of keys) {
    if (SKIP_FIELDS.has(k)) continue;
    if (norm(before?.[k]) !== norm(after?.[k])) {
      changes[k] = { from: before?.[k] ?? null, to: after?.[k] ?? null };
    }
  }
  return changes;
}

function entityName(obj) {
  if (!obj) return null;
  if (obj.firstName || obj.lastName) return [obj.firstName, obj.lastName].filter(Boolean).join(' ').trim() || null;
  return obj.name ?? obj.title ?? obj.label ?? obj.employee_id ?? obj.username ?? null;
}

function makeAuditMiddleware(prisma) {
  return async (params, next) => {
    const { model, action } = params;
    const skip = !model || !AUDIT_ACTIONS.has(action) || SKIP_MODELS.has(String(model).toLowerCase());
    if (skip) return next(params);

    // Capture the prior state for update/delete/upsert (best-effort; needs a unique where).
    let before = null;
    if (action === 'update' || action === 'delete' || action === 'upsert') {
      try {
        const where = params.args?.where;
        if (where) before = await prisma[lcFirst(model)]?.findUnique({ where }).catch(() => null);
      } catch { /* ignore — never block the write */ }
    }

    const result = await next(params); // the real write

    try {
      const { userId, userName, ip } = currentActor();
      let details = null;
      let principal = result || before || null;

      if (action === 'create') {
        details = { created: snapshot(result) };
      } else if (action === 'delete') {
        details = { deleted: snapshot(before) };
        principal = before || result;
      } else { // update / upsert
        if (before) {
          const changes = diff(before, result);
          if (Object.keys(changes).length === 0) return result; // nothing actually changed
          details = { changes };
        } else {
          details = { created: snapshot(result) }; // upsert that inserted
        }
      }

      const entId = principal && principal.id != null ? String(principal.id) : null;
      await prisma.$executeRaw`
        INSERT INTO auditlogs (module, action, entity_id, entity_name, user_id, user_name, ip_address, details)
         VALUES (${moduleLabel(model)}, ${action}, ${entId}, ${entityName(principal)},
                 ${userId != null ? BigInt(userId) : null},
                 ${userName != null ? String(userName) : null},
                 ${ip != null ? String(ip) : null},
                 ${details != null ? jsonStringifySafe(details) : null})`;
    } catch (e) {
      console.error('[audit middleware]', e.message);
    }

    return result;
  };
}

module.exports = { makeAuditMiddleware };
