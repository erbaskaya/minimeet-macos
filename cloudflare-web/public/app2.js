function buildMediaConstraints() {
  const video = state.selectedVideoId
    ? { deviceId: { exact: state.selectedVideoId }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } }
    : { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } };
  const audio = state.selectedAudioId
    ? { deviceId: { exact: state.selectedAudioId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    : { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  return { video, audio };
}

function genericMediaConstraints() {
  return {
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } },
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  };
}

function syncSelectedDevicesFromStream(stream) {
  const videoId = stream?.getVideoTracks?.()[0]?.getSettings?.().deviceId || '';
  const audioId = stream?.getAudioTracks?.()[0]?.getSettings?.().deviceId || '';
  if (videoId) {
    state.selectedVideoId = videoId;
    try { localStorage.setItem('minimeet-video-device', videoId); } catch {}
  }
  if (audioId) {
    state.selectedAudioId = audioId;
    try { localStorage.setItem('minimeet-audio-device', audioId); } catch {}
  }
}

async function acquirePreferredMedia() {
  try {
    return await navigator.mediaDevices.getUserMedia(buildMediaConstraints());
  } catch (firstError) {
    const name = String(firstError?.name || '');
    if (name === 'NotAllowedError' || name === 'SecurityError') throw firstError;

    console.warn('Kayitli kamera/mikrofon aygiti acilamadi; varsayilan aygitlarla yeniden deneniyor.', firstError);
    state.selectedVideoId = '';
    state.selectedAudioId = '';
    try {
      localStorage.removeItem('minimeet-video-device');
      localStorage.removeItem('minimeet-audio-device');
    } catch {}

    return navigator.mediaDevices.getUserMedia(genericMediaConstraints());
  }
}

function backgroundModeLabel(mode = state.backgroundMode) {
  if (mode === 'blur') return 'Bulanık (Orta)';
  if (mode === 'image') return 'Arka Plan Resmi';
  return 'Normal';
}

function syncBackgroundControls() {
  ['#pre-background-select', '#room-background-select'].forEach((selector) => {
    const select = $(selector);
    if (select) select.value = state.backgroundMode;
  });
  const status = $('#background-status');
  if (status) status.textContent = `Arka plan: ${backgroundModeLabel()}`;
  document.querySelectorAll('.background-image-btn').forEach((button) => {
    button.textContent = state.backgroundImageData ? 'Resmi değiştir' : 'Resim seç';
  });
}

async function buildEffectiveStream(rawStream, mode = state.backgroundMode, imageData = state.backgroundImageData) {
  if (!window.MiniMeetBackground || mode === 'normal' || !rawStream?.getVideoTracks?.().length) {
    return { stream: rawStream, processor: null, mode: 'normal' };
  }
  return window.MiniMeetBackground.createProcessedStream(rawStream, { mode, imageData });
}

function applyEnabledStateToStreams() {
  state.rawLocalStream?.getVideoTracks().forEach((track) => { track.enabled = state.cameraEnabled; });
  state.rawLocalStream?.getAudioTracks().forEach((track) => { track.enabled = state.micEnabled; });
  state.localStream?.getVideoTracks().forEach((track) => { track.enabled = state.cameraEnabled; });
  state.localStream?.getAudioTracks().forEach((track) => { track.enabled = state.micEnabled; });
}

function refreshLocalStreamViews() {
  const preview = $('#preview-video');
  if (preview) {
    preview.srcObject = state.localStream;
    preview.play?.().catch(() => {});
  }
  attachLocalCamera?.();
  updateCameraPlaceholders?.();
}

