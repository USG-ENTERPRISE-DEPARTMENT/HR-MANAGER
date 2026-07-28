# Staff360 XAuth setup

This application keeps its existing local/admin login. Staff users can instead select **Sign in with Staff360** on the login page.

1. Apply the Prisma migration in `src/prisma/migrations/20260728120000_add_xauth_employeeid`, then run `npx prisma generate --schema=src/prisma/schema.prisma`. It adds the required nullable, unique `users.employeeid` column without affecting existing accounts.
2. Register this app with Staff360. Set its callback URL to the deployed frontend login URL (for example, `https://hr.example.com/xhrm/`). The page exchanges the opaque `token` parameter with this server immediately.
3. Copy `Server/XAUTH.env.example` values into the deployment environment and set the registered `XAUTH_APP_KEY` and `XAUTH_APP_SECRET`.

The browser is only redirected to Staff360 and carries its opaque callback token. `POST /v1/api/hr/xauth/exchange` sends that token to Staff360's `/decode` endpoint with the secret held on this server, then creates the normal HR-MANAGER session.

XAuth identity is matched by `users.employeeid`. Existing users linked to an `employee.employee_id` record are backfilled on their first XAuth login. If an employee has no local staff record, access is denied; this prevents an external identity from silently receiving access to the portal. New local user records are created only for existing staff records and start with no roles or direct permissions, so access must be provisioned locally.

For a PostgreSQL deployment, use `src/prisma/manual-migrations/20260728_add_xauth_employeeid.postgres.sql`; PostgreSQL's legacy `users.employeeid` column is already used for the numeric employee relation, so the XAuth identifier is stored in `xauth_employeeid` there.
