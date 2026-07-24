#!/usr/bin/env node
/**
 * Generate a self-signed TLS certificate for the mobile API.
 *
 * Run:  npm run cert:generate
 *       npm run cert:generate -- 192.168.1.50        # include the server's LAN IP
 *
 * A self-signed certificate encrypts the connection, which is the point here — it stops the API key
 * and employee data being readable on the wire. It does NOT prove server identity to a browser, so
 * browsers show a warning; the mobile app pins or explicitly trusts this certificate instead.
 *
 * The certificate must list every host the app connects to (IP or hostname) in subjectAltName, or
 * clients reject it. Pass them as arguments; localhost and 127.0.0.1 are always included.
 *
 * Uses the openssl binary — present on macOS/Linux and bundled with Git for Windows.
 */
const { execFileSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const CERT_DIR  = path.join(__dirname, '..', 'certs');
const KEY_PATH  = path.join(CERT_DIR, 'server.key');
const CERT_PATH = path.join(CERT_DIR, 'server.crt');
const DAYS = 825;   // ~27 months: the maximum many clients accept for a leaf certificate

function fail(msg, hint) {
  console.error(`\n✖ ${msg}`);
  if (hint) console.error(`  ${hint}`);
  process.exit(1);
}

// Extra hosts from the command line — the LAN IP or hostname phones will actually dial.
const extras = process.argv.slice(2).filter(Boolean);
const isIp = (v) => /^\d{1,3}(\.\d{1,3}){3}$/.test(v);

const dnsNames = ['localhost', ...extras.filter((v) => !isIp(v))];
const ipAddrs  = ['127.0.0.1', ...extras.filter(isIp)];

const altNames = [
  ...dnsNames.map((d, i) => `DNS.${i + 1} = ${d}`),
  ...ipAddrs.map((ip, i) => `IP.${i + 1} = ${ip}`),
].join('\n');

// openssl needs the SANs in a config file; a temp file keeps this portable across shells.
const cnf = `
[req]
distinguished_name = dn
x509_extensions    = v3_req
prompt             = no

[dn]
CN = ${dnsNames[0]}
O  = HR System
OU = Mobile API

[v3_req]
basicConstraints = CA:FALSE
keyUsage         = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName   = @alt_names

[alt_names]
${altNames}
`.trimStart();

if (!fs.existsSync(CERT_DIR)) fs.mkdirSync(CERT_DIR, { recursive: true });

// Never silently destroy an existing certificate — rotating it breaks every app that pinned it.
if (fs.existsSync(KEY_PATH) || fs.existsSync(CERT_PATH)) {
  fail(
    'A certificate already exists in Server/certs/.',
    'Delete server.key and server.crt first if you really want to replace it — ' +
    'any mobile app that pinned the old certificate will stop connecting.',
  );
}

const cnfPath = path.join(CERT_DIR, 'openssl.cnf');
fs.writeFileSync(cnfPath, cnf);

try {
  execFileSync('openssl', [
    'req', '-x509', '-nodes',
    '-newkey', 'rsa:2048',
    '-keyout', KEY_PATH,
    '-out',    CERT_PATH,
    '-days',   String(DAYS),
    '-config', cnfPath,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
} catch (err) {
  fs.unlinkSync(cnfPath);
  if (err.code === 'ENOENT') {
    fail(
      'openssl was not found on your PATH.',
      'On Windows it ships with Git — try running this from Git Bash. ' +
      'On macOS/Linux install it with your package manager.',
    );
  }
  fail(`openssl failed: ${String(err.stderr || err.message).trim()}`);
}

fs.unlinkSync(cnfPath);
// The private key must not be world-readable. (chmod is a no-op on Windows; harmless.)
try { fs.chmodSync(KEY_PATH, 0o600); } catch { /* not supported on this platform */ }

const rel = (p) => path.relative(path.join(__dirname, '..', '..'), p).replace(/\\/g, '/');

console.log(`
✔ Self-signed certificate created (valid ${DAYS} days)

    ${rel(CERT_PATH)}
    ${rel(KEY_PATH)}

  Valid for: ${[...dnsNames, ...ipAddrs].join(', ')}

  Next steps
  ──────────
  1. Add to Server/.env.development (or .env.production):

       HTTPS_KEY=./certs/server.key
       HTTPS_CERT=./certs/server.crt
       HTTPS_PORT=3443

  2. Restart the server. It will log "🔒 HTTPS running on port 3443".
     HTTP keeps working on its existing port — the web app is unaffected.

  3. Point the mobile app at https://<this-server>:3443 and have it trust
     this certificate (copy server.crt into the app, or install it on the device).

  Re-run with your LAN IP if phones connect over the network, e.g.
      npm run cert:generate -- 192.168.1.50 hr.local
`);
