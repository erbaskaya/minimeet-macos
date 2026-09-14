const DOMAIN = 'https://minimeeting.vercel.app';
const $ = (selector) => document.querySelector(selector);

const state = {
  room: '',
  participantLink: '',
  peer: null,
  signalConn: null,
  avCall: null,
  screenCall: null,
  remoteScreenCall: null,
  localStream: null,
  rawLocalStream: null,
  backgroundProcessor: null,
  backgroundMode: window.MiniMeetBackground?.getMode?.() || 'normal',
  backgroundImageData: window.MiniMeetBackground?.getImageData?.() || '',
  backgroundUpdating: false,
  displayStream: null,
  micEnabled: true,
  cameraEnabled: true,
  screenEnabled: false,
  participantScreenAllowed: false,
  activeScreenSharer: null,
  connected: false,
  participantName: 'Katılımcı',
  managerName: localStorage.getItem('minimeet-manager-name') || '',
  selectedVideoId: localStorage.getItem('minimeet-manager-video-device') || '',
  selectedAudioId: localStorage.getItem('minimeet-manager-audio-device') || '',
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  turnConfigured: false,
  meetingStarted: false,
  reconnectTimer: null,
  durationMode: '',
  durationMinutes: 0,
  timerStarted: false,
  timerEndsAt: 0,
  timerInterval: null,
  timerExpiredHandled: false
};

function randomRoom() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

function peerId(role) {
  return `minimeet-${state.room.toLowerCase()}-${role}`;
}

function setStatus(text, ok = false) {
  $('#statusText').textContent = text;
  $('#statusDot').classList.toggle('ok', ok);
}

function setSetupStatus(text) {
  $('#setupStatus').textContent = text;
}

