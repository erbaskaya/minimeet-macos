const UPSTREAM = 'https://sytwiwiykolfgypiusdw.supabase.co/functions/v1/minimeet-api';

function upstreamHeaders(request) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  const apikey = request.headers.get('apikey');
  const authorization = request.headers.get('authorization');
  if (apikey) headers.set('apikey', apikey);
  if (authorization) headers.set('authorization', authorization);
  return headers;
}

export async function onRequest(context) {
  const request = context.request;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (request.method !== 'POST') return Response.json({ error: 'METHOD_NOT_ALLOWED' }, { status: 405 });

  try {
    const upstream = await fetch(UPSTREAM, {
      method: 'POST',
      headers: upstreamHeaders(request),
      body: await request.text(),
      redirect: 'follow',
    });
    return new Response(await upstream.arrayBuffer(), {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') || 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('MiniMeet Cloudflare proxy error', error);
    return Response.json({ error: 'CLOUDFLARE_PROXY_FAILED' }, { status: 502 });
  }
}
