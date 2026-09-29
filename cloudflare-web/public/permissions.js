(() => {
  const STATE = {
    checking: false,
    modal: null,
    waiters: [],
    acknowledged: sessionStorage.getItem('minimeet-permissions-ok') === '1',
    watchersInstalled: false,
  };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  async function queryPermission(name) {
    try {
      if (!navigator.permissions?.query) return 'unknown';
      const result = await navigator.permissions.query({ name });
      return result?.state || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  async function getStates() {
    const [camera, microphone] = await Promise.all([
      queryPermission('camera'),
      queryPermission('microphone'),
    ]);
    return { camera, microphone };
  }

  function mediaSupported() {
    return Boolean(window.isSecureContext && navigator.mediaDevices?.getUserMedia);
  }

  function removeModal() {
    STATE.modal?.remove();
    STATE.modal = null;
  }

  function resolveWaiters(value) {
    const waiters = STATE.waiters.splice(0);
    waiters.forEach((resolve) => {
      try { resolve(value); } catch {}
    });
  }

  function markAcknowledged() {
    STATE.acknowledged = true;
    try { sessionStorage.setItem('minimeet-permissions-ok', '1'); } catch {}
  }

  function setStatus(card, type, message) {
    const status = card.querySelector('.permission-status');
    if (!status) return;
    status.className = `permission-status ${type || ''}`.trim();
    status.textContent = message || '';
  }

  function setBusy(card, busy) {
    card.querySelectorAll('button').forEach((button) => { button.disabled = busy; });
    card.classList.toggle('is-busy', busy);
  }

  function browserInfo() {
    const ua = navigator.userAgent || '';
    const vendor = navigator.vendor || '';
    const isiOS = /iPhone|iPad|iPod/i.test(ua);
    const isFirefox = /Firefox\//i.test(ua) || /FxiOS\//i.test(ua);
    const isOpera = /OPR\//i.test(ua) || /Opera/i.test(ua);
    const isEdge = /Edg\//i.test(ua);
    const isBrave = Boolean(navigator.brave) || /Brave/i.test(ua);
    const isChromium = /Chrome\//i.test(ua) || /CriOS\//i.test(ua);
    const isSafari = /Safari\//i.test(ua) && !isChromium && !isEdge && !isOpera && !isFirefox;
    if (isiOS) return { key: 'ios', label: 'iPhone/iPad Safari' };
    if (isFirefox) return { key: 'firefox', label: 'Mozilla Firefox' };
    if (isBrave) return { key: 'brave', label: 'Brave' };
    if (isOpera) return { key: 'opera', label: 'Opera' };
    if (isEdge) return { key: 'edge', label: 'Microsoft Edge' };
    if (isSafari || /Apple/i.test(vendor)) return { key: 'safari', label: 'Safari' };
    if (isChromium) return { key: 'chrome', label: 'Google Chrome' };
    return { key: 'other', label: 'Tarayıcınız' };
  }

  function browserHelpText() {
    const browser = browserInfo();
    if (browser.key === 'ios') {
      return 'iPhone/iPad: adres çubuğundaki aA / sayfa menüsü → Web Sitesi Ayarları → Kamera ve Mikrofon → İzin Ver. Gerekirse Ayarlar → Safari → Kamera/Mikrofon izinlerini de kontrol edin.';
    }
    if (browser.key === 'safari') {
      return `Safari (Mac): Safari → Ayarlar → Web Siteleri → Kamera ve Mikrofon bölümünde ${location.hostname} için İzin Ver seçin, sonra sayfaya dönüp “Tekrar kontrol et” deyin.`;
    }
    if (browser.key === 'firefox') {
      return 'Firefox: adres çubuğunun solundaki kilit/izin simgesine tıklayın → Kamera ve Mikrofon izinlerini açın. Daha önce engellediyseniz izinleri sıfırlayıp “Tekrar kontrol et” deyin.';
    }
    if (browser.key === 'brave') {
      return 'Brave: adres çubuğunun solundaki site ayarları/kilit simgesi → Kamera ve Mikrofon → İzin Ver. Brave Shields engelliyorsa bu site için medya izinlerini açın.';
    }
    if (browser.key === 'opera') {
      return 'Opera: adres çubuğunun solundaki site ayarları/kilit simgesi → Kamera ve Mikrofon → İzin Ver. Sonra “Tekrar kontrol et” deyin.';
    }
    if (browser.key === 'edge') {
      return 'Microsoft Edge: adres çubuğunun solundaki site ayarları simgesi → Kamera ve Mikrofon → İzin Ver. Sonra “Tekrar kontrol et” deyin.';
    }
    if (browser.key === 'chrome') {
      return 'Google Chrome: adres çubuğunun solundaki site ayarları simgesi → Kamera ve Mikrofon → İzin Ver. Sonra “Tekrar kontrol et” deyin.';
    }
    return `Tarayıcınızın site izinleri bölümünden ${location.hostname} için Kamera ve Mikrofon erişimini İzin Ver olarak ayarlayın, ardından “Tekrar kontrol et” deyin.`;
  }

  function createModal(context = 'initial') {
    removeModal();
    const overlay = el('div', 'permission-gate');
    const card = el('div', 'permission-card');
    card.innerHTML = `
      <div class="permission-icon">🎥</div>
      <div class="permission-kicker">MiniMeet izin kontrolü · <span class="permission-browser"></span></div>
      <h2>Kamera ve mikrofon izni gerekli</h2>
      <p>Görüntülü görüşmenin çalışması için MiniMeet'in kameranıza ve mikrofonunuza erişmesine izin vermeniz gerekir. Bu kontrol telefon, tablet ve masaüstü bilgisayarda uygulanır.</p>
      <div class="permission-list">
        <div><span>📷</span><div><strong>Kamera</strong><small>Görüntünüzü görüşmedeki diğer kişiye göndermek için.</small></div></div>
        <div><span>🎤</span><div><strong>Mikrofon</strong><small>Sesinizi görüşmedeki diğer kişiye göndermek için.</small></div></div>
      </div>
      <div class="permission-status">İzin vermek için aşağıdaki düğmeye dokunun.</div>
      <button type="button" class="primary permission-allow">Kamera ve mikrofon izni ver</button>
      <button type="button" class="secondary permission-retry hidden">Tekrar kontrol et</button>
      <div class="permission-help hidden"></div>
      <small class="permission-note">MiniMeet yalnızca görüşme sırasında kamera ve mikrofonu kullanır.</small>
    `;
    overlay.append(card);
    document.body.append(overlay);
    STATE.modal = overlay;

    const allow = card.querySelector('.permission-allow');
    const retry = card.querySelector('.permission-retry');
    const help = card.querySelector('.permission-help');
    const browser = browserInfo();
    const browserLabel = card.querySelector('.permission-browser');
    if (browserLabel) browserLabel.textContent = browser.label;

    const showBlockedHelp = (message) => {
      setStatus(card, 'error', message);
      allow.classList.add('hidden');
      retry.classList.remove('hidden');
      help.classList.remove('hidden');
      help.textContent = browserHelpText();
    };

    const requestNow = async () => {
      if (STATE.checking) return;
      STATE.checking = true;
      setBusy(card, true);
      setStatus(card, 'working', 'Tarayıcı izin penceresi bekleniyor…');
      try {
        if (!mediaSupported()) {
          showBlockedHelp(window.isSecureContext
            ? 'Bu tarayıcı kamera/mikrofon erişimini desteklemiyor.'
            : 'Kamera ve mikrofon için güvenli HTTPS bağlantısı gerekir.');
          return false;
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        stream.getTracks().forEach((track) => track.stop());
        setStatus(card, 'ok', 'Kamera ve mikrofon izni verildi.');
        await new Promise((resolve) => setTimeout(resolve, 300));
        markAcknowledged();
        removeModal();
        resolveWaiters(true);
        return true;
      } catch (error) {
        console.warn('MiniMeet permission request failed', error);
        const name = error?.name || '';
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          showBlockedHelp('Kamera veya mikrofon izni engellendi. Site ayarlarından izin vermeniz gerekiyor.');
        } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
          showBlockedHelp('Kamera veya mikrofon aygıtı bulunamadı. Cihazınızı kontrol edip tekrar deneyin.');
        } else if (name === 'NotReadableError' || name === 'TrackStartError') {
          showBlockedHelp('Kamera veya mikrofon başka bir uygulama tarafından kullanılıyor olabilir. Diğer uygulamaları kapatıp tekrar deneyin.');
        } else {
          showBlockedHelp('Kamera ve mikrofon açılamadı. Tarayıcı site izinlerini kontrol edip tekrar deneyin.');
        }
        return false;
      } finally {
        STATE.checking = false;
        setBusy(card, false);
      }
    };

    allow.addEventListener('click', requestNow);
    retry.addEventListener('click', async () => {
      const states = await getStates();
      if (states.camera === 'granted' && states.microphone === 'granted') {
        setStatus(card, 'ok', 'İzinler açık. Görüşmeye devam edebilirsiniz.');
        await new Promise((resolve) => setTimeout(resolve, 250));
        markAcknowledged();
        removeModal();
        resolveWaiters(true);
        return;
      }
      allow.classList.remove('hidden');
      retry.classList.add('hidden');
      help.classList.add('hidden');
      await requestNow();
    });

    return { overlay, card, requestNow };
  }

  async function ensure({ context = 'initial', forcePrompt = false } = {}) {
    // Aynı sekme oturumunda kullanıcı MiniMeet izin kapısını zaten başarıyla geçtiyse
    // tekrar özel modal göstermeyiz. Gerçek cihaz erişimi prepareMedia sırasında yine
    // getUserMedia ile doğrulanır; izin sonradan kapatılmışsa hata akışı modalı yeniden açar.
    if (!forcePrompt && STATE.acknowledged) return true;

    if (!mediaSupported()) {
      createModal(context);
      const card = STATE.modal?.querySelector('.permission-card');
      if (card) setStatus(card, 'error', window.isSecureContext
        ? 'Bu tarayıcı kamera/mikrofon erişimini desteklemiyor.'
        : 'Kamera ve mikrofon için güvenli HTTPS bağlantısı gerekir.');
      return false;
    }

    const states = await getStates();
    if (!forcePrompt && states.camera === 'granted' && states.microphone === 'granted') return true;

    if (STATE.modal) {
      return new Promise((resolve) => { STATE.waiters.push(resolve); });
    }

    return new Promise((resolve) => {
      STATE.waiters.push(resolve);
      const { card } = createModal(context);
      if (states.camera === 'denied' || states.microphone === 'denied') {
        setStatus(card, 'error', 'Kamera veya mikrofon izni daha önce engellenmiş. Site ayarlarından izin vermeniz gerekiyor.');
        card.querySelector('.permission-allow')?.classList.add('hidden');
        card.querySelector('.permission-retry')?.classList.remove('hidden');
        const help = card.querySelector('.permission-help');
        if (help) {
          help.classList.remove('hidden');
          help.textContent = browserHelpText();
        }
      }
    });
  }

  async function ensureBeforeMeeting() {
    // Her yeni sayfa oturumunda MiniMeet'in kendi izin kapisi en az bir kez gorunur.
    // Tarayici izni daha once verilmis olsa bile kullanici MiniMeet uzerinden devam eder.
    return ensure({ context: 'meeting', forcePrompt: !STATE.acknowledged });
  }

  async function handleMediaError(error) {
    const name = error?.name || '';
    if (['NotAllowedError', 'SecurityError'].includes(name)) {
      await ensure({ context: 'meeting', forcePrompt: true });
      return true;
    }
    return false;
  }

  async function installPermissionWatchers() {
    if (STATE.watchersInstalled || !navigator.permissions?.query) return;
    STATE.watchersInstalled = true;
    for (const name of ['camera', 'microphone']) {
      try {
        const permission = await navigator.permissions.query({ name });
        permission.addEventListener?.('change', async () => {
          if (permission.state !== 'granted') {
            STATE.acknowledged = false;
            try { sessionStorage.removeItem('minimeet-permissions-ok'); } catch {}
            await ensure({ context: 'permission-change', forcePrompt: true });
          }
        });
      } catch {}
    }
  }

  installPermissionWatchers();
  window.MiniMeetPermissions = { ensure, ensureBeforeMeeting, handleMediaError, getStates };
})();
