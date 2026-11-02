// Try the new core API login and write every step to logs/core-api.log.
//
//   node scripts/core-auth-test.js            # envelope from .env (default: payload)
//   node scripts/core-auth-test.js raw        # send the encrypted text itself as the body
//   node scripts/core-auth-test.js both       # try payload, then raw
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { authenticate, CORE_API_LOG_PATH, coreLog } = require('../src/helpers/coreApiClient');

(async () => {
  const arg = (process.argv[2] || '').toLowerCase();
  const envelopes = arg === 'both' ? ['payload', 'raw'] : [arg || process.env.CORE_API_ENVELOPE || 'payload'];
  for (const envelope of envelopes) {
    process.env.CORE_API_ENVELOPE = envelope;
    coreLog(`TEST RUN — envelope: ${envelope}`, `Started by scripts/core-auth-test.js`);
    try {
      await authenticate({ force: true });
      console.log(`[${envelope}] authenticated — token received`);
    } catch (e) {
      console.log(`[${envelope}] ${e.message}`);
    }
  }
  console.log(`Log: ${CORE_API_LOG_PATH}`);
  process.exit(0);
})();
