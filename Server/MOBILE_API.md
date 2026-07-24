# Mobile Self-Service API

Endpoints for the staff mobile app: an employee's own leave, payslips, attendance, medical claims,
training, documents and notifications, plus supervisor approvals for direct reports.

Base URL: `http://<your-host>:3088/v1/api/hr/me`
(or `https://<your-host>:3443/...` once TLS is configured — see [TLS / HTTPS setup](#tls--https-setup))

---

## Interactive reference

Browsable API docs are served by the API itself, no login required:

```
http://<your-host>:3088/v1/api/hr/me/docs/
```

Also linked from *Settings → Mobile API* in the web app. The raw OpenAPI 3 spec is at
`/v1/api/hr/me/docs/openapi.json` if you want to generate a client from it.

---

## ⚠️ Security model — read this first

Every request carries a **shared API key** plus the **employee** the caller claims to be:

```
x-api-key:     <the key from Settings → Mobile API>
x-employee-id: EMP-2026-0012        # or the numeric id, e.g. 12
```

`x-employee-id` accepts **either** the numeric database id (`12`) or the staff-facing employee code
(`EMP-2026-0012`) — use whichever the app has. The code is what appears on an employee's record, so
it is usually the convenient one.

**The employee id is not verified against the key.** Any holder of the key can pass any employee id
and receive that employee's salary, payslips, medical claims and personal data. The key ships inside
the APK and can be extracted from it.

This is a deliberate, accepted trade-off — not a defect — but it has consequences you must respect:

- **Use HTTPS** (see below). Over plain HTTP the key and every payload are readable by anyone on the
  network, which makes the key public in practice and rotation pointless.
- **Rotate the key** from *Settings → Mobile API* if a build leaks or a device is compromised.
  Rotating invalidates every installed copy of the app until it ships the new key.
- **Do not expose this API to the public internet** unless you accept that the key is effectively
  public. Prefer VPN or an IP-allowlisted reverse proxy.
- Every call is written to the audit log (`module = MobileAPI`) with the employee id and source IP.
  Review it if misuse is suspected — it is the only forensic record of who read what.

If the app is ever published to a public app store, replace this with per-user tokens.

**Rate limit:** 120 requests/minute per IP. Over the limit returns `429` with a `Retry-After` header.

---

## TLS / HTTPS setup

The server listens on **HTTP by default**, and additionally on HTTPS when a certificate is
configured. You do not need a domain name, a certificate authority, or any spend — a self-signed
certificate encrypts the connection, which is the part that matters here.

> **Why bother without a public domain?** The whole security model rests on the API key being
> secret. On plain HTTP it is sent as readable text with every request, so anyone able to watch the
> network — a coworker on the same Wi-Fi, a guest, anyone between the phone and the server — can
> lift it along with the payslips and medical records it returns. Encrypting the connection is what
> makes the key a secret at all.

**1. Generate a certificate** (from `Server/`):

```bash
npm run cert:generate
# include the LAN IP / hostname phones will actually dial:
npm run cert:generate -- 192.168.1.50 hr.local
```

Every host the app connects to must be listed, or clients reject the certificate. Files are written
to `Server/certs/` and are git-ignored — generate them per machine, never commit the private key.

**2. Point the server at them** in `Server/.env.development` (or `.env.production`):

```dotenv
HTTPS_KEY=./certs/server.key
HTTPS_CERT=./certs/server.crt
HTTPS_PORT=3443
```

**3. Restart.** The log shows both listeners:

```
🚀 Server running on port 3088
🔒 HTTPS running on port 3443
```

HTTP keeps working on its original port, so the web app and any internal integrations are
unaffected. Point only the mobile app at the HTTPS port.

**4. Trust the certificate in the mobile app.** Because it is self-signed, clients reject it until
told to trust it — that rejection is the security check working, so do **not** disable certificate
validation wholesale to get around it. Instead bundle `server.crt` in the app and pin it (Android:
`network_security_config.xml`; iOS: `URLSessionDelegate` / ATS exception scoped to your host).
Pinning is actually *stronger* than a public CA certificate, since only your certificate is accepted.

The certificate is valid for 825 days. `npm run cert:generate` refuses to overwrite an existing one —
delete `Server/certs/` first, and remember that every pinned app must ship the replacement.

---

## Response shape

Every response is JSON:

```json
{ "status": "200", "message": "Leaves", "data": [ ... ] }
```

| Code | Meaning |
|------|---------|
| 200 / 201 | Success |
| 400 | Missing or invalid input (e.g. no `x-employee-id`) |
| 401 | Missing or invalid API key |
| 403 | Employee record inactive, or not the supervisor for an approval |
| 404 | Record not found, or not owned by this employee |
| 429 | Rate limited |

---

## Endpoints

### Identity

| Method | Path | Notes |
|---|---|---|
| GET | `/me/whoami` | Validates the key + employee id. Returns id, code, name, supervisor id. |

### Profile

| Method | Path | Notes |
|---|---|---|
| GET | `/me/profile` | Full employee record. |
| PUT | `/me/profile` | Editable fields only: `phone`, `personal_email`, `address`, `residential_address`, `city`, `country`. Other keys are ignored, not rejected. |

### Leave

| Method | Path | Notes |
|---|---|---|
| GET | `/me/leave` | Own leave history. `?status=`, `?date_start=`, `?date_end=`. |
| POST | `/me/leave` | Apply. Requires `leave_type`, `leave_period`, `date_start`, `date_end`. |
| GET | `/me/leave/types` | Available leave types. |
| GET | `/me/leave/balance` | Entitlement, taken, remaining. |
| PUT | `/me/leave/:id` | Edit own draft. |
| DELETE | `/me/leave/:id` | Delete own draft. |
| POST | `/me/leave/:id/submit` | Submit for approval. |
| POST | `/me/leave/:id/cancel` | Cancel. |

```bash
curl -X POST http://host:3088/v1/api/hr/me/leave \
  -H "x-api-key: $KEY" -H "x-employee-id: EMP-2026-0012" \
  -H "Content-Type: application/json" \
  -d '{"leave_type":"3","leave_period":"1","date_start":"2026-08-03","date_end":"2026-08-07","details":"Family visit"}'
```

### Payslips

| Method | Path | Notes |
|---|---|---|
| GET | `/me/payslips` | Completed/approved runs for this employee. |
| GET | `/me/payslips/:id/pdf` | Payslip PDF for run `:id`. |
| GET | `/me/tax-summary` | Annual earnings and tax. `?year=2026`. |

### Attendance

| Method | Path | Notes |
|---|---|---|
| POST | `/me/attendance/punch` | Clock in/out (direction inferred). Punches within 60s are rejected. |
| GET | `/me/attendance/today` | Today's record. |
| GET | `/me/attendance/timesheet` | `?month=YYYY-MM`, or `?date_from=&date_to=` (max 1 year). |

### Medical

| Method | Path | Notes |
|---|---|---|
| GET | `/me/medical/enquiry` | Limit, used, remaining for this employee. |
| GET | `/me/medical/staff` | Own staff medical claims. |
| POST | `/me/medical/staff` | Create a claim. |
| POST | `/me/medical/staff/:id/submit` | Submit for approval. |
| GET | `/me/medical/dependents` | Own dependent claims. |
| POST | `/me/medical/dependents` | Create a dependent claim. |
| POST | `/me/medical/dependents/:id/submit` | Submit for approval. |

### Training & performance

| Method | Path | Notes |
|---|---|---|
| GET | `/me/training/catalog` | Available courses with remaining seats. |
| GET | `/me/training/nominations` | Own nominations. |
| POST | `/me/training/nominations` | Nominate self for a course. |
| POST | `/me/training/nominations/:id/submit` | Submit for approval. |
| GET | `/me/reviews` | Own performance reviews. |
| POST | `/me/reviews/:id/self` | Submit self-assessment. |
| GET | `/me/goals` | Own goals. |
| POST | `/me/goals` | Create a goal. |

### Documents & notifications

| Method | Path | Notes |
|---|---|---|
| GET | `/me/documents` | Own personal documents. |
| GET | `/me/documents/shared` | Documents shared with this employee. |
| GET | `/me/documents/company` | Company-wide documents. |
| GET | `/me/notifications` | Latest 50 + unread count. |
| GET | `/me/notifications/unread-count` | Badge count only — cheap to poll. |
| PUT | `/me/notifications/:id/read` | Mark one read. |
| PUT | `/me/notifications/read-all` | Mark all read. |

### Supervisor approvals

Only for **direct reports** — `employee.supervisorid` must equal the caller's employee id, or the
request returns `403`.

| Method | Path | Notes |
|---|---|---|
| GET | `/me/approvals` | Combined pending queue. |
| GET | `/me/approvals/subordinates` | Direct reports. |
| GET | `/me/approvals/leave` | Subordinates' leave requests. |
| POST | `/me/approvals/leave/:id/approve` \| `/reject` | Body may carry `comment`. |
| POST | `/me/approvals/medical/:id/approve` \| `/reject` | |
| POST | `/me/approvals/training/:id/approve` \| `/reject` | |

---

## Notes for the mobile developer

- **Ownership is enforced server-side.** Sending `employee` in a request body has no effect — it is
  overwritten with the authenticated employee id. Listing endpoints cannot be widened (`?all=1` and
  equivalents are stripped).
- **The employee must be active.** A terminated or suspended record returns `403` on every call.
- **Ids are strings** in JSON (they are 64-bit integers server-side). Do not parse them as JS numbers.
- **Dates** are `YYYY-MM-DD`.

## Setting up the key

*Settings → Mobile API* in the web app: `POST /v1/api/hr/settings/mobile-api/regenerate` (requires
`manage_settings`). The key is shown **once** at generation. A key is auto-generated on first use if
none exists.
