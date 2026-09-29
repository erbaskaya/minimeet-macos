function setParticipantScreenPermission(allowed, notify = true) {
  if (state.role !== 'teacher') return;
  state.participantScreenAllowed = Boolean(allowed);
  const checkbox = $('#participant-screen-permission');
  if (checkbox) checkbox.checked = state.participantScreenAllowed;

  if (!state.participantScreenAllowed && state.activeScreenSharer === 'student') {
    sendSignal({ type: 'screen-force-stop' });
    closeScreenCall(false);
    state.activeScreenSharer = null;
    state.remoteScreenEnabled = false;
    showRemoteScreen(null);
    sendSignal({ type: 'screen-owner', owner: null });
  }

  if (notify) sendSignal({ type: 'screen-permission', allowed: state.participantScreenAllowed });
  updateScreenShareUi();
}

function updateScreenShareUi() {
  const button = $('#screen-btn');
  if (!button) return;

  const otherRole = state.role === 'teacher' ? 'student' : 'teacher';
  const otherLabel = state.role === 'teacher' ? 'Katılımcı' : 'Yönetici';
  const ownSharing = state.screenEnabled && state.activeScreenSharer === state.role;
  const otherSharing = state.activeScreenSharer === otherRole;

  button.classList.toggle('screen-on', ownSharing);
  button.classList.toggle('permission-disabled', state.role === 'student' && !state.participantScreenAllowed);

  if (ownSharing) {
    button.disabled = false;
    button.querySelector('.ci').textContent = '🟢';
    button.querySelector('span:last-child').textContent = 'Paylaşımı durdur';
    return;
  }
  if (otherSharing) {
    button.disabled = true;
    button.querySelector('.ci').textContent = '🖥️';
    button.querySelector('span:last-child').textContent = `${otherLabel} paylaşıyor`;
    return;
  }
  if (state.screenSharePending) {
    button.disabled = true;
    button.querySelector('.ci').textContent = '⏳';
    button.querySelector('span:last-child').textContent = 'İzin bekleniyor';
    return;
  }
  if (state.role === 'student' && !state.participantScreenAllowed) {
    button.disabled = true;
    button.querySelector('.ci').textContent = '🔒';
    button.querySelector('span:last-child').textContent = 'Paylaşım izni yok';
    return;
  }

  button.disabled = false;
  button.querySelector('.ci').textContent = '🖥️';
  button.querySelector('span:last-child').textContent = 'Ekran Paylaş';
}

async function toggleScreenShare() {
  if (state.screenEnabled) {
    await stopScreenShare();
    return;
  }

  const otherRole = state.role === 'teacher' ? 'student' : 'teacher';
  if (state.activeScreenSharer === otherRole) {
    toast(`${state.role === 'teacher' ? 'Katılımcı' : 'Yönetici'} şu anda ekran paylaşıyor. Aynı anda yalnızca bir kişi paylaşabilir.`, 4200);
    return;
  }

  if (state.role === 'student') {
    if (!state.participantScreenAllowed) {
      toast('Ekran paylaşımı için Yönetici izni gerekiyor.', 3800);
      return;
    }
    if (!state.signalConn?.open) {
      toast('Yönetici bağlantısı henüz hazır değil.', 3200);
      return;
    }
    state.screenSharePending = true;
    updateScreenShareUi();
    sendSignal({ type: 'screen-share-request' });
    return;
  }

  state.activeScreenSharer = 'teacher';
  sendSignal({ type: 'screen-owner', owner: 'teacher' });
  updateScreenShareUi();
  await beginScreenShare();
}

