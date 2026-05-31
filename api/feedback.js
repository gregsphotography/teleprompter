const MAX_NAME_LENGTH = 120;
const MAX_EMAIL_LENGTH = 254;
const MAX_MESSAGE_LENGTH = 4000;
const MAILGUN_ENDPOINT = 'https://api.eu.mailgun.net/v3';

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function sanitizeHeaderValue(value) {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }

  if (typeof req.body === 'string') {
    return JSON.parse(req.body);
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

module.exports = async function feedbackHandler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
  }

  const contentType = req.headers['content-type'] || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return sendJson(res, 415, { ok: false, error: 'Unsupported media type' });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    console.warn('Feedback request contained invalid JSON');
    return sendJson(res, 400, { ok: false, error: 'Invalid request' });
  }

  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim();
  const message = String(body.message || '').trim();
  const company = String(body.company || '').trim();

  if (company) {
    return sendJson(res, 200, { ok: true });
  }

  if (
    !name ||
    !email ||
    !message ||
    name.length > MAX_NAME_LENGTH ||
    email.length > MAX_EMAIL_LENGTH ||
    message.length > MAX_MESSAGE_LENGTH ||
    !isValidEmail(email)
  ) {
    return sendJson(res, 400, { ok: false, error: 'Invalid request' });
  }

  const { MAILGUN_API_KEY, MAILGUN_DOMAIN, MAILGUN_FROM, FEEDBACK_TO } = process.env;
  if (!MAILGUN_API_KEY || !MAILGUN_DOMAIN || !MAILGUN_FROM || !FEEDBACK_TO) {
    console.error('Feedback Mailgun configuration is incomplete');
    return sendJson(res, 500, { ok: false, error: 'Could not send feedback' });
  }

  const form = new URLSearchParams();
  form.set('from', sanitizeHeaderValue(MAILGUN_FROM));
  form.set('to', sanitizeHeaderValue(FEEDBACK_TO));
  form.set('subject', `AeroPrompter feedback from ${sanitizeHeaderValue(name)}`);
  form.set('text', [
    `Name: ${name}`,
    `Email: ${email}`,
    '',
    message
  ].join('\n'));
  form.set('h:Reply-To', `${sanitizeHeaderValue(name)} <${sanitizeHeaderValue(email)}>`);

  try {
    const response = await fetch(`${MAILGUN_ENDPOINT}/${encodeURIComponent(MAILGUN_DOMAIN)}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`api:${MAILGUN_API_KEY}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: form
    });

    if (!response.ok) {
      const responseText = await response.text();
      console.error('Mailgun feedback send failed', {
        status: response.status,
        body: responseText.slice(0, 500)
      });
      return sendJson(res, 502, { ok: false, error: 'Could not send feedback' });
    }

    return sendJson(res, 200, { ok: true });
  } catch (error) {
    console.error('Feedback send request failed', error);
    return sendJson(res, 502, { ok: false, error: 'Could not send feedback' });
  }
};