async function rebuildBackgroundEffect(nextMode = state.backgroundMode) {
  if (!state.rawLocalStream || state.backgroundUpdating) return;
  state.backgroundUpdating = true;
  const previousProcessor = state.backgroundProcessor;
  try {
    const result = await buildEffectiveStream(state.rawLocalStream, nextMode, state.backgroundImageData);
    state.backgroundMode = nextMode;
    state.backgroundProcessor = result.processor;
    state.localStream = result.stream;
    applyEnabledStateToStreams();
    refreshLocalStreamViews();
    await replaceOutgoingTracks(state.localStream);
    previousProcessor?.stop?.();
    window.MiniMeetBackground?.setMode?.(state.backgroundMode);
    syncBackgroundControls();
    sendSignal?.({ type: 'media-state', mic: state.micEnabled, camera: state.cameraEnabled });
  } catch (error) {
    console.warn('Arka plan efekti uygulanamadı', error);
    toast(error?.message || 'Arka plan efekti uygulanamadı.', 4500);
    state.backgroundMode = 'normal';
    window.MiniMeetBackground?.setMode?.('normal');
    syncBackgroundControls();
  } finally {
    state.backgroundUpdating = false;
  }
}

async function setBackgroundMode(mode) {
  const next = ['normal', 'blur', 'image'].includes(mode) ? mode : 'normal';
  if (next === 'image' && !state.backgroundImageData) {
    $('#background-image-input')?.click();
    syncBackgroundControls();
    return;
  }
  await rebuildBackgroundEffect(next);
}

async function setCustomBackgroundFile(file) {
  if (!file) return;
  try {
    const data = await window.MiniMeetBackground.prepareImageFile(file);
    state.backgroundImageData = data;
    window.MiniMeetBackground.setImageData(data);
    await rebuildBackgroundEffect('image');
  } catch (error) {
    console.warn(error);
    toast(error?.message || 'Arka plan resmi seçilemedi.', 4200);
    syncBackgroundControls();
  }
}

async function prepareMedia() {
  const permissionOk = await window.MiniMeetPermissions?.ensureBeforeMeeting?.();
  if (permissionOk === false) {
    state.cameraEnabled = false;
    state.micEnabled = false;
    updatePrejoinButtons();
    return false;
  }

  let rawStream;
  try {
    rawStream = await acquirePreferredMedia();
  } catch (error) {
    console.error(error);
    await window.MiniMeetPermissions?.handleMediaError?.(error);
    toast('Kamera/mikrofon açılamadı. Tarayıcı izinlerini kontrol edin.', 4500);
    try {
      rawStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      state.cameraEnabled = false;
    } catch {
      rawStream = new MediaStream();
      state.cameraEnabled = false;
      state.micEnabled = false;
    }
  }

  const previousRawStream = state.rawLocalStream;
  const previousBackgroundProcessor = state.backgroundProcessor;
  state.rawLocalStream = rawStream;
  syncSelectedDevicesFromStream(rawStream);
  try {
    const result = await buildEffectiveStream(rawStream);
    state.localStream = result.stream;
    state.backgroundProcessor = result.processor;
  } catch (error) {
    console.warn('Kaydedilmiş arka plan efekti açılamadı, normal kamera kullanılıyor.', error);
    state.backgroundMode = 'normal';
    window.MiniMeetBackground?.setMode?.('normal');
    state.localStream = rawStream;
    state.backgroundProcessor = null;
  }

  applyEnabledStateToStreams();
  refreshLocalStreamViews();
  previousBackgroundProcessor?.stop?.();
  if (previousRawStream && previousRawStream !== rawStream) previousRawStream.getTracks().forEach((track) => track.stop());
  await refreshDeviceLists();
  syncBackgroundControls();
  updatePrejoinButtons();
  return true;
}

function updatePrejoinButtons() {
  const cam = $('#pre-cam');
  const mic = $('#pre-mic');
  if (cam) {
    cam.classList.toggle('off', !state.cameraEnabled);
    cam.textContent = state.cameraEnabled ? '🎥 Kamera açık' : '🚫 Kamera kapalı';
  }
  if (mic) {
    mic.classList.toggle('off', !state.micEnabled);
    mic.textContent = state.micEnabled ? '🎤 Mikrofon açık' : '🔇 Mikrofon kapalı';
  }
}

function fillDeviceSelect(select, devices, selectedId, fallbackText) {
  if (!select) return;
  const current = selectedId || select.value;
  select.innerHTML = '';
  devices.forEach((device, index) => {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = device.label || `${fallbackText} ${index + 1}`;
    if (device.deviceId === current) option.selected = true;
    select.append(option);
  });
  if (!select.value && select.options.length) select.selectedIndex = 0;
}

