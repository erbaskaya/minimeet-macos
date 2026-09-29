function setTrackEnabled(kind, enabled) {
  state.rawLocalStream?.getTracks().filter((track) => track.kind === kind).forEach((track) => { track.enabled = enabled; });
  state.localStream?.getTracks().filter((track) => track.kind === kind).forEach((track) => { track.enabled = enabled; });
}

function attachLocalCamera() {
  const target = state.role === 'teacher' ? $('#teacher-video') : $('#student-video');
  if (!target) return;
  target.srcObject = state.localStream;
  target.muted = true;
  target.play?.().catch(() => {});
  updateCameraPlaceholders();
}

function updateCameraPlaceholders() {
  const localOff = state.role === 'teacher' ? $('#teacher-off') : $('#student-off');
  if (!localOff) return;
  localOff.classList.toggle('hidden', state.cameraEnabled && Boolean(state.localStream?.getVideoTracks().length));
}

async function loadIceConfig() {
  // MiniMeet Cloudflare: WebRTC varsayılan olarak STUN kullanır; TURN daha sonra güvenli yapılandırmayla eklenebilir.
  // TURN daha sonra eklenecekse bu liste Supabase Edge Function üzerinden güvenli biçimde genişletilebilir.
  state.iceServers = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ];
  state.turnConfigured = false;
  const turnState = $('#turn-state');
  if (turnState) {
    turnState.textContent = 'TURN relay henüz yapılandırılmadı · STUN ile bağlantı deneniyor.';
    turnState.classList.remove('ok');
  }
}

function signalPeerId(role) {
  return `minimeet-${state.room.toLowerCase()}-${role}`;
}

function clearReconnectTimers() {
  clearTimeout(state.signalRetryTimer);
  clearTimeout(state.peerRetryTimer);
  clearTimeout(state.avRetryTimer);
}

function setupSignalConnection(conn) {
  if (!conn) return;

  if (state.signalConn && state.signalConn !== conn && state.signalConn.open) {
    try { conn.close(); } catch {}
    return;
  }

  state.signalConn = conn;

  conn.on('open', async () => {
    state.connected = true;
    updateStatus('Eşleşiyor', false);
    if (state.role === 'student') {
      // Önce gerçek yöneticinin kim olduğunu öğreniyoruz. Web yöneticisi
      // hello-ack içinde serverManaged=true gönderir. Eski EXE/DMG bunu
      // göndermez; böylece masaüstü toplantısı Supabase kontrolüne takılmaz.
      sendSignal({ type: 'hello', name: state.name, role: 'student', room: state.room });
    }
  });

  conn.on('data', async (message) => {
    if (!message || typeof message !== 'object') return;
    await handleSignal(message);
  });

  conn.on('close', () => {
    if (state.signalConn !== conn) return;
    state.signalConn = null;
    state.peerConnected = false;
    closeAvCall();
    closeScreenCall(false);
    resetPeerMedia();
    updateStatus(state.role === 'teacher' ? 'Katılımcı bekleniyor' : 'Yönetici bağlantısı kesildi', false);
    if (state.role === 'student') scheduleManagerReconnect();
  });

  conn.on('error', (error) => {
    console.warn('MiniMeet signaling bağlantı hatası', error);
    if (state.role === 'student') scheduleManagerReconnect();
  });
}

function connectParticipantToManager() {
  if (state.role !== 'student' || !state.signalPeer || state.signalPeer.destroyed) return;
  if (state.signalConn?.open) return;

  try {
    updateStatus('Yöneticiye bağlanıyor', false);
    const conn = state.signalPeer.connect(signalPeerId('teacher'), {
      reliable: true,
      serialization: 'json',
      metadata: { role: 'student', name: state.name, room: state.room },
    });
    setupSignalConnection(conn);
  } catch (error) {
    console.warn('Yönetici bağlantısı başlatılamadı', error);
    scheduleManagerReconnect();
  }
}

function scheduleManagerReconnect(delay = 1500) {
  if (state.role !== 'student') return;
  clearTimeout(state.signalRetryTimer);
  state.signalRetryTimer = setTimeout(() => {
    if (!state.signalConn?.open) connectParticipantToManager();
  }, delay);
}

function schedulePeerRecovery(delay = 1800) {
  clearTimeout(state.peerRetryTimer);
  state.peerRetryTimer = setTimeout(async () => {
    if (!navigator.onLine) return schedulePeerRecovery(2500);
    try {
      if (state.signalPeer && !state.signalPeer.destroyed && state.signalPeer.disconnected) {
        state.signalPeer.reconnect();
        return;
      }
      if (!state.signalPeer || state.signalPeer.destroyed) await connectSignaling(true);
    } catch (error) {
      console.warn('Peer recovery failed', error);
      schedulePeerRecovery(Math.min(delay + 1200, 7000));
    }
  }, delay);
}

