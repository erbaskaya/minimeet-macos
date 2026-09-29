(() => {
  const config = {
    supabaseUrl: 'https://sytwiwiykolfgypiusdw.supabase.co',
    supabaseKey: 'sb_publishable_FOO3HshSIy9Nox-zOqvd_w_i5FRTOeg',
    edgeUrl: '/api/minimeet',
    guestEdgeUrl: '/api/minimeet-guest',
    licenseContactUrl: 'mailto:erbaskayam@gmail.com?subject=MiniMeet%20S%C3%BCresiz%20Lisans',
    licenseContactEmail: 'erbaskayam@gmail.com',
    freeMeetingMinutes: 59,
  };

  let client = null;
  let initPromise = null;
  let accountCache = null;
  let participantWatch = null;
  let managerWatch = null;
  const managerSessionKey = 'minimeet-manager-session-id';

  function getManagerSessionId() {
    let id = sessionStorage.getItem(managerSessionKey) || '';
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      id = crypto.randomUUID();
      sessionStorage.setItem(managerSessionKey, id);
    }
    return id;
  }


  function guestTokenKey(room) {
    return `minimeet-guest-host-${String(room || '').toUpperCase()}`;
  }

  function newGuestToken() {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    let binary = '';
    bytes.forEach((b) => { binary += String.fromCharCode(b); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function getGuestHostToken(room, create = false) {
    const key = guestTokenKey(room);
    let token = sessionStorage.getItem(key) || '';
    if (!token && create) {
      token = newGuestToken();
      sessionStorage.setItem(key, token);
    }
    return token;
  }

  function clearGuestHostToken(room) {
    sessionStorage.removeItem(guestTokenKey(room));
  }

  async function init() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      if (!window.supabase?.createClient) throw new Error('Supabase kutuphanesi yuklenemedi.');
      client = window.supabase.createClient(config.supabaseUrl, config.supabaseKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storageKey: 'minimeet-auth',
        },
      });
      client.auth.onAuthStateChange(() => { accountCache = null; });
      return client;
    })();
    return initPromise;
  }

  async function session() {
    await init();
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    return data?.session || null;
  }

  async function edgeFetch(action, payload = {}, { auth = false, retry = true } = {}) {
    await init();
    const headers = new Headers({
      'Content-Type': 'application/json',
      'apikey': config.supabaseKey,
    });

    if (auth) {
      const current = await session();
      if (!current?.access_token) {
        const error = new Error('AUTH_REQUIRED');
        error.code = 'AUTH_REQUIRED';
        throw error;
      }
      headers.set('Authorization', `Bearer ${current.access_token}`);
    }

    const response = await fetch(config.edgeUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action, ...payload }),
      cache: 'no-store',
    });

    if (response.status === 401 && auth && retry) {
      await client.auth.refreshSession();
      return edgeFetch(action, payload, { auth, retry: false });
    }

    const data = await response.json().catch(() => ({}));
    return { response, data };
  }

  async function edgeCall(action, payload = {}, options = {}) {
    const { response, data } = await edgeFetch(action, payload, options);
    if (!response.ok) {
      const error = new Error(data.error || 'REQUEST_FAILED');
      error.code = data.error || 'REQUEST_FAILED';
      error.status = response.status;
      error.payload = data;
      throw error;
    }
    return data;
  }


  async function guestEdgeFetch(action, payload = {}) {
    await init();
    const response = await fetch(config.guestEdgeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': config.supabaseKey,
      },
      body: JSON.stringify({ action, ...payload }),
      cache: 'no-store',
    });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  }

  async function guestEdgeCall(action, payload = {}) {
    const { response, data } = await guestEdgeFetch(action, payload);
    if (!response.ok) {
      const error = new Error(data.error || 'REQUEST_FAILED');
      error.code = data.error || 'REQUEST_FAILED';
      error.status = response.status;
      error.payload = data;
      throw error;
    }
    return data;
  }

  async function getAccount(force = false) {
    await init();
    if (accountCache && !force) return accountCache;
    const current = await session();
    if (!current) {
      accountCache = null;
      return null;
    }
    try {
      const data = await edgeCall('account-me', {}, { auth: true });
      accountCache = data.account || null;
      return accountCache;
    } catch (error) {
      if (error.status === 401) return null;
      throw error;
    }
  }

  async function signUp({ email, password, fullName }) {
    await init();
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanName = String(fullName || '').trim();
    if (!cleanEmail || !cleanName) throw new Error('Ad soyad ve e-posta zorunludur.');
    if (String(password || '').length < 8) throw new Error('Sifre en az 8 karakter olmalidir.');
    const { data, error } = await client.auth.signUp({
      email: cleanEmail,
      password,
      options: {
        data: { full_name: cleanName },
        emailRedirectTo: `${location.origin}/`,
      },
    });
    if (error) throw error;
    accountCache = null;
    return data;
  }

  async function signIn({ email, password }) {
    await init();
    const { data, error } = await client.auth.signInWithPassword({
      email: String(email || '').trim().toLowerCase(),
      password: String(password || ''),
    });
    if (error) throw error;
    accountCache = null;
    return data;
  }

  async function requestPasswordReset(email) {
    await init();
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!cleanEmail) throw new Error('E-posta adresinizi yazın.');
    const { error } = await client.auth.resetPasswordForEmail(cleanEmail, {
      redirectTo: `${location.origin}/?reset=1`,
    });
    if (error) throw error;
    return true;
  }

  async function updatePassword(password) {
    await init();
    if (String(password || '').length < 8) throw new Error('Yeni şifre en az 8 karakter olmalıdır.');
    const { error } = await client.auth.updateUser({ password: String(password) });
    if (error) throw error;
    accountCache = null;
    return true;
  }

  async function signOut() {
    stopWatches();
    try {
      const current = await session();
      if (current) await releaseManagerSession().catch(() => {});
    } catch {}
    await client?.auth?.signOut();
    accountCache = null;
  }

  async function createMeeting(room, options = {}) {
    const forceGuest = Boolean(options?.guest);
    const current = forceGuest ? null : await session();
    if (current) {
      return edgeCall('meeting-create', { room, managerSessionId: getManagerSessionId() }, { auth: true });
    }
    const guestHostToken = getGuestHostToken(room, true);
    return guestEdgeCall('meeting-create-guest', {
      room,
      managerSessionId: getManagerSessionId(),
      guestHostToken,
    });
  }

  async function hostSyncMeeting(room) {
    const guestHostToken = getGuestHostToken(room, false);
    if (guestHostToken) {
      return guestEdgeCall('meeting-host-sync-guest', {
        room,
        managerSessionId: getManagerSessionId(),
        guestHostToken,
      }, { auth: false });
    }
    return edgeCall('meeting-host-sync', { room, managerSessionId: getManagerSessionId() }, { auth: true });
  }

  async function managerHeartbeat(room = '') {
    const guestHostToken = room ? getGuestHostToken(room, false) : '';
    if (guestHostToken) {
      return guestEdgeCall('manager-heartbeat-guest', {
        room,
        managerSessionId: getManagerSessionId(),
        guestHostToken,
      }, { auth: false });
    }
    return edgeCall('manager-heartbeat', {
      op: 'heartbeat',
      room,
      managerSessionId: getManagerSessionId(),
    }, { auth: true });
  }

  async function releaseManagerSession(room = '') {
    const guestHostToken = room ? getGuestHostToken(room, false) : '';
    if (guestHostToken) {
      try {
        return await guestEdgeCall('meeting-end-guest', {
          room,
          reason: 'manager_left',
          managerSessionId: getManagerSessionId(),
          guestHostToken,
        }, { auth: false });
      } finally {
        clearGuestHostToken(room);
      }
    }
    const current = await session();
    if (!current) return { ok: true };
    return edgeCall('manager-heartbeat', {
      op: 'release',
      room,
      managerSessionId: getManagerSessionId(),
    }, { auth: true });
  }

  async function endMeeting(room, reason = 'manual') {
    const guestHostToken = getGuestHostToken(room, false);
    if (guestHostToken) {
      try {
        return await guestEdgeCall('meeting-end-guest', {
          room,
          reason,
          managerSessionId: getManagerSessionId(),
          guestHostToken,
        }, { auth: false });
      } finally {
        clearGuestHostToken(room);
      }
    }
    return edgeCall('meeting-end', {
      room,
      reason,
      managerSessionId: getManagerSessionId(),
    }, { auth: true });
  }

  function legacyDesktopMeetingStatus() {
    return {
      allowed: true,
      mode: 'legacy',
      serverManaged: false,
      legacyDesktop: true,
      endsAt: null,
      remainingMs: null,
    };
  }

  async function participantJoin(room) {
    const { response, data } = await guestEdgeFetch('meeting-join', { room });
    if (response.ok) return data;

    // Windows / macOS masaüstü MiniMeet toplantıları Supabase web_meetings
    // tablosunda kayıtlı olmayabilir. PeerJS bağlantısı zaten açıldıysa 404
    // durumunda eski masaüstü toplantısını engelleme.
    if (response.status === 404 && data.error === 'MEETING_NOT_FOUND') {
      return { ok: true, status: legacyDesktopMeetingStatus() };
    }

    const error = new Error(data.error || 'REQUEST_FAILED');
    error.code = data.error || 'REQUEST_FAILED';
    error.status = response.status;
    error.payload = data;
    throw error;
  }

  async function meetingStatus(room) {
    const { response, data } = await guestEdgeFetch('meeting-status', { room });
    if (response.ok || response.status === 410) {
      return data.status || { allowed: false, reason: data.error || 'meeting_unavailable' };
    }

    // Veritabanında bulunmayan kod, masaüstü EXE/DMG tarafından oluşturulmuş
    // bir toplantı olabilir. Bu durumda ön katılım ekranını kapatma; gerçek
    // geçerlilik PeerJS yöneticisine bağlanırken doğrulanır.
    if (response.status === 404 && data.error === 'MEETING_NOT_FOUND') {
      return legacyDesktopMeetingStatus();
    }

    const error = new Error(data.error || 'MEETING_STATUS_FAILED');
    error.code = data.error || 'MEETING_STATUS_FAILED';
    error.payload = data;
    throw error;
  }

  function startParticipantWatch(room, callback) {
    clearInterval(participantWatch);
    const tick = async () => {
      try { callback(await meetingStatus(room)); }
      catch (error) { console.warn('MiniMeet meeting watch', error); }
    };
    participantWatch = setInterval(tick, 30000);
    return tick();
  }

  function startManagerWatch(room, callback) {
    clearInterval(managerWatch);
    const tick = async () => {
      try {
        const result = await managerHeartbeat(room);
        callback(result.status || null);
      } catch (error) {
        if (['SESSION_INVALID', 'SESSION_IN_USE'].includes(error.code)) callback({ allowed: false, reason: 'session_invalid' });
        else console.warn('MiniMeet manager watch', error);
      }
    };
    managerWatch = setInterval(tick, 30000);
    return tick();
  }

  function stopWatches() {
    clearInterval(participantWatch);
    clearInterval(managerWatch);
    participantWatch = null;
    managerWatch = null;
  }

  async function adminUsers(q = '') {
    const data = await edgeCall('admin-users', { q }, { auth: true });
    return data.users || [];
  }

  async function adminSetLicense(userId, status, licenseExpiresAt = null) {
    return edgeCall('admin-license', { userId, status, licenseExpiresAt }, { auth: true });
  }

  function getConfig() { return config; }

  window.MiniMeetAuth = {
    init,
    session,
    getAccount,
    signUp,
    signIn,
    signOut,
    requestPasswordReset,
    updatePassword,
    createMeeting,
    hostSyncMeeting,
    managerHeartbeat,
    releaseManagerSession,
    endMeeting,
    participantJoin,
    meetingStatus,
    startParticipantWatch,
    startManagerWatch,
    stopWatches,
    adminUsers,
    adminSetLicense,
    getManagerSessionId,
    getGuestHostToken,
    getConfig,
  };
})();