async function refreshDeviceLists() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter((d) => d.kind === 'videoinput');
    const mics = devices.filter((d) => d.kind === 'audioinput');

    if (!state.selectedVideoId && cameras[0]) state.selectedVideoId = cameras[0].deviceId;
    if (!state.selectedAudioId && mics[0]) state.selectedAudioId = mics[0].deviceId;

    fillDeviceSelect($('#pre-camera-select'), cameras, state.selectedVideoId, 'Kamera');
    fillDeviceSelect($('#pre-mic-select'), mics, state.selectedAudioId, 'Mikrofon');
    fillDeviceSelect($('#room-camera-select'), cameras, state.selectedVideoId, 'Kamera');
    fillDeviceSelect($('#room-mic-select'), mics, state.selectedAudioId, 'Mikrofon');
  } catch (error) {
    console.warn('Aygıt listesi alınamadı', error);
  }
}

async function replaceOutgoingTracks(stream) {
  const pc = state.avCall?.peerConnection;
  if (!pc) return;
  const senders = pc.getSenders?.() || [];
  for (const kind of ['audio', 'video']) {
    const sender = senders.find((s) => s.track?.kind === kind || (!s.track && kind === 'video'));
    const nextTrack = stream.getTracks().find((t) => t.kind === kind) || null;
    if (sender && nextTrack) {
      try { await sender.replaceTrack(nextTrack); } catch (error) { console.warn(`${kind} track değiştirilemedi`, error); }
    }
  }
}

async function switchMediaDevices({ videoId = state.selectedVideoId, audioId = state.selectedAudioId } = {}) {
  state.selectedVideoId = videoId || '';
  state.selectedAudioId = audioId || '';
  if (state.selectedVideoId) localStorage.setItem('minimeet-video-device', state.selectedVideoId);
  if (state.selectedAudioId) localStorage.setItem('minimeet-audio-device', state.selectedAudioId);

  let nextRaw;
  try {
    nextRaw = await acquirePreferredMedia();
  } catch (error) {
    toast('Seçilen kamera veya mikrofon açılamadı.', 4200);
    console.warn(error);
    return false;
  }

  syncSelectedDevicesFromStream(nextRaw);
  nextRaw.getVideoTracks().forEach((t) => { t.enabled = state.cameraEnabled; });
  nextRaw.getAudioTracks().forEach((t) => { t.enabled = state.micEnabled; });

  let result;
  try {
    result = await buildEffectiveStream(nextRaw);
  } catch (error) {
    console.warn('Arka plan efekti yeni aygıtta uygulanamadı.', error);
    toast('Arka plan efekti uygulanamadı; normal kamera ile devam ediliyor.', 3600);
    state.backgroundMode = 'normal';
    window.MiniMeetBackground?.setMode?.('normal');
    result = { stream: nextRaw, processor: null };
  }

  const oldRaw = state.rawLocalStream;
  const oldProcessor = state.backgroundProcessor;
  state.rawLocalStream = nextRaw;
  state.backgroundProcessor = result.processor;
  state.localStream = result.stream;
  applyEnabledStateToStreams();
  refreshLocalStreamViews();
  await replaceOutgoingTracks(state.localStream);
  oldProcessor?.stop?.();
  oldRaw?.getTracks().forEach((t) => t.stop());
  await refreshDeviceLists();
  syncBackgroundControls();
  sendSignal({ type: 'media-state', mic: state.micEnabled, camera: state.cameraEnabled });
  return true;
}

function updateRemoteName(name) {
  const cleanName = String(name || '').trim().slice(0, 50);
  if (!cleanName) return;
  state.remoteName = cleanName;
  const label = document.querySelector('.remote-cam .cam-label');
  if (label) label.textContent = cleanName;
}