async function recoverConnection() {
  if (!state.room || $('#prejoin') && !$('#prejoin').classList.contains('hidden')) return;
  updateStatus('Yeniden bağlanıyor', false);
  if (!state.signalPeer || state.signalPeer.destroyed) {
    await connectSignaling(true);
    return;
  }
  if (state.signalPeer.disconnected) {
    try { state.signalPeer.reconnect(); } catch { schedulePeerRecovery(); }
  }
  if (state.role === 'student' && !state.signalConn?.open) scheduleManagerReconnect(250);
}

async function connectSignaling(isRecovery = false) {
  if (!isRecovery) updateStatus('Bağlantı servisine bağlanıyor', false);

  if (typeof Peer !== 'function') {
    toast('Bağlantı kütüphanesi yüklenemedi. Sayfayı yenileyin.', 5200);
    updateStatus('Bağlantı hatası', false);
    return;
  }

  if (state.signalPeer && !state.signalPeer.destroyed) {
    try { state.signalPeer.destroy(); } catch {}
  }

  const peer = new Peer(signalPeerId(state.role), {
    host: '0.peerjs.com',
    port: 443,
    path: '/',
    secure: true,
    config: { iceServers: state.iceServers },
    debug: 1,
  });
  state.signalPeer = peer;

  peer.on('open', () => {
    clearTimeout(state.peerRetryTimer);
    clearTimeout(state.signalRetryTimer);
    state.connected = true;
    if (state.role === 'teacher') updateStatus('Katılımcı bekleniyor', false);
    else connectParticipantToManager();
  });

  peer.on('connection', (conn) => {
    if (state.role !== 'teacher') {
      try { conn.close(); } catch {}
      return;
    }
    if (conn.metadata?.room && String(conn.metadata.room).toUpperCase() !== state.room) {
      try { conn.close(); } catch {}
      return;
    }
    setupSignalConnection(conn);
  });

  peer.on('call', (call) => handleIncomingMediaCall(call));

  peer.on('disconnected', () => {
    updateStatus('Bağlantı servisine yeniden bağlanıyor', false);
    schedulePeerRecovery(700);
  });

  peer.on('close', () => {
    state.connected = false;
    schedulePeerRecovery();
  });

  peer.on('error', (error) => {
    const type = error?.type || '';
    if (state.role === 'student' && ['peer-unavailable', 'network', 'disconnected'].includes(type)) {
      scheduleManagerReconnect(type === 'peer-unavailable' ? 1800 : 1000);
      return;
    }
    if (type === 'unavailable-id') {
      toast('Bu toplantı kodunun eski bağlantısı hâlâ açık. Birkaç saniye sonra tekrar deneniyor.', 4200);
      schedulePeerRecovery(2500);
    } else {
      console.error('PeerJS bağlantı hatası', error);
      updateStatus('Bağlantı yeniden kuruluyor', false);
      schedulePeerRecovery();
    }
  });
}

