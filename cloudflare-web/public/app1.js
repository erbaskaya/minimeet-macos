const app = document.querySelector('#app');

const state = {
  room: null,
  role: null, // legacy internal ids: teacher = yönetici, student = katılımcı
  name: '',
  remoteName: '',
  signalPeer: null,
  signalConn: null,
  signalRetryTimer: null,
  peerRetryTimer: null,
  avRetryTimer: null,
  avCall: null,
  screenCall: null,
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
  remoteScreenEnabled: false,
  participantScreenAllowed: false,
  activeScreenSharer: null,
  screenSharePending: false,
  localScreenPreviewVisible: true,
  connected: false,
  peerConnected: false,
  turnConfigured: false,
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  selectedVideoId: localStorage.getItem('minimeet-video-device') || '',
  selectedAudioId: localStorage.getItem('minimeet-audio-device') || '',
  annotationActive: false,
  annotationTool: 'pen',
  annotationColor: '#ff2d2d',
  annotationSize: 4,
  durationMode: '',
  durationMinutes: 0,
  timerStarted: false,
  timerEndsAt: 0,
  timerInterval: null,
  timerExpiredHandled: false,
  account: null,
  licenseMode: null,
  hostTransport: null, // 'web' | 'desktop' for participant sessions
  serverMeetingEndsAt: 0,
  serverMeetingStarted: false,
};

const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
const isManager = () => state.role === 'teacher';
const isParticipant = () => state.role === 'student';

function toast(message, timeout = 2800) {
  const old = $('.toast');
  if (old) old.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.append(el);
  setTimeout(() => el.remove(), timeout);
}

function randomRoom() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

function hostNameStorageKey(room) {
  return `minimeet-manager-name-${String(room || '').toUpperCase()}`;
}

function participantNameStorageKey(room) {
  return `minimeet-participant-name-${String(room || '').toUpperCase()}`;
}

function durationModeStorageKey(room) {
  return `minimeet-duration-mode-${String(room || '').toUpperCase()}`;
}

function durationMinutesStorageKey(room) {
  return `minimeet-duration-minutes-${String(room || '').toUpperCase()}`;
}

function routeInfo() {
  const match = location.pathname.match(/^\/ders\/([A-Za-z0-9]+)/);
  if (!match) return null;
  const room = match[1].toUpperCase();
  const params = new URLSearchParams(location.search);
  const role = params.get('role') === 'teacher' ? 'teacher' : 'student';
  return { room, role };
}

function formatTrialRemaining(ms) {
  const minutes = Math.max(0, Math.ceil((Number(ms) || 0) / 60000));
  if (minutes <= 0) return 'Süre doldu';
  return `${minutes} dk kaldı`;
}

function openLicenseContact() {
  const url = window.MiniMeetAuth?.getConfig?.().licenseContactUrl || '';
  if (url) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  window.location.href = 'mailto:erbaskayam@gmail.com?subject=MiniMeet%20S%C3%BCresiz%20Lisans';
}

function authErrorText(error) {
  const code = String(error?.code || error?.message || '');
  if (code.includes('Invalid login credentials')) return 'E-posta veya şifre hatalı.';
  if (code === 'SESSION_IN_USE') return 'Bu hesap başka bir cihazda aktif yönetici oturumu kullanıyor. Diğer cihazdan çıkış yapın veya yaklaşık 90 saniye bekleyin.';
  if (code === 'ACTIVE_MEETING_EXISTS') return 'Bu hesapla başka bir aktif toplantı var.';
  if (['free_limit_expired','trial_expired'].includes(code)) return 'Ücretsiz toplantı süresi 59 dakikadır. Yeni bir toplantı başlatabilir veya süresiz kullanım için lisans satın alabilirsiniz.';
  if (code === 'blocked') return 'Bu hesap pasif durumda. İletişim: erbaskayam@gmail.com';
  return error?.message || 'İşlem tamamlanamadı.';
}