function readManagerDurationSelection() {
  if (state.durationMode === 'unlimited') return { ok: true, mode: 'unlimited', minutes: 0 };
  if (state.durationMode === 'timed' && Number.isFinite(state.durationMinutes) && state.durationMinutes >= 1) {
    return { ok: true, mode: 'timed', minutes: state.durationMinutes };
  }
  const selected = document.querySelector('input[name="duration-mode"]:checked')?.value || '';
  if (!selected) return { ok: false, message: 'Toplantı süresini seçin: Süresiz veya Süreli.' };
  if (selected === 'unlimited') return { ok: true, mode: 'unlimited', minutes: 0 };
  const raw = Number.parseInt($('#duration-minutes')?.value || '', 10);
  if (!Number.isFinite(raw) || raw < 1 || raw > 1440) {
    return { ok: false, message: 'Süreli toplantı için 1 ile 1440 arasında dakika yazın.' };
  }
  return { ok: true, mode: 'timed', minutes: raw };
}

function bindDurationControls() {
  const radios = document.querySelectorAll('input[name="duration-mode"]');
  const row = $('#duration-minutes-row');
  const input = $('#duration-minutes');
  radios.forEach((radio) => radio.addEventListener('change', () => {
    const timed = radio.checked && radio.value === 'timed';
    const selectedTimed = document.querySelector('input[name="duration-mode"]:checked')?.value === 'timed';
    row?.classList.toggle('hidden', !selectedTimed);
    if (selectedTimed) setTimeout(() => input?.focus(), 0);
  }));
}

