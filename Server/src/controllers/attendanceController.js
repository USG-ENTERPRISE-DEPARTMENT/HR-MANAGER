const crypto        = require('crypto');
const { prisma }    = require('../helpers/dbQueryHelper');
const { Prisma }    = require('@prisma/client'); // Prisma.sql / Prisma.join for portable dynamic SQL
const asyncHandler  = require('../middleware/asyncHandler');
const respond       = require('../helpers/respondHelper');
const { tmsg }      = require('../helpers/messageStore');
const { toBigInt, s, safeAlter } = require('../helpers/controllerHelpers');
const { logActivity, fromReq }   = require('./auditController');

// ── Schema patches (no-ops once applied) ──────────────────────────────────────
safeAlter(`ALTER TABLE attendance ADD COLUMN source_in VARCHAR(20) NULL`);
safeAlter(`ALTER TABLE attendance ADD COLUMN source_out VARCHAR(20) NULL`);
safeAlter(`ALTER TABLE attendance ADD COLUMN device_id VARCHAR(50) NULL`);
safeAlter(`ALTER TABLE attendance ADD COLUMN day_status VARCHAR(20) NULL`);
safeAlter(`ALTER TABLE attendance ADD COLUMN worked_minutes INT NULL`);
safeAlter(`ALTER TABLE attendance ADD COLUMN late_minutes INT NULL`);
safeAlter(`ALTER TABLE attendance ADD COLUMN early_leave_minutes INT NULL`);
safeAlter(`ALTER TABLE attendance ADD COLUMN overtime_minutes INT NULL`);
safeAlter(`ALTER TABLE attendance ADD COLUMN edited_by BIGINT NULL`);
safeAlter(`ALTER TABLE attendance ADD COLUMN edited_at DATETIME NULL`);
safeAlter(`ALTER TABLE attendance ADD COLUMN edit_note VARCHAR(500) NULL`);
safeAlter(`ALTER TABLE attendance ADD COLUMN map_accuracy INT NULL`);
safeAlter(`ALTER TABLE attendance ADD COLUMN map_out_accuracy INT NULL`);
safeAlter(`ALTER TABLE attendance_punches ADD COLUMN accuracy INT NULL`);
safeAlter(`ALTER TABLE attendance ADD INDEX idx_att_emp_date (employee, date)`);
safeAlter(`CREATE TABLE IF NOT EXISTS attendance_punches (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  employee BIGINT NOT NULL,
  punch_time DATETIME NOT NULL,
  direction VARCHAR(10) NULL,
  source VARCHAR(20) NOT NULL,
  device_id VARCHAR(50) NULL,
  lat DECIMAL(10,8) NULL, lng DECIMAL(11,8) NULL,
  accuracy INT NULL,
  ip VARCHAR(45) NULL,
  photo LONGTEXT NULL,
  import_batch BIGINT NULL,
  created_by BIGINT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  dedup_key VARCHAR(80) NULL,
  UNIQUE KEY uq_punch_dedup (dedup_key),
  INDEX idx_punch_emp_time (employee, punch_time)
)`);
safeAlter(`CREATE TABLE IF NOT EXISTS attendance_night_shift (
  employee BIGINT PRIMARY KEY,
  assigned_by BIGINT NULL,
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`);
safeAlter(`CREATE TABLE IF NOT EXISTS attendance_import_batches (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  file_name VARCHAR(255) NULL,
  source VARCHAR(20) DEFAULT 'csv',
  device_id VARCHAR(50) NULL,
  total_rows INT DEFAULT 0, inserted INT DEFAULT 0, duplicates INT DEFAULT 0, failed INT DEFAULT 0,
  errors TEXT NULL,
  imported_by BIGINT NULL,
  imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`);

// ── Local wall-clock time helpers ─────────────────────────────────────────────
// All DATETIME values are written/read as wall-clock strings through raw SQL.
// Never pass JS Date objects through Prisma for these columns (UTC shift),
// and never format "now" with toISOString().

const pad = n => String(n).padStart(2, '0');
const nowDateTime = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const todayStr    = () => nowDateTime().slice(0, 10);

