const SUPABASE_API = 'https://sytwiwiykolfgypiusdw.supabase.co/functions/v1/minimeet-api';
const SUPABASE_GUEST_API = 'https://sytwiwiykolfgypiusdw.supabase.co/functions/v1/minimeet-guest-api';

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
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
  };
}

function json(request, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request),
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

async function handleIce(request, env) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }
  if (request.method !== 'GET') return json(request, { error: 'METHOD_NOT_ALLOWED' }, 405);

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

  return json(request, { iceServers, turnConfigured });
}

function upstreamHeaders(request) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  const apikey = request.headers.get('apikey');
  const authorization = request.headers.get('authorization');
  if (apikey) headers.set('apikey', apikey);
  if (authorization) headers.set('authorization', authorization);
  return headers;
}

async function proxyPost(request, upstreamUrl) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }
  if (request.method !== 'POST') return json(request, { error: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    const upstream = await fetch(upstreamUrl, {
      method: 'POST',
      headers: upstreamHeaders(request),
      body: await request.text(),
      redirect: 'follow',
    });

    const responseHeaders = new Headers({
      ...corsHeaders(request),
      'Content-Type': upstream.headers.get('Content-Type') || 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });

    return new Response(await upstream.arrayBuffer(), {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('MiniMeet Workers proxy error', error);
    return json(request, { error: 'CLOUDFLARE_PROXY_FAILED' }, 502);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/ice') return handleIce(request, env);
    if (url.pathname === '/api/minimeet') return proxyPost(request, SUPABASE_API);
    if (url.pathname === '/api/minimeet-guest') return proxyPost(request, SUPABASE_GUEST_API);
    if (url.pathname.startsWith('/api/')) return json(request, { error: 'NOT_FOUND' }, 404);

    return env.ASSETS.fetch(request);
  },
};