async function beginScreenShare() {
  try {
    toast('Paylaşmak istediğiniz ekranı seçin.', 3000);
    const display = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 24, max: 30 }, displaySurface: 'monitor' },
      audio: true,
      preferCurrentTab: false,
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
      systemAudio: 'include',
      monitorTypeSurfaces: 'include',
    });

    const screenTrack = display.getVideoTracks()[0];
    const displaySurface = screenTrack?.getSettings?.().displaySurface;
    if (displaySurface && displaySurface !== 'monitor') {
      display.getTracks().forEach((track) => track.stop());
      state.screenSharePending = false;
      if (state.role === 'student') sendSignal({ type: 'screen-share-cancelled' });
      else {
        state.activeScreenSharer = null;
        sendSignal({ type: 'screen-owner', owner: null });
      }
      updateScreenShareUi();
      toast('Yalnızca Tüm ekran / Ekran 1 paylaşılabilir. Lütfen tekrar deneyin.', 5200);
      return;
    }
    state.displayStream = display;
    state.screenEnabled = true;
    state.screenSharePending = false;
    state.activeScreenSharer = state.role;
    state.localScreenPreviewVisible = true;
    screenTrack.addEventListener('ended', () => stopScreenShare(), { once: true });

    showLocalScreen(screenTrack);
    updateControls();
    updateScreenShareUi();

    if (state.signalConn?.open) startScreenCallToParticipant();
    else toast('Ekran hazır. Karşı taraf bağlandığında otomatik paylaşılacak.', 3200);
  } catch (error) {
    if (error?.name !== 'NotAllowedError') console.error(error);
    state.screenEnabled = false;
    state.screenSharePending = false;
    if (state.role === 'student') sendSignal({ type: 'screen-share-cancelled' });
    else {
      state.activeScreenSharer = null;
      sendSignal({ type: 'screen-owner', owner: null });
    }
    updateControls();
    updateScreenShareUi();
  }
}

async function stopScreenShare() {
  if (!state.screenEnabled && !state.displayStream) {
    state.screenSharePending = false;
    updateScreenShareUi();
    return;
  }
  const wasRole = state.role;
  state.screenEnabled = false;
  state.screenSharePending = false;
  if (state.annotationActive) toggleAnnotationMode(false);
  closeScreenCall(true);
  state.displayStream?.getTracks().forEach((track) => track.stop());
  state.displayStream = null;
  state.localScreenPreviewVisible = true;

  const previewToggle = $('#screen-preview-toggle');
  if (previewToggle) previewToggle.classList.add('hidden');

  const video = $('#screen-video');
  if (video) {
    video.srcObject = null;
    video.classList.remove('hidden');
  }
  const empty = $('#screen-empty');
  if (empty) {
    empty.innerHTML = `<div class="icon">🖥️</div><div>${state.role === 'teacher' ? 'Ekran paylaşımını başlatabilir veya Katılımcıya izin verebilirsiniz.' : 'Ekran paylaşımı yok.'}</div>`;
    empty.classList.remove('hidden');
  }
  if ($('#screen-label')) $('#screen-label').textContent = 'Ekran paylaşımı';
  clearAnnotationCanvas(true);

  state.activeScreenSharer = null;
  if (wasRole === 'student') sendSignal({ type: 'screen-share-stopped' });
  else sendSignal({ type: 'screen-owner', owner: null });
  updateControls();
  updateScreenShareUi();
}

function showLocalScreen(track) {
  const video = $('#screen-video');
  if (!video) return;

  const toggle = $('#screen-preview-toggle');
  if (toggle) {
    toggle.classList.remove('hidden');
    toggle.textContent = state.localScreenPreviewVisible ? 'Önizlemeyi gizle' : 'Önizlemeyi göster';
  }

  const empty = $('#screen-empty');
  const target = state.role === 'teacher' ? 'Katılımcı' : 'Yönetici';

  if (state.localScreenPreviewVisible && track) {
    video.classList.remove('hidden');
    video.srcObject = new MediaStream([track]);
    video.muted = true;
    video.play?.().catch(() => {});
    empty?.classList.add('hidden');
    if ($('#screen-label')) $('#screen-label').textContent = 'Paylaşılan ekranınız · Önizleme';
    resizeAnnotationCanvas();
    return;
  }

  video.srcObject = null;
  video.classList.add('hidden');
  if (empty) {
    empty.innerHTML = `<div class="sharing-indicator"><div class="sharing-dot"></div><div><strong>Ekran paylaşılıyor</strong><span>${target} ekranınızı canlı olarak görüyor. Önizleme gizli.</span></div></div>`;
    empty.classList.remove('hidden');
  }
  if ($('#screen-label')) $('#screen-label').textContent = 'Ekranınız paylaşılıyor';
}

function toggleLocalScreenPreview() {
  if (!state.screenEnabled || state.activeScreenSharer !== state.role || !state.displayStream) return;
  state.localScreenPreviewVisible = !state.localScreenPreviewVisible;
  const track = state.displayStream.getVideoTracks()[0] || null;
  showLocalScreen(track);
}

