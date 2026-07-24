require("dotenv").config({
  path: `.env.${process.env.NODE_ENV || "development"}`
});

const fs   = require("fs");
const http = require("http");
const app  = require("./src/app");

const PORT = process.env.PORT;

// ── HTTP (always on) ─────────────────────────────────────────────────────────
http.createServer(app).listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

// ── HTTPS (optional) ─────────────────────────────────────────────────────────
// Enabled by pointing HTTPS_KEY / HTTPS_CERT at a key pair. A self-signed certificate is enough —
// see `npm run cert:generate` and the TLS section of MOBILE_API.md.
//
// Why this matters: the mobile API authenticates with a shared key sent in a header. Over plain
// HTTP that key — and every payslip and medical record it returns — travels as readable text, so
// anyone on the same network can capture it with standard tools. Rotating the key does not help if
// the replacement is sniffed on first use. HTTPS is what makes the key a secret in transit.
//
// HTTP keeps listening alongside it so the existing web app and internal integrations are
// unaffected; point the mobile app at the HTTPS port.
const { HTTPS_KEY, HTTPS_CERT, HTTPS_PORT } = process.env;

if (HTTPS_KEY && HTTPS_CERT) {
  const missing = [HTTPS_KEY, HTTPS_CERT].filter((p) => !fs.existsSync(p));
  if (missing.length) {
    console.error(`⚠️  HTTPS not started — certificate file(s) not found: ${missing.join(", ")}`);
    console.error("   Generate a self-signed pair with:  npm run cert:generate");
  } else {
    try {
      const https = require("https");
      const httpsPort = HTTPS_PORT || 3443;
      https
        .createServer({ key: fs.readFileSync(HTTPS_KEY), cert: fs.readFileSync(HTTPS_CERT) }, app)
        .listen(httpsPort, () => {
          console.log(`🔒 HTTPS running on port ${httpsPort}`);
        });
    } catch (err) {
      // A broken certificate must not take the HTTP server down with it.
      console.error(`⚠️  HTTPS failed to start: ${err.message}`);
    }
  }
} else {
  console.warn(
    "⚠️  HTTPS is off — the mobile API key and all employee data it returns (payslips, medical " +
    "records) travel unencrypted and can be read by anyone on the network. Set HTTPS_KEY and " +
    "HTTPS_CERT to enable it; run `npm run cert:generate` to create a self-signed pair."
  );
}
