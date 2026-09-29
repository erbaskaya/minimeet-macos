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
    if (url.protocol !== 'https:') return false;
    return url.hostname.endsWith('.workers.dev') || url.hostname.endsWith('.minimeeting.pages.dev');
  } catch {
    return false;
  }
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { 'X-Client-Info': 'minimeet-edge' } },
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

async function requireUser(req: Request) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return { user: null, error: 'AUTH_REQUIRED' };
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return { user: null, error: 'AUTH_INVALID' };
  return { user: data.user, error: null };
}

async function getProfile(userId: string) {
  const { data, error } = await admin
    .from('profiles')
    .select('id,email,full_name,account_status,license_expires_at,is_admin,created_at,updated_at')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

function entitlement(profile: any, now = Date.now()) {
  if (!profile) return { allowed: false, mode: 'none', reason: 'profile_missing' };
  if (profile.account_status === 'blocked') return { allowed: false, mode: 'blocked', reason: 'blocked' };

  const licenseEnds = profile.license_expires_at ? Date.parse(profile.license_expires_at) : 0;
  const licensed = profile.account_status === 'licensed' && (!licenseEnds || licenseEnds > now);
  if (licensed) {
    return {
      allowed: true,
      mode: 'licensed',
      reason: null,
      licenseExpiresAt: profile.license_expires_at || null,
      endsAt: null,
      remainingMs: null,
    };
  }

  return {
    allowed: true,
    mode: 'free',
    reason: null,
    endsAt: null,
    remainingMs: FREE_MINUTES * 60 * 1000,
    freeMeetingMinutes: FREE_MINUTES,
  };
}

async function meetingState(meeting: any, profile: any) {
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

  const ent = entitlement(profile, now);
  if (!ent.allowed) {
    if (ent.reason === 'blocked') {
      await admin.from('web_meetings').update({
        status: 'ended', ended_at: new Date().toISOString(), end_reason: 'account_blocked',
      }).eq('room_code', meeting.room_code).eq('status', 'active');
    }
    return ent;
  }

  if (ent.mode === 'licensed') return { ...ent, endsAt: null, remainingMs: null };

  if (!meeting.participant_joined_at) {
    return { ...ent, endsAt: null, remainingMs: FREE_MINUTES * 60 * 1000 };
  }

  let endsAt = meeting.server_ends_at ? Date.parse(meeting.server_ends_at) : 0;
  if (!endsAt) {
    endsAt = now + FREE_MINUTES * 60 * 1000;
    const iso = new Date(endsAt).toISOString();
    await admin.from('web_meetings').update({ license_mode: 'free', server_ends_at: iso })
      .eq('room_code', meeting.room_code).eq('status', 'active');
    meeting.server_ends_at = iso;
  }

  if (endsAt <= now) {
    await admin.from('web_meetings').update({
      status: 'ended', ended_at: new Date().toISOString(), end_reason: 'free_limit_expired',
    }).eq('room_code', meeting.room_code).eq('status', 'active');
    return {
      allowed: false,
      mode: 'free',
      reason: 'free_limit_expired',
      endsAt: new Date(endsAt).toISOString(),
      remainingMs: 0,
    };
  }

  return {
    ...ent,
    endsAt: new Date(endsAt).toISOString(),
    remainingMs: Math.max(0, endsAt - now),
  };
}

async function actionAccountMe(req: Request) {
  const auth = await requireUser(req);
  if (!auth.user) return json(req, 401, { error: auth.error });
  const profile = await getProfile(auth.user.id);
  if (!profile) return json(req, 404, { error: 'PROFILE_NOT_FOUND' });
  return json(req, 200, {
    account: {
      ...profile,
      email: auth.user.email || profile.email,
      is_admin: Boolean(profile.is_admin),
      entitlement: entitlement(profile),
    },
  });
}

async function actionMeetingCreate(req: Request, body: any) {
  const auth = await requireUser(req);
  if (!auth.user) return json(req, 401, { error: auth.error });
  const room = roomCode(body.room);
  const sid = sessionId(body.managerSessionId);
  if (!room || !sid) return json(req, 400, { error: 'INVALID_REQUEST' });

  const profile = await getProfile(auth.user.id);
  const ent = entitlement(profile);
  if (!ent.allowed) return json(req, ent.reason === 'blocked' ? 403 : 402, { error: ent.reason, status: ent });

  const { data: lock, error: lockError } = await admin.rpc('acquire_manager_session', {
    p_user_id: auth.user.id,
    p_session_id: sid,
  });
  if (lockError) throw lockError;
  if (!lock?.ok) return json(req, 409, { error: lock?.code || 'SESSION_IN_USE' });

  const staleBefore = new Date(Date.now() - HOST_OFFLINE_MS).toISOString();
  await admin.from('web_meetings')
    .update({ status: 'ended', ended_at: new Date().toISOString(), end_reason: 'replaced' })
    .eq('manager_user_id', auth.user.id)
    .eq('status', 'active')
    .lt('host_heartbeat_at', staleBefore);

  const { data: existingActive } = await admin.from('web_meetings')
    .select('room_code,host_heartbeat_at')
    .eq('manager_user_id', auth.user.id)
    .eq('status', 'active')
    .neq('room_code', room)
    .limit(1);
  if (existingActive?.length) return json(req, 409, { error: 'ACTIVE_MEETING_EXISTS', room: existingActive[0].room_code });

  const now = new Date().toISOString();
  const { error } = await admin.from('web_meetings').insert({
    room_code: room,
    manager_user_id: auth.user.id,
    manager_session_id: sid,
    status: 'active',
    license_mode: ent.mode,
    server_ends_at: null,
    host_heartbeat_at: now,
    participant_joined_at: null,
    ended_at: null,
    end_reason: null,
  });
  if (error) {
    if (String(error.code) === '23505') return json(req, 409, { error: 'ROOM_COLLISION' });
    throw error;
  }
  return json(req, 200, { ok: true, room, status: ent });
}

async function actionHostSync(req: Request, body: any) {
  const auth = await requireUser(req);
  if (!auth.user) return json(req, 401, { error: auth.error });
  const room = roomCode(body.room);
  const sid = sessionId(body.managerSessionId);
  if (!room || !sid) return json(req, 400, { error: 'INVALID_REQUEST' });

  const { data: meeting, error } = await admin.from('web_meetings').select('*')
    .eq('room_code', room).eq('manager_user_id', auth.user.id).maybeSingle();
  if (error) throw error;
  if (!meeting) return json(req, 404, { error: 'MEETING_NOT_FOUND' });
  if (meeting.manager_session_id !== sid) return json(req, 409, { error: 'SESSION_MISMATCH' });

  const { data: beat, error: beatError } = await admin.rpc('heartbeat_manager_session', {
    p_user_id: auth.user.id,
    p_session_id: sid,
    p_room_code: room,
  });
  if (beatError) throw beatError;
  if (!beat?.ok) return json(req, 409, { error: beat?.code || 'SESSION_INVALID' });

  const profile = await getProfile(auth.user.id);
  const status = await meetingState({ ...meeting, host_heartbeat_at: new Date().toISOString() }, profile);
  if (!status.allowed) return json(req, status.reason === 'blocked' ? 403 : 402, { error: status.reason, status });

  await admin.from('web_meetings').update({
    license_mode: status.mode,
    server_ends_at: status.mode === 'free' ? (status.endsAt || null) : null,
    host_heartbeat_at: new Date().toISOString(),
  }).eq('room_code', room).eq('manager_user_id', auth.user.id);

  return json(req, 200, { ok: true, status });
}

async function actionManagerHeartbeat(req: Request, body: any) {
  const auth = await requireUser(req);
  if (!auth.user) return json(req, 401, { error: auth.error });
  const sid = sessionId(body.managerSessionId);
  const room = roomCode(body.room);
  const op = String(body.op || 'heartbeat');
  if (!sid) return json(req, 400, { error: 'INVALID_SESSION_ID' });

  if (op === 'release') {
    await admin.rpc('release_manager_session', { p_user_id: auth.user.id, p_session_id: sid });
    if (room) {
      await admin.from('web_meetings').update({
        status: 'ended', ended_at: new Date().toISOString(), end_reason: 'manager_left',
      }).eq('room_code', room).eq('manager_user_id', auth.user.id).eq('status', 'active');
    }
    return json(req, 200, { ok: true });
  }

  const { data, error } = await admin.rpc('heartbeat_manager_session', {
    p_user_id: auth.user.id,
    p_session_id: sid,
    p_room_code: room || null,
  });
  if (error) throw error;
  if (!data?.ok) return json(req, 409, { error: data?.code || 'SESSION_INVALID' });

  const profile = await getProfile(auth.user.id);
  let status = entitlement(profile);
  if (room) {
    const { data: meeting } = await admin.from('web_meetings').select('*')
      .eq('room_code', room).eq('manager_user_id', auth.user.id).maybeSingle();
    if (meeting) status = await meetingState({ ...meeting, host_heartbeat_at: new Date().toISOString() }, profile);
  }
  return json(req, 200, { ok: true, status });
}

async function actionMeetingEnd(req: Request, body: any) {
  const auth = await requireUser(req);
  if (!auth.user) return json(req, 401, { error: auth.error });
  const room = roomCode(body.room);
  const sid = sessionId(body.managerSessionId);
  if (!room || !sid) return json(req, 400, { error: 'INVALID_REQUEST' });

  await admin.from('web_meetings').update({
    status: 'ended',
    ended_at: new Date().toISOString(),
    end_reason: String(body.reason || 'manual').slice(0, 40),
  }).eq('room_code', room).eq('manager_user_id', auth.user.id).eq('manager_session_id', sid);
  await admin.rpc('release_manager_session', { p_user_id: auth.user.id, p_session_id: sid });
  return json(req, 200, { ok: true });
}

async function actionMeetingJoin(req: Request, body: any) {
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

async function actionMeetingStatus(req: Request, body: any) {
  const room = roomCode(body.room);
  if (!room) return json(req, 400, { error: 'INVALID_ROOM' });
  const { data: meeting, error } = await admin.from('web_meetings').select('*').eq('room_code', room).maybeSingle();
  if (error) throw error;
  if (!meeting) return json(req, 404, { error: 'MEETING_NOT_FOUND', status: { allowed: false, reason: 'meeting_not_found' } });
  const profile = await getProfile(meeting.manager_user_id);
  const status = await meetingState(meeting, profile);
  return json(req, status.allowed ? 200 : 410, { ok: status.allowed, status });
}

async function actionAdminUsers(req: Request, body: any) {
  const auth = await requireUser(req);
  if (!auth.user) return json(req, 401, { error: auth.error });
  const ownProfile = await getProfile(auth.user.id);
  if (!ownProfile?.is_admin) return json(req, 403, { error: 'ADMIN_REQUIRED' });

  const search = String(body.q || '').trim().replace(/[^a-zA-Z0-9@.+\- çğıöşüÇĞİÖŞÜ]/g, '').slice(0, 80);
  let query = admin.from('profiles')
    .select('id,email,full_name,account_status,license_expires_at,is_admin,created_at,updated_at')
    .order('created_at', { ascending: false })
    .limit(200);
  if (search) query = query.or(`email.ilike.%${search}%,full_name.ilike.%${search}%`);
  const { data, error } = await query;
  if (error) throw error;
  return json(req, 200, { users: data || [] });
}

async function actionAdminLicense(req: Request, body: any) {
  const auth = await requireUser(req);
  if (!auth.user) return json(req, 401, { error: auth.error });
  const ownProfile = await getProfile(auth.user.id);
  if (!ownProfile?.is_admin) return json(req, 403, { error: 'ADMIN_REQUIRED' });

  const userId = String(body.userId || '');
  const status = String(body.status || '');
  if (!/^[0-9a-f-]{36}$/i.test(userId) || !['free', 'licensed', 'blocked'].includes(status)) {
    return json(req, 400, { error: 'INVALID_REQUEST' });
  }

  let licenseExpiresAt = null;
  if (status === 'licensed' && body.licenseExpiresAt) {
    const parsed = Date.parse(String(body.licenseExpiresAt));
    if (!Number.isFinite(parsed)) return json(req, 400, { error: 'INVALID_LICENSE_DATE' });
    licenseExpiresAt = new Date(parsed).toISOString();
  }

  const { data, error } = await admin.from('profiles').update({
    account_status: status,
    license_expires_at: licenseExpiresAt,
    updated_at: new Date().toISOString(),
  }).eq('id', userId)
    .select('id,email,full_name,account_status,license_expires_at,is_admin,created_at,updated_at')
    .single();
  if (error) throw error;

  if (status === 'blocked') {
    await admin.from('web_meetings').update({
      status: 'ended', ended_at: new Date().toISOString(), end_reason: 'account_blocked',
    }).eq('manager_user_id', userId).eq('status', 'active');
  }

  return json(req, 200, { ok: true, user: data });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, 405, { error: 'METHOD_NOT_ALLOWED' });

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '');
    switch (action) {
      case 'account-me': return await actionAccountMe(req);
      case 'meeting-create': return await actionMeetingCreate(req, body);
      case 'meeting-host-sync': return await actionHostSync(req, body);
      case 'manager-heartbeat': return await actionManagerHeartbeat(req, body);
      case 'meeting-end': return await actionMeetingEnd(req, body);
      case 'meeting-join': return await actionMeetingJoin(req, body);
      case 'meeting-status': return await actionMeetingStatus(req, body);
      case 'admin-users': return await actionAdminUsers(req, body);
      case 'admin-license': return await actionAdminLicense(req, body);
      default: return json(req, 400, { error: 'UNKNOWN_ACTION' });
    }
  } catch (error) {
    console.error('MiniMeet Edge error', error);
    return json(req, 500, { error: String((error as any)?.code || 'EDGE_FAILED') });
  }
});
