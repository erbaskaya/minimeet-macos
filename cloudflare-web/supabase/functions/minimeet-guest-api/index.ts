import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const FREE_MINUTES = 59;
const HOST_OFFLINE_MS = 150000;
const ALLOWED_ORIGINS = new Set([
  'https://minimeeting.pages.dev',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]);

function isAllowedOrigin(origin: string) {
  if (ALLOWED_ORIGINS.has(origin)) return true;
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' && url.hostname.endsWith('.minimeeting.pages.dev');
  } catch {
    return false;
  }
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { 'X-Client-Info': 'minimeet-guest-edge' } },
});

function corsHeaders(req: Request) {
  const origin = req.headers.get('origin') || '';
  const allowOrigin = isAllowedOrigin(origin) ? origin : 'https://minimeeting.pages.dev';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(req: Request, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function roomCode(value: unknown) {
  const room = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-Z0-9]{6,12}$/.test(room) ? room : '';
}

function sessionId(value: unknown) {
  const id = String(value || '').trim();
  return /^[0-9a-f-]{36}$/i.test(id) ? id : '';
}

function guestHostToken(value: unknown) {
  const token = String(value || '').trim();
  return /^[A-Za-z0-9_-]{32,180}$/.test(token) ? token : '';
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function getProfile(userId: string) {
  const { data, error } = await admin.from('profiles')
    .select('id,account_status,license_expires_at')
    .eq('id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

function freeStatus(extra: Record<string, unknown> = {}) {
  return {
    allowed: true,
    mode: 'free',
    endsAt: null,
    remainingMs: FREE_MINUTES * 60 * 1000,
    freeMeetingMinutes: FREE_MINUTES,
    ...extra,
  };
}

async function meetingState(meeting: any) {
  const now = Date.now();
  if (!meeting || meeting.status !== 'active') {
    return { allowed: false, reason: 'meeting_ended', mode: 'none', endsAt: null };
  }

  const hostSeen = meeting.host_heartbeat_at ? Date.parse(meeting.host_heartbeat_at) : 0;
  if (hostSeen && now - hostSeen > HOST_OFFLINE_MS) {
    await admin.from('web_meetings').update({
      status: 'ended', ended_at: new Date().toISOString(), end_reason: 'host_offline',
    }).eq('room_code', meeting.room_code).eq('status', 'active');
    return { allowed: false, reason: 'host_offline', mode: 'none', endsAt: null };
  }

  let mode = 'free';
  let profile: any = null;
  if (meeting.manager_user_id) {
    profile = await getProfile(meeting.manager_user_id);
    if (!profile) return { allowed: false, reason: 'profile_missing', mode: 'none', endsAt: null };
    if (profile.account_status === 'blocked') {
      await admin.from('web_meetings').update({
        status: 'ended', ended_at: new Date().toISOString(), end_reason: 'account_blocked',
      }).eq('room_code', meeting.room_code).eq('status', 'active');
      return { allowed: false, reason: 'blocked', mode: 'blocked', endsAt: null };
    }
    const licenseEnds = profile.license_expires_at ? Date.parse(profile.license_expires_at) : 0;
    if (profile.account_status === 'licensed' && (!licenseEnds || licenseEnds > now)) mode = 'licensed';
  }

  if (mode === 'licensed') {
    return {
      allowed: true,
      mode: 'licensed',
      endsAt: null,
      remainingMs: null,
      licenseExpiresAt: profile?.license_expires_at || null,
    };
  }

  if (!meeting.participant_joined_at) return freeStatus({ guest: !meeting.manager_user_id });

  let endsAt = meeting.server_ends_at ? Date.parse(meeting.server_ends_at) : 0;
  if (!endsAt) {
    endsAt = now + FREE_MINUTES * 60 * 1000;
    const iso = new Date(endsAt).toISOString();
    await admin.from('web_meetings').update({ license_mode: 'free', server_ends_at: iso })
      .eq('room_code', meeting.room_code).eq('status', 'active');
  }

  if (endsAt <= now) {
    await admin.from('web_meetings').update({
      status: 'ended', ended_at: new Date().toISOString(), end_reason: 'free_limit_expired',
    }).eq('room_code', meeting.room_code).eq('status', 'active');
    return {
      allowed: false,
      reason: 'free_limit_expired',
      mode: 'free',
      endsAt: new Date(endsAt).toISOString(),
      remainingMs: 0,
    };
  }

  return {
    allowed: true,
    mode: 'free',
    guest: !meeting.manager_user_id,
    endsAt: new Date(endsAt).toISOString(),
    remainingMs: Math.max(0, endsAt - now),
    freeMeetingMinutes: FREE_MINUTES,
  };
}

async function checkedGuestMeeting(body: any) {
  const room = roomCode(body.room);
  const sid = sessionId(body.managerSessionId);
  const token = guestHostToken(body.guestHostToken);
  if (!room || !sid || !token) return { error: 'INVALID_REQUEST', room, sid, meeting: null };

  const { data: meeting, error } = await admin.from('web_meetings').select('*')
    .eq('room_code', room)
    .is('manager_user_id', null)
    .eq('manager_session_id', sid)
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw error;
  if (!meeting) return { error: 'MEETING_NOT_FOUND', room, sid, meeting: null };

  const tokenHash = await sha256Hex(token);
  if (!meeting.guest_host_token_hash || meeting.guest_host_token_hash !== tokenHash) {
    return { error: 'GUEST_HOST_INVALID', room, sid, meeting: null };
  }
  return { error: null, room, sid, meeting };
}

async function createGuest(req: Request, body: any) {
  const room = roomCode(body.room);
  const sid = sessionId(body.managerSessionId);
  const token = guestHostToken(body.guestHostToken);
  if (!room || !sid || !token) return json(req, 400, { error: 'INVALID_REQUEST' });

  const { data: existing, error: existingError } = await admin.from('web_meetings')
    .select('room_code,host_heartbeat_at')
    .is('manager_user_id', null)
    .eq('manager_session_id', sid)
    .eq('status', 'active')
    .limit(1);
  if (existingError) throw existingError;

  if (existing?.length) {
    const seen = existing[0].host_heartbeat_at ? Date.parse(existing[0].host_heartbeat_at) : 0;
    if (seen && Date.now() - seen <= HOST_OFFLINE_MS) {
      return json(req, 409, { error: 'ACTIVE_MEETING_EXISTS', room: existing[0].room_code });
    }
    await admin.from('web_meetings').update({
      status: 'ended', ended_at: new Date().toISOString(), end_reason: 'host_offline',
    }).eq('room_code', existing[0].room_code).eq('status', 'active');
  }

  const now = new Date().toISOString();
  const { error } = await admin.from('web_meetings').insert({
    room_code: room,
    manager_user_id: null,
    manager_session_id: sid,
    guest_host_token_hash: await sha256Hex(token),
    status: 'active',
    license_mode: 'free',
    participant_joined_at: null,
    server_ends_at: null,
    host_heartbeat_at: now,
    ended_at: null,
    end_reason: null,
  });
  if (error) {
    if (String(error.code) === '23505') return json(req, 409, { error: 'ROOM_COLLISION' });
    throw error;
  }
  return json(req, 200, { ok: true, room, status: freeStatus({ guest: true }) });
}

async function syncGuest(req: Request, body: any) {
  const checked = await checkedGuestMeeting(body);
  if (!checked.meeting) return json(req, checked.error === 'GUEST_HOST_INVALID' ? 403 : 404, { error: checked.error });

  const now = new Date().toISOString();
  const meeting = { ...checked.meeting, host_heartbeat_at: now };
  const status = await meetingState(meeting);
  if (!status.allowed) return json(req, 410, { error: status.reason, status });

  await admin.from('web_meetings').update({
    host_heartbeat_at: now,
    license_mode: 'free',
    server_ends_at: status.endsAt || null,
  }).eq('room_code', checked.room).is('manager_user_id', null).eq('manager_session_id', checked.sid).eq('status', 'active');

  return json(req, 200, { ok: true, status: { ...status, guest: true } });
}

async function endGuest(req: Request, body: any) {
  const checked = await checkedGuestMeeting(body);
  if (!checked.meeting) return json(req, checked.error === 'GUEST_HOST_INVALID' ? 403 : 404, { error: checked.error });
  await admin.from('web_meetings').update({
    status: 'ended',
    ended_at: new Date().toISOString(),
    end_reason: String(body.reason || 'manual').slice(0, 40),
  }).eq('room_code', checked.room).is('manager_user_id', null).eq('manager_session_id', checked.sid).eq('status', 'active');
  return json(req, 200, { ok: true });
}

async function joinMeeting(req: Request, body: any) {
  const room = roomCode(body.room);
  if (!room) return json(req, 400, { error: 'INVALID_ROOM' });
  const { data, error } = await admin.rpc('participant_join_meeting', { p_room_code: room });
  if (error) throw error;
  if (!data?.allowed) {
    const code = data?.reason === 'blocked' ? 403 : data?.reason === 'free_limit_expired' ? 402 : 409;
    return json(req, code, { error: data?.reason || 'MEETING_UNAVAILABLE', status: data });
  }
  return json(req, 200, { ok: true, status: data });
}

async function statusMeeting(req: Request, body: any) {
  const room = roomCode(body.room);
  if (!room) return json(req, 400, { error: 'INVALID_ROOM' });
  const { data: meeting, error } = await admin.from('web_meetings').select('*').eq('room_code', room).maybeSingle();
  if (error) throw error;
  if (!meeting) return json(req, 404, { error: 'MEETING_NOT_FOUND', status: { allowed: false, reason: 'meeting_not_found' } });
  const status = await meetingState(meeting);
  return json(req, status.allowed ? 200 : 410, { ok: status.allowed, status });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, 405, { error: 'METHOD_NOT_ALLOWED' });

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '');
    switch (action) {
      case 'meeting-create-guest': return await createGuest(req, body);
      case 'meeting-host-sync-guest': return await syncGuest(req, body);
      case 'manager-heartbeat-guest': return await syncGuest(req, body);
      case 'meeting-end-guest': return await endGuest(req, body);
      case 'meeting-join': return await joinMeeting(req, body);
      case 'meeting-status': return await statusMeeting(req, body);
      default: return json(req, 400, { error: 'UNKNOWN_ACTION' });
    }
  } catch (error) {
    console.error('MiniMeet guest edge error', error);
    return json(req, 500, { error: String((error as any)?.code || 'EDGE_FAILED') });
  }
});
