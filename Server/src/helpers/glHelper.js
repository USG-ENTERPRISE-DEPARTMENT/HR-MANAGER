const axios          = require('axios');
const { getApiConfig } = require('../controllers/apiIntegrationController');

/**
 * Post a bulk payment to the GL system.
 * @param {{ approvedBy: string, referenceNo: string, debitAccounts: any[], creditAccounts: any[] }} opts
 * @returns {{ documentRef: string, raw: object }}
 */
async function postToGL({ approvedBy, referenceNo, debitAccounts, creditAccounts }) {
  const cfg = await getApiConfig();
  const url = cfg.gl_url;
  if (!url) throw new Error('GL API URL not configured');

  let extra = {};
  try { extra = JSON.parse(cfg.gl_extra || '{}'); } catch {}

  const headers = { 'Content-Type': 'application/json' };
  const forwardedFor = cfg.gl_forwarded_for || extra.x_forwarded_for || extra.forwarded_for;
  if (forwardedFor) headers['X-FORWARDED-FOR'] = String(forwardedFor);
  if (cfg.gl_bearer_token) {
    headers['Authorization'] = `Bearer ${cfg.gl_bearer_token}`;
  } else if (cfg.gl_basic_user) {
    const creds = Buffer.from(`${cfg.gl_basic_user}:${cfg.gl_basic_pass}`).toString('base64');
    headers['Authorization'] = `Basic ${creds}`;
  } else {
    if (cfg.gl_api_key)    headers['x-api-key']    = cfg.gl_api_key;
    if (cfg.gl_api_secret) headers['x-api-secret'] = cfg.gl_api_secret;
  }

  const payload = {
    approvedBy,
    channelCode:   extra.channel_code || 'HRP',
    transType:     extra.trans_type   || '1504',
    debitAccounts,
    creditAccounts,
    referenceNo,
    postedBy:      approvedBy,
  };

  const res = await axios({
    method:        'put',
    maxBodyLength: Infinity,
    url,
    headers,
    data:    payload,
    timeout: Number(cfg.gl_timeout) || 30000,
  });

  const data = res.data || {};
  const code = String(data.responseCode ?? '');
  if (code && code !== '00' && code !== '000' && code !== '0') {
    const err = new Error(`GL error ${code}: ${data.message || 'Unknown error'}`);
    err.glResponse = data;
    throw err;
  }
  return {
    documentRef: data.documentRef || data.document_ref || data.referenceNo || referenceNo,
    raw: data,
  };
}

module.exports = { postToGL };
