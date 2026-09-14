(() => {
  const MODE_KEY = 'minimeet-background-mode';
  const IMAGE_KEY = 'minimeet-background-image';
  const VALID_MODES = new Set(['normal', 'blur', 'image']);
  const MP_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/';
  let loaderPromise = null;

  function getMode() {
    const mode = localStorage.getItem(MODE_KEY) || 'normal';
    return VALID_MODES.has(mode) ? mode : 'normal';
  }

  function setMode(mode) {
    const next = VALID_MODES.has(mode) ? mode : 'normal';
    localStorage.setItem(MODE_KEY, next);
    return next;
  }

  function getImageData() {
    return localStorage.getItem(IMAGE_KEY) || '';
  }

  function setImageData(dataUrl) {
    if (!dataUrl) {
      localStorage.removeItem(IMAGE_KEY);
      return '';
    }
    try {
      localStorage.setItem(IMAGE_KEY, dataUrl);
    } catch (error) {
      console.warn('Arka plan resmi kalici olarak kaydedilemedi.', error);
    }
    return dataUrl;
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('Resim okunamadi.'));
      reader.readAsDataURL(file);
    });
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Arka plan resmi acilamadi.'));
      image.src = src;
    });
  }

  async function prepareImageFile(file) {
    if (!file || !String(file.type || '').startsWith('image/')) throw new Error('JPG veya PNG resim secin.');
    const raw = await fileToDataUrl(file);
    const image = await loadImage(raw);
    const maxW = 1280;
    const maxH = 720;
    const scale = Math.min(1, maxW / image.naturalWidth, maxH / image.naturalHeight);
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0, width, height);
    const data = canvas.toDataURL('image/jpeg', 0.84);
    setImageData(data);
    return data;
  }

  function ensureSelfieSegmentation() {
    if (window.SelfieSegmentation) return Promise.resolve();
    if (loaderPromise) return loaderPromise;
    loaderPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `${MP_BASE}selfie_segmentation.js`;
      script.crossOrigin = 'anonymous';
      script.onload = () => window.SelfieSegmentation ? resolve() : reject(new Error('Arka plan motoru yuklenemedi.'));
      script.onerror = () => reject(new Error('Arka plan motoru indirilemedi.'));
      document.head.append(script);
    });
    return loaderPromise;
  }

  function drawCover(ctx, image, width, height) {
    const iw = image.naturalWidth || image.videoWidth || image.width || width;
    const ih = image.naturalHeight || image.videoHeight || image.height || height;
    const scale = Math.max(width / Math.max(1, iw), height / Math.max(1, ih));
    const dw = iw * scale;
    const dh = ih * scale;
    ctx.drawImage(image, (width - dw) / 2, (height - dh) / 2, dw, dh);
  }

  async function createProcessedStream(rawStream, options = {}) {
    const requestedMode = VALID_MODES.has(options.mode) ? options.mode : getMode();
    const imageData = options.imageData || getImageData();
    const videoTrack = rawStream?.getVideoTracks?.()[0];
    if (!videoTrack || requestedMode === 'normal') {
      return { stream: rawStream, processor: null, mode: 'normal' };
    }
    if (typeof HTMLCanvasElement === 'undefined' || !HTMLCanvasElement.prototype.captureStream) {
      throw new Error('Bu cihaz arka plan efektini desteklemiyor.');
    }

    await ensureSelfieSegmentation();

    let backgroundImage = null;
    let mode = requestedMode;
    if (mode === 'image') {
      if (!imageData) throw new Error('Once bir arka plan resmi secin.');
      backgroundImage = await loadImage(imageData);
    }

    const settings = videoTrack.getSettings?.() || {};
    const sourceWidth = Number(settings.width) || 1280;
    const sourceHeight = Number(settings.height) || 720;
    const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth <= 820;
    const maxWidth = mobile ? 640 : 960;
    const scale = Math.min(1, maxWidth / sourceWidth);
    const width = Math.max(320, Math.round(sourceWidth * scale));
    const height = Math.max(180, Math.round(sourceHeight * scale));

    const inputVideo = document.createElement('video');
    inputVideo.muted = true;
    inputVideo.playsInline = true;
    inputVideo.autoplay = true;
    inputVideo.srcObject = new MediaStream([videoTrack]);
    await inputVideo.play().catch(() => {});

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
    if (!ctx) throw new Error('Arka plan cizim alani acilamadi.');

    const segmentation = new window.SelfieSegmentation({
      locateFile: (file) => `${MP_BASE}${file}`,
    });
    segmentation.setOptions({ modelSelection: 1, selfieMode: false });

    let running = true;
    let sending = false;
    let timer = null;

    segmentation.onResults((results) => {
      if (!running || !results?.image || !results?.segmentationMask) return;
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.filter = 'none';
      ctx.clearRect(0, 0, width, height);

      // Kisi maskesinin kenarlarini hafif yumusat, kisi net kalsin.
      ctx.filter = 'blur(1.4px)';
      ctx.drawImage(results.segmentationMask, 0, 0, width, height);
      ctx.filter = 'none';
      ctx.globalCompositeOperation = 'source-in';
      ctx.drawImage(results.image, 0, 0, width, height);

      // Arka plana orta seviye blur veya secilen resmi yerlestir.
      ctx.globalCompositeOperation = 'destination-over';
      if (mode === 'blur') {
        ctx.filter = 'blur(16px)';
        ctx.drawImage(results.image, -24, -24, width + 48, height + 48);
        ctx.filter = 'none';
      } else if (mode === 'image' && backgroundImage) {
        drawCover(ctx, backgroundImage, width, height);
      }
      ctx.restore();
    });

    const outputCanvasStream = canvas.captureStream(mobile ? 20 : 24);
    const outputVideoTrack = outputCanvasStream.getVideoTracks()[0];
    if (!outputVideoTrack) throw new Error('Efektli kamera akisi olusturulamadi.');
    outputVideoTrack.contentHint = 'motion';
    const outputStream = new MediaStream([outputVideoTrack, ...rawStream.getAudioTracks()]);

    const tick = async () => {
      if (!running) return;
      if (!sending && inputVideo.readyState >= 2 && videoTrack.readyState === 'live') {
        sending = true;
        try {
          await segmentation.send({ image: inputVideo });
        } catch (error) {
          console.warn('Arka plan efekti kare islemede hata verdi.', error);
        } finally {
          sending = false;
        }
      }
      timer = setTimeout(tick, mobile ? 60 : 42);
    };
    tick();

    const processor = {
      mode,
      outputVideoTrack,
      stop() {
        running = false;
        if (timer) clearTimeout(timer);
        try { outputVideoTrack.stop(); } catch {}
        try { inputVideo.pause(); } catch {}
        inputVideo.srcObject = null;
        try { segmentation.close?.(); } catch {}
      },
    };

    return { stream: outputStream, processor, mode };
  }

  window.MiniMeetBackground = {
    getMode,
    setMode,
    getImageData,
    setImageData,
    prepareImageFile,
    createProcessedStream,
  };
})();