// DATETIME read back through Prisma raw comes out as a Date the driver built in UTC;
// rendering it back with toISOString restores the original wall-clock digits.
const dtStr   = v => v == null ? null : (v instanceof Date ? v.toISOString().slice(0, 19).replace('T', ' ') : String(v).slice(0, 19).replace('T', ' '));
const dateStr = v => v == null ? null : (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const timeHM  = v => { const x = dtStr(v); return x ? x.slice(11, 16) : null; };

// Minutes since midnight from 'HH:mm[:ss]' or a 'YYYY-MM-DD HH:mm:ss' string
const toMin = v => {
  if (!v) return null;
  const m = String(v).match(/(\d{2}):(\d{2})(?::\d{2})?$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// workdays.status comes as 'Full Day' / 'Half Day' / 'Non-working Day' — normalize to enum style
const normWorkStatus = v => String(v ?? 'Full_Day').trim().replace(/[\s-]+/g, '_');

// ── Settings ──────────────────────────────────────────────────────────────────

const SETTING_DEFAULTS = {
  attendance_work_start:                '08:30',
  attendance_work_end:                  '17:00',
  attendance_grace_minutes:             '15',
  attendance_half_day_threshold_minutes:'240',
  attendance_auto_absent_enabled:       '1',
  attendance_device_api_key:            '',
  attendance_kiosk_enabled:             '0',
  attendance_kiosk_token:               '',
  attendance_kiosk_require_photo:       '0',
  attendance_web_require_location:      '0',
  attendance_web_require_photo:         '0',
  attendance_night_start:               '21:00',
  attendance_night_end:                 '06:00',
  attendance_digest_enabled:            '0',
  attendance_digest_recipients:         '',
};

async function upsertSetting(key, value) {
  await prisma.app_settings.upsert({
    where:  { setting_key: key },
    update: { setting_value: String(value) },
    create: { setting_key: key, setting_value: String(value) },
  });
}

async function getAttSettings() {
  const rows = await prisma.app_settings
    .findMany({ where: { setting_key: { startsWith: 'attendance_' } }, select: { setting_key: true, setting_value: true } })
    .catch(() => []);
  const cfg = { ...SETTING_DEFAULTS, ...Object.fromEntries(rows.map(r => [r.setting_key, r.setting_value ?? ''])) };
  // Secrets are generated lazily on first read so fresh installs work out of the box
  if (!cfg.attendance_device_api_key) {
    cfg.attendance_device_api_key = crypto.randomBytes(24).toString('hex');
    await upsertSetting('attendance_device_api_key', cfg.attendance_device_api_key);
  }
  if (!cfg.attendance_kiosk_token) {
    cfg.attendance_kiosk_token = crypto.randomBytes(24).toString('hex');
    await upsertSetting('attendance_kiosk_token', cfg.attendance_kiosk_token);
  }
  return cfg;
}

// ── Night shift ───────────────────────────────────────────────────────────────

// Employees assigned to the night shift — cached briefly since it's read on every punch
let _nightCache = { ts: 0, set: new Set() };
async function nightShiftSet() {
  if (Date.now() - _nightCache.ts < 30_000) return _nightCache.set;
  const rows = await prisma.attendance_night_shift.findMany({ select: { employee: true } }).catch(() => []);
  _nightCache = { ts: Date.now(), set: new Set(rows.map(r => String(r.employee))) };
  return _nightCache.set;
}
const invalidateNightCache = () => { _nightCache.ts = 0; };

// Night windows span midnight (e.g. 21:00 → 06:00). Punches before the cutoff
// (midpoint of the off-duty gap) belong to the shift that STARTED the previous day.
function nightWindow(cfg) {
  const start = toMin(cfg.attendance_night_start) ?? 1260;
  const end   = toMin(cfg.attendance_night_end)   ?? 360;
  const spansMidnight = start > end;
  const cutoff = spansMidnight ? Math.floor((end + start) / 2) : 0;
  return { start, end, spansMidnight, cutoff };
}

// Which attendance date a punch belongs to, given the employee's shift
function attributedDate(punchTime, isNight, cfg) {
  const date = punchTime.slice(0, 10);
  if (!isNight) return date;
  const nw = nightWindow(cfg);
  if (!nw.spansMidnight) return date;
  const punchMin = toMin(punchTime) ?? 0;
  if (punchMin < nw.cutoff) {
    const d = new Date(`${date}T00:00:00`);
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  return date;
}

// ── Day context: work week, holidays, approved leave ──────────────────────────

async function dayContext(date) {
  const weekday = WEEKDAYS[new Date(`${date}T00:00:00`).getDay()];
  const workRows = await prisma.workdays.findMany({ select: { name: true, status: true } }).catch(() => []);
  const wd = workRows.find(w => String(w.name).toLowerCase() === weekday);
  const holiday = await prisma.holidays
    .findFirst({ where: { dateh: new Date(date) }, select: { id: true, name: true, status: true } })
    .catch(() => null);
  const leaveRows = await prisma.employeeleaves.findMany({
    where: { status: 'Approved', date_start: { lte: new Date(date) }, date_end: { gte: new Date(date) } },
    distinct: ['employee'], select: { employee: true },
  }).catch(() => []);
  return {
    workStatus: normWorkStatus(wd?.status),        // Full_Day | Half_Day | Non_working_Day
    holiday:    holiday ?? null,
    onLeave:    new Set(leaveRows.map(r => String(r.employee))),
  };
}

// ── Day derivation ────────────────────────────────────────────────────────────
// Precedence: Holiday > Weekend > On_Leave > Absent > Incomplete > Half_Day > Late > Present

function deriveDay({ date, inTime, outTime, employee, ctx, cfg, isNight = false }) {
  const out = { day_status: null, worked_minutes: null, late_minutes: null, early_leave_minutes: null, overtime_minutes: null };

  const grace   = parseInt(cfg.attendance_grace_minutes, 10) || 0;
  const halfThr = parseInt(cfg.attendance_half_day_threshold_minutes, 10) || 240;

  let startMin = toMin(cfg.attendance_work_start) ?? 510;
  let endMin   = toMin(cfg.attendance_work_end)   ?? 1020;
  let inMin    = toMin(inTime);
  let outMin   = toMin(outTime);

  // Night shifts span midnight: shift times after the cutoff are "day 0",
  // times before the cutoff are "day 1" (+24h) so the arithmetic stays linear.
  const nw = nightWindow(cfg);
  if (isNight && nw.spansMidnight) {
    startMin = nw.start;
    endMin   = nw.end + 1440;
    if (inMin  != null && inMin  < nw.cutoff) inMin  += 1440;
    if (outMin != null && outMin < nw.cutoff) outMin += 1440;
  }

  if (inMin != null) {
    out.late_minutes = Math.max(0, inMin - startMin);
    if (outMin != null && outMin > inMin) {
      out.worked_minutes      = outMin - inMin;
      out.early_leave_minutes = Math.max(0, endMin - outMin);
      out.overtime_minutes    = Math.max(0, outMin - endMin);
    }
  }

  if (ctx.holiday)                              out.day_status = 'Holiday';
  else if (ctx.workStatus === 'Non_working_Day') out.day_status = 'Weekend';
  else if (ctx.onLeave.has(String(employee)))    out.day_status = 'On_Leave';
  else if (inMin == null)                        out.day_status = 'Absent';
  else if (outMin == null || outMin <= inMin)    out.day_status = 'Incomplete';
  else if (ctx.workStatus === 'Half_Day' || out.worked_minutes < halfThr) out.day_status = 'Half_Day';
  else if (inMin > startMin + grace)             out.day_status = 'Late';
  else                                           out.day_status = 'Present';

  return out;
}

async function deptName(employeeId) {
  const emp = await prisma.employee
    .findUnique({ where: { id: toBigInt(employeeId) }, select: { departmentId: true } })
    .catch(() => null);
  if (!emp?.departmentId) return '';
  const cs = await prisma.companystructures
    .findUnique({ where: { id: emp.departmentId }, select: { title: true } })
    .catch(() => null);
  return cs?.title != null ? String(cs.title) : '';
}

// ── Punch engine ──────────────────────────────────────────────────────────────

// Record a raw punch (deduped) and fold it into the daily attendance row.
// Returns { duplicate, action: 'in'|'out'|'none', record }
async function applyPunch(employeeId, punchTime, meta = {}) {
  const employee = toBigInt(employeeId);
  const cfg      = await getAttSettings();
  const isNight  = (await nightShiftSet()).has(String(employee));
  const date     = attributedDate(punchTime, isNight, cfg);
  const source   = meta.source ?? 'web';

  // Raw punch with dedup (device retries / repeated imports). Portable "insert-if-absent" via
  // INSERT … SELECT … WHERE NOT EXISTS (standard SQL on MySQL and Postgres — replaces INSERT IGNORE).
  // A rare concurrent race would hit the uq_punch_dedup constraint; treat that throw as a duplicate too.
  const dedup = crypto.createHash('sha1').update(`${employee}|${punchTime}|${meta.deviceId ?? ''}`).digest('hex');
  const inserted = await prisma.$executeRaw`
    INSERT INTO attendance_punches (employee, punch_time, direction, source, device_id, lat, lng, accuracy, ip, photo, import_batch, created_by, dedup_key)
    SELECT ${employee}, ${punchTime}, ${meta.direction ?? null}, ${source}, ${meta.deviceId ?? null},
           ${meta.lat ?? null}, ${meta.lng ?? null}, ${meta.accuracy ?? null}, ${meta.ip ?? null}, ${meta.photo ?? null},
           ${meta.importBatch ?? null}, ${meta.createdBy ?? null}, ${dedup}
    FROM (SELECT 1) AS _t
    WHERE NOT EXISTS (SELECT 1 FROM attendance_punches WHERE dedup_key = ${dedup})
  `.catch(() => 0);
  if (!inserted) return { duplicate: true, action: 'none', record: null };

  // Daily row — first-in / last-out pairing
  const [row] = await prisma.$queryRaw`
    SELECT * FROM attendance WHERE employee = ${employee} AND date = ${date} ORDER BY id ASC LIMIT 1
  `.catch(() => []);

  let recordId;
  let action;
  if (!row) {
    await prisma.$executeRaw`
      INSERT INTO attendance (employee, department, date, in_time, source_in, device_id, in_ip, map_lat, map_lng, map_accuracy, image_in, time_stamp)
      VALUES (${employee}, ${await deptName(employee)}, ${date}, ${punchTime}, ${source}, ${meta.deviceId ?? null},
              ${meta.ip ?? null}, ${meta.lat ?? null}, ${meta.lng ?? null}, ${meta.accuracy ?? null}, ${meta.photo ?? null}, NOW())`;
    const [created] = await prisma.$queryRaw`
      SELECT * FROM attendance WHERE employee = ${employee} AND date = ${date} ORDER BY id ASC LIMIT 1`;
    recordId = created.id;
    action = 'in';
  } else {
    recordId = row.id;
    const curIn = dtStr(row.in_time);
    if (!curIn || punchTime < curIn) {
      await prisma.$executeRaw`
        UPDATE attendance SET in_time = ${punchTime}, source_in = ${source}, device_id = COALESCE(${meta.deviceId ?? null}, device_id),
          in_ip = ${meta.ip ?? null}, map_lat = ${meta.lat ?? null}, map_lng = ${meta.lng ?? null},
          map_accuracy = ${meta.accuracy ?? null}, image_in = COALESCE(${meta.photo ?? null}, image_in) WHERE id = ${recordId}`;
      action = 'in';
    } else if (punchTime > curIn) {
      await prisma.$executeRaw`
        UPDATE attendance SET out_time = ${punchTime}, source_out = ${source}, device_id = COALESCE(${meta.deviceId ?? null}, device_id),
          out_ip = ${meta.ip ?? null}, map_out_lat = ${meta.lat ?? null}, map_out_lng = ${meta.lng ?? null},
          map_out_accuracy = ${meta.accuracy ?? null}, image_out = COALESCE(${meta.photo ?? null}, image_out) WHERE id = ${recordId}`;
      action = 'out';
    } else {
      action = 'none';
    }
  }

  const record = await rederive(recordId);
  return { duplicate: false, action, record };
}

// Re-derive status + minute columns for a daily row
async function rederive(recordId, ctxCache = null, cfgCache = null) {
  const [row] = await prisma.$queryRaw`SELECT * FROM attendance WHERE id = ${toBigInt(recordId)}`.catch(() => []);
  if (!row) return null;
  const date    = dateStr(row.date);
  const cfg     = cfgCache ?? await getAttSettings();
  const ctx     = ctxCache ?? await dayContext(date);
  const isNight = (await nightShiftSet()).has(String(row.employee));
  const d       = deriveDay({ date, inTime: dtStr(row.in_time), outTime: dtStr(row.out_time), employee: row.employee, ctx, cfg, isNight });
  await prisma.$executeRaw`
    UPDATE attendance SET day_status = ${d.day_status}, worked_minutes = ${d.worked_minutes}, late_minutes = ${d.late_minutes},
      early_leave_minutes = ${d.early_leave_minutes}, overtime_minutes = ${d.overtime_minutes} WHERE id = ${row.id}`;
  return { ...row, ...d };
}

function serializeRecord(r, extra = {}) {
  return {
    ...s(r),
    date:     dateStr(r.date),
    in_time:  timeHM(r.in_time),
    out_time: timeHM(r.out_time),
    edited_at: dtStr(r.edited_at),
    ...extra,
  };
}

// Resolve the calling user's employee id (web punch / personal views)
function userEmployeeId(req) {
  return toBigInt(req.user?.employeeId);
}

// Normalized staff-number map for device/import/kiosk punches.
// Devices commonly zero-pad numeric IDs — strip leading zeros when matching.
const normNo = v => String(v ?? '').trim().toLowerCase().replace(/^0+(?=\d)/, '');
async function employeeNoMap() {
  const raw = await prisma.employee
    .findMany({ where: { status: '1' }, select: { id: true, employee_id: true, firstName: true, lastName: true } })
    .catch(() => []);
  const rows = raw.map(r => ({ id: r.id, employee_id: r.employee_id, name: `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim() }));
  const map = new Map();
  for (const r of rows) {
    if (r.employee_id) map.set(normNo(r.employee_id), r);
  }
  for (const r of rows) {
    const k = normNo(r.id); // numeric DB id fallback — never overrides a real staff number
    if (!map.has(k)) map.set(k, r);
  }
  // Numeric-tail fallback for keypad entry: "3" matches EMP-00003 — only when unambiguous
  const tails = new Map();
  for (const r of rows) {
    const tail = String(r.employee_id ?? '').match(/(\d+)\s*$/)?.[1];
    if (!tail) continue;
    const k = normNo(tail);
    tails.set(k, tails.has(k) ? null : r); // null marks a collision
  }
  for (const [k, r] of tails) {
    if (r && !map.has(k)) map.set(k, r);
  }
  return map;
}

// ══════════════════════════════════════════════════════════════════════════════
// SETTINGS
// ══════════════════════════════════════════════════════════════════════════════

const EDITABLE_KEYS = [
  'attendance_work_start', 'attendance_work_end', 'attendance_grace_minutes',
  'attendance_half_day_threshold_minutes', 'attendance_auto_absent_enabled',
  'attendance_kiosk_enabled', 'attendance_kiosk_require_photo',
  'attendance_web_require_location', 'attendance_web_require_photo',
  'attendance_night_start', 'attendance_night_end',
  'attendance_digest_enabled', 'attendance_digest_recipients',
];

// GET /attendance/punch-policy — web punch rules for the clock screen (no secrets)
exports.getPunchPolicy = asyncHandler(async (req, res) => {
  const cfg = await getAttSettings();
  const employee = userEmployeeId(req);
  const isNight  = employee ? (await nightShiftSet()).has(String(employee)) : false;
  respond.ok(res, 'Punch policy', {
    require_location: cfg.attendance_web_require_location === '1',
    require_photo:    cfg.attendance_web_require_photo === '1',
    shift:            isNight ? 'night' : 'day',
    window_start:     isNight ? cfg.attendance_night_start : cfg.attendance_work_start,
    window_end:       isNight ? cfg.attendance_night_end   : cfg.attendance_work_end,
  });
});

// GET /attendance/settings
exports.getSettings = asyncHandler(async (req, res) => {
  const cfg = await getAttSettings();
  respond.ok(res, 'Attendance settings', {
    ...cfg,
    attendance_device_api_key: `••••${cfg.attendance_device_api_key.slice(-4)}`,
    attendance_kiosk_token:    cfg.attendance_kiosk_token, // needed to build the kiosk URL
  });
});

// PUT /attendance/settings
exports.updateSettings = asyncHandler(async (req, res) => {
  for (const k of EDITABLE_KEYS) {
    if (req.body[k] !== undefined) await upsertSetting(k, req.body[k]);
  }
  logActivity({ module: 'Attendance', action: 'update_settings', ...fromReq(req) });
  respond.ok(res, 'Attendance settings saved');
});

// POST /attendance/settings/regenerate-key  { target: 'device' | 'kiosk' }
exports.regenerateKey = asyncHandler(async (req, res) => {
  const target = req.body?.target === 'kiosk' ? 'kiosk' : 'device';
  const key = crypto.randomBytes(24).toString('hex');
  await upsertSetting(target === 'kiosk' ? 'attendance_kiosk_token' : 'attendance_device_api_key', key);
  logActivity({ module: 'Attendance', action: `regenerate_${target}_key`, ...fromReq(req) });
  respond.ok(res, 'Key regenerated — store it now, it will not be shown again', { key });
});

// ══════════════════════════════════════════════════════════════════════════════
// WEB PUNCH + PERSONAL VIEWS
// ══════════════════════════════════════════════════════════════════════════════

// POST /attendance/punch — clock in/out for the logged-in user
// Is clock-in currently open for the given shift? (Clock-OUT is never window-blocked
// so overtime and forgotten clock-outs can still be recorded.)
function clockInWindow(isNight, punchTime, cfg) {
  const pMin = toMin(punchTime) ?? 0;
  if (isNight) {
    const nw = nightWindow(cfg);
    const open = nw.spansMidnight
      ? (pMin >= nw.start || pMin <= nw.end)
      : (pMin >= nw.start && pMin <= nw.end);
    return { open, start: cfg.attendance_night_start, end: cfg.attendance_night_end, shift: 'night' };
  }
  const s = toMin(cfg.attendance_work_start) ?? 510;
  const e = toMin(cfg.attendance_work_end)   ?? 1020;
  return { open: pMin >= s && pMin <= e, start: cfg.attendance_work_start, end: cfg.attendance_work_end, shift: 'day' };
}

// Interactive punches (web/kiosk) are one clock-in + one clock-out per day,
// blocked while on approved leave, and clock-in is only allowed within the
// shift's working hours. Returns an error message, or null when the punch may proceed.
async function interactivePunchViolation(employee, date, punchTime, isNight, cfg) {
  const ctx = await dayContext(date);
  if (ctx.onLeave.has(String(employee))) {
    return 'You are on approved leave today — clocking in is not allowed';
  }
  const [row] = await prisma.$queryRaw`
    SELECT in_time, out_time FROM attendance WHERE employee = ${toBigInt(employee)} AND date = ${date} LIMIT 1`.catch(() => []);
  if (row?.in_time && row?.out_time) {
    return 'You have already clocked in and out today';
  }
  // This punch would be a CLOCK-IN — enforce the working-hours window
  if (!row?.in_time && punchTime && cfg) {
    const w = clockInWindow(isNight, punchTime, cfg);
    if (!w.open) {
      const pMin = toMin(punchTime) ?? 0;
      const sMin = toMin(w.start) ?? 0;
      const beforeStart = w.shift === 'day' ? pMin < sMin : false;
      return beforeStart
        ? `Working hours have not started — clock-in opens at ${w.start}`
        : `Working hours are over (${w.start} – ${w.end}) — clocking in is closed until the next ${w.shift === 'night' ? 'shift' : 'work day'}`;
    }
  }
  return null;
}

exports.punch = asyncHandler(async (req, res) => {
  const employee = userEmployeeId(req);
  if (!employee) return respond.badReq(res, 'Your account is not linked to an employee profile');

  // Double-punch guard: ignore punches within 60s of the previous one
  const [last] = await prisma.$queryRaw`
    SELECT punch_time FROM attendance_punches WHERE employee = ${employee} ORDER BY punch_time DESC LIMIT 1`.catch(() => []);
  const now = nowDateTime();
  if (last && (new Date(now).getTime() - new Date(dtStr(last.punch_time)).getTime()) < 60_000) {
    return respond.badReq(res, 'You just punched — please wait a minute before punching again');
  }

  // Night workers' punches attribute to the shift's start date (e.g. a 02:00 punch belongs to yesterday)
  const cfg     = await getAttSettings();
  const isNight = (await nightShiftSet()).has(String(employee));
  const shiftDate = attributedDate(now, isNight, cfg);
  const violation = await interactivePunchViolation(employee, shiftDate, now, isNight, cfg);
  if (violation) return respond.badReq(res, violation);

  const { lat, lng, accuracy, photo } = req.body ?? {};

  // Policy enforcement — the client blocks too, but the server is the authority
  if (cfg.attendance_web_require_location === '1' && (lat == null || lng == null)) {
    return respond.badReq(res, 'Location is required to clock in — please allow location access in your browser and try again');
  }
  if (cfg.attendance_web_require_photo === '1' && !photo) {
    return respond.badReq(res, 'A photo is required to clock in — please allow camera access and try again');
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() ?? req.socket?.remoteAddress ?? null;
  const result = await applyPunch(employee, now, {
    source: 'web',
    lat: lat != null ? parseFloat(lat) : null,
    lng: lng != null ? parseFloat(lng) : null,
    accuracy: accuracy != null ? Math.round(parseFloat(accuracy)) : null,
    ip,
    photo: photo ?? null,
  });

  respond.ok(res, result.action === 'in' ? 'Clocked in' : 'Clocked out', serializeRecord(result.record, { action: result.action }));
});

// GET /attendance/today — own record for today
exports.getToday = asyncHandler(async (req, res) => {
  const employee = userEmployeeId(req);
  if (!employee) return respond.ok(res, 'Today', null);
  const [row] = await prisma.$queryRaw`
    SELECT * FROM attendance WHERE employee = ${employee} AND date = ${todayStr()} ORDER BY id ASC LIMIT 1`.catch(() => []);
  respond.ok(res, 'Today', row ? serializeRecord(row) : null);
});

// GET /attendance/timesheet?month=YYYY-MM[&employee=ID|&personal=1]
exports.getTimesheet = asyncHandler(async (req, res) => {
  const month = String(req.query.month ?? '').match(/^\d{4}-\d{2}$/) ? req.query.month : todayStr().slice(0, 7);
  const employee = req.query.personal === '1' || !req.query.employee
    ? userEmployeeId(req)
    : toBigInt(req.query.employee);
  if (!employee) return respond.badReq(res, 'Employee is required');

  // Explicit date range wins; otherwise the full month
  const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? ''));
  const daysInMonth = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  let first = isDate(req.query.date_from) ? req.query.date_from : `${month}-01`;
  let last  = isDate(req.query.date_to)   ? req.query.date_to   : `${month}-${pad(daysInMonth)}`;
  if (last < first) [first, last] = [last, first];
  // Hard cap to keep the day-fill loop sane
  const span = Math.round((new Date(`${last}T00:00:00`) - new Date(`${first}T00:00:00`)) / 86_400_000) + 1;
  if (span > 366) return respond.badReq(res, 'Date range cannot exceed one year');
  const today = todayStr();

  const rows = await prisma.$queryRaw`
    SELECT * FROM attendance WHERE employee = ${employee} AND date BETWEEN ${first} AND ${last} ORDER BY date ASC`.catch(() => []);
  const byDate = Object.fromEntries(rows.map(r => [dateStr(r.date), r]));

  const workRows = await prisma.workdays.findMany({ select: { name: true, status: true } }).catch(() => []);
  const wdMap = Object.fromEntries(workRows.map(w => [String(w.name).toLowerCase(), normWorkStatus(w.status)]));
  const holRows = await prisma.holidays
    .findMany({ where: { dateh: { gte: new Date(first), lte: new Date(last) } }, select: { dateh: true, name: true } })
    .catch(() => []);
  const holMap = Object.fromEntries(holRows.map(h => [dateStr(h.dateh), h.name]));
  const leaveRows = await prisma.employeeleaves.findMany({
    where: { employee, status: 'Approved', date_start: { lte: new Date(last) }, date_end: { gte: new Date(first) } },
    select: { date_start: true, date_end: true },
  }).catch(() => []);

  const onLeave = d => leaveRows.some(l => dateStr(l.date_start) <= d && dateStr(l.date_end) >= d);

  const days = [];
  const totals = { worked_minutes: 0, overtime_minutes: 0, late_days: 0, present_days: 0, absent_days: 0 };
  const cursor = new Date(`${first}T00:00:00`);
  for (let i = 0; i < span; i++) {
    const d = `${cursor.getFullYear()}-${pad(cursor.getMonth() + 1)}-${pad(cursor.getDate())}`;
    cursor.setDate(cursor.getDate() + 1);
    const rec = byDate[d];
    let status = rec?.day_status ?? null;
    if (!status) {
      const weekday = WEEKDAYS[new Date(`${d}T00:00:00`).getDay()];
      if (holMap[d]) status = 'Holiday';
      else if ((wdMap[weekday] ?? 'Full_Day') === 'Non_working_Day') status = 'Weekend';
      else if (onLeave(d)) status = 'On_Leave';
      else if (d < today) status = 'Absent';
      // future days stay null
    }
    if (rec?.worked_minutes)   totals.worked_minutes   += rec.worked_minutes;
    if (rec?.overtime_minutes) totals.overtime_minutes += rec.overtime_minutes;
    if (status === 'Late') totals.late_days++;
    if (['Present', 'Late', 'Half_Day'].includes(status)) totals.present_days++;
    if (status === 'Absent') totals.absent_days++;
    days.push({
      date: d,
      status,
      holiday: holMap[d] ?? null,
      in_time:  rec ? timeHM(rec.in_time)  : null,
      out_time: rec ? timeHM(rec.out_time) : null,
      worked_minutes:   rec?.worked_minutes   ?? null,
      late_minutes:     rec?.late_minutes     ?? null,
      overtime_minutes: rec?.overtime_minutes ?? null,
      record_id: rec ? String(rec.id) : null,
    });
  }

  const emp = await prisma.employee
    .findUnique({ where: { id: employee }, select: { firstName: true, lastName: true, employee_id: true } })
    .catch(() => null);
  const empName = emp ? `${emp.firstName ?? ''} ${emp.lastName ?? ''}`.trim() : null;

  respond.ok(res, 'Timesheet', { month, date_from: first, date_to: last, employee: String(employee), employee_name: empName, employee_no: emp?.employee_id ?? null, days, totals });
});

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN LOG / SUMMARY / PUNCHES
// ══════════════════════════════════════════════════════════════════════════════

async function queryDailyLog(q) {
  const from = q.date_from || todayStr();
  const to   = q.date_to   || from;
  // Portable dynamic WHERE via Prisma.sql fragments (correct placeholders per provider).
  const conds = [Prisma.sql`a.date BETWEEN ${from} AND ${to}`];
  if (q.employee)   conds.push(Prisma.sql`a.employee = ${toBigInt(q.employee)}`);
  if (q.status)     conds.push(Prisma.sql`a.day_status = ${String(q.status)}`);
  if (q.department) conds.push(Prisma.sql`e.departmentId = ${toBigInt(q.department)}`);
  if (q.supervisor) conds.push(Prisma.sql`e.supervisorId = ${toBigInt(q.supervisor)}`);
  const where = Prisma.join(conds, ' AND ');
  // Photos and map snapshots are LongText — excluded here, fetched per record via /attendance/:id/photos.
  // has_photo_in/out flags let the client show a camera indicator without the payload.
  return prisma.$queryRaw`
    SELECT a.id, a.employee, a.department, a.date, a.in_time, a.out_time, a.note,
           a.map_lat, a.map_lng, a.map_accuracy, a.map_out_lat, a.map_out_lng, a.map_out_accuracy, a.in_ip, a.out_ip,
           a.source_in, a.source_out, a.device_id, a.day_status,
           a.worked_minutes, a.late_minutes, a.early_leave_minutes, a.overtime_minutes,
           a.edited_by, a.edited_at, a.edit_note,
           (a.image_in  IS NOT NULL AND a.image_in  != '') AS has_photo_in,
           (a.image_out IS NOT NULL AND a.image_out != '') AS has_photo_out,
           TRIM(CONCAT_WS(' ', e.firstName, e.lastName)) AS employee_name, e.employee_id AS employee_no,
           cs.title AS department_name
    FROM attendance a
    LEFT JOIN employee e ON e.id = a.employee
    LEFT JOIN companystructures cs ON cs.id = e.departmentId
    WHERE ${where}
    ORDER BY a.date DESC, employee_name ASC`.catch(() => []);
}

// GET /attendance/:id/photos — clock-in/out photos for one record (heavy base64, fetched on demand)
exports.getRecordPhotos = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  const [row] = await prisma.$queryRaw`SELECT image_in, image_out FROM attendance WHERE id = ${id}`.catch(() => []);
  if (!row) return respond.notFound(res, 'Record not found');
  respond.ok(res, 'Punch photos', { image_in: row.image_in ?? null, image_out: row.image_out ?? null });
});

// GET /attendance?date_from&date_to&employee&status&department
exports.getDailyLog = asyncHandler(async (req, res) => {
  const rows = await queryDailyLog(req.query);
  respond.ok(res, 'Attendance log', rows.map(r => serializeRecord(r, {
    employee_name:   r.employee_name ?? null,
    employee_no:     r.employee_no ?? null,
    department_name: r.department_name != null ? String(r.department_name) : null,
  })));
});

// GET /attendance/subordinates?date_from&date_to&status — direct reports of the calling supervisor
exports.getSubordinateLog = asyncHandler(async (req, res) => {
  const me = userEmployeeId(req);
  if (!me) return respond.ok(res, 'Subordinate attendance', []);
  const rows = await queryDailyLog({ ...req.query, supervisor: me, employee: undefined, department: undefined });
  respond.ok(res, 'Subordinate attendance', rows.map(r => serializeRecord(r, {
    employee_name:   r.employee_name ?? null,
    employee_no:     r.employee_no ?? null,
    department_name: r.department_name != null ? String(r.department_name) : null,
  })));
});

// GET /attendance/summary?date_from&date_to
exports.getSummary = asyncHandler(async (req, res) => {
  const from = req.query.date_from || todayStr();
  const to   = req.query.date_to   || from;
  const grp = await prisma.attendance.groupBy({
    by: ['date', 'day_status'],
    where: { date: { gte: new Date(from), lte: new Date(to) } },
    _count: { _all: true },
  }).catch(() => []);
  // Headcount = approved, active workforce only — same population the Employees page shows
  const hc = await prisma.employee
    .count({ where: { lifecycleStatus: 'ACTIVE', approvalStatus: 'APPROVED' } })
    .catch(() => 0);

  const byDate = {};
  const totals = {};
  for (const r of grp) {
    const d = dateStr(r.date);
    const key = r.day_status ?? 'Unknown';
    const cnt = Number(r._count._all);
    if (!byDate[d]) byDate[d] = {};
    byDate[d][key] = cnt;
    totals[key] = (totals[key] ?? 0) + cnt;
  }
  respond.ok(res, 'Attendance summary', { date_from: from, date_to: to, headcount: Number(hc), days: byDate, totals });
});

// GET /attendance/punches?date&employee
exports.getPunches = asyncHandler(async (req, res) => {
  const date = req.query.date || todayStr();
  const conds = [Prisma.sql`p.punch_time BETWEEN ${`${date} 00:00:00`} AND ${`${date} 23:59:59`}`];
  if (req.query.employee) conds.push(Prisma.sql`p.employee = ${toBigInt(req.query.employee)}`);
  const where = Prisma.join(conds, ' AND ');
  const rows = await prisma.$queryRaw`
    SELECT p.id, p.employee, p.punch_time, p.direction, p.source, p.device_id, p.lat, p.lng, p.ip, p.import_batch,
           TRIM(CONCAT_WS(' ', e.firstName, e.lastName)) AS employee_name, e.employee_id AS employee_no
    FROM attendance_punches p LEFT JOIN employee e ON e.id = p.employee
    WHERE ${where} ORDER BY p.punch_time DESC LIMIT 500`.catch(() => []);
  respond.ok(res, 'Punches', rows.map(r => ({ ...s(r), punch_time: dtStr(r.punch_time) })));
});

// ══════════════════════════════════════════════════════════════════════════════
// MANUAL ENTRY / CORRECTION / VOID
// ══════════════════════════════════════════════════════════════════════════════

// POST /attendance/manual  { employee, date, in_time 'HH:mm', out_time 'HH:mm', note }
exports.manualEntry = asyncHandler(async (req, res) => {
  const { employee, date, in_time, out_time, note } = req.body ?? {};
  if (!toBigInt(employee)) return respond.badReq(res, 'Employee is required');
  if (!date)               return respond.badReq(res, 'Date is required');
  if (!in_time)            return respond.badReq(res, 'In time is required');

  const emp = toBigInt(employee);
  const [existing] = await prisma.$queryRaw`
    SELECT id FROM attendance WHERE employee = ${emp} AND date = ${date} LIMIT 1`.catch(() => []);
  if (existing) return respond.badReq(res, 'A record already exists for this employee on this date — edit it instead');

  await prisma.$executeRaw`
    INSERT INTO attendance (employee, department, date, in_time, out_time, source_in, source_out, note, edited_by, edited_at, time_stamp)
    VALUES (${emp}, ${await deptName(emp)}, ${date}, ${`${date} ${in_time}:00`}, ${out_time ? `${date} ${out_time}:00` : null},
            'manual', ${out_time ? 'manual' : null}, ${note ? String(note).trim() : null}, ${toBigInt(req.user?.id)}, ${nowDateTime()}, NOW())`;
  const [row] = await prisma.$queryRaw`SELECT * FROM attendance WHERE employee = ${emp} AND date = ${date} LIMIT 1`;
  const record = await rederive(row.id);

  logActivity({ module: 'Attendance', action: 'manual_entry', entityId: String(row.id), entityName: `${date} emp ${employee}`, details: `in ${in_time} out ${out_time ?? '—'}`, ...fromReq(req) });
  respond.created(res, 'Attendance recorded', serializeRecord(record));
});

// PUT /attendance/:id  { in_time?, out_time?, note?, edit_note }
exports.updateRecord = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  const [row] = await prisma.$queryRaw`SELECT * FROM attendance WHERE id = ${id}`.catch(() => []);
  if (!row) return respond.notFound(res, 'Record not found');

  const date = dateStr(row.date);
  const { in_time, out_time, note, edit_note } = req.body ?? {};
  const before = `in ${timeHM(row.in_time) ?? '—'} out ${timeHM(row.out_time) ?? '—'}`;

  // Portable dynamic SET list via Prisma.sql fragments.
  const sets = [];
  if (in_time !== undefined && in_time) {
    sets.push(Prisma.sql`in_time = ${`${date} ${in_time}:00`}`, Prisma.sql`source_in = 'manual'`);
  }
  if (out_time !== undefined) {
    sets.push(Prisma.sql`out_time = ${out_time ? `${date} ${out_time}:00` : null}`, Prisma.sql`source_out = 'manual'`);
  }
  if (note !== undefined) {
    sets.push(Prisma.sql`note = ${note ? String(note).trim() : null}`);
  }
  sets.push(
    Prisma.sql`edited_by = ${toBigInt(req.user?.id)}`,
    Prisma.sql`edited_at = ${nowDateTime()}`,
    Prisma.sql`edit_note = ${edit_note ? String(edit_note).trim() : null}`,
  );
  await prisma.$executeRaw`UPDATE attendance SET ${Prisma.join(sets, ', ')} WHERE id = ${id}`;

  const record = await rederive(id);
  const after = `in ${timeHM(record.in_time) ?? '—'} out ${timeHM(record.out_time) ?? '—'}`;
  logActivity({ module: 'Attendance', action: 'correction', entityId: String(id), entityName: date, details: `${before} → ${after}`, ...fromReq(req) });
  respond.ok(res, 'Record updated', serializeRecord(record));
});

// DELETE /attendance/:id — void a record
exports.deleteRecord = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  const [row] = await prisma.$queryRaw`SELECT * FROM attendance WHERE id = ${id}`.catch(() => []);
  if (!row) return respond.notFound(res, 'Record not found');
  await prisma.attendance.deleteMany({ where: { id } });
  logActivity({ module: 'Attendance', action: 'void_record', entityId: String(id), entityName: `${dateStr(row.date)} emp ${row.employee}`, ...fromReq(req) });
  respond.ok(res, 'Record voided');
});

// ══════════════════════════════════════════════════════════════════════════════
// DEVICE SYNC (public, x-api-key) + CSV IMPORT
// ══════════════════════════════════════════════════════════════════════════════

async function ingestPunches(punches, { source, deviceId, fileName, createdBy }) {
  const map = await employeeNoMap();
  let inserted = 0, duplicates = 0, failed = 0;
  const errors = [];
  const unmatched = [];

  // Pre-create the batch so punch rows can reference it
  const batch = await prisma.attendance_import_batches.create({
    data: { file_name: fileName ?? null, source, device_id: deviceId ?? null, total_rows: punches.length, imported_by: createdBy ?? null },
    select: { id: true },
  });
  const batchId = batch.id;

  for (const p of punches) {
    try {
      const emp = map.get(normNo(p.employee_no));
      if (!emp) {
        failed++;
        if (!unmatched.includes(String(p.employee_no))) unmatched.push(String(p.employee_no));
        errors.push(`No employee matches "${p.employee_no}"`);
        continue;
      }
      const time = String(p.time).trim().replace('T', ' ').slice(0, 19);
      if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(time)) {
        failed++;
        errors.push(`Bad time "${p.time}" for ${p.employee_no}`);
        continue;
      }
      const full = time.length === 16 ? `${time}:00` : time;
      const r = await applyPunch(emp.id, full, {
        source: source === 'device_api' ? 'biometric' : 'import',
        direction: p.direction ?? null,
        deviceId: deviceId ?? null,
        importBatch: batchId,
        createdBy: createdBy ?? null,
      });
      if (r.duplicate) duplicates++; else inserted++;
    } catch (err) {
      failed++;
      errors.push(`${p.employee_no ?? '?'}: ${err.message}`);
    }
  }

  await prisma.attendance_import_batches.updateMany({
    where: { id: batchId },
    data: { inserted, duplicates, failed, errors: errors.length ? errors.slice(0, 200).join('\n') : null },
  });
  return { batch_id: String(batchId), total: punches.length, inserted, duplicates, failed, unmatched, errors: errors.slice(0, 50) };
}

// POST /public/attendance/device-sync — biometric device SDK push (x-api-key auth)
exports.deviceSync = asyncHandler(async (req, res) => {
  const cfg = await getAttSettings();
  const key = req.headers['x-api-key'];
  if (!key || key !== cfg.attendance_device_api_key) {
    return res.status(401).json({ status: '401', message: 'Invalid API key' });
  }
  const { device_id, punches } = req.body ?? {};
  if (!Array.isArray(punches) || punches.length === 0) return respond.badReq(res, 'punches array is required');
  if (punches.length > 5000) return respond.badReq(res, 'Maximum 5000 punches per request');

  const result = await ingestPunches(punches, { source: 'device_api', deviceId: device_id ?? null });
  logActivity({ module: 'Attendance', action: 'device_sync', entityName: device_id ?? 'unknown device', details: `inserted ${result.inserted}, duplicates ${result.duplicates}, failed ${result.failed}` });
  respond.ok(res, 'Sync processed', result);
});

// POST /attendance/import — CSV upload (employee_no,date,time[,direction] or employee_no,datetime[,direction])
exports.importCsv = asyncHandler(async (req, res) => {
  if (!req.file?.buffer) return respond.badReq(res, 'CSV file is required (field name "file")');

  const text = req.file.buffer.toString('utf8');
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return respond.badReq(res, 'File is empty');

  // Skip a header row if the first cell isn't data-like
  const start = /employee/i.test(lines[0]) ? 1 : 0;
  const punches = [];
  for (let i = start; i < lines.length; i++) {
    const cells = lines[i].split(/[,;\t]/).map(c => c.trim().replace(/^"|"$/g, ''));
    if (cells.length < 2) continue;
    if (cells.length >= 3 && /^\d{4}-\d{2}-\d{2}$/.test(cells[1])) {
      punches.push({ employee_no: cells[0], time: `${cells[1]} ${cells[2]}`, direction: cells[3] || null });
    } else {
      punches.push({ employee_no: cells[0], time: cells[1], direction: cells[2] || null });
    }
  }
  if (!punches.length) return respond.badReq(res, 'No data rows found — expected employee_no,date,time or employee_no,datetime');

  const result = await ingestPunches(punches, {
    source: 'csv',
    fileName: req.file.originalname,
    createdBy: toBigInt(req.user?.id),
  });
  logActivity({ module: 'Attendance', action: 'csv_import', entityName: req.file.originalname, details: `inserted ${result.inserted}, duplicates ${result.duplicates}, failed ${result.failed}`, ...fromReq(req) });
  respond.ok(res, 'Import processed', result);
});

// GET /attendance/import/batches
exports.getImportBatches = asyncHandler(async (req, res) => {
  const rows = await prisma.$queryRaw`
    SELECT b.*, u.username AS imported_by_name FROM attendance_import_batches b
    LEFT JOIN users u ON u.id = b.imported_by
    ORDER BY b.id DESC LIMIT 100`.catch(() => []);
  respond.ok(res, 'Import batches', rows.map(r => ({ ...s(r), imported_at: dtStr(r.imported_at) })));
});

// ══════════════════════════════════════════════════════════════════════════════
// KIOSK (public, token auth)
// ══════════════════════════════════════════════════════════════════════════════

async function kioskGuard(req, res) {
  const cfg = await getAttSettings();
  if (cfg.attendance_kiosk_enabled !== '1' || req.params.token !== cfg.attendance_kiosk_token) {
    res.status(404).json({ status: '404', message: 'Kiosk is not available' });
    return null;
  }
  return cfg;
}

// GET /public/attendance/kiosk/:token/meta
exports.kioskMeta = asyncHandler(async (req, res) => {
  const cfg = await kioskGuard(req, res);
  if (!cfg) return;
  const companyRow = await prisma.app_settings
    .findFirst({ where: { setting_key: 'payslip_company_name' }, select: { setting_value: true } })
    .catch(() => null);
  const company = companyRow?.setting_value ?? 'Attendance Kiosk';
  respond.ok(res, 'Kiosk', { company, require_photo: cfg.attendance_kiosk_require_photo === '1' });
});

// GET /public/attendance/kiosk/:token/lookup/:staffId
exports.kioskLookup = asyncHandler(async (req, res) => {
  const cfg = await kioskGuard(req, res);
  if (!cfg) return;
  const map = await employeeNoMap();
  const emp = map.get(normNo(req.params.staffId));
  if (!emp) return respond.notFound(res, 'No employee matches that staff ID');
  const [today] = await prisma.$queryRaw`
    SELECT in_time, out_time FROM attendance WHERE employee = ${emp.id} AND date = ${todayStr()} LIMIT 1`.catch(() => []);
  const photoRow = await prisma.employee
    .findUnique({ where: { id: emp.id }, select: { profile_imagebase64: true } })
    .catch(() => null);
  respond.ok(res, 'Employee', {
    employee_no: emp.employee_id,
    name: emp.name,
    photo: photoRow?.profile_imagebase64 ?? null,
    today_in:  today ? timeHM(today.in_time)  : null,
    today_out: today ? timeHM(today.out_time) : null,
  });
});

// POST /public/attendance/kiosk/:token/punch  { employee_no, photo? }
exports.kioskPunch = asyncHandler(async (req, res) => {
  const cfg = await kioskGuard(req, res);
  if (!cfg) return;
  const { employee_no, photo } = req.body ?? {};
  const map = await employeeNoMap();
  const emp = map.get(normNo(employee_no));
  if (!emp) return respond.notFound(res, 'No employee matches that staff ID');
  if (cfg.attendance_kiosk_require_photo === '1' && !photo) return respond.badReq(res, 'Photo is required');

  const kioskNow      = nowDateTime();
  const kioskIsNight  = (await nightShiftSet()).has(String(emp.id));
  const kioskShiftDate = attributedDate(kioskNow, kioskIsNight, cfg);
  const violation = await interactivePunchViolation(emp.id, kioskShiftDate, kioskNow, kioskIsNight, cfg);
  if (violation) {
    return respond.badReq(res, violation.startsWith('You are on approved leave')
      ? `${emp.name} is on approved leave today — clocking in is not allowed`
      : violation.startsWith('You have already')
        ? `${emp.name} has already clocked in and out today`
        : violation);
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() ?? req.socket?.remoteAddress ?? null;
  const result = await applyPunch(emp.id, nowDateTime(), { source: 'kiosk', ip, photo: photo ?? null });
  respond.ok(res, result.action === 'in' ? `Welcome, ${emp.name}!` : `Goodbye, ${emp.name}!`, {
    name: emp.name,
    action: result.action,
    record: serializeRecord(result.record),
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// EXPORT / RECOMPUTE / CRON
// ══════════════════════════════════════════════════════════════════════════════

// GET /attendance/export?date_from&date_to&employee&status&department — CSV download
exports.exportCsv = asyncHandler(async (req, res) => {
  const rows = await queryDailyLog(req.query);
  const esc = v => v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  const header = 'Date,Employee No,Employee,Department,Status,In,Out,Worked (min),Late (min),Early Leave (min),Overtime (min),Source In,Source Out,Note';
  const lines = rows.map(r => [
    dateStr(r.date), r.employee_no, r.employee_name, r.department_name, r.day_status,
    timeHM(r.in_time), timeHM(r.out_time), r.worked_minutes, r.late_minutes,
    r.early_leave_minutes, r.overtime_minutes, r.source_in, r.source_out, r.note,
  ].map(esc).join(','));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="attendance_${req.query.date_from ?? todayStr()}_${req.query.date_to ?? todayStr()}.csv"`);
  res.send([header, ...lines].join('\n'));
});

// POST /attendance/recompute  { date_from, date_to } — re-pair from punches + re-derive
exports.recompute = asyncHandler(async (req, res) => {
  const from = req.body?.date_from || todayStr();
  const to   = req.body?.date_to   || from;
  const cfg  = await getAttSettings();

  const rows = await prisma.$queryRaw`SELECT * FROM attendance WHERE date BETWEEN ${from} AND ${to}`.catch(() => []);

  const ctxByDate = {};
  let updated = 0;
  for (const row of rows) {
    const d = dateStr(row.date);
    if (!d) continue;
    if (!ctxByDate[d]) ctxByDate[d] = await dayContext(d);

    // Re-pair from raw punches when any exist for this employee/day
    const [agg] = await prisma.$queryRaw`
      SELECT MIN(punch_time) AS first_in, MAX(punch_time) AS last_out, COUNT(*) AS cnt
      FROM attendance_punches WHERE employee = ${row.employee} AND punch_time BETWEEN ${`${d} 00:00:00`} AND ${`${d} 23:59:59`}`.catch(() => []);
    if (agg && Number(agg.cnt) > 0) {
      const firstIn = dtStr(agg.first_in);
      const lastOut = dtStr(agg.last_out);
      await prisma.$executeRaw`UPDATE attendance SET in_time = ${firstIn}, out_time = ${lastOut > firstIn ? lastOut : null} WHERE id = ${row.id}`;
    }
    await rederive(row.id, ctxByDate[d], cfg);
    updated++;
  }
  logActivity({ module: 'Attendance', action: 'recompute', details: `${from} → ${to}, ${updated} records`, ...fromReq(req) });
  respond.ok(res, tmsg('attendance.recomputed', { count: updated }), { updated });
});

// Cron: mark absentees for a date (default today). Skips weekends, holidays, approved leave.
// Mark Absent for a given date, restricted to day OR night workers.
// Idempotent — employees who already have a record for that date are skipped,
// and a late punch self-heals the row (applyPunch fills in_time and re-derives).
async function markAbsentees(date, group /* 'day' | 'night' */) {
  const ctx = await dayContext(date);
  if (ctx.holiday || ctx.workStatus === 'Non_working_Day') return 0;

  const night = await nightShiftSet();
  // Active employees with NO attendance row yet for this date (anti-join — standard SQL, portable).
  const employees = await prisma.$queryRaw`
    SELECT e.id, cs.title AS dept FROM employee e
    LEFT JOIN companystructures cs ON cs.id = e.departmentId
    WHERE e.lifecycleStatus = 'ACTIVE' AND e.approvalStatus = 'APPROVED'
      AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.employee = e.id AND a.date = ${date})`.catch(() => []);

  let marked = 0;
  for (const e of employees) {
    const isNight = night.has(String(e.id));
    if (group === 'day' ? isNight : !isNight) continue;
    if (ctx.onLeave.has(String(e.id))) continue;
    await prisma.attendance.create({
      data: { employee: e.id, department: e.dept != null ? String(e.dept) : '', date: new Date(date), day_status: 'Absent' },
    });
    marked++;
  }
  if (marked) console.log(`[cron] Attendance auto-absent (${group}) for ${date}: ${marked} marked`);
  return marked;
}

// Sweep — runs every 15 minutes. Marks day workers absent once the day closing
// time has passed, and night workers absent for YESTERDAY's shift once the
// night closing time has passed the following morning.
exports.runAutoAbsentSweep = async () => {
  const cfg = await getAttSettings();
  if (cfg.attendance_auto_absent_enabled !== '1') return { skipped: 'disabled' };

  const now    = nowDateTime();
  const nowMin = toMin(now) ?? 0;
  const today  = now.slice(0, 10);
  const y      = new Date(`${today}T00:00:00`); y.setDate(y.getDate() - 1);
  const yesterday = `${y.getFullYear()}-${pad(y.getMonth() + 1)}-${pad(y.getDate())}`;

  const result = { day: 0, night: 0 };

  // Day workers — after the day closing time
  const dayEnd = toMin(cfg.attendance_work_end) ?? 1020;
  if (nowMin >= dayEnd) result.day = await markAbsentees(today, 'day');

  // Night workers — after the night closing time, for the shift that started yesterday
  const nw = nightWindow(cfg);
  if (nw.spansMidnight) {
    if (nowMin >= nw.end && nowMin < nw.start) result.night = await markAbsentees(yesterday, 'night');
  } else if (nowMin >= nw.end) {
    result.night = await markAbsentees(today, 'night');
  }

  return result;
};

// Kept for manual/backfill use — marks day workers for an explicit date
exports.runAutoAbsent = async (date = null) => {
  const cfg = await getAttSettings();
  if (cfg.attendance_auto_absent_enabled !== '1') return { skipped: 'disabled' };
  const d = date ?? todayStr();
  const marked = await markAbsentees(d, 'day');
  return { date: d, marked };
};

// ══════════════════════════════════════════════════════════════════════════════
// NIGHT SHIFT ASSIGNMENT
// ══════════════════════════════════════════════════════════════════════════════

// GET /attendance/night-shift — employees currently assigned to the night shift
exports.getNightShift = asyncHandler(async (req, res) => {
  const rows = await prisma.$queryRaw`
    SELECT ns.employee, ns.assigned_at,
           TRIM(CONCAT_WS(' ', e.firstName, e.lastName)) AS name, e.employee_id AS employee_no
    FROM attendance_night_shift ns
    LEFT JOIN employee e ON e.id = ns.employee
    ORDER BY name ASC`.catch(() => []);
  respond.ok(res, 'Night shift employees', rows.map(r => ({
    employee:    String(r.employee),
    name:        r.name ?? null,
    employee_no: r.employee_no ?? null,
    assigned_at: dtStr(r.assigned_at),
  })));
});

// POST /attendance/night-shift  { employees: [ids] } — add employees to the night shift
exports.addNightShift = asyncHandler(async (req, res) => {
  const ids = Array.isArray(req.body?.employees) ? req.body.employees.map(toBigInt).filter(Boolean) : [];
  if (!ids.length) return respond.badReq(res, 'Select at least one employee');
  const assignedBy = toBigInt(req.user?.id);
  // INSERT IGNORE (employee is the PK) → createMany skipDuplicates (portable, returns inserted count).
  const { count: added } = await prisma.attendance_night_shift.createMany({
    data: ids.map(id => ({ employee: id, assigned_by: assignedBy })),
    skipDuplicates: true,
  });
  invalidateNightCache();
  logActivity({ module: 'Attendance', action: 'night_shift_add', details: `${added} employee(s) added to night shift`, ...fromReq(req) });
  respond.ok(res, tmsg('attendance.night_shift_added', { count: added }), { added });
});

// DELETE /attendance/night-shift/:employee — remove one employee from the night shift
exports.removeNightShift = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.employee);
  if (!id) return respond.badReq(res, 'Invalid employee');
  await prisma.attendance_night_shift.deleteMany({ where: { employee: id } });
  invalidateNightCache();
  logActivity({ module: 'Attendance', action: 'night_shift_remove', entityId: String(id), ...fromReq(req) });
  respond.ok(res, 'Removed from night shift');
});

// Cron: email yesterday's summary digest (uses email_% SMTP settings)
exports.runDailyDigest = async () => {
  const cfg = await getAttSettings();
  if (cfg.attendance_digest_enabled !== '1' || !cfg.attendance_digest_recipients.trim()) return { skipped: 'disabled' };

  const { notifyEnabled } = require('../helpers/emailHelper');
  if (!(await notifyEnabled('attendance'))) return { skipped: 'notifications off' };

  const y = new Date(); y.setDate(y.getDate() - 1);
  const d = `${y.getFullYear()}-${pad(y.getMonth() + 1)}-${pad(y.getDate())}`;

  const grp = await prisma.attendance
    .groupBy({ by: ['day_status'], where: { date: new Date(d) }, _count: { _all: true } })
    .catch(() => []);
  if (!grp.length) return { skipped: 'no data' };
  const rows = grp.map(r => ({ day_status: r.day_status, cnt: Number(r._count._all) }));

  const smtp = await prisma.app_settings
    .findMany({ where: { setting_key: { startsWith: 'email_' } }, select: { setting_key: true, setting_value: true } })
    .catch(() => []);
  const db = Object.fromEntries(smtp.map(r => [r.setting_key, r.setting_value ?? '']));
  if (db.email_enabled !== 'true' && db.email_enabled !== '1') return { skipped: 'email disabled' };

  const nodemailer = require('nodemailer');
  const transport = nodemailer.createTransport({
    host: db.email_smtp_host, port: Number(db.email_smtp_port || 587),
    secure: db.email_smtp_secure === 'true',
    auth: { user: db.email_smtp_user, pass: db.email_smtp_pass },
  });
  const table = rows.map(r => `<tr><td style="padding:6px 14px;border-bottom:1px solid #e5edf6">${r.day_status ?? '—'}</td><td style="padding:6px 14px;border-bottom:1px solid #e5edf6;text-align:right;font-weight:700">${Number(r.cnt)}</td></tr>`).join('');
  await transport.sendMail({
    from: db.email_from || db.email_smtp_user,
    to: cfg.attendance_digest_recipients,
    subject: `Attendance summary — ${d}`,
    html: `<div style="font-family:Segoe UI,Arial,sans-serif"><h2 style="color:#0f172a">Attendance summary for ${d}</h2><table style="border-collapse:collapse;border:1px solid #e5edf6;border-radius:8px">${table}</table></div>`,
  });
  console.log(`[cron] Attendance digest sent for ${d}`);
  return { date: d, sent: true };
};