function renderHome() {
  app.innerHTML = `
    <main class="home-shell">
      <section class="home-card">
        <div class="brand">
          <div class="brand-mark">M</div>
          <div><h1>MiniMeet</h1><p>İki kişilik sade görüntülü görüşme</p></div>
        </div>
        <div class="hero">
          <div>
            <h2>Toplantınızı <span>tek linkle</span> başlatın.</h2>
            <p>Yönetici ve katılımcı hesap açmadan görüşmeye başlayabilir. Her toplantıda 59 dakika ücretsiz kullanım vardır; süresiz kullanmak isterseniz lisans satın alabilirsiniz.</p>
            <div class="choice-grid">
              <div class="choice manager-choice">
                <h3>Toplantı Başlat · Yönetici</h3>
                <p>Adınızı yazın ve hesap oluşturmadan ücretsiz toplantı başlatın.</p>
                <div id="manager-account-shell" class="manager-account-shell"><div class="auth-loading">Hesap kontrol ediliyor…</div></div>
              </div>
              <div class="choice">
                <h3>Toplantıya Katıl · Katılımcı</h3>
                <p>Katılımcı için hesap veya lisans gerekmez.</p>
                <input id="participant-name" class="field" maxlength="50" placeholder="Adınız" autocomplete="name" />
                <input id="room-input" class="field" maxlength="12" placeholder="Örn. K7P9W2" autocomplete="off" style="margin-top:10px;" />
                <button id="join-room" class="secondary" style="width:100%; margin-top:10px;">Toplantıya katıl</button>
              </div>
            </div>
            <div class="share-warning">⚠ Ekran paylaşımında kamera görüntünüz her zaman görünmez.</div>
          </div>
          <div class="visual-card" aria-hidden="true">
            <div class="visual-glow"></div>
            <div class="visual-pill pill-one">🔗 Tek linkle katılım</div>
            <div class="visual-pill pill-two">🖥️ Ekran paylaşımı</div>
            <div class="visual-pill pill-three">👤 Hesap gerekmez</div>
            <div class="visual-pill pill-four">⏱️ 59 dk ücretsiz</div>
            <div class="visual-screen">
              <div class="visual-screen-top">
                <span class="visual-badge">Canlı önizleme</span>
                <span class="visual-room">Kod: K7P9W2</span>
              </div>
              <div class="visual-screen-body">
                <div class="visual-stage">
                  <div class="visual-stage-title">Paylaşılan ekran</div>
                  <div class="visual-stage-window">
                    <div class="visual-stage-window-bar"></div>
                    <div class="visual-stage-window-body">
                      <div class="visual-line large"></div>
                      <div class="visual-line"></div>
                      <div class="visual-line short"></div>
                      <div class="visual-cards-row">
                        <span></span><span></span><span></span>
                      </div>
                    </div>
                  </div>
                </div>
                <div class="visual-side-stack">
                  <div class="visual-cam one">👤</div>
                  <div class="visual-cam two">👤</div>
                </div>
              </div>
            </div>
            <div class="visual-bar">
              <span class="visual-chip">Kamera</span>
              <span class="visual-chip">Mikrofon</span>
              <span class="visual-chip">Ekran</span>
              <span class="visual-chip">Link</span>
            </div>
          </div>
        </div>
      </section>
    </main>`;

  const join = async () => {
    const participantName = $('#participant-name').value.trim();
    const code = $('#room-input').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!participantName) return toast('Toplantıya katılmak için adınızı yazın.');
    if (!code) return toast('Toplantı kodunu yazın.');
    // Toplantının web mi yoksa masaüstü EXE/DMG tarafından mı açıldığını
    // gerçek PeerJS yönetici bağlantısı kurulduktan sonra belirliyoruz.
    sessionStorage.setItem(participantNameStorageKey(code), participantName);
    location.href = `/ders/${code}?role=student`;
  };
  $('#join-room').addEventListener('click', join);
  $('#participant-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#room-input').focus(); });
  $('#room-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });

  hydrateManagerAccount().catch((error) => {
    console.error(error);
    const shell = $('#manager-account-shell');
    if (shell) shell.innerHTML = `<div class="account-warning">Hesap sistemi açılamadı: ${escapeHtml(error.message)}</div>`;
  });
}