function formatMeetingTime(totalSeconds) {
  const safe = Math.max(0, Math.ceil(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function timerUiState() {
  if (state.durationMode !== 'timed' || !state.timerStarted || !state.timerEndsAt) {
    return { visible: false, text: '', critical: false };
  }
  const remainingMs = Math.max(0, state.timerEndsAt - Date.now());
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  return {
    visible: remainingMs <= 5 * 60 * 1000,
    text: formatMeetingTime(remainingSeconds),
    critical: remainingSeconds <= 59
  };
}

function renderMeetingTimer() {
  const ui = timerUiState();
  const timer = $('#meetingTimer');
  const text = $('#meetingTimerText');
  if (timer) {
    timer.classList.toggle('hidden', !ui.visible);
    timer.classList.toggle('critical', ui.critical);
  }
  if (text && ui.text) text.textContent = ui.text;
  broadcastToolbarState();

  if (state.durationMode === 'timed' && state.timerStarted && state.timerEndsAt <= Date.now() && !state.timerExpiredHandled) {
    state.timerExpiredHandled = true;
    if (text) text.textContent = '00:00';
    timer?.classList.remove('hidden');
    timer?.classList.add('critical');
    setTimeout(() => endMeeting('time-expired'), 250);
  }
}

function startTimerTicker() {
  clearInterval(state.timerInterval);
  state.timerInterval = setInterval(renderMeetingTimer, 500);
  renderMeetingTimer();
}

function resetMeetingTimer() {
  clearInterval(state.timerInterval);
  state.timerInterval = null;
  state.timerStarted = false;
  state.timerEndsAt = 0;
  state.timerExpiredHandled = false;
  const timer = $('#meetingTimer');
  timer?.classList.add('hidden');
  timer?.classList.remove('critical');
  broadcastToolbarState();
}

function startTimerOnParticipantHello() {
  if (state.durationMode === 'unlimited') {
    state.timerStarted = true;
    sendSignal({ type: 'timer-start', mode: 'unlimited' });
    broadcastToolbarState();
    return;
  }
  if (state.durationMode !== 'timed' || !state.durationMinutes) return;
  if (!state.timerStarted || !state.timerEndsAt) {
    state.timerStarted = true;
    state.timerExpiredHandled = false;
    state.timerEndsAt = Date.now() + state.durationMinutes * 60 * 1000;
    startTimerTicker();
  }
  sendSignal({
    type: 'timer-start',
    mode: 'timed',
    durationMinutes: state.durationMinutes,
    remainingMs: Math.max(0, state.timerEndsAt - Date.now())
  });
}

function selectedDuration() {
  const mode = document.querySelector('input[name="durationMode"]:checked')?.value || '';
  if (!mode) return { ok: false, message: 'Toplantı süresini seçin: Süresiz veya Süreli.' };
  if (mode === 'unlimited') return { ok: true, mode, minutes: 0 };
  const minutes = Number.parseInt($('#durationMinutes')?.value || '', 10);
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) {
    return { ok: false, message: 'Süreli toplantı için 1 ile 1440 arasında dakika yazın.' };
  }
  return { ok: true, mode: 'timed', minutes };
}

function updateDurationUi() {
  const mode = document.querySelector('input[name="durationMode"]:checked')?.value || '';
  $('#durationMinutesRow')?.classList.toggle('hidden', mode !== 'timed');
  if (mode === 'timed') setTimeout(() => $('#durationMinutes')?.focus(), 0);
}

function resetDurationSelection() {
  document.querySelectorAll('input[name="durationMode"]').forEach((radio) => { radio.checked = false; });
  if ($('#durationMinutes')) $('#durationMinutes').value = '';
  $('#durationMinutesRow')?.classList.add('hidden');
  state.durationMode = '';
  state.durationMinutes = 0;
}

function setVideoOff(element, hidden) {
  element?.classList.toggle('hidden', hidden);
}

function broadcastToolbarState() {
  window.miniMeet.sendToolbarState({
    micEnabled: state.micEnabled,
    cameraEnabled: state.cameraEnabled,
    screenEnabled: state.screenEnabled,
    activeScreenSharer: state.activeScreenSharer,
    connected: state.connected,
    timerVisible: timerUiState().visible,
    timerText: timerUiState().text,
    timerCritical: timerUiState().critical
  });
}

async function loadIceConfig() {
  try {
    const response = await fetch(`${DOMAIN}/api/ice`, { cache: 'no-store' });
    const data = await response.json();
    if (Array.isArray(data.iceServers) && data.iceServers.length) state.iceServers = data.iceServers;
    state.turnConfigured = Boolean(data.turnConfigured);
    const el = $('#turnStatus');
    el.textContent = state.turnConfigured
      ? 'TURN relay aktif · farklı modem ve sıkı ağlarda bağlantı desteği hazır.'
      : 'TURN relay henüz yapılandırılmadı · STUN ile bağlantı denenir.';
    el.classList.toggle('ok', state.turnConfigured);
  } catch (error) {
    console.warn('ICE ayarları alınamadı, STUN ile devam ediliyor.', error);
    $('#turnStatus').textContent = 'Bağlantı ayarları alınamadı · STUN ile devam ediliyor.';
  }
}

function mediaConstraints() {
  const video = state.selectedVideoId
    ? { deviceId: { exact: state.selectedVideoId }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } }
    : { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } };
  const audio = state.selectedAudioId
    ? { deviceId: { exact: state.selectedAudioId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    : { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  return { video, audio };
}

function backgroundModeLabel(mode = state.backgroundMode) {
  if (mode === 'blur') return 'Bulanık (Orta)';
  if (mode === 'image') return 'Arka Plan Resmi';
  return 'Normal';
}

function syncBackgroundControls() {
  [$('#backgroundSelect'), $('#lessonBackgroundSelect')].forEach((select) => {
    if (select) select.value = state.backgroundMode;
  });
  [$('#backgroundImageBtn'), $('#lessonBackgroundImageBtn')].forEach((button) => {
    if (button) button.textContent = state.backgroundImageData ? 'Resmi değiştir' : 'Resim seç';
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

function refreshLocalViews() {
  const preview = $('#selfPreview');
  if (preview) {
    preview.srcObject = state.localStream;
    preview.play().catch(() => {});
  }
  setVideoOff($('#selfPreviewOff'), state.cameraEnabled && state.localStream?.getVideoTracks().length > 0);
  if (state.meetingStarted) applyLocalPreview();
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
    refreshLocalViews();
    await replaceOutgoingTracks(state.localStream);
    previousProcessor?.stop?.();
    window.MiniMeetBackground?.setMode?.(state.backgroundMode);
    syncBackgroundControls();
    setSetupStatus(`Arka plan: ${backgroundModeLabel()}`);
    sendSignal?.({ type: 'media-state', mic: state.micEnabled, camera: state.cameraEnabled });
  } catch (error) {
    console.warn('Arka plan efekti uygulanamadı', error);
    state.backgroundMode = 'normal';
    window.MiniMeetBackground?.setMode?.('normal');
    syncBackgroundControls();
    setSetupStatus(error?.message || 'Arka plan efekti uygulanamadı.');
  } finally {
    state.backgroundUpdating = false;
  }
}

async function setBackgroundMode(mode) {
  const next = ['normal', 'blur', 'image'].includes(mode) ? mode : 'normal';
  if (next === 'image' && !state.backgroundImageData) {
    $('#backgroundImageInput')?.click();
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
    setSetupStatus(error?.message || 'Arka plan resmi seçilemedi.');
    syncBackgroundControls();
  }
}

function fillSelect(select, devices, selected, label) {
  if (!select) return;
  select.innerHTML = '';
  devices.forEach((device, index) => {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = device.label || `${label} ${index + 1}`;
    if (device.deviceId === selected) option.selected = true;
    select.append(option);
  });
  if (!select.value && select.options.length) select.selectedIndex = 0;
}

async function refreshDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter((d) => d.kind === 'videoinput');
    const mics = devices.filter((d) => d.kind === 'audioinput');
    if (!state.selectedVideoId && cameras[0]) state.selectedVideoId = cameras[0].deviceId;
    if (!state.selectedAudioId && mics[0]) state.selectedAudioId = mics[0].deviceId;
    [$('#cameraSelect'), $('#lessonCameraSelect')].forEach((s) => fillSelect(s, cameras, state.selectedVideoId, 'Kamera'));
    [$('#micSelect'), $('#lessonMicSelect')].forEach((s) => fillSelect(s, mics, state.selectedAudioId, 'Mikrofon'));
  } catch (error) {
    console.warn('Aygıtlar listelenemedi', error);
  }
}

async function prepareLocalMedia() {
  setSetupStatus('Kamera ve mikrofon hazırlanıyor…');
  await loadIceConfig();
  let rawStream;
  try {
    rawStream = await navigator.mediaDevices.getUserMedia(mediaConstraints());
  } catch (error) {
    console.warn('Kamera + mikrofon birlikte açılamadı', error);
    try {
      rawStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      state.cameraEnabled = false;
    } catch (audioError) {
      console.error('Medya aygıtları açılamadı', audioError);
      rawStream = new MediaStream();
      state.micEnabled = false;
      state.cameraEnabled = false;
    }
  }

  state.rawLocalStream = rawStream;
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
  refreshLocalViews();
  await refreshDevices();
  syncBackgroundControls();
  renderSetupToggles();
  $('#managerName').value = state.managerName;
  setSetupStatus('Hazır. Toplantıyı başlatabilirsiniz.');
}

async function replaceOutgoingTracks(nextStream) {
  const pc = state.avCall?.peerConnection;
  if (!pc) return;
  const senders = pc.getSenders?.() || [];
  for (const kind of ['audio', 'video']) {
    const nextTrack = nextStream.getTracks().find((t) => t.kind === kind);
    if (!nextTrack) continue;
    const sender = senders.find((s) => s.track?.kind === kind);
    if (sender) {
      try { await sender.replaceTrack(nextTrack); } catch (error) { console.warn(`${kind} track değiştirilemedi`, error); }
    }
  }
}

async function switchDevices({ videoId = state.selectedVideoId, audioId = state.selectedAudioId } = {}) {
  state.selectedVideoId = videoId || '';
  state.selectedAudioId = audioId || '';
  if (state.selectedVideoId) localStorage.setItem('minimeet-manager-video-device', state.selectedVideoId);
  if (state.selectedAudioId) localStorage.setItem('minimeet-manager-audio-device', state.selectedAudioId);

  let nextRaw;
  try {
    nextRaw = await navigator.mediaDevices.getUserMedia(mediaConstraints());
  } catch (error) {
    setSetupStatus('Seçilen aygıt açılamadı.');
    return;
  }
  nextRaw.getVideoTracks().forEach((t) => { t.enabled = state.cameraEnabled; });
  nextRaw.getAudioTracks().forEach((t) => { t.enabled = state.micEnabled; });

  let result;
  try {
    result = await buildEffectiveStream(nextRaw);
  } catch (error) {
    console.warn('Arka plan efekti yeni aygıtta uygulanamadı.', error);
    state.backgroundMode = 'normal';
    window.MiniMeetBackground?.setMode?.('normal');
    result = { stream: nextRaw, processor: null };
    setSetupStatus('Arka plan efekti uygulanamadı; normal kamera ile devam ediliyor.');
  }

  const oldRaw = state.rawLocalStream;
  const oldProcessor = state.backgroundProcessor;
  state.rawLocalStream = nextRaw;
  state.backgroundProcessor = result.processor;
  state.localStream = result.stream;
  applyEnabledStateToStreams();
  refreshLocalViews();
  await replaceOutgoingTracks(state.localStream);
  oldProcessor?.stop?.();
  oldRaw?.getTracks().forEach((t) => t.stop());
  await refreshDevices();
  syncBackgroundControls();
}

function renderSetupToggles() {
  const mic = $('#setupMicBtn');
  const cam = $('#setupCamBtn');
  mic.classList.toggle('off', !state.micEnabled);
  mic.textContent = state.micEnabled ? '🎤 Mikrofon açık' : '🔇 Mikrofon kapalı';
  cam.classList.toggle('off', !state.cameraEnabled);
  cam.textContent = state.cameraEnabled ? '🎥 Kamera açık' : '🚫 Kamera kapalı';
}

function setTrackEnabled(kind, enabled) {
  state.rawLocalStream?.getTracks().filter((track) => track.kind === kind).forEach((track) => { track.enabled = enabled; });
  state.localStream?.getTracks().filter((track) => track.kind === kind).forEach((track) => { track.enabled = enabled; });
}

function applyLocalPreview() {
  const video = $('#teacherVideo');
  video.srcObject = state.localStream;
  video.muted = true;
  video.play().catch(() => {});
  setVideoOff($('#teacherOff'), state.cameraEnabled && state.localStream?.getVideoTracks().length > 0);
}

function sendSignal(payload) {
  if (state.signalConn?.open) {
    try { state.signalConn.send(payload); } catch (error) { console.warn('Signal gönderilemedi', error); }
  }
}

function setParticipantScreenPermission(allowed, notify = true) {
  state.participantScreenAllowed = Boolean(allowed);
  const checkbox = $('#participantScreenPermission');
  if (checkbox) checkbox.checked = state.participantScreenAllowed;

  if (!state.participantScreenAllowed && state.activeScreenSharer === 'student') {
    sendSignal({ type: 'screen-force-stop' });
    closeRemoteScreenCall();
    state.activeScreenSharer = null;
    sendSignal({ type: 'screen-owner', owner: null });
  }
  if (notify) sendSignal({ type: 'screen-permission', allowed: state.participantScreenAllowed });
  broadcastToolbarState();
}

function closeRemoteScreenCall() {
  const call = state.remoteScreenCall;
  state.remoteScreenCall = null;
  if (call) try { call.close(); } catch {}
  const video = $('#participantScreenVideo');
  if (video) video.srcObject = null;
  const audio = $('#screenAudio');
  if (audio) audio.srcObject = null;
  $('#participantShareView')?.classList.add('hidden');
  $('#meetingContent')?.classList.remove('participant-sharing');
  window.miniMeet.remoteScreenActive(false);
  if (!state.screenEnabled) $('#shareStatus').textContent = 'Ekran paylaşılmıyor';
  broadcastToolbarState();
}

function attachParticipantScreen(stream) {
  const videoTracks = stream.getVideoTracks();
  const audioTracks = stream.getAudioTracks();
  if (videoTracks.length) {
    const video = $('#participantScreenVideo');
    video.srcObject = new MediaStream(videoTracks);
    video.play().catch(() => {});
  }
  if (audioTracks.length) {
    const audio = $('#screenAudio');
    audio.srcObject = new MediaStream(audioTracks);
    audio.play().catch(() => {});
  }
  state.activeScreenSharer = 'student';
  $('#participantShareTitle').textContent = `${state.participantName || 'Katılımcı'} · Ekran paylaşımı`;
  $('#participantShareView').classList.remove('hidden');
  $('#meetingContent').classList.add('participant-sharing');
  $('#shareStatus').textContent = `${state.participantName || 'Katılımcı'} ekran paylaşıyor`;
  window.miniMeet.remoteScreenActive(true);
  broadcastToolbarState();
}

function closeAvCall() {
  const call = state.avCall;
  state.avCall = null;
  if (call) try { call.close(); } catch {}
}

function closeScreenCall(notify = true) {
  const call = state.screenCall;
  state.screenCall = null;
  if (call) try { call.close(); } catch {}
  if (notify) sendSignal({ type: 'screen-state', enabled: false, owner: 'teacher' });
}

function clearParticipantMedia() {
  $('#studentVideo').srcObject = null;
  $('#remoteAudio').srcObject = null;
  setVideoOff($('#studentOff'), false);
}

function attachParticipantStream(stream) {
  const videoTracks = stream.getVideoTracks();
  const audioTracks = stream.getAudioTracks();
  if (videoTracks.length) {
    $('#studentVideo').srcObject = new MediaStream(videoTracks);
    $('#studentVideo').play().catch(() => {});
    setVideoOff($('#studentOff'), true);
  } else setVideoOff($('#studentOff'), false);

  if (audioTracks.length) {
    $('#remoteAudio').srcObject = new MediaStream(audioTracks);
    $('#remoteAudio').play().catch(() => {});
  }
  state.connected = true;
  setStatus('Bağlı', true);
  broadcastToolbarState();
  sendSignal({ type: 'media-state', mic: state.micEnabled, camera: state.cameraEnabled });
}

function wireAvCall(call) {
  call.on('stream', attachParticipantStream);
  call.on('close', () => {
    if (state.avCall === call) state.avCall = null;
    state.connected = false;
    clearParticipantMedia();
    setStatus(state.signalConn?.open ? 'Katılımcı medya bağlantısı yeniden kuruluyor' : 'Katılımcı bekleniyor', false);
    broadcastToolbarState();
  });
  call.on('error', (error) => {
    console.warn('Kamera/ses görüşmesi hatası', error);
    setStatus(state.turnConfigured ? 'Medya bağlantısı yeniden deneniyor' : 'Medya bağlantısı zayıf · TURN önerilir', false);
  });
}

function handleIncomingCall(call) {
  const kind = call.metadata?.kind || 'av';
  const room = String(call.metadata?.room || '').toUpperCase();
  if (room && room !== state.room) return void call.close();
  if (kind === 'screen') {
    if (call.metadata?.role !== 'student' || !state.participantScreenAllowed || state.activeScreenSharer !== 'student') return void call.close();
    closeRemoteScreenCall();
    state.remoteScreenCall = call;
    call.on('stream', attachParticipantScreen);
    call.on('close', () => {
      if (state.remoteScreenCall === call) state.remoteScreenCall = null;
      if (state.activeScreenSharer === 'student') state.activeScreenSharer = null;
      closeRemoteScreenCall();
    });
    call.on('error', (error) => console.warn('Katılımcı ekran paylaşımı hatası', error));
    call.answer();
    return;
  }
  if (kind !== 'av') return void call.close();
  closeAvCall();
  state.avCall = call;
  wireAvCall(call);
  call.answer(state.localStream || new MediaStream());
}

function setupSignalConnection(conn) {
  if (state.signalConn && state.signalConn !== conn && state.signalConn.open) return void conn.close();
  state.signalConn = conn;
  conn.on('open', () => setStatus('Katılımcı eşleşiyor', false));
  conn.on('data', (message) => {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'hello') {
      state.participantName = message.name || 'Katılımcı';
      $('#participantLabel').textContent = state.participantName;
      setStatus('Katılımcı bulundu', false);
      sendSignal({ type: 'hello-ack', name: state.managerName || 'Yönetici' });
      sendSignal({ type: 'screen-permission', allowed: state.participantScreenAllowed });
      sendSignal({ type: 'screen-owner', owner: state.activeScreenSharer });
      startTimerOnParticipantHello();
      if (state.screenEnabled) setTimeout(startScreenCall, 300);
      return;
    }
    if (message.type === 'screen-share-request') {
      if (!state.participantScreenAllowed) {
        sendSignal({ type: 'screen-share-denied', reason: 'permission' });
      } else if (state.activeScreenSharer && state.activeScreenSharer !== 'student') {
        sendSignal({ type: 'screen-share-denied', reason: 'busy' });
      } else {
        state.activeScreenSharer = 'student';
        sendSignal({ type: 'screen-share-grant' });
        sendSignal({ type: 'screen-owner', owner: 'student' });
        broadcastToolbarState();
      }
      return;
    }
    if (message.type === 'screen-share-cancelled' || message.type === 'screen-share-stopped') {
      if (state.activeScreenSharer === 'student') state.activeScreenSharer = null;
      closeRemoteScreenCall();
      sendSignal({ type: 'screen-owner', owner: null });
      broadcastToolbarState();
      return;
    }
    if (message.type === 'screen-state') {
      if (!message.enabled && state.activeScreenSharer === 'student') {
        state.activeScreenSharer = null;
        closeRemoteScreenCall();
        sendSignal({ type: 'screen-owner', owner: null });
      }
      return;
    }
    if (message.type === 'media-state' && !message.camera) setVideoOff($('#studentOff'), false);
  });
  conn.on('close', () => {
    if (state.signalConn !== conn) return;
    state.signalConn = null;
    state.connected = false;
    closeAvCall();
    closeScreenCall(false);
    closeRemoteScreenCall();
    state.activeScreenSharer = state.screenEnabled ? 'teacher' : null;
    clearParticipantMedia();
    setStatus('Katılımcı bekleniyor', false);
    broadcastToolbarState();
  });
  conn.on('error', (error) => console.warn('Signaling hatası', error));
}

function schedulePeerReconnect(delay = 1200) {
  clearTimeout(state.reconnectTimer);
  state.reconnectTimer = setTimeout(() => {
    if (!state.meetingStarted || !navigator.onLine) return schedulePeerReconnect(2500);
    if (state.peer && !state.peer.destroyed && state.peer.disconnected) {
      try { state.peer.reconnect(); return; } catch {}
    }
    connectManager(true);
  }, delay);
}

async function connectManager(recovery = false) {
  if (!recovery) setStatus('Bağlantı servisine bağlanıyor', false);
  if (state.peer && !state.peer.destroyed) try { state.peer.destroy(); } catch {}

  const peer = new Peer(peerId('teacher'), {
    host: '0.peerjs.com', port: 443, path: '/', secure: true,
    config: { iceServers: state.iceServers }, debug: 1
  });
  state.peer = peer;

  peer.on('open', () => { clearTimeout(state.reconnectTimer); setStatus('Katılımcı bekleniyor', false); });
  peer.on('connection', (conn) => {
    if (conn.metadata?.room && String(conn.metadata.room).toUpperCase() !== state.room) return void conn.close();
    setupSignalConnection(conn);
  });
  peer.on('call', handleIncomingCall);
  peer.on('disconnected', () => {
    setStatus('Bağlantı servisine yeniden bağlanıyor', false);
    schedulePeerReconnect(700);
  });
  peer.on('close', () => schedulePeerReconnect());
  peer.on('error', (error) => {
    console.error('PeerJS hatası', error);
    if (error?.type === 'unavailable-id') setStatus('Toplantı kodu hâlâ kullanımda · tekrar deneniyor', false);
    else setStatus('Bağlantı yeniden kuruluyor', false);
    schedulePeerReconnect(error?.type === 'unavailable-id' ? 2500 : 1200);
  });
}

async function startScreenShare() {
  if (state.screenEnabled) return;
  if (state.activeScreenSharer === 'student') {
    $('#shareStatus').textContent = 'Katılımcı şu anda ekran paylaşıyor';
    broadcastToolbarState();
    return;
  }
  state.activeScreenSharer = 'teacher';
  sendSignal({ type: 'screen-owner', owner: 'teacher' });
  broadcastToolbarState();
  try {
    const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    state.displayStream = display;
    state.screenEnabled = true;
    const track = display.getVideoTracks()[0];
    track?.addEventListener('ended', stopScreenShare, { once: true });
    $('#shareStatus').textContent = 'Tüm ekran paylaşılıyor';
    broadcastToolbarState();
    if (state.signalConn?.open) startScreenCall();
  } catch (error) {
    console.error('Ekran paylaşımı başlatılamadı', error);
    state.activeScreenSharer = null;
    sendSignal({ type: 'screen-owner', owner: null });
    $('#shareStatus').textContent = 'Ekran paylaşımı başlatılamadı';
    broadcastToolbarState();
  }
}

function startScreenCall() {
  if (!state.screenEnabled || !state.displayStream || !state.peer || state.peer.destroyed || !state.signalConn?.open) return;
  closeScreenCall(false);
  const call = state.peer.call(peerId('student'), state.displayStream, {
    metadata: { kind: 'screen', room: state.room, role: 'teacher', name: state.managerName || 'Yönetici' }
  });
  if (!call) return;
  state.screenCall = call;
  call.on('close', () => {
    if (state.screenCall === call) state.screenCall = null;
    if (state.screenEnabled && state.signalConn?.open) setTimeout(startScreenCall, 900);
  });
  call.on('error', (error) => console.warn('Ekran görüşmesi hatası', error));
  sendSignal({ type: 'screen-state', enabled: true, owner: 'teacher' });
}

async function stopScreenShare() {
  if (!state.screenEnabled && !state.displayStream) return;
  state.screenEnabled = false;
  window.miniMeet.closeAnnotation();
  closeScreenCall(true);
  state.displayStream?.getTracks().forEach((track) => track.stop());
  state.displayStream = null;
  state.activeScreenSharer = null;
  sendSignal({ type: 'screen-owner', owner: null });
  $('#shareStatus').textContent = 'Ekran paylaşılmıyor';
  broadcastToolbarState();
}

function toggleMic() {
  state.micEnabled = !state.micEnabled;
  setTrackEnabled('audio', state.micEnabled);
  renderSetupToggles();
  broadcastToolbarState();
  sendSignal({ type: 'media-state', mic: state.micEnabled, camera: state.cameraEnabled });
}

function toggleCamera() {
  state.cameraEnabled = !state.cameraEnabled;
  setTrackEnabled('video', state.cameraEnabled);
  renderSetupToggles();
  setVideoOff($('#teacherOff'), state.cameraEnabled && state.localStream?.getVideoTracks().length > 0);
  setVideoOff($('#selfPreviewOff'), state.cameraEnabled && state.localStream?.getVideoTracks().length > 0);
  broadcastToolbarState();
  sendSignal({ type: 'media-state', mic: state.micEnabled, camera: state.cameraEnabled });
}

async function copyParticipantLink() {
  await window.miniMeet.copyText(state.participantLink);
  const old = $('#shareStatus').textContent;
  $('#shareStatus').textContent = 'Katılımcı linki kopyalandı';
  setTimeout(() => { if ($('#shareStatus').textContent === 'Katılımcı linki kopyalandı') $('#shareStatus').textContent = old; }, 1800);
}

async function endMeeting(reason = 'manual') {
  if (!state.meetingStarted) return;
  sendSignal({ type: 'lesson-ended', reason });
  await stopScreenShare();
  closeAvCall();
  try { state.signalConn?.close(); } catch {}
  try { state.peer?.destroy(); } catch {}
  clearTimeout(state.reconnectTimer);
  resetMeetingTimer();
  state.signalConn = null;
  state.peer = null;
  state.connected = false;
  state.meetingStarted = false;
  state.participantScreenAllowed = false;
  state.activeScreenSharer = null;
  $('#participantScreenPermission').checked = false;
  closeRemoteScreenCall();
  clearParticipantMedia();
  $('#lessonView').classList.add('hidden');
  $('#setupView').classList.remove('hidden');
  window.miniMeet.lessonEnded();
  setSetupStatus(reason === 'time-expired' ? 'Toplantı süresi doldu. Görüşme otomatik olarak bitirildi.' : 'Toplantı bitti. Yeni toplantı kodu oluşturuluyor…');
  resetDurationSelection();
  createRoom();
  if (reason !== 'time-expired') setTimeout(() => setSetupStatus('Hazır. Toplantıyı başlatabilirsiniz.'), 500);
}

function createRoom() {
  state.room = randomRoom();
  state.participantLink = `${DOMAIN}/ders/${state.room}?role=student`;
  $('#roomCode').textContent = state.room;
  $('#studentLink').value = state.participantLink;
  $('#lessonRoom').textContent = `Toplantı: ${state.room}`;
  window.miniMeet.setStudentLink(state.participantLink);
}

async function beginMeeting() {
  if (state.meetingStarted) return;
  const managerName = $('#managerName').value.trim();
  if (!managerName) return setSetupStatus('Toplantıyı başlatmak için adınızı yazın.');
  const duration = selectedDuration();
  if (!duration.ok) return setSetupStatus(duration.message);
  state.durationMode = duration.mode;
  state.durationMinutes = duration.minutes;
  state.timerStarted = false;
  state.timerEndsAt = 0;
  state.timerExpiredHandled = false;
  state.managerName = managerName;
  localStorage.setItem('minimeet-manager-name', managerName);
  state.meetingStarted = true;
  $('#setupView').classList.add('hidden');
  $('#lessonView').classList.remove('hidden');
  applyLocalPreview();
  setStatus('Hazırlanıyor', false);
  window.miniMeet.lessonStarted({ room: state.room, participantLink: state.participantLink, studentLink: state.participantLink });
  broadcastToolbarState();
  await connectManager();
}

function toggleDeviceDrawer(force) {
  const drawer = $('#lessonDeviceDrawer');
  const show = typeof force === 'boolean' ? force : drawer.classList.contains('hidden');
  drawer.classList.toggle('hidden', !show);
  if (show) refreshDevices();
}

$('#minimizeBtn').addEventListener('click', () => window.miniMeet.minimize());
$('#closeBtn').addEventListener('click', async () => { if (state.meetingStarted) await endMeeting(); window.miniMeet.closeApp(); });
$('#copySetupLink').addEventListener('click', copyParticipantLink);
$('#copyMiniLink').addEventListener('click', copyParticipantLink);
$('#setupMicBtn').addEventListener('click', toggleMic);
$('#setupCamBtn').addEventListener('click', toggleCamera);
$('#startLessonBtn').addEventListener('click', beginMeeting);
$('#cameraSelect').addEventListener('change', (e) => switchDevices({ videoId: e.target.value }));
$('#micSelect').addEventListener('change', (e) => switchDevices({ audioId: e.target.value }));
$('#lessonCameraSelect').addEventListener('change', (e) => switchDevices({ videoId: e.target.value }));
$('#lessonMicSelect').addEventListener('change', (e) => switchDevices({ audioId: e.target.value }));
$('#backgroundSelect').addEventListener('change', (e) => setBackgroundMode(e.target.value));
$('#lessonBackgroundSelect').addEventListener('change', (e) => setBackgroundMode(e.target.value));
$('#backgroundImageBtn').addEventListener('click', () => $('#backgroundImageInput').click());
$('#lessonBackgroundImageBtn').addEventListener('click', () => $('#backgroundImageInput').click());
$('#backgroundImageInput').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (file) await setCustomBackgroundFile(file);
  e.target.value = '';
});
$('#closeDeviceDrawer').addEventListener('click', () => toggleDeviceDrawer(false));
$('#participantScreenPermission').addEventListener('change', (e) => setParticipantScreenPermission(Boolean(e.target.checked), true));
window.addEventListener('online', () => { if (state.meetingStarted) schedulePeerReconnect(100); });
window.addEventListener('offline', () => { if (state.meetingStarted) setStatus('İnternet bağlantısı yok', false); });

document.querySelectorAll('input[name="durationMode"]').forEach((radio) => radio.addEventListener('change', updateDurationUi));

window.miniMeet.onCommand(async (command) => {
  if (command === 'toggle-mic') toggleMic();
  if (command === 'toggle-camera') toggleCamera();
  if (command === 'toggle-screen') state.screenEnabled ? await stopScreenShare() : await startScreenShare();
  if (command === 'copy-link') await copyParticipantLink();
  if (command === 'open-devices') toggleDeviceDrawer();
  if (command === 'end-lesson') await endMeeting();
});

createRoom();
prepareLocalMedia();
