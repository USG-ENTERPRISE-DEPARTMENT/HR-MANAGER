# GL Reference Lookup — Mobile Integration Guide

How to look up any GL posting by its reference number and display it in the app.

---

## 1. The short version

- One endpoint returns **every kind of GL posting** — payroll, leave allowance, out of station,
  end of service, staff medical, dependent medical and hospital claims.
- **Every posting comes back in the same structure as a payroll run.** One screen and one model
  class can render all of them.
- **Decide the kind of posting from the `module` field — never from the reference number.**
  Reference prefixes are not reliable (see section 3).

---

## 2. Endpoint

```
GET /v1/api/hr/me/gl/by-reference/{reference}
GET /v1/api/hr/me/payroll/runs/by-reference/{reference}     ← older path, same handler, same response
```

| Header      | Value                                   |
|-------------|-----------------------------------------|
| `x-api-key` | the API key (no `x-employee-id` needed) |

Use the `/gl/...` path for new work. The old path keeps working; it is not payroll-only any more.

### Responses

| HTTP | Body | Meaning |
|------|------|---------|
| 200  | `{ "status": "200", "message": "...", "data": { ... } }` | Found. `data` is described below. |
| 400  | `{ "status": "400", "message": "Reference number is required" }` | Empty reference. |
| 401  | `{ "status": "401", "message": "..." }` | Missing or wrong API key. |
| 404  | `{ "status": "404", "message": "No GL posting found for that reference number" }` | No posting has this reference. |
| 429  | `{ "status": "429", "message": "..." }` | Rate limited (120 requests/min per IP). |

`message` on a 200 names the kind of posting (`"Payroll run retrieved"`,
`"Staff Medical posting retrieved"`, …). Show it if useful, but do not branch on it — use `module`.

Every call is logged server-side. Please don't fire the same request twice per screen open.

---

## 3. Why you must not use the reference prefix

The prefix looks like it identifies the module, but it doesn't reliably:

| Reference seen in production | What it actually is |
|------------------------------|---------------------|
| `PR2151020801`    | payroll |
| `101658481679`    | **payroll** (bank-issued reference, no prefix) |
| `b01669892325`, `2g1747994193` | **payroll** (bank-issued / migrated) |
| `MS118953641490`  | staff medical |
| `J51793772000264` | **leave allowance** (migrated from the old system) |
| `MC2083905856`    | hospital claim |

The core banking system sometimes returns its own reference instead of the one HR sent, and
records migrated from the old system kept their old references. Only 16 of 66 payroll runs on the
server today start with `PR`. **The server already knows which module a reference belongs to and
tells you in `module`.**

---

## 4. The `module` field

| `module`            | `moduleLabel`       | What it is |
|---------------------|---------------------|------------|
| `payroll`           | `Payroll`           | A payroll run — many employees, many columns. |
| `leave`             | `Leave Allowance`   | Leave allowance paid to one employee (gross, tax, net). |
| `out_of_station`    | `Out of Station`    | Out-of-station allowance for one employee. |
| `end_of_service`    | `End of Service`    | End-of-service settlement for one employee (benefit + additions − deductions). |
| `staff_medical`     | `Staff Medical`     | Medical refund to one employee. |
| `dependent_medical` | `Dependent Medical` | Medical refund to one employee for a dependant. |
| `hospital_claim`    | `Hospital Claim`    | A hospital's invoice covering one or more employees — **paid to the hospital**, not the employees. |

Use `moduleLabel` as the screen title / badge text. Treat an unknown `module` value as a
generic posting and render it with the common layout — new modules may be added later.

---

## 5. Response structure (identical for every module)

```jsonc
{
  "id": "11895",
  "name": "Staff Medical - JOHN DOE - malaria",   // title line for the posting
  "status": "Approved",
  "module": "staff_medical",
  "moduleLabel": "Staff Medical",
  "reference": "MS118953641490",                   // what you looked up
  "document_ref": "MS118953641490",

  "date_start": "2026-11-10T00:00:00.000Z",
  "date_end": "2026-11-25T00:00:00.000Z",
  "created_at": "2026-11-18T00:00:00.000Z",
  "approved_at": "2026-11-18T00:00:00.000Z",
  "finalized_at": "2026-11-18T00:00:00.000Z",      // when it was posted to the GL

  // Payroll-run-only fields — present on every response, null outside payroll:
  "pay_frequency": null, "freq_name": null, "deduction_group": null, "group_name": null,
  "payment_type_id": null, "type_name": null, "columns": null,
  "bank_confirmed_at": null, "bank_confirmed_by": null,
  "cur_approver_type": null, "cur_approver_id": null, "cur_approver_label": null, "cur_stage_name": null,
  "submitted_by": "1", "approved_by": "4", "rejection_reason": null,
  "payment_log": "{...}",                          // raw bank response, for support only — don't display

  "employeeCount": 1,
  "totals": { "earnings": 120, "deductions": 0, "netPay": 120 },

  "columnSummary": [
    { "name": "Medical Claim", "type": "Payment", "glAccount": "143000000003",
      "glAccounts": ["143000000003"], "currency": "SLL", "employeeCount": 1, "amount": 120 }
  ],

  "netPay": { "name": "Net Pay", "type": "Credit", "glAccount": null,
              "currency": "SLL", "employeeCount": 1, "amount": 120 },

  "employees": [
    {
      "employeeId": "382", "employeeCode": "P2021013", "name": "JOHN DOE",
      "bankAccount": "0201303152501", "currency": "SLL", "branch": "000",
      "columns": [
        { "name": "Medical Claim", "amount": 120, "type": "Payment",
          "glAccount": "143000000003", "branch": "000", "currency": "SLL" }
      ],
      "earnings": 120, "deductions": 0, "netPay": 120
    }
  ],

  "details": { "illness": "malaria", "hospital": null }   // NOT present on payroll — see section 7
}
```