function showRemoteScreen(track) {
  const previewToggle = $('#screen-preview-toggle');
  if (previewToggle) previewToggle.classList.add('hidden');
  const video = $('#screen-video');
  if (!video) return;
  if (!track) {
    video.srcObject = null;
    video.classList.remove('hidden');
    $('#screen-empty')?.classList.remove('hidden');
    if ($('#screen-label')) $('#screen-label').textContent = 'Ekran paylaşımı';
    clearAnnotationCanvas(false);
    return;
  }
  video.classList.remove('hidden');
  video.srcObject = new MediaStream([track]);
  video.muted = true;
  video.play?.().catch(() => {});
  $('#screen-empty')?.classList.add('hidden');
  if ($('#screen-label')) $('#screen-label').textContent = state.role === 'teacher' ? 'Katılımcının ekranı' : 'Yöneticinin ekranı';
  resizeAnnotationCanvas();
}

function sendSignal(payload) {
  if (state.signalConn?.open) {
    try { state.signalConn.send(payload); } catch (error) { console.warn('Signal gönderilemedi', error); }
  }
}

function updateControls() {
  $('#mic-btn')?.classList.toggle('off', !state.micEnabled);
  if ($('#mic-btn .ci')) $('#mic-btn .ci').textContent = state.micEnabled ? '🎤' : '🔇';
  $('#cam-btn')?.classList.toggle('off', !state.cameraEnabled);
  if ($('#cam-btn .ci')) $('#cam-btn .ci').textContent = state.cameraEnabled ? '🎥' : '🚫';
  updateScreenShareUi();
  if ($('#draw-btn')) {
    $('#draw-btn').classList.toggle('screen-on', state.annotationActive);
    $('#draw-btn span:last-child').textContent = state.annotationActive ? 'Çizimi kapat' : 'Çizim';
  }
}

function updateStatus(text, ok) {
  if ($('#status-text')) $('#status-text').textContent = text;
  $('#status-dot')?.classList.toggle('ok', Boolean(ok));
}


function handleServerMeetingAccessEnded(reason = 'meeting_ended') {
  if (!state.room) return;
  // EXE/DMG yöneticili toplantıda Supabase yalnızca web toplantılarını bilir.
  // Eski/gecikmiş bir web durum cevabı masaüstü toplantısını kapatamaz.
  if (state.role === 'student' && state.hostTransport === 'desktop') {
    console.info('MiniMeet: desktop toplantıda web sunucu kapanış sinyali yok sayıldı', reason);
    return;
  }
  const room = state.room;
  const wasManager = state.role === 'teacher';
  const safeReason = String(reason || 'meeting_ended').toLowerCase();
  if (wasManager) {
    if (state.signalConn?.open) sendSignal({ type: 'lesson-ended', reason: safeReason });
    window.MiniMeetAuth?.endMeeting?.(room, safeReason).catch(() => {});
  }
  cleanup(false);
  history.replaceState({}, '', '/');
  renderExitScreen(room, true, safeReason);
}

function handleParticipantServerStatus(status, fromWatch = false) {
  if (!status) return;
  if (state.role === 'student' && state.hostTransport === 'desktop') return;
  if (!status.allowed) {
    handleServerMeetingAccessEnded(status.reason || 'meeting_ended');
    return;
  }
  const previousMode = state.licenseMode;
  state.licenseMode = status.mode || state.licenseMode;
  if (status.mode === 'free' && status.endsAt) {
    const endsAt = Date.parse(status.endsAt);
    if (Number.isFinite(endsAt) && endsAt > 0) {
      state.durationMode = 'timed';
      state.durationMinutes = 59;
      state.timerStarted = true;
      state.timerExpiredHandled = false;
      state.timerEndsAt = endsAt;
      state.serverMeetingEndsAt = endsAt;
      startTimerTicker();
    }
  } else if (status.mode === 'licensed' && previousMode === 'free' && fromWatch) {
    resetMeetingTimer();
    state.durationMode = 'unlimited';
    state.timerStarted = true;
    toast('Yönetici lisansı etkinleştirildi. Süre sınırı kaldırıldı.', 4200);
  }
}

function handleManagerServerStatus(status, fromWatch = false) {
  if (!status) return;
  if (!status.allowed) {
    handleServerMeetingAccessEnded(status.reason || 'meeting_ended');
    return;
  }
  const previousMode = state.licenseMode;
  state.licenseMode = status.mode || state.licenseMode;

  if (status.mode === 'free' && status.endsAt) {
    const endsAt = Date.parse(status.endsAt);
    if (Number.isFinite(endsAt) && endsAt > 0) {
      state.durationMode = 'timed';
      state.durationMinutes = 59;
      state.timerStarted = true;
      state.timerExpiredHandled = false;
      state.timerEndsAt = endsAt;
      state.serverMeetingEndsAt = endsAt;
      startTimerTicker();
      if (fromWatch && state.signalConn?.open) {
        sendSignal({
          type: 'timer-start',
          mode: 'timed',
          durationMinutes: 59,
          remainingMs: Math.max(0, endsAt - Date.now()),
        });
      }
    }
    return;
  }

  if (status.mode === 'licensed' && previousMode === 'free' && fromWatch) {
    resetMeetingTimer();
    state.durationMode = 'unlimited';
    state.timerStarted = true;
    state.timerEndsAt = 0;
    sendSignal({ type: 'timer-start', mode: 'unlimited' });
    toast('Lisans etkinleştirildi. Toplantı artık süresiz.', 4200);
  }
}

