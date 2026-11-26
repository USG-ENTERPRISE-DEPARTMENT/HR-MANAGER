# Staff360 XAuth setup

This application keeps its existing local/admin login. Staff users can instead select **Sign in with x100** on the login page.

1. Apply the Prisma migration in `src/prisma/migrations/20260728120000_add_xauth_employeeid`, then run `npx prisma generate --schema=src/prisma/schema.prisma`. It adds the required nullable, unique `users.employeeid` column without affecting existing accounts.
2. Register this app with Staff360. Set its callback URL to the deployed frontend login URL (for example, `https://hr.example.com/xhrm/`). The page exchanges the opaque `token` parameter with this server immediately.
3. Copy `Server/XAUTH.env.example` values into the deployment environment and set the registered `XAUTH_APP_KEY` and `XAUTH_APP_SECRET`.

The browser is only redirected to Staff360 and carries its opaque callback token. `POST /v1/api/hr/xauth/exchange` sends that token to Staff360's `/decode` endpoint with the secret held on this server, then creates the normal HR-MANAGER session.

XAuth identity is matched by `users.employeeid`. Existing users linked to an `employee.employee_id` record are backfilled on their first XAuth login. If an employee has no local staff record, access is denied; this prevents an external identity from silently receiving access to the portal. New local user records are created only for existing staff records and start with no roles or direct permissions, so access must be provisioned locally.

For a PostgreSQL deployment, use `src/prisma/manual-migrations/20260728_add_xauth_employeeid.postgres.sql`; PostgreSQL's legacy `users.employeeid` column is already used for the numeric employee relation, so the XAuth identifier is stored in `xauth_employeeid` there.

---

## Application access and role sync

Staff 360 is the source of truth for **which HR-MANAGER roles a staff member holds** when they sign in through XAuth.

**At login** (`xauthController.exchange`):

- If `/decode` says `hasApplicationAccess: false` (or no roles), the login is refused with *"You do not have access to {appName}…"*. No session is created and no local user row is auto-provisioned.
- Each role in `currentApplicationAccess.roles` is matched to a local **active** role by `roleId` = `roles.id`, falling back to `roleCode` (case-insensitive). If none match, the login is refused.
- The user's `model_has_roles` rows are **replaced** by the matched set on every XAuth login, so roles granted or removed in Staff 360 take effect at the next login. Roles assigned locally to a user who signs in via XAuth are overwritten. The local email/password login is unchanged.
- If the decode response has no application-access fields (older Staff 360), the locally assigned roles are kept as before.
- **Accounts with no employee record** (system/admin logins such as `UNIONADMIN`): matched to a local user whose `username` equals the staff ID (case-insensitive) and that is not linked to an employee. If there is none, and Staff 360 granted roles, a username-only user is created. Name and email come from Staff 360. On an older Staff 360 with no access fields these logins are still refused.

**Role sync** (`helpers/xauthRoleSync.js`): every local role is mirrored to Staff 360's XAuth Roles API using our own id as `roleId` and a code derived from the name (`HR Manager` → `HR-MANAGER`).

| Local action | Staff 360 call |
|---|---|
| Create role | `POST /api/v1/xauth/roles` |
| Rename / activate / deactivate | `PUT /api/v1/xauth/roles/{id}` (creates it if Staff 360 returns 404) |
| Delete role | `DELETE /api/v1/xauth/roles/{id}`, sent **first**. A `409` (still assigned to staff) blocks the local delete. |

A failed create/update never undoes the local save; the response message ends with *"(Staff 360 sync failed: …)"* and carries an `xauthSync` object. To push every role (initial load, or to repair drift) call **`POST /v1/api/hr/roles/xauth-sync`** (needs `manage_roles`). It creates or updates every role and lists any `orphans` (roles Staff 360 holds that no longer exist here) without deleting them.

`userName` sent to Staff 360 is the actor's `employee.employee_id`, falling back to their username.

---

## Embedded (no-URL) login — allowing this app to iframe the Staff360 sign-in page

The HR portal shows the Staff360 sign-in **inside a modal iframe** so the user never sees a browser
address bar (Google-popup feel, but framed in-page). For that iframe to render, **Staff360 must
permit this app's origin to embed its sign-in page.** By default most servers forbid framing, and the
iframe comes up blank.

### What the Staff360 (X100) team must change

Their sign-in responses (`GET /api/v1/xauth/signin/initiate`, `POST /api/v1/xauth/signin`, and any
page the flow renders) currently likely send a header that blocks framing:

```
X-Frame-Options: DENY            # or SAMEORIGIN
```

They need to do **two** things:

1. **Remove `X-Frame-Options`** for these sign-in routes. `X-Frame-Options` is legacy and only
   supports `DENY` / `SAMEORIGIN` / a single origin — it cannot allow-list multiple external origins,
   so it must be dropped in favour of CSP below.

2. **Send a Content-Security-Policy `frame-ancestors`** listing this HR portal's origin(s):

   ```
   Content-Security-Policy: frame-ancestors 'self' <HR-PORTAL-ORIGIN> [more origins...];
   ```

   `frame-ancestors` is the modern control and is what browsers honour. List **every origin the HR
   portal is served from** (scheme + host + port, space-separated). For this deployment those are:

   ```
   Content-Security-Policy: frame-ancestors 'self'
     http://localhost:3099
     http://10.203.14.114:3099
     http://192.168.1.92:3099 ;
   ```

   (Put them on one line in the actual header — shown wrapped here for readability. Add/replace with
   the real production origin, e.g. `https://hr.example.com`, once deployed. Whatever is in the HR
   app's `allowedOrigins` list is the set to mirror here.)

### Framework snippets for their team

- **Express / Node** (e.g. via `helmet`):
  ```js
  app.use((req, res, next) => {
    res.removeHeader('X-Frame-Options');
    res.setHeader('Content-Security-Policy',
      "frame-ancestors 'self' http://localhost:3099 http://10.203.14.114:3099 https://hr.example.com");
    next();
  });
  ```
- **nginx** (on the sign-in location):
  ```nginx
  proxy_hide_header X-Frame-Options;
  add_header Content-Security-Policy "frame-ancestors 'self' http://10.203.14.114:3099 https://hr.example.com" always;
  ```
- **Java / Spring Security**:
  ```java
  http.headers(h -> h
    .frameOptions(f -> f.disable())                         // drop X-Frame-Options
    .contentSecurityPolicy(csp -> csp.policyDirectives(
       "frame-ancestors 'self' http://10.203.14.114:3099 https://hr.example.com")));
  ```

### How to confirm it worked

From a machine that can reach Staff360, check the header:

```bash
curl -sI "http://10.32.11.53:8282/api/v1/xauth/signin/initiate?app_key=<APP_KEY>" \
  | grep -iE "x-frame-options|content-security-policy"
```

You want to see a `content-security-policy: frame-ancestors ...` that includes your origin, and **no**
`x-frame-options: DENY`. Then the in-app modal will display the Staff360 form directly.

### If they can't/won't change it

The HR portal degrades gracefully: when the embed is blocked it falls back to opening Staff360 in a
real window (which does show a URL bar — a browser limitation, not a bug). See the login page's
popup fallback.

> **Security note for the Staff360 team:** `frame-ancestors` with an explicit allow-list is safe —
> it only lets the named, trusted HR origins embed the page. Do **not** use `frame-ancestors *`, which
> would let any site frame the login and enable clickjacking.