function bindRoomControls() {
  const role = state.role;
  if (role === 'teacher') bindDurationControls();
  const participantUrl = `${location.origin}/ders/${state.room}?role=student`;
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(participantUrl);
      toast('Katılım bağlantısı kopyalandı.');
    } catch {
      prompt('Katılım bağlantısı:', participantUrl);
    }
  };

  $('#copy-btn')?.addEventListener('click', copyLink);
  $('#copy-link-top')?.addEventListener('click', copyLink);

  $('#prejoin-home')?.addEventListener('click', async () => {
    const button = $('#prejoin-home');
    if (button) {
      button.disabled = true;
      button.textContent = 'Ana sayfaya dönülüyor…';
    }

    const room = state.room;
    const role = state.role;
    cleanup(false);

    if (role === 'teacher' && room) {
      try { await window.MiniMeetAuth?.endMeeting?.(room, 'cancelled'); } catch (error) { console.warn('Hazırlık toplantısı kapatılamadı', error); }
      try { await window.MiniMeetAuth?.releaseManagerSession?.(room); } catch (error) { console.warn('Yönetici oturumu bırakılamadı', error); }
      sessionStorage.removeItem(hostNameStorageKey(room));
      sessionStorage.removeItem(durationModeStorageKey(room));
      sessionStorage.removeItem(durationMinutesStorageKey(room));
      sessionStorage.removeItem(`minimeet-server-plan-${room}`);
    }

    location.href = '/';
  });

  $('#pre-cam')?.addEventListener('click', async () => {
    const enabling = !state.cameraEnabled;
    state.cameraEnabled = enabling;

    if (enabling) {
      const hasLiveVideo = Boolean(state.rawLocalStream?.getVideoTracks?.().some((track) => track.readyState === 'live'));
      if (!hasLiveVideo) {
        updatePrejoinButtons();
        const reopened = await switchMediaDevices();
        const recovered = Boolean(state.rawLocalStream?.getVideoTracks?.().some((track) => track.readyState === 'live'));
        if (!reopened || !recovered) {
          state.cameraEnabled = false;
          toast('Kamera yeniden açılamadı. Kamera iznini ve başka bir uygulamanın kamerayı kullanıp kullanmadığını kontrol edin.', 5200);
        }
      } else {
        setTrackEnabled('video', true);
      }
    } else {
      setTrackEnabled('video', false);
    }
    updatePrejoinButtons();
  });

  $('#pre-mic')?.addEventListener('click', () => {
    state.micEnabled = !state.micEnabled;
    setTrackEnabled('audio', state.micEnabled);
    updatePrejoinButtons();
  });

  $('#pre-camera-select')?.addEventListener('change', (e) => switchMediaDevices({ videoId: e.target.value }));
  $('#pre-mic-select')?.addEventListener('change', (e) => switchMediaDevices({ audioId: e.target.value }));
  $('#room-camera-select')?.addEventListener('change', (e) => switchMediaDevices({ videoId: e.target.value }));
  $('#room-mic-select')?.addEventListener('change', (e) => switchMediaDevices({ audioId: e.target.value }));
  $('#pre-background-select')?.addEventListener('change', (e) => setBackgroundMode(e.target.value));
  $('#room-background-select')?.addEventListener('change', (e) => setBackgroundMode(e.target.value));
  $('#pre-background-image-btn')?.addEventListener('click', () => $('#background-image-input')?.click());
  $('#room-background-image-btn')?.addEventListener('click', () => $('#background-image-input')?.click());
  $('#background-image-input')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (file) await setCustomBackgroundFile(file);
    e.target.value = '';
  });

  $('#enter-room').addEventListener('click', async () => {
    if (role === 'teacher' && !state.name) {
      const name = $('#host-name-room')?.value.trim();
      if (!name) return toast('Toplantıyı başlatmak için adınızı yazın.');
      state.name = name;
      sessionStorage.setItem(hostNameStorageKey(state.room), state.name);
    }
    if (role === 'student' && !state.name) {
      const name = $('#participant-name-room')?.value.trim();
      if (!name) return toast('Toplantıya katılmak için adınızı yazın.');
      state.name = name;
      sessionStorage.setItem(participantNameStorageKey(state.room), state.name);
    }
    if (role === 'teacher') {
      const duration = readManagerDurationSelection();
      if (!duration.ok) return toast(duration.message, 4200);
      state.durationMode = duration.mode;
      state.durationMinutes = duration.minutes;
      state.timerStarted = false;
      state.timerEndsAt = 0;
      state.timerExpiredHandled = false;
      try {
        const synced = await window.MiniMeetAuth.hostSyncMeeting(state.room);
        state.licenseMode = synced?.status?.mode || null;
        handleManagerServerStatus(synced?.status || null, false);
        window.MiniMeetAuth.startManagerWatch(state.room, (status) => handleManagerServerStatus(status, true));
      } catch (error) {
        toast(authErrorText(error), 6000);
        if (['free_limit_expired', 'trial_expired', 'blocked', 'SESSION_MISMATCH', 'MEETING_NOT_FOUND'].includes(error.code)) {
          history.replaceState({}, '', '/');
          renderHome();
        }
        return;
      }
    }

    const permissionOk = await window.MiniMeetPermissions?.ensureBeforeMeeting?.();
    if (permissionOk === false) return;
    if (!state.rawLocalStream || state.rawLocalStream.getTracks().length === 0) {
      const mediaReady = await prepareMedia();
      if (mediaReady === false) return;
    }

    $('#prejoin').classList.add('hidden');
    attachLocalCamera();
    await loadIceConfig();
    await connectSignaling();
  });

  $('#mic-btn').addEventListener('click', () => {
    state.micEnabled = !state.micEnabled;
    setTrackEnabled('audio', state.micEnabled);
    updateControls();
    sendSignal({ type: 'media-state', mic: state.micEnabled, camera: state.cameraEnabled });
  });

  $('#cam-btn').addEventListener('click', () => {
    state.cameraEnabled = !state.cameraEnabled;
    setTrackEnabled('video', state.cameraEnabled);
    updateControls();
    updateCameraPlaceholders();
    sendSignal({ type: 'media-state', mic: state.micEnabled, camera: state.cameraEnabled });
  });

  $('#devices-btn')?.addEventListener('click', async () => {
    await refreshDeviceLists();
    $('#device-panel')?.classList.remove('hidden');
  });
  $('#device-panel-close')?.addEventListener('click', () => $('#device-panel')?.classList.add('hidden'));
  $('#device-panel')?.addEventListener('click', (e) => {
    if (e.target.id === 'device-panel') $('#device-panel').classList.add('hidden');
  });

  if (role === 'teacher') {
    $('#participant-screen-permission')?.addEventListener('change', (e) => {
      setParticipantScreenPermission(Boolean(e.target.checked), true);
    });
  }

  $('#screen-btn')?.addEventListener('click', toggleScreenShare);
  $('#screen-preview-toggle')?.addEventListener('click', toggleLocalScreenPreview);
  if (role === 'teacher') $('#draw-btn')?.addEventListener('click', toggleAnnotationMode);
  $('#fullscreen-btn')?.addEventListener('click', toggleRoomFullscreen);

  $('#end-btn').addEventListener('click', () => endCurrentMeeting('manual'));

  window.addEventListener('beforeunload', cleanup, { once: true });
  window.addEventListener('online', recoverConnection);
  window.addEventListener('offline', () => updateStatus('İnternet bağlantısı yok', false));
  initCameraRailInteractions();
  initAnnotationTools();
}