function formatMeetingTime(totalSeconds) {
  const safe = Math.max(0, Math.ceil(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function hideMeetingTimer() {
  const timer = $('#meeting-timer');
  timer?.classList.add('hidden');
  timer?.classList.remove('critical');
}

function renderMeetingTimer() {
  const timer = $('#meeting-timer');
  const text = $('#meeting-timer-text');
  if (!timer || !text || state.durationMode !== 'timed' || !state.timerStarted || !state.timerEndsAt) {
    hideMeetingTimer();
    return;
  }

  const remainingMs = Math.max(0, state.timerEndsAt - Date.now());
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const visible = remainingMs <= 5 * 60 * 1000;
  timer.classList.toggle('hidden', !visible);
  timer.classList.toggle('critical', visible && remainingSeconds <= 59);
  text.textContent = formatMeetingTime(remainingSeconds);

  if (remainingMs <= 0 && !state.timerExpiredHandled) {
    state.timerExpiredHandled = true;
    text.textContent = '00:00';
    timer.classList.remove('hidden');
    timer.classList.add('critical');
    setTimeout(() => handleMeetingTimerExpired(), 250);
  }
}

function startTimerTicker() {
  clearInterval(state.timerInterval);
  state.timerInterval = setInterval(renderMeetingTimer, 250);
  renderMeetingTimer();
}

async function startManagerTimerOnParticipantHello() {
  if (state.role !== 'teacher') return;

  try {
    const synced = await window.MiniMeetAuth.hostSyncMeeting(state.room);
    handleManagerServerStatus(synced?.status || null, false);
    if (!state.room || state.role !== 'teacher') return;
    if (synced?.status?.mode === 'free') {
      const endsAt = Date.parse(synced.status.endsAt || '');
      if (!Number.isFinite(endsAt) || endsAt <= 0) {
        handleServerMeetingAccessEnded('free_limit_expired');
        return;
      }
      const remainingMs = Math.max(0, endsAt - Date.now());
      sendSignal({ type: 'timer-start', mode: 'timed', durationMinutes: 59, remainingMs });
      return;
    }
  } catch (error) {
    handleServerMeetingAccessEnded(error?.payload?.status?.reason || error.code || 'meeting_ended');
    return;
  }

  // Lisansli hesaplarda kullanicinin sectigi sureli/suresiz ayar korunur.
  if (state.durationMode === 'unlimited') {
    state.timerStarted = true;
    sendSignal({ type: 'timer-start', mode: 'unlimited' });
    hideMeetingTimer();
    return;
  }

  if (state.durationMode !== 'timed' || !state.durationMinutes) return;
  if (!state.timerStarted || !state.timerEndsAt) {
    state.timerStarted = true;
    state.timerExpiredHandled = false;
    state.timerEndsAt = Date.now() + state.durationMinutes * 60 * 1000;
    startTimerTicker();
  }

  const remainingMs = Math.max(0, state.timerEndsAt - Date.now());
  sendSignal({
    type: 'timer-start',
    mode: 'timed',
    durationMinutes: state.durationMinutes,
    remainingMs,
  });
}

function applyRemoteTimerConfig(message) {
  clearInterval(state.timerInterval);
  state.timerInterval = null;
  state.timerExpiredHandled = false;
  state.durationMode = message.mode === 'timed' ? 'timed' : 'unlimited';

  if (state.durationMode === 'unlimited') {
    state.timerStarted = true;
    state.timerEndsAt = 0;
    state.durationMinutes = 0;
    hideMeetingTimer();
    return;
  }

  const remainingMs = Math.max(0, Number(message.remainingMs) || 0);
  state.durationMinutes = Math.max(1, Number(message.durationMinutes) || 1);
  state.timerStarted = true;
  state.timerEndsAt = Date.now() + remainingMs;
  startTimerTicker();
}

function resetMeetingTimer() {
  clearInterval(state.timerInterval);
  state.timerInterval = null;
  state.timerStarted = false;
  state.timerEndsAt = 0;
  state.timerExpiredHandled = false;
  hideMeetingTimer();
}

function handleMeetingTimerExpired() {
  if (!state.room) return;
  if (state.role === 'teacher') {
    endCurrentMeeting('time-expired');
    return;
  }
  const room = state.room;
  cleanup(false);
  history.replaceState({}, '', '/');
  renderExitScreen(room, true, 'time-expired');
}

function endCurrentMeeting(reason = 'manual') {
  const room = state.room;
  if (!room) return;

  if (state.role === 'teacher') {
    if (state.signalConn?.open) sendSignal({ type: 'lesson-ended', reason });
    window.MiniMeetAuth?.endMeeting?.(room, reason).catch((error) => console.warn('Toplantı sunucuda kapatılamadı', error));
    cleanup(false);
    sessionStorage.removeItem(hostNameStorageKey(room));
    history.replaceState({}, '', '/');
    if (reason === 'time-expired') toast('Toplantı süresi doldu.', 2200);
    renderHome();
    return;
  }

  cleanup(false);
  history.replaceState({}, '', '/');
  renderExitScreen(room, false);
}

function cleanup(notifyPeer = true) {
  clearReconnectTimers();
  window.MiniMeetAuth?.stopWatches?.();
  resetMeetingTimer();
  if (notifyPeer && state.role === 'teacher' && state.signalConn?.open) sendSignal({ type: 'lesson-ended', reason: 'manual' });
  closeScreenCall(false);
  closeAvCall();
  try { state.signalConn?.close(); } catch {}
  try { state.signalPeer?.destroy(); } catch {}
  state.backgroundProcessor?.stop?.();
  state.backgroundProcessor = null;
  state.rawLocalStream?.getTracks().forEach((t) => t.stop());
  state.rawLocalStream = null;
  state.localStream?.getTracks().forEach((t) => t.stop());
  state.localStream = null;
  state.displayStream?.getTracks().forEach((t) => t.stop());
  state.connected = false;
  state.hostTransport = null;
}

// ---- Paylaşılan çizim / işaretleme ----
let annotationOps = [];
let annotationPointer = null;
let annotationStart = null;
let annotationLast = null;

function resizeAnnotationCanvas() {
  const canvas = $('#annotation-canvas');
  const panel = $('#screen-panel');
  if (!canvas || !panel) return;
  const rect = panel.getBoundingClientRect();
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width === width && canvas.height === height) return;
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  redrawAnnotations();
}

function annotationPoint(event) {
  const canvas = $('#annotation-canvas');
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width))),
    y: Math.min(1, Math.max(0, (event.clientY - rect.top) / Math.max(1, rect.height))),
  };
}