### Guarantees you can rely on

- Every key above is **always present** on every module (except `details`, absent on payroll).
- `created_at`, `approved_at`, `finalized_at`, `date_start`, `date_end` are **never null** —
  where a record lacks one, the server fills it from the nearest date it has.
- All money values are numbers rounded to 2 decimals, all in the one system `currency`.
- IDs (`id`, `employeeId`, `submitted_by`, `approved_by`) are strings.
- For every employee: `earnings − deductions = netPay`.
- `totals` is the sum across `employees`. `columnSummary` sums to `totals.earnings + totals.deductions`.

### Fields that may be null — handle them

| Field | When null |
|-------|-----------|
| `columns[].glAccount`, `columnSummary[].glAccount` | No GL account configured for that line. Show "—". |
| `netPay.glAccount` | Always null except `hospital_claim` (each employee's own bank account is used). |
| `employees[].bankAccount` | Employee has no account on file. |
| `employees[].employeeCode` | Can be an empty string for very old records. |
| `rejection_reason`, `approved_by`, `submitted_by` | Not applicable / not recorded. |
| All payroll-run-only fields (listed above) | Always null outside `payroll`. |

---

## 6. How each module fills the structure

The idea: every amount the GL journal paid becomes a **column** on the employee.
`Payment` = money owed to the employee; `Deduction` = money withheld from it; `netPay` = what
reached the employee.

| `module` | Employees | Columns per employee | `netPay` means |
|----------|-----------|----------------------|----------------|
| `payroll` | many | the run's posting columns (Basic, allowances, PAYE, …) | Net salary credited to each employee |
| `leave` | 1 | `Leave Allowance - <leave name>` (Payment, gross) and `Leave Allowance Tax` (Deduction) | Net allowance credited |
| `out_of_station` | 1 | `Out of Station Allowance` (Payment) | Allowance credited |
| `end_of_service` | 1 | `End of Service Benefit` (Payment) + each settlement line (additions = Payment, deductions such as loans = Deduction) | Settlement balance credited |
| `staff_medical` | 1 | `Medical Claim` (Payment) | Refund credited |
| `dependent_medical` | 1 | `Dependent Medical - <dependant>` (Payment) | Refund credited |
| `hospital_claim` | 1 or more | `Medical Claim` / `Dependent Medical - <dependant>` per claim item (Payment) | **Paid to the hospital** — see below |

### Hospital claims are the one exception

The money went to the hospital, not the employees. The employees listed are the patients the
invoice covers; their `netPay` is the value of their treatment, **not** money they received. The
top-level `netPay` block says so:

```jsonc
"netPay": { "name": "Hospital Payment", "type": "Credit",
            "glAccount": "0233441211103",   // the hospital's account
            "amount": 1425 }                 // credited to the hospital, after withholding tax
```

`totals.netPay` is the claim value before withholding tax; `netPay.amount` is what the hospital
received. The difference is `details.withholdingTax`.

**Display rule:** always label the cash line with `netPay.name` (don't hard-code "Net Pay"), and
for `hospital_claim` label the per-employee figure as "Claim amount" instead of "Net pay".

---

## 7. `details` — module-specific extras

Not present on `payroll`. Show these in an "Additional information" section. All fields may be null.

| `module` | `details` fields |
|----------|------------------|
| `leave` | `leaveName`, `leaveStatus` |
| `out_of_station` | `requestNumber`, `purpose`, `location`, `days`, `dailyRate` |
| `end_of_service` | `settlementNumber`, `exitReason` |
| `staff_medical` | `illness`, `hospital` |
| `dependent_medical` | `illness`, `hospital`, `dependantName`, `relation` |
| `hospital_claim` | `hospital`, `hospitalAccount`, `invoiceNo`, `referenceNo`, `withholdingTax`, `hospitalCredit` |

A simple, future-proof approach: render `details` as a key/value list, turning the camelCase keys
into labels (`dependantName` → "Dependant name"), and skip nulls. New keys then appear without an
app release.

---

## 8. `status` values

| `module` | Values you will see |
|----------|---------------------|
| `payroll` | `Bank Pending` (posted, awaiting bank approval), `Completed`, `Rejected` |
| `leave`, `out_of_station`, `end_of_service` | `Paid` |
| `staff_medical`, `dependent_medical`, `hospital_claim` | `Approved` |

Display the value as-is; colour unknown values neutrally.

---

## 9. Recommended screen

One screen for every module:

```
┌───────────────────────────────────────────┐
│ [moduleLabel badge]           [status]    │
│ name                                      │
│ Ref: reference          Posted: finalized_at
├───────────────────────────────────────────┤
│ Earnings     totals.earnings              │
│ Deductions   totals.deductions            │
│ netPay.name  netPay.amount                │
├───────────────────────────────────────────┤
│ Columns (columnSummary)                   │   ← hide the section if only 1 employee:
│   name · type · glAccount · amount        │     the employee card shows the same lines
├───────────────────────────────────────────┤
│ Employees (employeeCount)                 │
│   name (employeeCode) · bankAccount       │
│     columns[] …                           │
│     Net pay / Claim amount: netPay        │
├───────────────────────────────────────────┤
│ Additional information (details)          │   ← not shown for payroll
└───────────────────────────────────────────┘
```

- Payroll runs can have hundreds of employees — keep the employee list lazy/paginated client-side.
- Payroll-only header lines (`freq_name`, `group_name`, `type_name`, `cur_stage_name`) — show only
  when non-null; that automatically hides them for other modules.

---

## 10. Dart sketch

```dart
class GlPosting {
  final String id, name, status, module, moduleLabel, reference;
  final DateTime postedAt;
  final Totals totals;
  final List<ColumnTotal> columnSummary;
  final NetPayLine netPay;
  final List<PostingEmployee> employees;
  final Map<String, dynamic> details;      // empty for payroll
  final String? freqName, groupName;       // payroll only

  bool get isHospitalClaim => module == 'hospital_claim';

  factory GlPosting.fromJson(Map<String, dynamic> j) => GlPosting(
        id: j['id'] as String,
        name: j['name'] as String? ?? '',
        status: j['status'] as String? ?? '',
        module: j['module'] as String? ?? 'payroll',   // older servers didn't send it
        moduleLabel: j['moduleLabel'] as String? ?? 'Payroll',
        reference: j['reference'] as String,
        postedAt: DateTime.parse(j['finalized_at'] as String),
        totals: Totals.fromJson(j['totals']),
        columnSummary: (j['columnSummary'] as List).map((e) => ColumnTotal.fromJson(e)).toList(),
        netPay: NetPayLine.fromJson(j['netPay']),
        employees: (j['employees'] as List).map((e) => PostingEmployee.fromJson(e)).toList(),
        details: (j['details'] as Map<String, dynamic>?) ?? const {},
        freqName: j['freq_name'] as String?,
        groupName: j['group_name'] as String?,
      );
}

class ColumnLine {
  final String name, type;          // type: 'Payment' | 'Deduction'
  final String? glAccount;          // nullable
  final double amount;
  bool get isDeduction => type == 'Deduction';
  // amounts arrive as JSON numbers — use (x as num).toDouble(), not `as double`
}
```

Parse amounts with `(json['amount'] as num).toDouble()` — whole numbers arrive as `int`.

---

## 11. Test references

Live postings on the test server you can call today:

| `module` | Reference | What you get |
|----------|-----------|--------------|
| `payroll` | `PR2472538796` | 62 employees, 14 columns, `Completed` |
| `leave` | `J51793772000264` | Allowance with a tax deduction (Payment + Deduction columns) |
| `staff_medical` | `MS118953641490` | One medical claim column |
| `hospital_claim` | `MC2083905856` | `netPay.name` = `Hospital Payment`, hospital's account in `netPay.glAccount` |
| — | `NOPE-0000` | `404` — use it to test the not-found state |

`out_of_station`, `end_of_service` and `dependent_medical` have not been posted on the test server
yet, so there is no live reference. They have been verified server-side with the same structure;
build against the examples in sections 5–7 and ask HR to post one when you are ready to test end to
end. Note that `end_of_service` is the module most likely to have several Payment **and** Deduction
columns on a single employee, so make sure the employee card handles that.

---

## 12. Checklist

- [ ] Branch on `module`, never on the reference prefix.
- [ ] Use `moduleLabel` for the title/badge; fall back gracefully on unknown modules.
- [ ] Label the cash line with `netPay.name`.
- [ ] For `hospital_claim`, call the employee figure "Claim amount" and show `details.withholdingTax`.
- [ ] Treat every `glAccount`, `bankAccount` and payroll-only field as nullable.
- [ ] Parse money as `num`, not `double`.
- [ ] Render `details` generically (key/value), skipping nulls.
- [ ] Call the endpoint once per screen open.
