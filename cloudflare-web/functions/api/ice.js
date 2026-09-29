function splitUrls(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin === 'null' ? '*' : origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
  };
}

export async function onRequestOptions(context) {
  return new Response(null, { status: 204, headers: corsHeaders(context.request) });
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
  const turnUrls = splitUrls(env.TURN_URL);
  const username = String(env.TURN_USERNAME || '').trim();
  const credential = String(env.TURN_CREDENTIAL || '').trim();

  let turnConfigured = false;
  if (turnUrls.length && username && credential) {
    iceServers.push({
      urls: turnUrls.length === 1 ? turnUrls[0] : turnUrls,
      username,
      credential,
    });
    turnConfigured = true;
  }

  return new Response(JSON.stringify({ iceServers, turnConfigured }), {
    status: 200,
    headers: {
      ...corsHeaders(request),
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}