function drawAnnotationOp(op) {
  const canvas = $('#annotation-canvas');
  if (!canvas || !op) return;
  const ctx = canvas.getContext('2d');
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const w = canvas.width;
  const h = canvas.height;
  const p1 = { x: op.from.x * w, y: op.from.y * h };
  const p2 = { x: op.to.x * w, y: op.to.y * h };
  const size = (op.size || 4) * dpr;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = op.color || '#ff2d2d';
  ctx.lineWidth = size;
  ctx.globalAlpha = op.tool === 'highlighter' ? 0.32 : 1;
  if (op.tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineWidth = size * 3;
  }

  if (op.tool === 'rect') {
    ctx.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
  } else if (op.tool === 'arrow') {
    const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    const head = Math.max(10 * dpr, size * 3);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.moveTo(p2.x, p2.y);
    ctx.lineTo(p2.x - head * Math.cos(angle - Math.PI / 6), p2.y - head * Math.sin(angle - Math.PI / 6));
    ctx.moveTo(p2.x, p2.y);
    ctx.lineTo(p2.x - head * Math.cos(angle + Math.PI / 6), p2.y - head * Math.sin(angle + Math.PI / 6));
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }
  ctx.restore();
}

function redrawAnnotations() {
  const canvas = $('#annotation-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  annotationOps.forEach(drawAnnotationOp);
}

function commitAnnotation(op, send = true) {
  annotationOps.push(op);
  drawAnnotationOp(op);
  if (send) sendSignal({ type: 'annotation', payload: op });
}

function receiveAnnotationEvent(op) {
  if (!op?.from || !op?.to) return;
  resizeAnnotationCanvas();
  commitAnnotation(op, false);
}

function clearAnnotationCanvas(send = true) {
  annotationOps = [];
  redrawAnnotations();
  if (send) sendSignal({ type: 'annotation-clear' });
}

function setAnnotationTool(tool) {
  state.annotationTool = tool;
  document.querySelectorAll('#annotation-tools [data-tool]').forEach((button) => {
    button.classList.toggle('active', button.dataset.tool === tool);
  });
}

function toggleAnnotationMode(force) {
  if (state.role !== 'teacher') return;
  if (force === false) {
    state.annotationActive = false;
    $('#annotation-tools')?.classList.add('hidden');
    $('#annotation-canvas')?.classList.remove('interactive');
    updateControls();
    return;
  }
  if (!state.screenEnabled) {
    toast('Çizim için önce ekran paylaşımını başlatın.');
    return;
  }
  state.annotationActive = typeof force === 'boolean' ? force : !state.annotationActive;
  $('#annotation-tools')?.classList.toggle('hidden', !state.annotationActive);
  $('#annotation-canvas')?.classList.toggle('interactive', state.annotationActive);
  updateControls();
  resizeAnnotationCanvas();
}

function initAnnotationTools() {
  const canvas = $('#annotation-canvas');
  if (!canvas) return;
  resizeAnnotationCanvas();
  new ResizeObserver(resizeAnnotationCanvas).observe($('#screen-panel'));

  document.querySelectorAll('#annotation-tools [data-tool]').forEach((button) => {
    button.addEventListener('click', () => setAnnotationTool(button.dataset.tool));
  });
  $('#annotation-color')?.addEventListener('input', (e) => { state.annotationColor = e.target.value; });
  $('#annotation-size')?.addEventListener('input', (e) => { state.annotationSize = Number(e.target.value) || 4; });
  $('#annotation-clear')?.addEventListener('click', () => clearAnnotationCanvas(true));

  canvas.addEventListener('pointerdown', (event) => {
    if (!state.annotationActive || state.role !== 'teacher') return;
    event.preventDefault();
    annotationPointer = event.pointerId;
    annotationStart = annotationPoint(event);
    annotationLast = annotationStart;
    canvas.setPointerCapture?.(event.pointerId);
  });

  canvas.addEventListener('pointermove', (event) => {
    if (event.pointerId !== annotationPointer || !annotationLast) return;
    const next = annotationPoint(event);
    if (['pen', 'highlighter', 'eraser'].includes(state.annotationTool)) {
      const op = { tool: state.annotationTool, color: state.annotationColor, size: state.annotationSize, from: annotationLast, to: next };
      commitAnnotation(op, true);
      annotationLast = next;
    }
  });

  const finish = (event) => {
    if (event.pointerId !== annotationPointer || !annotationStart) return;
    const end = annotationPoint(event);
    if (['arrow', 'rect'].includes(state.annotationTool)) {
      commitAnnotation({ tool: state.annotationTool, color: state.annotationColor, size: state.annotationSize, from: annotationStart, to: end }, true);
    }
    annotationPointer = null;
    annotationStart = null;
    annotationLast = null;
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);
}

async function bootMiniMeet() {
  try {
    await window.MiniMeetAuth.init();
  } catch (error) {
    app.innerHTML = `<main class="home-shell"><section class="exit-card"><div class="brand-mark exit-mark">M</div><div class="exit-status">Kurulum gerekli</div><h2>MiniMeet hesap sistemi yapılandırılmamış.</h2><p>${escapeHtml(error.message)}</p></section></main>`;
    return;
  }

  const route = routeInfo();
  if (route?.role === 'teacher') {
    try {
      const account = await window.MiniMeetAuth.getAccount(true);
      state.account = account;
      if (!account || !account.entitlement?.allowed) {
        history.replaceState({}, '', '/');
        renderHome();
        setTimeout(() => toast(!account ? 'Yönetici olarak devam etmek için giriş yapın.' : serverMeetingReasonText(account.entitlement?.reason), 5200), 100);
        return;
      }
      renderRoom(route.room, route.role);
    } catch (error) {
      history.replaceState({}, '', '/');
      renderHome();
      setTimeout(() => toast(authErrorText(error), 5200), 100);
    }
  } else if (route) {
    renderRoom(route.room, route.role);
  } else {
    renderHome();
    setTimeout(() => {
      window.MiniMeetPermissions?.ensure?.({ context: 'initial', forcePrompt: true });
    }, 120);
  }
}

bootMiniMeet();