async function hydrateManagerAccount() {
  const shell = $('#manager-account-shell');
  if (!shell) return;
  const auth = window.MiniMeetAuth;
  const account = await auth.getAccount(true);
  state.account = account;

  if (!account) {
    shell.innerHTML = `
      <div class="auth-mode-note guest-free-note"><strong>Hesap açmadan her toplantıda 59 dakika ücretsiz</strong><span>Adınızı yazıp doğrudan toplantı başlatabilirsiniz. Katılımcı için de hesap gerekmez.</span><span>Süresiz kullanım için lisans satın alabilirsiniz.</span></div>
      <input id="guest-host-name" class="field" maxlength="50" placeholder="Adınız" autocomplete="name" />
      <div class="home-duration-box free-trial-box">
        <div class="home-duration-title">Ücretsiz kullanım <span>Her toplantı 59 dk</span></div>
        <strong class="free-trial-time">59:00 dakika</strong>
        <div class="home-duration-help">Sayaç ilk katılımcı gerçekten bağlandığında başlar. 59 dakika dolunca o toplantı sona erer; yeni toplantı açtığınızda yeniden 59 dakika ücretsiz kullanabilirsiniz.</div>
      </div>
      <button id="create-guest-room" class="primary" type="button">Ücretsiz toplantı başlat</button>
      <div class="guest-license-actions">
        <button id="show-account-login" class="link-button" type="button">Lisanslı hesabım var / Giriş yap</button>
        <button id="buy-license-top" class="link-button" type="button">Süresiz Kullanımı Satın Al</button>
      </div>
      <div id="account-login-panel" class="guest-account-panel hidden">
        <div class="guest-account-heading"><strong>Lisanslı hesap</strong><span>Satın aldığınız lisansı kullanmak veya lisanslı hesap oluşturmak için giriş yapın.</span></div>
        <input id="auth-full-name" class="field" maxlength="80" placeholder="Ad soyad (hesap oluştururken)" autocomplete="name" />
        <input id="auth-email" class="field" type="email" placeholder="E-posta" autocomplete="email" />
        <input id="auth-password" class="field" type="password" minlength="8" placeholder="Şifre (en az 8 karakter)" autocomplete="current-password" />
        <div class="auth-buttons">
          <button id="manager-login" class="primary" type="button">Giriş yap</button>
          <button id="manager-signup" class="secondary" type="button">Hesap oluştur</button>
        </div>
        <button id="forgot-password" class="link-button forgot-password" type="button">Şifremi unuttum</button>
      </div>`;

    const startGuestMeeting = async () => {
      const managerName = $('#guest-host-name')?.value.trim();
      if (!managerName) return toast('Toplantıyı başlatmak için adınızı yazın.');
      const button = $('#create-guest-room');
      button.disabled = true;
      button.textContent = 'Hazırlanıyor…';
      try {
        const room = randomRoom();
        const created = await auth.createMeeting(room, { guest: true });
        sessionStorage.setItem(hostNameStorageKey(room), managerName);
        sessionStorage.setItem(durationModeStorageKey(room), 'timed');
        sessionStorage.setItem(durationMinutesStorageKey(room), '59');
        sessionStorage.setItem(`minimeet-server-plan-${room}`, JSON.stringify(created.status || {}));
        location.href = `/ders/${room}?role=teacher`;
      } catch (error) {
        toast(authErrorText(error), 6200);
        button.disabled = false;
        button.textContent = 'Ücretsiz toplantı başlat';
      }
    };

    $('#create-guest-room')?.addEventListener('click', startGuestMeeting);
    $('#guest-host-name')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') startGuestMeeting(); });
    $('#buy-license-top')?.addEventListener('click', openLicenseContact);
    $('#show-account-login')?.addEventListener('click', () => {
      const panel = $('#account-login-panel');
      const willShow = panel?.classList.contains('hidden');
      panel?.classList.toggle('hidden', !willShow);
      $('#show-account-login').textContent = willShow ? 'Giriş alanını kapat' : 'Lisanslı hesabım var / Giriş yap';
      if (willShow) setTimeout(() => $('#auth-email')?.focus(), 0);
    });

    const credentials = () => ({
      fullName: $('#auth-full-name')?.value.trim() || '',
      email: $('#auth-email')?.value.trim() || '',
      password: $('#auth-password')?.value || '',
    });
    $('#manager-login')?.addEventListener('click', async () => {
      const c = credentials();
      if (!c.email || !c.password) return toast('E-posta ve şifrenizi yazın.');
      try {
        await auth.signIn(c);
        toast('Giriş yapıldı.');
        await hydrateManagerAccount();
      } catch (error) { toast(authErrorText(error), 4800); }
    });
    $('#forgot-password')?.addEventListener('click', async () => {
      const email = $('#auth-email')?.value.trim() || '';
      if (!email) return toast('Önce e-posta adresinizi yazın.');
      try {
        await auth.requestPasswordReset(email);
        toast('Şifre yenileme bağlantısı e-posta adresinize gönderildi.', 6000);
      } catch (error) { toast(authErrorText(error), 5200); }
    });
    $('#manager-signup')?.addEventListener('click', async () => {
      const c = credentials();
      if (!c.fullName || !c.email || !c.password) return toast('Hesap oluşturmak için ad soyad, e-posta ve şifreyi doldurun.');
      try {
        const result = await auth.signUp(c);
        if (result?.session) {
          toast('Hesabınız oluşturuldu.');
          await hydrateManagerAccount();
        } else {
          toast('Hesap oluşturuldu. E-posta doğrulaması açıksa gelen bağlantıyla hesabınızı doğrulayın.', 6500);
        }
      } catch (error) { toast(authErrorText(error), 5200); }
    });
    $('#auth-password')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#manager-login')?.click(); });
    return;
  }

  const resetMode = new URLSearchParams(location.search).get('reset') === '1';
  if (resetMode) {
    shell.innerHTML = `
      <div class="auth-mode-note"><strong>Yeni şifre belirleyin</strong><span>${escapeHtml(account.email || '')}</span></div>
      <input id="new-password" class="field" type="password" minlength="8" placeholder="Yeni şifre (en az 8 karakter)" autocomplete="new-password" />
      <input id="new-password-2" class="field" type="password" minlength="8" placeholder="Yeni şifre tekrar" autocomplete="new-password" />
      <button id="save-new-password" class="primary" type="button">Şifreyi kaydet</button>`;
    $('#save-new-password')?.addEventListener('click', async () => {
      const a = $('#new-password')?.value || '';
      const b = $('#new-password-2')?.value || '';
      if (a.length < 8) return toast('Yeni şifre en az 8 karakter olmalıdır.');
      if (a !== b) return toast('Şifreler aynı değil.');
      try {
        await auth.updatePassword(a);
        history.replaceState({}, '', '/');
        toast('Şifreniz güncellendi.');
        await hydrateManagerAccount();
      } catch (error) { toast(authErrorText(error), 5200); }
    });
    return;
  }

  const ent = account.entitlement || {};
  const isLicensed = ent.mode === 'licensed' && ent.allowed;
  const isBlocked = ent.mode === 'blocked' || account.account_status === 'blocked';
  const statusClass = isLicensed ? 'licensed' : isBlocked ? 'blocked' : 'free';
  const statusText = isLicensed ? 'Lisanslı · Süresiz' : isBlocked ? 'Hesap pasif' : 'Ücretsiz · Her toplantı 59 dk';

  shell.innerHTML = `
    <div class="account-summary">
      <div><strong>${escapeHtml(account.full_name || 'Yönetici')}</strong><small>${escapeHtml(account.email || '')}</small></div>
      <span class="account-status ${statusClass}">${escapeHtml(statusText)}</span>
    </div>
    <div class="account-actions-top">
      ${!isLicensed && !isBlocked ? '<button id="buy-license-top" class="link-button" type="button">Süresiz Kullanımı Satın Al</button>' : ''}
      ${account.is_admin ? '<a class="account-link" href="/admin">Lisans yönetimi</a>' : ''}
      <button id="manager-logout" class="link-button" type="button">Çıkış</button>
    </div>
    ${isBlocked ? '<div class="account-warning">Bu hesap pasif durumda. Yönetici olarak toplantı başlatamaz.</div>' : ''}
    ${!isBlocked ? `
      <input id="host-name" class="field" maxlength="50" placeholder="Toplantıda görünecek adınız" autocomplete="name" value="${escapeHtml(account.full_name || '')}" />
      ${isLicensed ? `
        <div class="home-duration-box">
          <div class="home-duration-title">Toplantı süresi <span>Lisanslı</span></div>
          <div class="home-duration-options">
            <label class="home-duration-option"><input type="radio" name="home-duration-mode" value="unlimited" checked /> <span>Süresiz</span></label>
            <label class="home-duration-option"><input type="radio" name="home-duration-mode" value="timed" /> <span>Süreli</span></label>
          </div>
          <div id="home-duration-minutes-row" class="home-duration-minutes-row hidden">
            <input id="home-duration-minutes" class="field" type="number" min="1" max="1440" step="1" inputmode="numeric" placeholder="Örn. 45" />
            <span>dakika</span>
          </div>
          <div class="home-duration-help">Lisanslı hesapta süre sınırı yoktur.</div>
        </div>` : `
        <div class="home-duration-box free-trial-box">
          <div class="home-duration-title">Ücretsiz kullanım <span>Her toplantı 59 dk</span></div>
          <strong class="free-trial-time">59:00 dakika</strong>
          <div class="home-duration-help">Ücretsiz kullanım her toplantı için 59 dakikadır. Süre ilk katılımcı gerçekten bağlandığında başlar. 59 dakika dolunca toplantı sona erer; yeni bir toplantı açarak yeniden 59 dakika ücretsiz kullanabilirsiniz. Süresiz kullanmak isterseniz satın almanız gerekir. İletişim: <a href="mailto:erbaskayam@gmail.com?subject=MiniMeet%20S%C3%BCresiz%20Lisans">erbaskayam@gmail.com</a></div>
        </div>`}
      <button id="create-room" class="primary" style="margin-top:10px;">Toplantıyı başlat</button>` : ''}`;

  $('#manager-logout')?.addEventListener('click', async () => {
    await auth.signOut();
    state.account = null;
    toast('Hesaptan çıkış yapıldı.');
    await hydrateManagerAccount();
  });
  $('#buy-license')?.addEventListener('click', openLicenseContact);
  $('#buy-license-top')?.addEventListener('click', openLicenseContact);

  if (isBlocked) return;

  if (isLicensed) {
    const radios = document.querySelectorAll('input[name="home-duration-mode"]');
    const row = $('#home-duration-minutes-row');
    const input = $('#home-duration-minutes');
    radios.forEach((radio) => radio.addEventListener('change', () => {
      const timed = document.querySelector('input[name="home-duration-mode"]:checked')?.value === 'timed';
      row?.classList.toggle('hidden', !timed);
      if (timed) setTimeout(() => input?.focus(), 0);
    }));
  }

  const startMeeting = async () => {
    const managerName = $('#host-name')?.value.trim();
    if (!managerName) return toast('Toplantıyı başlatmak için adınızı yazın.');
    let durationMode = 'timed';
    let durationMinutes = 59;
    if (isLicensed) {
      durationMode = document.querySelector('input[name="home-duration-mode"]:checked')?.value || 'unlimited';
      durationMinutes = 0;
      if (durationMode === 'timed') {
        durationMinutes = Number.parseInt($('#home-duration-minutes')?.value || '', 10);
        if (!Number.isFinite(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440) return toast('Süreli toplantı için 1 ile 1440 arasında dakika yazın.', 4200);
      }
    }

    const button = $('#create-room');
    button.disabled = true;
    button.textContent = 'Hazırlanıyor…';
    try {
      const room = randomRoom();
      const created = await auth.createMeeting(room);
      sessionStorage.setItem(hostNameStorageKey(room), managerName);
      sessionStorage.setItem(durationModeStorageKey(room), durationMode);
      sessionStorage.setItem(durationMinutesStorageKey(room), String(durationMinutes));
      sessionStorage.setItem(`minimeet-server-plan-${room}`, JSON.stringify(created.status || {}));
      location.href = `/ders/${room}?role=teacher`;
    } catch (error) {
      toast(authErrorText(error), 6200);
      button.disabled = false;
      button.textContent = 'Toplantıyı başlat';
      if (['free_limit_expired', 'trial_expired', 'blocked'].includes(error.code)) await hydrateManagerAccount();
    }
  };
  $('#create-room')?.addEventListener('click', startMeeting);
  $('#host-name')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') startMeeting(); });
}

function serverMeetingReasonText(reason) {
  const map = {
    'free_limit_expired': 'Bu ücretsiz toplantının 59 dakikalık süresi tamamlandı.',
    'trial_expired': 'Bu ücretsiz toplantının 59 dakikalık süresi tamamlandı.',
    'blocked': 'Yönetici hesabı pasif durumda.',
    'account_blocked': 'Yönetici hesabı pasif durumda.',
    'host_offline': 'Yönetici bağlantısı sona erdi.',
    'meeting_ended': 'Toplantı sona erdi.',
    'meeting_not_found': 'Toplantı bulunamadı.',
    'session_invalid': 'Yönetici oturumu başka bir cihazda açıldı.',
    'time-expired': 'Belirlenen görüşme süresi tamamlandı.',
  };
  return map[reason] || 'Toplantı artık aktif değil.';
}

function renderExitScreen(room, endedByManager = false, reason = '') {
  const protectedEnd = ['free_limit_expired','trial_expired','blocked','account_blocked','host_offline','meeting_ended','meeting_not_found','session_invalid'].includes(reason);
  const licenseRelated = ['free_limit_expired','trial_expired','blocked','account_blocked','session_invalid'].includes(reason);
  const title = reason === 'time-expired' ? 'Toplantı süresi doldu' : protectedEnd ? 'Toplantı sona erdi' : endedByManager ? 'Toplantı sona erdi' : 'Toplantıdan ayrıldınız';
  const headline = protectedEnd ? serverMeetingReasonText(reason) : reason === 'time-expired' ? 'Belirlenen görüşme süresi tamamlandı.' : endedByManager ? 'Yönetici görüşmeyi bitirdi.' : 'MiniMeet oturumundan çıktınız.';
  const exitDescription = licenseRelated
    ? 'Görüşme süre veya hesap kontrolü nedeniyle kapatıldı.'
    : reason === 'meeting_not_found'
      ? 'Toplantı bağlantısı artık aktif değil veya toplantı daha önce kapatıldı.'
      : reason === 'host_offline'
        ? 'Yönetici bağlantısı kesildiği için toplantı kapatıldı.'
        : protectedEnd
          ? 'Bu toplantı artık aktif değil.'
          : endedByManager
            ? (reason === 'time-expired' ? 'Süre dolduğu için görüşme otomatik olarak sonlandırıldı.' : 'Bu toplantı artık aktif değil.')
            : 'Yanlışlıkla ayrıldıysanız aynı toplantı koduyla tekrar katılabilirsiniz.';
  app.innerHTML = `
    <main class="home-shell student-home-shell">
      <section class="exit-card">
        <div class="brand-mark exit-mark">M</div>
        <div class="exit-status">${escapeHtml(title)}</div>
        <h2>${escapeHtml(headline)}</h2>
        <p>${escapeHtml(exitDescription)}</p>
        ${endedByManager || protectedEnd ? '' : `<button id="rejoin-room" class="primary">Aynı toplantıya tekrar katıl</button>`}
        <button id="student-home" class="secondary exit-secondary">Ana ekrana dön</button>
      </section>
    </main>`;

  $('#rejoin-room')?.addEventListener('click', () => {
    location.href = `/ders/${encodeURIComponent(room)}?role=student`;
  });
  $('#student-home').addEventListener('click', () => {
    history.replaceState({}, '', '/');
    renderHome();
  });
}

function renderRoom(room, role) {
  state.room = room;
  state.role = role;
  state.name = role === 'teacher'
    ? (sessionStorage.getItem(hostNameStorageKey(room)) || '')
    : (sessionStorage.getItem(participantNameStorageKey(room)) || '');
  state.remoteName = role === 'teacher' ? 'Katılımcı' : 'Yönetici';
  state.durationMode = role === 'teacher' ? (sessionStorage.getItem(durationModeStorageKey(room)) || '') : '';
  state.durationMinutes = role === 'teacher' ? (Number.parseInt(sessionStorage.getItem(durationMinutesStorageKey(room)) || '0', 10) || 0) : 0;
  state.timerStarted = false;
  state.timerEndsAt = 0;
  state.timerExpiredHandled = false;
  clearInterval(state.timerInterval);
  state.timerInterval = null;
  state.participantScreenAllowed = false;
  state.activeScreenSharer = null;
  state.screenSharePending = false;
  state.hostTransport = role === 'teacher' ? 'web' : null;

  const namePrompt = role === 'teacher'
    ? (state.name
        ? `<div class="host-name-display">Yönetici: <strong>${escapeHtml(state.name)}</strong></div>`
        : '<input id="host-name-room" class="field" maxlength="50" placeholder="Adınız" autocomplete="name" />')
    : (state.name
        ? `<div class="host-name-display">Katılımcı: <strong>${escapeHtml(state.name)}</strong></div>`
        : '<input id="participant-name-room" class="field" maxlength="50" placeholder="Adınız" autocomplete="name" />');

  app.innerHTML = `
    <main class="room-shell ${role === 'teacher' ? 'manager-room' : 'participant-room'}">
      <header class="topbar">
        <div class="top-left">
          <div class="room-brand">MiniMeet</div>
          <div class="room-code">Kod: <b>${escapeHtml(room)}</b></div>
          <div class="role-chip">${role === 'teacher' ? 'Yönetici' : 'Katılımcı'}</div>
        </div>
        <div class="top-right">
          <div class="status-pill"><span id="status-dot" class="status-dot"></span><span id="status-text">Hazırlanıyor</span></div>
          <div id="meeting-timer" class="meeting-timer hidden"><span>Kalan</span><strong id="meeting-timer-text">05:00</strong></div>
          ${role === 'teacher' ? '<button id="copy-link-top" class="secondary">Katılım linkini kopyala</button>' : ''}
        </div>
      </header>

      <section class="stage">
        <div class="screen-panel" id="screen-panel">
          <div class="screen-label" id="screen-label">Ekran paylaşımı</div>
          <button id="screen-preview-toggle" class="screen-preview-toggle hidden" type="button">Önizlemeyi gizle</button>
          <video id="screen-video" autoplay playsinline muted></video>
          <canvas id="annotation-canvas" class="annotation-canvas"></canvas>
          <div id="screen-empty" class="screen-empty"><div class="icon">🖥️</div><div>${role === 'teacher' ? 'Ekran paylaşımını başlatabilir veya Katılımcıya izin verebilirsiniz.' : 'Ekran paylaşımı yok.'}</div></div>
          ${role === 'teacher' ? `
          <div id="annotation-tools" class="annotation-tools hidden">
            <button data-tool="pen" class="active" title="Kalem">✏️</button>
            <button data-tool="highlighter" title="Fosforlu kalem">🖍️</button>
            <button data-tool="arrow" title="Ok">➜</button>
            <button data-tool="rect" title="Dikdörtgen">▭</button>
            <button data-tool="eraser" title="Silgi">⌫</button>
            <input id="annotation-color" type="color" value="#ff2d2d" title="Renk" />
            <input id="annotation-size" type="range" min="2" max="16" value="4" title="Kalınlık" />
            <button id="annotation-clear" title="Tümünü temizle">🧹</button>
          </div>` : ''}
        </div>
        <aside class="video-rail ${role === 'teacher' ? 'teacher-view' : 'student-view'}" id="video-rail">
          <div class="camera-drag-handle" id="camera-drag-handle" title="Kamera panelini taşı">⋮⋮</div>
          ${role === 'teacher' ? `
            <div class="cam-card remote-cam">
              <video id="student-video" autoplay playsinline muted></video>
              <div id="student-off" class="cam-off"><div><div class="avatar">K</div><div>Katılımcı kamerası kapalı</div></div></div>
              <div class="cam-label">Katılımcı</div>
            </div>
            <div class="cam-card self-cam">
              <video id="teacher-video" autoplay playsinline muted></video>
              <div id="teacher-off" class="cam-off"><div><div class="avatar">S</div><div>Kameranız kapalı</div></div></div>
              <div class="cam-label">Siz</div>
            </div>` : `
            <div class="cam-card remote-cam">
              <video id="teacher-video" autoplay playsinline muted></video>
              <div id="teacher-off" class="cam-off"><div><div class="avatar">Y</div><div>Yönetici kamerası kapalı</div></div></div>
              <div class="cam-label">Yönetici</div>
            </div>
            <div class="cam-card self-cam">
              <video id="student-video" autoplay playsinline muted></video>
              <div id="student-off" class="cam-off"><div><div class="avatar">S</div><div>Kameranız kapalı</div></div></div>
              <div class="cam-label">Siz</div>
            </div>`}
          <div class="camera-resize-handle" id="camera-resize-handle" title="Kamera görüntülerini büyüt / küçült" aria-label="Kamera görüntülerini büyüt veya küçült"></div>
        </aside>
      </section>

      <footer class="controls" id="room-controls">
        <button id="mic-btn" class="control active"><span class="ci">🎤</span><span>Mikrofon</span></button>
        <button id="cam-btn" class="control active"><span class="ci">🎥</span><span>Kamera</span></button>
        <button id="devices-btn" class="control"><span class="ci">⚙️</span><span>${role === 'teacher' ? 'Ayarlar' : 'Aygıtlar'}</span></button>
        ${role === 'teacher' ? '<button id="screen-btn" class="control"><span class="ci">🖥️</span><span>Ekran Paylaş</span></button>' : '<button id="screen-btn" class="control permission-disabled" disabled><span class="ci">🖥️</span><span>Paylaşım izni yok</span></button>'}
        ${role === 'teacher' ? '<button id="draw-btn" class="control"><span class="ci">✏️</span><span>Çizim</span></button>' : ''}
        <button id="fullscreen-btn" class="control"><span class="ci">⛶</span><span>Tam ekran</span></button>
        ${role === 'teacher' ? '<button id="copy-btn" class="control"><span class="ci">🔗</span><span>Link</span></button>' : ''}
        <button id="end-btn" class="control end"><span class="ci">⏹</span><span>${role === 'teacher' ? 'Toplantıyı bitir' : 'Ayrıl'}</span></button>
      </footer>
    </main>
    <audio id="remote-audio" autoplay></audio>
    <audio id="screen-audio" autoplay></audio>

    <div id="device-panel" class="device-panel hidden">
      <div class="device-panel-card">
        <div class="device-panel-head"><strong>${role === 'teacher' ? 'Toplantı ayarları' : 'Kamera ve mikrofon'}</strong><button id="device-panel-close">×</button></div>
        <label>Kamera<select id="room-camera-select" class="field"></select></label>
        <label>Mikrofon<select id="room-mic-select" class="field"></select></label>
        <div class="background-setting">
          <div><strong>Arka plan</strong><small>Normal, orta bulanık veya kendi resminiz.</small></div>
          <div class="background-controls">
            <select id="room-background-select" class="field background-select">
              <option value="normal">Normal</option>
              <option value="blur">Bulanık (Orta)</option>
              <option value="image">Arka Plan Resmi</option>
            </select>
            <button id="room-background-image-btn" class="secondary background-image-btn" type="button">Resim seç</button>
          </div>
        </div>
        ${role === 'teacher' ? `
        <div class="permission-setting">
          <div><strong>Katılımcı ekran paylaşabilir</strong><small>Açıldığında Katılımcının Ekran Paylaş düğmesi etkinleşir. Aynı anda yalnızca bir kişi ekran paylaşabilir.</small></div>
          <label class="switch"><input id="participant-screen-permission" type="checkbox" /><span></span></label>
        </div>` : ''}
        <div id="turn-state" class="network-state">Bağlantı ayarları kontrol ediliyor…</div>
      </div>
    </div>

    <div id="prejoin" class="prejoin">
      <div class="prejoin-card">
        <div class="prejoin-nav">
          <button id="prejoin-home" class="prejoin-home-btn" type="button">← Ana sayfaya dön</button>
        </div>
        <div class="prejoin-grid">
          <div class="preview"><video id="preview-video" autoplay playsinline muted></video></div>
          <div class="form-stack">
            <h2>${role === 'teacher' ? 'Toplantıyı başlat · Yönetici' : 'Toplantıya katıl · Katılımcı'}</h2>
            <p>Kamera ve mikrofonunuzu kontrol edin.</p>
            ${namePrompt}
            <label class="device-select-label">Kamera<select id="pre-camera-select" class="field"></select></label>
            <label class="device-select-label">Mikrofon<select id="pre-mic-select" class="field"></select></label>
            <div class="pre-background-box">
              <label class="device-select-label">Arka plan
                <select id="pre-background-select" class="field">
                  <option value="normal">Normal</option>
                  <option value="blur">Bulanık (Orta)</option>
                  <option value="image">Arka Plan Resmi</option>
                </select>
              </label>
              <button id="pre-background-image-btn" class="secondary background-image-btn" type="button">Resim seç</button>
            </div>
            <input id="background-image-input" type="file" accept="image/png,image/jpeg,image/webp" hidden />
            <div id="background-status" class="background-status">Arka plan: Normal</div>
            <div class="device-row">
              <button id="pre-cam" class="device-toggle">🎥 Kamera açık</button>
              <button id="pre-mic" class="device-toggle">🎤 Mikrofon açık</button>
            </div>
            ${role === 'teacher' ? `
              ${state.durationMode ? `
                <div class="duration-summary">
                  <span>Toplantı süresi</span>
                  <strong>${state.durationMode === 'unlimited' ? 'Süresiz' : `${state.durationMinutes} dakika`}</strong>
                  <small>Sayaç, katılımcı bağlandığı anda başlayacak.</small>
                </div>` : `
                <div class="duration-box">
                  <div class="duration-title">Toplantı süresi <span>Zorunlu</span></div>
                  <label class="duration-option"><input type="radio" name="duration-mode" value="unlimited" /> <span><strong>Süresiz</strong><small>Katılımcı ayrılana veya siz bitirene kadar devam eder.</small></span></label>
                  <label class="duration-option"><input type="radio" name="duration-mode" value="timed" /> <span><strong>Süreli</strong><small>Dakika cinsinden toplantı süresi belirleyin.</small></span></label>
                  <div id="duration-minutes-row" class="duration-minutes-row hidden">
                    <input id="duration-minutes" class="field" type="number" min="1" max="1440" step="1" inputmode="numeric" placeholder="Örn. 45" />
                    <span>dakika</span>
                  </div>
                  <div class="duration-help">Sayaç, katılımcı görüşmeye bağlandığı anda başlar. Son 5 dakika ekranda geri sayım olarak görünür.</div>
                </div>`}
              <div class="share-warning compact">⚠ Ekran paylaşımında kamera görüntünüz her zaman görünmez.</div>` : ''}
            <button id="enter-room" class="primary">${role === 'teacher' ? 'Toplantıyı başlat' : 'Toplantıya katıl'}</button>
          </div>
        </div>
      </div>
    </div>`;

  bindRoomControls();
  if (role === 'student') {
    // Burada Supabase durumuna bakarak toplantıyı erkenden kapatmıyoruz.
    // Masaüstü EXE/DMG toplantıları web_meetings tablosunda bulunmayabilir.
    // Gerçek ayrım, yöneticiyle PeerJS el sıkışması sırasında yapılır.
    prepareMedia();
  } else {
    window.MiniMeetAuth.hostSyncMeeting(room).then((synced) => {
      state.licenseMode = synced?.status?.mode || null;
      handleManagerServerStatus(synced?.status || null, false);
      window.MiniMeetAuth.startManagerWatch(room, (status) => handleManagerServerStatus(status, true));
      if (state.room) prepareMedia();
    }).catch((error) => {
      history.replaceState({}, '', '/');
      renderHome();
      setTimeout(() => toast(authErrorText(error), 5200), 100);
    });
  }
}
