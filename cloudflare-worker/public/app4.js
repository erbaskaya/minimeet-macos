function mediaCallMetadata(kind) {
  return { kind, room: state.room, role: state.role, name: state.name };
}

function wireCallErrors(call, label) {
  call.on('error', (error) => {
    console.warn(`${label} görüşme hatası`, error);
    if (error?.type === 'webrtc') {
      updateStatus(state.turnConfigured ? 'Medya bağlantısı yeniden kuruluyor' : 'Medya bağlantısı zayıf · TURN yapılandırılması önerilir', false);
      if (state.role === 'student') scheduleAvReconnect();
    }
  });
}

function scheduleAvReconnect(delay = 1200) {
  if (state.role !== 'student') return;
  clearTimeout(state.avRetryTimer);
  state.avRetryTimer = setTimeout(() => {
    if (state.signalConn?.open && (!state.avCall || !state.peerConnected)) startAvCallAsParticipant();
  }, delay);
}

async function startAvCallAsParticipant() {
  if (state.role !== 'student' || !state.signalPeer || state.signalPeer.destroyed) return;
  if (state.avCall && state.peerConnected) return;

  closeAvCall();
  updateStatus('Ses ve görüntü bağlanıyor', false);
  const stream = state.localStream || new MediaStream();
  const call = state.signalPeer.call(signalPeerId('teacher'), stream, {
    metadata: mediaCallMetadata('av'),
  });

  if (!call) {
    updateStatus('Medya bağlantısı yeniden deneniyor', false);
    scheduleAvReconnect();
    return;
  }

  state.avCall = call;
  wireAvCall(call);
}

function handleIncomingMediaCall(call) {
  const kind = call.metadata?.kind || 'av';
  const room = String(call.metadata?.room || '').toUpperCase();
  if (room && room !== state.room) {
    try { call.close(); } catch {}
    return;
  }

  if (kind === 'av' && state.role === 'teacher') {
    if (state.avCall && state.avCall !== call) {
      try { state.avCall.close(); } catch {}
    }
    state.avCall = call;
    wireAvCall(call);
    call.answer(state.localStream || new MediaStream());
    return;
  }

  if (kind === 'screen') {
    const callerRole = call.metadata?.role;
    if (callerRole === state.role) { try { call.close(); } catch {} return; }
    if (state.role === 'teacher' && callerRole === 'student' && (!state.participantScreenAllowed || state.activeScreenSharer !== 'student')) {
      try { call.close(); } catch {}
      return;
    }
    if (state.activeScreenSharer && callerRole && state.activeScreenSharer !== callerRole) {
      try { call.close(); } catch {}
      return;
    }
    state.activeScreenSharer = callerRole || (state.role === 'teacher' ? 'student' : 'teacher');
    updateScreenShareUi();
    if (state.screenCall && state.screenCall !== call) {
      try { state.screenCall.close(); } catch {}
    }
    state.screenCall = call;
    wireScreenCall(call);
    call.answer();
    return;
  }

  try { call.close(); } catch {}
}

function wireAvCall(call) {
  wireCallErrors(call, 'Kamera/ses');

  call.on('stream', (remoteStream) => {
    attachRemoteAvStream(remoteStream);
    state.peerConnected = true;
    updateStatus('Bağlı', true);
    sendSignal({ type: 'media-state', mic: state.micEnabled, camera: state.cameraEnabled });
  });

  call.on('close', () => {
    if (state.avCall === call) state.avCall = null;
    state.peerConnected = false;
    clearRemoteAv();
    if (state.signalConn?.open) updateStatus('Medya bağlantısı yeniden kuruluyor', false);
    if (state.role === 'student' && state.signalConn?.open) scheduleAvReconnect();
  });
}

function attachRemoteAvStream(stream) {
  const video = state.role === 'teacher' ? $('#student-video') : $('#teacher-video');
  const off = state.role === 'teacher' ? $('#student-off') : $('#teacher-off');
  const videoTracks = stream.getVideoTracks();
  const audioTracks = stream.getAudioTracks();

  if (videoTracks.length) {
    video.srcObject = new MediaStream(videoTracks);
    video.muted = true;
    video.play?.().catch(() => {});
    off?.classList.add('hidden');
  }

  if (audioTracks.length) {
    const audio = $('#remote-audio');
    audio.srcObject = new MediaStream(audioTracks);
    audio.play?.().catch(() => {
      toast('Karşı tarafın sesini duymak için ekrana bir kez dokunun.', 4200);
      const unlock = () => audio.play?.().catch(() => {});
      document.addEventListener('click', unlock, { once: true });
      document.addEventListener('touchend', unlock, { once: true });
    });
  }
}

function clearRemoteAv() {
  const video = state.role === 'teacher' ? $('#student-video') : $('#teacher-video');
  const off = state.role === 'teacher' ? $('#student-off') : $('#teacher-off');
  if (video) video.srcObject = null;
  if ($('#remote-audio')) $('#remote-audio').srcObject = null;
  off?.classList.remove('hidden');
}

function updateRemoteMediaState(message) {
  const off = state.role === 'teacher' ? $('#student-off') : $('#teacher-off');
  off?.classList.toggle('hidden', Boolean(message.camera));
}

function startScreenCallToParticipant() {
  if (!state.screenEnabled || !state.displayStream) return;
  if (!state.signalPeer || state.signalPeer.destroyed || !state.signalConn?.open) return;

  closeScreenCall(false);
  const targetRole = state.role === 'teacher' ? 'student' : 'teacher';
  const call = state.signalPeer.call(signalPeerId(targetRole), state.displayStream, {
    metadata: mediaCallMetadata('screen'),
  });
  if (!call) return;

  state.screenCall = call;
  wireScreenCall(call);
  sendSignal({ type: 'screen-state', enabled: true, owner: state.role });
}

function wireScreenCall(call) {
  wireCallErrors(call, 'Ekran');

  call.on('stream', (remoteStream) => {
    if (state.screenEnabled) return;
    state.remoteScreenEnabled = true;
    attachRemoteScreenStream(remoteStream);
    updateScreenShareUi();
  });

  call.on('close', () => {
    if (state.screenCall === call) state.screenCall = null;
    if (!state.screenEnabled) {
      state.remoteScreenEnabled = false;
      showRemoteScreen(null);
      const audio = $('#screen-audio');
      if (audio) audio.srcObject = null;
    } else if (state.signalConn?.open) {
      setTimeout(startScreenCallToParticipant, 900);
    }
    updateScreenShareUi();
  });
}

function attachRemoteScreenStream(stream) {
  const videoTracks = stream.getVideoTracks();
  const audioTracks = stream.getAudioTracks();

  if (videoTracks.length) showRemoteScreen(videoTracks[0]);

  const audio = $('#screen-audio');
  if (audioTracks.length && audio) {
    audio.srcObject = new MediaStream(audioTracks);
    audio.play?.().catch(() => {
      const unlock = () => audio.play?.().catch(() => {});
      document.addEventListener('click', unlock, { once: true });
      document.addEventListener('touchend', unlock, { once: true });
    });
  }
}

function closeAvCall() {
  if (!state.avCall) return;
  const call = state.avCall;
  state.avCall = null;
  try { call.close(); } catch {}
}

function closeScreenCall(notify = true) {
  if (state.screenCall) {
    const call = state.screenCall;
    state.screenCall = null;
    try { call.close(); } catch {}
  }
  if (notify) sendSignal({ type: 'screen-state', enabled: false, owner: state.role });
}

function resetPeerMedia() {
  clearRemoteAv();
  showRemoteScreen(null);
}