async function toggleRoomFullscreen() {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    const root = document.querySelector('.room-shell');
    if (root?.requestFullscreen) {
      await root.requestFullscreen();
      return;
    }
    const video = $('#screen-video');
    if (video?.webkitEnterFullscreen && video.srcObject) video.webkitEnterFullscreen();
    else toast('Bu tarayıcı tam ekran modunu desteklemiyor.');
  } catch (error) {
    console.warn(error);
  }
}

function initCameraRailInteractions() {
  const rail = $('#video-rail');
  const resizeHandle = $('#camera-resize-handle');
  const dragHandle = $('#camera-drag-handle');
  if (!rail || !resizeHandle || !dragHandle) return;

  const storageKey = `minimeet-camera-panel-${state.role || 'room'}`;
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (saved?.width) rail.style.width = `${saved.width}px`;
    if (Number.isFinite(saved?.left) && Number.isFinite(saved?.top)) {
      rail.style.left = `${saved.left}px`;
      rail.style.top = `${saved.top}px`;
      rail.style.right = 'auto';
    }
  } catch {}

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const save = () => {
    const rect = rail.getBoundingClientRect();
    localStorage.setItem(storageKey, JSON.stringify({ width: Math.round(rect.width), left: Math.round(rect.left), top: Math.round(rect.top) }));
  };

  let mode = '';
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let startRect = null;

  const begin = (event, nextMode) => {
    event.preventDefault();
    mode = nextMode;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    startRect = rail.getBoundingClientRect();
    rail.style.left = `${startRect.left}px`;
    rail.style.top = `${startRect.top}px`;
    rail.style.right = 'auto';
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  dragHandle.addEventListener('pointerdown', (e) => begin(e, 'drag'));
  resizeHandle.addEventListener('pointerdown', (e) => begin(e, 'resize'));

  const move = (event) => {
    if (event.pointerId !== pointerId || !startRect) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (mode === 'drag') {
      const left = clamp(startRect.left + event.clientX - startX, 4, Math.max(4, vw - startRect.width - 4));
      const top = clamp(startRect.top + event.clientY - startY, 4, Math.max(4, vh - startRect.height - 4));
      rail.style.left = `${Math.round(left)}px`;
      rail.style.top = `${Math.round(top)}px`;
    } else if (mode === 'resize') {
      const min = vw <= 520 ? 92 : 130;
      const max = Math.min(vw <= 820 ? 260 : 430, vw - 12);
      const width = clamp(startRect.width + (startX - event.clientX), min, max);
      const left = clamp(startRect.right - width, 4, Math.max(4, vw - width - 4));
      rail.style.width = `${Math.round(width)}px`;
      rail.style.left = `${Math.round(left)}px`;
    }
  };

  const end = (event) => {
    if (event.pointerId !== pointerId) return;
    pointerId = null;
    mode = '';
    startRect = null;
    save();
  };

  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', end);

  window.addEventListener('resize', () => {
    const rect = rail.getBoundingClientRect();
    if (rect.right > window.innerWidth || rect.bottom > window.innerHeight) {
      rail.style.left = `${Math.max(4, window.innerWidth - rect.width - 8)}px`;
      rail.style.top = `${Math.max(4, Math.min(rect.top, window.innerHeight - rect.height - 8))}px`;
      rail.style.right = 'auto';
      save();
    }
  });
}