async function handleSignal(message) {
  switch (message.type) {
    case 'hello':
      if (state.role !== 'teacher') break;
      updateStatus('Katılımcı bulundu', false);
      updateRemoteName(message.name || 'Katılımcı');
      sendSignal({ type: 'hello-ack', name: state.name || 'Yönetici', serverManaged: true, protocol: 'web-1.9.11' });
      // 59 dk sayacı, katılımcı Supabase kaydına başarıyla işlendiğini
      // server-ready sinyaliyle bildirdikten sonra başlatılır.
      sendSignal({ type: 'screen-permission', allowed: state.participantScreenAllowed });
      sendSignal({ type: 'screen-owner', owner: state.activeScreenSharer });
      if (state.screenEnabled) setTimeout(() => startScreenCallToParticipant(), 350);
      break;
    case 'hello-ack':
      if (state.role !== 'student') break;
      updateRemoteName(message.name || 'Yönetici');
      if (message.serverManaged === true) {
        state.hostTransport = 'web';
        try {
          const joined = await window.MiniMeetAuth.participantJoin(state.room);
          const joinedStatus = joined?.status || null;
          // Web yöneticisi kendini serverManaged olarak tanıttıysa 404'ü
          // legacy masaüstü fallback'i olarak kabul etmiyoruz.
          if (joinedStatus?.legacyDesktop) {
            handleServerMeetingAccessEnded('meeting_not_found');
            break;
          }
          handleParticipantServerStatus(joinedStatus, false);
          if (!state.room || state.role !== 'student' || state.hostTransport !== 'web') break;
          await window.MiniMeetAuth.startParticipantWatch(state.room, (status) => {
            if (state.hostTransport === 'web') handleParticipantServerStatus(status, true);
          });
          if (!state.room || state.role !== 'student' || state.hostTransport !== 'web') break;
          sendSignal({ type: 'server-ready' });
        } catch (error) {
          if (state.hostTransport === 'web') {
            handleServerMeetingAccessEnded(error?.payload?.status?.reason || error.code || 'meeting_ended');
          }
          break;
        }
      } else {
        // Windows/macOS masaüstü yöneticisi. Bu oturumda Supabase'in web
        // toplantı durumu bu katılımcıyı kapatamaz. Toplantıyı EXE'nin
        // PeerJS sinyalleri ve lesson-ended mesajı yönetir.
        state.hostTransport = 'desktop';
        state.licenseMode = 'desktop';
        window.MiniMeetAuth?.stopWatches?.();
      }
      await startAvCallAsParticipant();
      break;
    case 'server-ready':
      if (state.role !== 'teacher') break;
      await startManagerTimerOnParticipantHello();
      break;
    case 'timer-start':
      if (state.role !== 'student') break;
      applyRemoteTimerConfig(message);
      break;
    case 'screen-permission':
      if (state.role !== 'student') break;
      state.participantScreenAllowed = Boolean(message.allowed);
      updateScreenShareUi();
      if (!state.participantScreenAllowed && state.screenEnabled) await stopScreenShare();
      break;
    case 'screen-share-request':
      if (state.role !== 'teacher') break;
      if (!state.participantScreenAllowed) {
        sendSignal({ type: 'screen-share-denied', reason: 'permission' });
        break;
      }
      if (state.activeScreenSharer && state.activeScreenSharer !== 'student') {
        sendSignal({ type: 'screen-share-denied', reason: 'busy' });
        break;
      }
      state.activeScreenSharer = 'student';
      sendSignal({ type: 'screen-share-grant' });
      sendSignal({ type: 'screen-owner', owner: 'student' });
      updateScreenShareUi();
      break;
    case 'screen-share-grant':
      if (state.role !== 'student') break;
      state.screenSharePending = false;
      state.activeScreenSharer = 'student';
      updateScreenShareUi();
      await beginScreenShare();
      break;
    case 'screen-share-denied':
      if (state.role !== 'student') break;
      state.screenSharePending = false;
      updateScreenShareUi();
      toast(message.reason === 'busy' ? 'Şu anda Yönetici ekran paylaşıyor.' : 'Yönetici ekran paylaşım izni vermedi.', 3800);
      break;
    case 'screen-share-cancelled':
    case 'screen-share-stopped':
      if (state.role !== 'teacher') break;
      if (state.activeScreenSharer === 'student') state.activeScreenSharer = null;
      sendSignal({ type: 'screen-owner', owner: null });
      updateScreenShareUi();
      break;
    case 'screen-force-stop':
      if (state.role !== 'student') break;
      if (state.screenEnabled) await stopScreenShare();
      toast('Yönetici ekran paylaşım iznini kapattı.', 3200);
      break;
    case 'screen-owner':
      state.activeScreenSharer = message.owner === 'teacher' || message.owner === 'student' ? message.owner : null;
      updateScreenShareUi();
      if (!state.activeScreenSharer && state.remoteScreenEnabled) {
        state.remoteScreenEnabled = false;
        showRemoteScreen(null);
      }
      break;
    case 'screen-state':
      state.remoteScreenEnabled = Boolean(message.enabled);
      if (message.owner === 'teacher' || message.owner === 'student') state.activeScreenSharer = message.owner;
      if (!state.remoteScreenEnabled && !state.screenEnabled) showRemoteScreen(null);
      updateScreenShareUi();
      break;
    case 'media-state':
      updateRemoteMediaState(message);
      break;
    case 'annotation':
      receiveAnnotationEvent(message.payload);
      break;
    case 'annotation-clear':
      clearAnnotationCanvas(false);
      break;
    case 'media-restart':
      if (state.role === 'student') scheduleAvReconnect(200);
      break;
    case 'lesson-ended': {
      const reason = message.reason || '';
      toast(reason === 'time-expired' ? 'Toplantı süresi doldu.' : 'Toplantı sona erdi.', 2200);
      setTimeout(() => {
        const room = state.room;
        cleanup(false);
        history.replaceState({}, '', '/');
        renderExitScreen(room, true, reason);
      }, 650);
      break;
    }
  }
}
