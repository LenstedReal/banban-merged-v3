'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { TR } from '@/lib/i18n';

type Channel = { id: string; name: string; status: 'online' | 'maintenance' | 'checking' | 'coming_soon'; premium?: boolean; src?: string; badge?: string };

// CORS bypass — m3u8'leri backend proxy üzerinden ver (eski repo davranışı)
const proxify = (url: string) => `/api/stream/proxy?url=${encodeURIComponent(url)}`;

// Her kanal için yedek sunucu listesi (eski repodaki SERVER_ALTERNATIVES mantığı)
// 1. seçenek başarısız olursa otomatik 2., 3. denenir
const CHANNEL_SOURCES: Record<string, string[]> = {
  trt1: [
    proxify('https://tv-trt1.medya.trt.com.tr/master.m3u8'),
    proxify('https://tv-trt1.medya.trt.com.tr/master_1080.m3u8'),
    proxify('https://tv-trt1.medya.trt.com.tr/master_720.m3u8'),
  ],
  trthaber: [
    proxify('https://tv-trthaber.medya.trt.com.tr/master.m3u8'),
    proxify('https://tv-trthaber.medya.trt.com.tr/master_720.m3u8'),
  ],
  trtspor: [
    proxify('https://tv-trtspor1.medya.trt.com.tr/master.m3u8'),
    proxify('https://tv-trtspor1.medya.trt.com.tr/master_720.m3u8'),
  ],
  tv8: [
    proxify('https://tv8.daioncdn.net/tv8/tv8.m3u8?app=7ddc255a-ef47-4e81-ab14-c0e5f2949788&ce=3'),
    proxify('https://tv8.daioncdn.net/tv8/tv8.m3u8'),
  ],
  spiderman: ['/spiderman_trailer.mp4'],
  bein1: ['/api/bein1/stream.m3u8'],
};

const CHANNELS: Channel[] = [
  { id: 'fastx',     name: 'HIZLI VE ÖFKELİ 11', status: 'coming_soon', badge: 'YAKINDA' },
  { id: 'spiderman', name: 'SPIDER-MAN: BND',    status: 'online',      src: '/spiderman_trailer.mp4', badge: 'NEW' },
  { id: 'trt1',      name: 'TRT 1',              status: 'online',      src: CHANNEL_SOURCES.trt1[0] },
  { id: 'trthaber',  name: 'TRT HABER',          status: 'online',      src: CHANNEL_SOURCES.trthaber[0] },
  { id: 'tv8',       name: 'TV 8',               status: 'online',      src: CHANNEL_SOURCES.tv8[0] },
  { id: 'trtspor',   name: 'TRT SPOR',           status: 'online',      src: CHANNEL_SOURCES.trtspor[0] },
  { id: 'bein1',     name: 'beIN SPORTS 1',      status: 'maintenance', premium: true, src: '/api/bein1/stream.m3u8' },
  { id: 'bein2',     name: 'beIN SPORTS 2',      status: 'maintenance', premium: true },
  { id: 'ssport',    name: 'S SPORT',            status: 'maintenance', premium: true },
  { id: 'gstv',      name: 'GS TV',              status: 'maintenance' },
  { id: 'fbtv',      name: 'FB TV',              status: 'maintenance' },
  { id: 'atv',       name: 'ATV',                status: 'maintenance' },
  { id: 'aspor',     name: 'A SPOR',             status: 'maintenance' },
];

const AD_LIBRARY = [
  { name: 'eFootball',    src: '/ad_efootball.mp4', store: 'https://play.google.com/store/apps/details?id=jp.konami.pesam',                       color: '#0066FF' },
  { name: 'PUBG Mobile',  src: '/ad_pubg.mp4',      store: 'https://play.google.com/store/apps/details?id=com.tencent.ig',                       color: '#FF6600' },
  { name: 'Call of Duty', src: '/ad_cod.mp4',       store: 'https://play.google.com/store/apps/details?id=com.activision.callofduty.shooter',    color: '#00CC44' },
  { name: 'Lords Mobile', src: '/ad_lords.mp4',     store: 'https://play.google.com/store/apps/details?id=com.igg.android.lordsmobile',          color: '#CC0000' },
];

const MID_ROLL_INTERVAL_SEC = 17 * 60; // 17 dk — eski repodaki MIDROLL_INTERVAL
const AD_MAX_DURATION_MS = 60_000;     // 60sn güvenlik limiti

// Ad rotation — sessionStorage'de queue tut, her seferinde sıradakini ver
function nextAdIndex(): number {
  if (typeof window === 'undefined') return 0;
  try {
    const i = parseInt(sessionStorage.getItem('bb_adi') || '0', 10);
    const next = (i + 1) % AD_LIBRARY.length;
    sessionStorage.setItem('bb_adi', String(next));
    return i % AD_LIBRARY.length;
  } catch { return 0; }
}

// App store yönlendirme — Android Play Store / iOS App Store / Desktop yeni sekme
function redirectToStore(url: string) {
  if (!url) return;
  try {
    const ua = (navigator.userAgent || '').toLowerCase();
    const isMobile = /android|iphone|ipad|ipod/.test(ua);
    if (isMobile) {
      // Mobil cihazda doğrudan store linkine git (browser tarafı app açar)
      window.location.href = url;
    } else {
      // Desktop: yeni sekmede aç
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  } catch { /* noop */ }
}

type Level = { index: number; height: number; bitrate: number };

const qualityLabel = (h: number): string => {
  if (h >= 2160) return '4K';
  if (h >= 1440) return '1440p';
  if (h >= 1080) return '1080p';
  if (h >= 720) return '720p';
  if (h >= 480) return '480p';
  return '360p';
};

export default function VideoPlayer() {
  const [selected, setSelected] = useState<Channel>(CHANNELS[2]); // TRT 1 default
  const [serverIndex, setServerIndex] = useState(0);
  const [hasStarted, setHasStarted] = useState(false);
  const [adActive, setAdActive] = useState(false);
  const [adIndex, setAdIndex] = useState(0);
  const [awaitingResume, setAwaitingResume] = useState(false); // Reklam bitti → kullanıcı Play'e basana kadar yayın YOK
  const [adRemainingSec, setAdRemainingSec] = useState(0);
  const [streamError, setStreamError] = useState('');
  const [muted, setMuted] = useState(true);
  const [levels, setLevels] = useState<Level[]>([]);
  const [currentLevel, setCurrentLevel] = useState(-1); // -1 = AUTO
  const [qualityOpen, setQualityOpen] = useState(false);
  const [isPip, setIsPip] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  // Yeni eski-repo UI state'leri
  const [netType, setNetType] = useState('—');        // '4G' | 'WiFi' | '—'
  const [fps, setFps] = useState(0);                  // gerçek zamanlı fps
  const [subtitleTracks, setSubtitleTracks] = useState<Array<{id: number; name: string; lang: string}>>([]);
  const [currentSubtitle, setCurrentSubtitle] = useState(-1); // -1 = kapalı
  const [subtitleOpen, setSubtitleOpen] = useState(false);
  const [castSupported, setCastSupported] = useState(false);
  const [casting, setCasting] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<any>(null);
  const hlsActiveSrcRef = useRef<string | null>(null); // anti Strict-Mode double-init
  const playedTimeRef = useRef(0);
  const adVideoRef = useRef<HTMLVideoElement>(null);
  const adSafetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fpsFrameCountRef = useRef(0);
  const fpsLastSampleRef = useRef(0);
  const fpsRafIdRef = useRef<number | null>(null);

  // ===== Crash / freeze detection refs (eski repo mantığı) =====
  // STALL_THRESHOLD = 15sn donma → "YAYIN DONDU" overlay göster
  // CRASH_THRESHOLD = 45sn donma → tam çöktü → otomatik yeniden başlat
  const stallCountRef = useRef(0);
  const lastPlaybackTimeRef = useRef(0);
  const crashCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const freezeAutoRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const networkRetryRef = useRef(0);
  const retryStreamRef = useRef<(() => void) | null>(null);
  const cleanupListenersRef = useRef<(() => void) | null>(null);
  const [freezeOverlay, setFreezeOverlay] = useState(false);
  const STALL_THRESHOLD = 15;
  const CRASH_THRESHOLD = 45;
  const MAX_NETWORK_RETRIES = 3;

  // ===== Pre-roll on channel change — SADECE session içinde her kanal için BİR KEZ (eski repo) =====
  useEffect(() => {
    if (!hasStarted) return;
    // sessionStorage flag — kanal başına 1 kez preroll
    let alreadyShown = false;
    try { alreadyShown = sessionStorage.getItem('bb_pr_' + selected.id) === '1'; } catch { /* noop */ }
    if (alreadyShown) return; // Bu kanal için preroll zaten gösterildi — direkt yayına geç
    try { sessionStorage.setItem('bb_pr_' + selected.id, '1'); } catch { /* noop */ }
    // Yayını TAMAMEN durdur (ses bleed önlemek için)
    if (hlsRef.current) { try { hlsRef.current.destroy(); } catch { /* noop */ } hlsRef.current = null; }
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.muted = true; // arka plan sesi YOK
      videoRef.current.removeAttribute('src');
      videoRef.current.load();
    }
    setAdIndex(nextAdIndex());
    setAdActive(true);
    setAwaitingResume(false);
  }, [selected.id, hasStarted]);

  // ===== Ad countdown + safety timer =====
  useEffect(() => {
    if (!adActive) return;
    const id = setInterval(() => {
      const av = adVideoRef.current;
      if (!av) return;
      const dur = (isFinite(av.duration) && av.duration > 0) ? av.duration : 30;
      const cur = av.currentTime || 0;
      setAdRemainingSec(Math.max(0, Math.ceil(dur - cur)));
    }, 300);
    // Güvenlik timer: video hang olursa 60sn sonra reklamı kapat (store yönlendirme YOK çünkü tamamlanmadı)
    if (adSafetyTimerRef.current) clearTimeout(adSafetyTimerRef.current);
    adSafetyTimerRef.current = setTimeout(() => {
      setAdActive(false);
      setAwaitingResume(true);
    }, AD_MAX_DURATION_MS);
    return () => {
      clearInterval(id);
      if (adSafetyTimerRef.current) { clearTimeout(adSafetyTimerRef.current); adSafetyTimerRef.current = null; }
    };
  }, [adActive, adIndex]);

  // ===== Mid-roll timer — sadece yayın aktifken sayar =====
  useEffect(() => {
    if (!hasStarted) return;
    const id = setInterval(() => {
      if (adActive || awaitingResume) return; // Reklam veya manuel-play bekleme sırasında zamanlayıcı çalışmaz
      playedTimeRef.current += 0.5;
      if (playedTimeRef.current >= MID_ROLL_INTERVAL_SEC) {
        playedTimeRef.current = 0;
        // Yayını durdur, reklam başlat
        if (hlsRef.current) { try { hlsRef.current.destroy(); } catch { /* noop */ } hlsRef.current = null; }
        if (videoRef.current) { videoRef.current.pause(); videoRef.current.removeAttribute('src'); videoRef.current.load(); }
        setAdIndex(nextAdIndex());
        setAdActive(true);
      }
    }, 500);
    return () => clearInterval(id);
  }, [adActive, awaitingResume, hasStarted]);

  // ===== Fullscreen state tracker =====
  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  // ===== PiP state tracker =====
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onEnter = () => setIsPip(true);
    const onLeave = () => setIsPip(false);
    v.addEventListener('enterpictureinpicture', onEnter);
    v.addEventListener('leavepictureinpicture', onLeave);
    return () => {
      v.removeEventListener('enterpictureinpicture', onEnter);
      v.removeEventListener('leavepictureinpicture', onLeave);
    };
  }, []);

  // ===== Network connection type detect (Navigator.connection API) =====
  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    const conn: any = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
    const update = () => {
      try {
        if (!conn) { setNetType(navigator.onLine ? 'WiFi' : 'OFFLINE'); return; }
        const t = (conn.effectiveType || conn.type || '').toLowerCase();
        if (!navigator.onLine) { setNetType('OFFLINE'); return; }
        if (t === 'wifi' || t === 'ethernet') setNetType('WiFi');
        else if (t === '4g') setNetType('4G');
        else if (t === '5g') setNetType('5G');
        else if (t === '3g') setNetType('3G');
        else if (t === '2g' || t === 'slow-2g') setNetType('2G');
        else setNetType('WiFi');
      } catch { setNetType('—'); }
    };
    update();
    const onOnline = () => update();
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOnline);
    if (conn && conn.addEventListener) conn.addEventListener('change', update);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOnline);
      if (conn && conn.removeEventListener) conn.removeEventListener('change', update);
    };
  }, []);

  // ===== Cast support detect (Remote Playback API + iOS AirPlay) =====
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    try {
      // @ts-ignore
      const hasRemote = !!(v as any).remote && typeof (v as any).remote.watchAvailability === 'function';
      // @ts-ignore
      const hasAirplay = typeof (v as any).webkitShowPlaybackTargetPicker === 'function';
      setCastSupported(hasRemote || hasAirplay);
    } catch { setCastSupported(false); }
  }, [hasStarted]);

  // ===== Gerçek zamanlı FPS sayacı — requestVideoFrameCallback (Chrome/Edge) + fallback rAF =====
  useEffect(() => {
    if (!hasStarted || adActive || awaitingResume || streamError) {
      setFps(0);
      if (fpsRafIdRef.current) cancelAnimationFrame(fpsRafIdRef.current);
      fpsRafIdRef.current = null;
      return;
    }
    const v = videoRef.current;
    if (!v) return;
    fpsFrameCountRef.current = 0;
    fpsLastSampleRef.current = performance.now();
    // @ts-ignore
    if (typeof v.requestVideoFrameCallback === 'function') {
      const cb = () => {
        fpsFrameCountRef.current += 1;
        const now = performance.now();
        const dt = now - fpsLastSampleRef.current;
        if (dt >= 1000) {
          setFps(Math.round((fpsFrameCountRef.current * 1000) / dt));
          fpsFrameCountRef.current = 0;
          fpsLastSampleRef.current = now;
        }
        // @ts-ignore
        v.requestVideoFrameCallback(cb);
      };
      // @ts-ignore
      v.requestVideoFrameCallback(cb);
      return;
    }
    // Fallback rAF (kesinlik düşük ama çalışır)
    const loop = () => {
      fpsFrameCountRef.current += 1;
      const now = performance.now();
      const dt = now - fpsLastSampleRef.current;
      if (dt >= 1000) {
        setFps(Math.round((fpsFrameCountRef.current * 1000) / dt));
        fpsFrameCountRef.current = 0;
        fpsLastSampleRef.current = now;
      }
      fpsRafIdRef.current = requestAnimationFrame(loop);
    };
    fpsRafIdRef.current = requestAnimationFrame(loop);
    return () => {
      if (fpsRafIdRef.current) cancelAnimationFrame(fpsRafIdRef.current);
      fpsRafIdRef.current = null;
    };
  }, [hasStarted, adActive, awaitingResume, streamError, selected.id, serverIndex]);

  // ===== Mevcut yayın URL'i — server failover destekli =====
  const sources = CHANNEL_SOURCES[selected.id] || (selected.src ? [selected.src] : []);
  const activeSrc = sources[serverIndex] || sources[0] || selected.src || '';

  // ===== Kanal değişince server index sıfırla =====
  useEffect(() => { setServerIndex(0); }, [selected.id]);

  // ===== Global window callback — sayfa altındaki ServerSelector buradan tetikler =====
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.bbServerIndex = serverIndex;
    window.bbServerCount = sources.length;
    window.bbSwitchServer = (idx: number) => {
      if (idx === serverIndex || idx >= sources.length) return;
      networkRetryRef.current = 0;
      stallCountRef.current = 0;
      setFreezeOverlay(false);
      setServerIndex(idx);
    };
  }, [serverIndex, sources.length]);

  // ===== Load HLS / fallback — REKLAM YOKKEN VE MANUEL PLAY BEKLEME YOKKEN =====
  useEffect(() => {
    if (adActive || awaitingResume || !hasStarted) return;
    // Eğer pending destroy varsa iptal et (Strict Mode aynı src ile remount)
    const pending = (hlsRef as any).__pendingDestroy;
    if (pending) { clearTimeout(pending); (hlsRef as any).__pendingDestroy = null; }
    // Strict Mode (Next dev) effect'i 2 kez tetikler — aynı src ise tekrar HLS başlatma
    if (hlsActiveSrcRef.current === activeSrc && hlsRef.current) return;
    hlsActiveSrcRef.current = activeSrc;
    setStreamError(''); setLevels([]); setCurrentLevel(-1);
    const v = videoRef.current; if (!v) return;
    if (hlsRef.current) { try { hlsRef.current.destroy(); } catch { /* noop */ }; hlsRef.current = null; }
    if (!activeSrc || selected.status === 'maintenance' || selected.status === 'coming_soon') {
      v.removeAttribute('src'); v.load();
      if (selected.status === 'maintenance') setStreamError(TR.CHANNEL_MAINTENANCE);
      else if (selected.status === 'coming_soon') setStreamError(TR.CHANNEL_COMING_SOON);
      else setStreamError(TR.CHANNEL_NO_SOURCE);
      return;
    }
    let cancelled = false;
    (async () => {
      // Native HLS (Safari) → doğrudan src
      if (v.canPlayType('application/vnd.apple.mpegurl')) {
        v.src = activeSrc;
        try { await v.play(); } catch { /* noop */ }
        return;
      }
      try {
        const mod: any = await import('hls.js');
        const Hls = mod.default;
        if (cancelled) return;
        if (Hls.isSupported()) {
          const h = new Hls({
            // En yüksek kalite & dayanıklılık (4K destekli)
            enableWorker: true,
            lowLatencyMode: true,
            backBufferLength: 30,
            maxBufferLength: 60,
            maxMaxBufferLength: 120,
            maxBufferSize: 240 * 1000 * 1000, // 240 MB buffer — 4K segment'ler için
            manifestLoadingTimeOut: 15_000,
            manifestLoadingMaxRetry: 4,
            levelLoadingTimeOut: 15_000,
            fragLoadingTimeOut: 20_000,
            startLevel: -1,                  // Otomatik en iyi kalite
            capLevelToPlayerSize: false,     // Player küçük diye kaliteyi kısma — KULLANICI istemiyor
            abrEwmaDefaultEstimate: 1_000_000,
            abrBandWidthFactor: 0.95,
            abrBandWidthUpFactor: 0.7,
            testBandwidth: true,
            progressive: true,
            xhrSetup: (xhr: XMLHttpRequest) => {
              xhr.setRequestHeader('Accept', '*/*');
            },
          });
          hlsRef.current = h;
          h.loadSource(activeSrc);
          h.attachMedia(v);
          h.on(Hls.Events.MANIFEST_PARSED, () => {
            const ls: Level[] = (h.levels || []).map((l: any, i: number) => ({
              index: i,
              height: l.height || 0,
              bitrate: l.bitrate || 0,
            })).sort((a: Level, b: Level) => b.height - a.height);
            setLevels(ls);
            // Subtitle tracks (altyazı) — HLS subtitle playlist'leri okur
            try {
              const subs: any[] = h.subtitleTracks || [];
              setSubtitleTracks(subs.map((s: any, i: number) => ({
                id: i,
                name: s.name || s.lang || `Altyazı ${i + 1}`,
                lang: s.lang || '',
              })));
              if (typeof h.subtitleTrack === 'number') setCurrentSubtitle(h.subtitleTrack);
              else setCurrentSubtitle(-1);
            } catch { setSubtitleTracks([]); setCurrentSubtitle(-1); }
            networkRetryRef.current = 0;
            v.play().catch(() => { /* noop */ });
          });
          h.on(Hls.Events.LEVEL_SWITCHED, (_: any, data: any) => {
            if (h.currentLevel === -1) setCurrentLevel(-1);
            else setCurrentLevel(data.level ?? -1);
          });
          // ===== HLS ERROR HANDLING (eski repo mantığı + server failover) =====
          h.on(Hls.Events.ERROR, (_: any, data: any) => {
            if (!data?.fatal) return;
            // CODEC uyumsuzluğu — proxy CODECS attribute'unu zaten kaldırıyor;
            // burada düşersek son çare: sonraki sunucuya geç
            if (data.details === 'manifestIncompatibleCodecsError') {
              if (serverIndex < sources.length - 1) {
                setServerIndex((i) => i + 1);
              } else {
                setFreezeOverlay(true);
              }
              return;
            }
            // NETWORK ERROR — segment yüklenemiyor, recover dene (3 deneme)
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              if (networkRetryRef.current < MAX_NETWORK_RETRIES) {
                networkRetryRef.current += 1;
                try { h.startLoad(); } catch { /* noop */ }
                return;
              }
              // 3 deneme başarısız → sonraki sunucuya geç
              if (serverIndex < sources.length - 1) {
                networkRetryRef.current = 0;
                setServerIndex((i) => i + 1);
                return;
              }
              // Tüm sunucular tükendi → freeze overlay
              setFreezeOverlay(true);
              return;
            }
            // MEDIA ERROR — codec/decoder sorunu, recoverMediaError dene
            if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              try { h.recoverMediaError(); } catch { /* noop */ }
              return;
            }
            // Diğer fatal hatalar → sonraki sunucuya
            if (serverIndex < sources.length - 1) {
              setServerIndex((i) => i + 1);
              return;
            }
            setFreezeOverlay(true);
          });
        } else {
          v.src = activeSrc;
        }
      } catch {
        v.src = activeSrc;
      }

      // ===== Crash detection — eski repodaki mantık (currentTime advance kontrolü) =====
      stallCountRef.current = 0;
      lastPlaybackTimeRef.current = v.currentTime;
      if (crashCheckRef.current) clearInterval(crashCheckRef.current);
      crashCheckRef.current = setInterval(() => {
        if (!v || v.paused) return;
        const ct = v.currentTime;
        if (Math.abs(ct - lastPlaybackTimeRef.current) < 0.1) {
          stallCountRef.current += 1;
          const n = stallCountRef.current;
          // 8sn donma → sessiz HLS recover
          if (n === 8 && hlsRef.current) {
            try { hlsRef.current.startLoad(); v.play().catch(() => { /* noop */ }); } catch { /* noop */ }
          }
          // 15sn donma → overlay
          if (n >= STALL_THRESHOLD && !freezeOverlay) {
            setFreezeOverlay(true);
          }
          // 45sn donma → tam yeniden başlat
          if (n >= CRASH_THRESHOLD) {
            stallCountRef.current = 0;
            retryStreamRef.current?.();
          }
        } else {
          if (stallCountRef.current > 0) setFreezeOverlay(false);
          stallCountRef.current = 0;
        }
        lastPlaybackTimeRef.current = ct;
      }, 1000);

      // ===== Video element event listener'ları =====
      const onWaiting = () => {
        if (hlsRef.current) { try { hlsRef.current.startLoad(); } catch { /* noop */ } }
      };
      const onStalled = () => {
        if (hlsRef.current) {
          try { hlsRef.current.startLoad(); } catch { /* noop */ }
          setTimeout(() => v.play().catch(() => { /* noop */ }), 1000);
        }
      };
      const onError = () => {
        const code = v.error?.code;
        if (code === 2 || code === 4) { // NETWORK or SRC_NOT_SUPPORTED
          retryStreamRef.current?.();
        }
      };
      v.addEventListener('waiting', onWaiting);
      v.addEventListener('stalled', onStalled);
      v.addEventListener('error', onError);
      const onPlay = () => setIsPlaying(true);
      const onPause = () => setIsPlaying(false);
      v.addEventListener('play', onPlay);
      v.addEventListener('pause', onPause);
      cleanupListenersRef.current = () => {
        v.removeEventListener('waiting', onWaiting);
        v.removeEventListener('stalled', onStalled);
        v.removeEventListener('error', onError);
        v.removeEventListener('play', onPlay);
        v.removeEventListener('pause', onPause);
      };
    })();
    return () => {
      cancelled = true;
      if (crashCheckRef.current) { clearInterval(crashCheckRef.current); crashCheckRef.current = null; }
      if (freezeAutoRetryRef.current) { clearTimeout(freezeAutoRetryRef.current); freezeAutoRetryRef.current = null; }
      cleanupListenersRef.current?.();
      // Strict Mode'da hızlı yeniden mount geliyorsa instance'ı koru.
      // microtask: gerçek unmount mı yoksa Strict Mode mı?
      const willRemount = setTimeout(() => {
        if (hlsRef.current) { try { hlsRef.current.destroy(); } catch { /* noop */ } hlsRef.current = null; }
        hlsActiveSrcRef.current = null;
      }, 0);
      // Eğer Strict Mode hemen yeni effect koşturur ve aynı src ise: yeni effect destroy'u iptal eder
      (hlsRef as any).__pendingDestroy = willRemount;
    };
  }, [selected.id, serverIndex, adActive, awaitingResume, hasStarted]);

  // ===== Controls =====
  const handlePlay = useCallback(() => {
    // Yayını ATOMIK olarak başlat — önce reklam state'i, sonra hasStarted
    // Pre-roll effect bu kanal için tekrar fire etmesin diye sessionStorage flag set ediyoruz
    try { sessionStorage.setItem('bb_pr_' + selected.id, '1'); } catch { /* noop */ }
    setAdIndex(nextAdIndex());
    setAdActive(true);
    setMuted(false);
    if (videoRef.current) videoRef.current.muted = false;
    setHasStarted(true);
  }, [selected.id]);

  // Reklam bittikten sonra kullanıcının yayını başlatmak için bastığı manuel Play tuşu
  const handleResume = useCallback(() => {
    setMuted(false);
    const v = videoRef.current;
    if (v) v.muted = false;
    // State'i değiştir → HLS effect tekrar tetiklenecek
    setAwaitingResume(false);
    // HLS'in attach olup data yüklemesi için 200ms'lik adımlarla 5sn boyunca play dene
    // Bu kullanıcı gesture context'i içinde play çağırmamızı garanti eder (autoplay policy)
    let tries = 0;
    const tryPlay = () => {
      const vv = videoRef.current;
      if (!vv) return;
      vv.muted = false;
      if (vv.readyState >= 2 && vv.paused) {
        vv.play().catch(() => { /* noop */ });
        return;
      }
      if (vv.readyState >= 2 && !vv.paused) {
        return; // zaten oynuyor
      }
      if (tries++ < 25) setTimeout(tryPlay, 200);
    };
    setTimeout(tryPlay, 300);
  }, []);

  // ===== Play/Pause — pause sonrası play'de CANLI YAYIN EDGE'ine atla =====
  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      // Canlı yayın için (HLS m3u8): seekable.end - 2sn'ye atla
      try {
        if (hlsRef.current && v.seekable && v.seekable.length > 0) {
          const liveEdge = v.seekable.end(v.seekable.length - 1);
          if (liveEdge - v.currentTime > 5) {
            v.currentTime = Math.max(0, liveEdge - 2);
          }
        }
      } catch { /* noop */ }
      v.play().catch(() => { /* noop */ });
    } else {
      v.pause();
    }
  }, []);

  // Reklam doğal sonuna geldi → store'a yönlendir + kullanıcıyı manuel-play ekranına al
  const handleAdEnded = useCallback(() => {
    const ad = AD_LIBRARY[adIndex];
    setAdActive(false);
    setAwaitingResume(true);
    // Doğal bitiş = store yönlendirme (eski repo davranışı)
    if (ad?.store) redirectToStore(ad.store);
  }, [adIndex]);

  // ===== Stream Retry — bir sonraki sunucuya geçer, son sunucuda ise yenileme döngüsü =====
  const retryStream = useCallback(() => {
    setFreezeOverlay(false);
    stallCountRef.current = 0;
    networkRetryRef.current = 0;
    if (freezeAutoRetryRef.current) { clearTimeout(freezeAutoRetryRef.current); freezeAutoRetryRef.current = null; }
    setServerIndex((idx) => {
      // Mevcut sunucu son ise döngünün başına dön (eski repo davranışı)
      const next = idx < sources.length - 1 ? idx + 1 : 0;
      return next;
    });
  }, [sources.length]);

  // retryStream'i ref'e koy — interval ve event listener'lar erişebilsin
  useEffect(() => { retryStreamRef.current = retryStream; }, [retryStream]);

  // ===== Freeze overlay 5sn auto-retry timer (eski repo davranışı) =====
  useEffect(() => {
    if (!freezeOverlay) {
      if (freezeAutoRetryRef.current) { clearTimeout(freezeAutoRetryRef.current); freezeAutoRetryRef.current = null; }
      return;
    }
    if (freezeAutoRetryRef.current) clearTimeout(freezeAutoRetryRef.current);
    freezeAutoRetryRef.current = setTimeout(() => {
      freezeAutoRetryRef.current = null;
      retryStream();
    }, 5000);
    return () => {
      if (freezeAutoRetryRef.current) { clearTimeout(freezeAutoRetryRef.current); freezeAutoRetryRef.current = null; }
    };
  }, [freezeOverlay, retryStream]);

  const setQuality = useCallback((idx: number) => {
    if (hlsRef.current) hlsRef.current.currentLevel = idx;
    setCurrentLevel(idx);
    setQualityOpen(false);
  }, []);

  // Altyazı seç (id = -1 → kapalı)
  const setSubtitle = useCallback((id: number) => {
    if (hlsRef.current) hlsRef.current.subtitleTrack = id;
    setCurrentSubtitle(id);
    setSubtitleOpen(false);
  }, []);

  // Cast / AirPlay — Remote Playback API + iOS WebKit fallback
  const toggleCast = useCallback(async () => {
    const v = videoRef.current;
    if (!v) return;
    try {
      // @ts-ignore
      if ((v as any).webkitShowPlaybackTargetPicker) {
        // @ts-ignore — iOS AirPlay
        (v as any).webkitShowPlaybackTargetPicker();
        return;
      }
      // @ts-ignore
      const remote = (v as any).remote;
      if (remote && typeof remote.prompt === 'function') {
        await remote.prompt();
      }
    } catch { /* noop — user iptal etti veya destek yok */ }
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      if (videoRef.current) videoRef.current.muted = next;
      return next;
    });
  }, []);

  const togglePip = useCallback(async () => {
    const v = videoRef.current; if (!v) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if ((v as any).requestPictureInPicture) {
        await (v as any).requestPictureInPicture();
      }
    } catch { /* noop */ }
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const w = wrapperRef.current; if (!w) return;
    try {
      if (!document.fullscreenElement) {
        await w.requestFullscreen?.();
      } else {
        await document.exitFullscreen?.();
      }
    } catch { /* noop */ }
  }, []);

  // Close quality menu on outside click
  useEffect(() => {
    if (!qualityOpen && !subtitleOpen) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (qualityOpen && !t?.closest('[data-testid="quality-selector"]')) setQualityOpen(false);
      if (subtitleOpen && !t?.closest('[data-testid="subtitle-selector"]')) setSubtitleOpen(false);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [qualityOpen, subtitleOpen]);

  const currentLabel = currentLevel === -1
    ? TR.AUTO
    : (qualityLabel(levels.find((l) => l.index === currentLevel)?.height || 0));

  return (
    <main className="main-content">
      <div className="player-layout">
        <div
          ref={wrapperRef}
          className={`video-wrapper ${isFullscreen ? 'fullscreen-active' : ''}`}
          data-testid="video-wrapper"
        >
          <video
            ref={videoRef}
            className="video-player"
            playsInline
            muted={muted}
            /* TARAYICI NATIVE KONTROLLERİNİ KAPAT — cast/play/PiP/fullscreen */
            controls={false}
            // @ts-ignore
            disableRemotePlayback
            disablePictureInPicture
            controlsList="nodownload nofullscreen noremoteplayback"
            onClick={() => { if (hasStarted && !adActive && !awaitingResume && !streamError) togglePlay(); }}
            style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000', cursor: hasStarted && !adActive && !awaitingResume ? 'pointer' : 'default' }}
            data-testid="video-player"
          />

          {/* 📺 CUSTOM CAST BUTTON — sol üst, sadece yayın aktifken */}
          {hasStarted && !adActive && !awaitingResume && !streamError && (
            <button
              onClick={toggleCast}
              data-testid="cast-btn"
              aria-label="Yayını cihaza aktar"
              title={castSupported ? 'Chromecast / AirPlay' : 'Bu cihaz desteklemiyor'}
              disabled={!castSupported}
              style={{
                position: 'absolute', top: 12, left: 12, zIndex: 25,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 38, height: 32, padding: 0,
                borderRadius: 6,
                background: 'linear-gradient(135deg, rgba(8,4,14,0.78), rgba(20,8,30,0.78))',
                border: `1px solid ${castSupported ? 'rgba(0,240,255,0.45)' : 'rgba(255,255,255,0.18)'}`,
                color: castSupported ? 'var(--cyan, #00f0ff)' : 'rgba(255,255,255,0.35)',
                cursor: castSupported ? 'pointer' : 'not-allowed',
                boxShadow: castSupported ? '0 4px 14px rgba(0,0,0,0.45), 0 0 14px rgba(0,240,255,0.25)' : 'none',
                backdropFilter: 'blur(6px)',
                transition: 'transform 0.15s, box-shadow 0.15s',
              }}
              onMouseEnter={(e) => { if (castSupported) e.currentTarget.style.transform = 'scale(1.06)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M21 3H3c-1.1 0-2 .9-2 2v3h2V5h18v14h-7v2h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM1 18v3h3c0-1.66-1.34-3-3-3zm0-4v2c2.76 0 5 2.24 5 5h2c0-3.87-3.13-7-7-7zm0-4v2c4.97 0 9 4.03 9 9h2c0-6.08-4.93-11-11-11z" />
              </svg>
            </button>
          )}

          {/* ⚡ FPS INDICATOR — sağ üst (UNMUTE butonu varken solunda dur) */}
          {hasStarted && !adActive && !awaitingResume && !streamError && isPlaying && fps > 0 && (
            <div
              data-testid="fps-indicator"
              style={{
                position: 'absolute', top: 12,
                right: muted ? 110 : 12, // UNMUTE pill açıksa sola kay
                zIndex: 25,
                padding: '6px 10px', borderRadius: 6,
                background: 'linear-gradient(135deg, rgba(8,4,14,0.82), rgba(20,8,30,0.82))',
                border: '1px solid rgba(0,240,255,0.35)',
                color: 'var(--cyan, #00f0ff)',
                fontFamily: 'Orbitron, sans-serif', fontSize: 10, fontWeight: 700, letterSpacing: 1.5,
                boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                backdropFilter: 'blur(6px)',
                pointerEvents: 'none', userSelect: 'none',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <span style={{
                width: 6, height: 6, borderRadius: '50%',
                background: fps >= 50 ? 'var(--green, #00ff66)' : fps >= 24 ? 'var(--orange, #ffa600)' : '#ff3060',
                boxShadow: `0 0 6px ${fps >= 50 ? 'var(--green, #00ff66)' : fps >= 24 ? 'var(--orange, #ffa600)' : '#ff3060'}`,
              }} />
              {fps} FPS
            </div>
          )}

          {/* AD OVERLAY — SKIP YOK, kullanıcı sonuna kadar izlemek zorunda */}
          {adActive && (
            <div style={{ position: 'absolute', inset: 0, zIndex: 50 }} data-testid="ad-overlay">
              <video
                ref={adVideoRef}
                src={AD_LIBRARY[adIndex].src}
                autoPlay playsInline muted={muted}
                onEnded={handleAdEnded}
                onError={() => {
                  setAdActive(false);
                  setAwaitingResume(true);
                }}
                /* TARAYICI NATIVE KONTROLLERİNİ KAPAT — cast/play/PiP/fullscreen */
                controls={false}
                // @ts-ignore — non-standard but widely supported
                disableRemotePlayback
                disablePictureInPicture
                controlsList="nodownload nofullscreen noremoteplayback"
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
                data-testid="ad-video"
              />
              {/* SOL ÜST — Reklam markası */}
              <div style={{
                position: 'absolute', top: 12, left: 12, padding: '8px 14px',
                borderRadius: 6,
                background: `linear-gradient(135deg, ${AD_LIBRARY[adIndex].color}ee, rgba(170,0,255,0.92))`,
                color: '#fff',
                fontFamily: 'Orbitron, sans-serif', fontSize: 11, fontWeight: 800, letterSpacing: 3,
                border: '1px solid rgba(255,255,255,0.45)',
                boxShadow: `0 4px 18px rgba(0,0,0,0.5), 0 0 24px ${AD_LIBRARY[adIndex].color}80`,
                userSelect: 'none', pointerEvents: 'none',
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <span style={{ width: 7, height: 7, background: '#fff', borderRadius: '50%', boxShadow: '0 0 8px #fff' }} />
                REKLAM · {AD_LIBRARY[adIndex].name.toUpperCase()}
              </div>
              {/* SAĞ ÜST — Geri sayım */}
              <div style={{
                position: 'absolute', top: 12, right: 12, padding: '8px 14px',
                borderRadius: 6,
                background: 'linear-gradient(90deg, rgba(8,4,14,0.88), rgba(20,8,30,0.88))',
                border: '1px solid rgba(0,240,255,0.35)',
                fontFamily: 'Orbitron, sans-serif', fontSize: 10, letterSpacing: 2,
                color: '#b8e8ff',
                display: 'flex', flexDirection: 'column', lineHeight: 1.2,
                backdropFilter: 'blur(6px)',
              }} data-testid="ad-countdown">
                <span style={{ color: 'var(--cyan)', fontSize: 9, opacity: 0.75 }}>YAYIN HAZIRLANIYOR</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#fff', letterSpacing: 1.5 }}>
                  Reklam {adRemainingSec} sn
                </span>
              </div>
              {/* ALT — boş — eski "atlanamaz" yazısı kaldırıldı */}
            </div>
          )}

          {/* MANUEL PLAY — Reklam bitti, kullanıcı yayını başlatmak için butona basmalı */}
          {!adActive && awaitingResume && hasStarted && (
            <div className="overlay" data-testid="resume-overlay" style={{
              background: 'rgba(7,7,11,0.92)', zIndex: 30,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 0,
            }}>
              <button
                onClick={handleResume}
                className="shelby-play-btn"
                data-testid="resume-play-btn"
                aria-label="Yayını başlat"
                style={{ marginBottom: 28 }}
              >
                <svg width="44" height="44" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: 4 }}>
                  <path d="M8 5v14l11-7z" />
                </svg>
              </button>
              <div style={{
                color: 'var(--cyan)', fontFamily: 'Orbitron, sans-serif',
                fontSize: 13, letterSpacing: 3, textShadow: '0 0 10px var(--cyan)',
                textAlign: 'center', padding: '0 20px',
              }}>
                YAYINI BAŞLATMAK İÇİN TIKLA
              </div>
              <div style={{
                marginTop: 10, color: 'var(--text-dim)', fontFamily: 'VT323, monospace',
                fontSize: 12, letterSpacing: 2, textAlign: 'center', padding: '0 20px',
              }}>
                Reklam tamamlandı · {selected.name}
              </div>
            </div>
          )}

          {/* FREEZE OVERLAY — yayın dondu / crash → tıklanırsa anında, otomatik 5sn sonra retry */}
          {freezeOverlay && !adActive && (
            <div
              className="overlay freeze-overlay"
              data-testid="freeze-overlay"
              onClick={retryStream}
              style={{ background: 'rgba(7,7,11,0.85)', zIndex: 40, cursor: 'pointer' }}
            >
              <svg width="56" height="56" viewBox="0 0 24 24" fill="var(--cyan)" style={{ filter: 'drop-shadow(0 0 10px var(--cyan))' }}>
                <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
              </svg>
              <div style={{
                marginTop: 14, color: '#fff', fontFamily: 'Orbitron, sans-serif',
                fontSize: 16, letterSpacing: 4, textShadow: '0 0 12px var(--cyan)',
              }}>
                YAYIN DONDU
              </div>
              <div style={{
                marginTop: 6, color: 'var(--text-dim)', fontFamily: 'VT323, monospace',
                fontSize: 13, letterSpacing: 2,
              }}>
                Tıkla veya bekle — otomatik yenileniyor...
              </div>
            </div>
          )}

          {/* SHELBY SPLASH */}
          {!hasStarted && (
            <div className="overlay start-overlay" data-testid="start-overlay">
              <div className="shelby-scene">
                <div className="shelby-bg" style={{
                  backgroundImage: "url('/peaky_splash.jpg')", backgroundSize: 'cover',
                  backgroundPosition: 'center 20%', filter: 'brightness(0.95) contrast(1.1) saturate(1.02)',
                }} />
                <div className="shelby-overlay" />
                <div className="shelby-grain" />
                <button className="shelby-play-btn" onClick={handlePlay} data-testid="shelby-play-btn" aria-label="Başlat">
                  <svg width="44" height="44" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: 4 }}>
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </button>
                <div className="shelby-cta">BAŞLATMAK İÇİN TIKLA · PRESS PLAY</div>
                <div className="shelby-quote">"VEFA BİLMEYENE VEDA YAKIŞIR"</div>
                <div className="shelby-credit">— T. SHELBY</div>
              </div>
            </div>
          )}

          {/* MAINTENANCE / ERROR */}
          {hasStarted && !adActive && streamError && (
            <div className="overlay maintenance-overlay" data-testid="stream-error">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor">
                <path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z" />
              </svg>
              <div className="maintenance-title">{selected.name}</div>
              <div className="maintenance-subtitle">{streamError}</div>
            </div>
          )}

          {/* UNMUTE FLOATING BUTTON (eski repodan) */}
          {hasStarted && !adActive && muted && (
            <button
              onClick={toggleMute}
              data-testid="unmute-btn"
              style={{
                position: 'absolute', top: 14, right: 14, zIndex: 40,
                padding: '8px 16px', borderRadius: 999,
                background: 'var(--pink, #ff00aa)', color: '#000',
                border: 'none', cursor: 'pointer',
                fontFamily: 'Orbitron, sans-serif', fontSize: 11, fontWeight: 700, letterSpacing: 2,
                boxShadow: '0 0 18px var(--pink, #ff00aa)',
              }}
            >
              🔊 {TR.UNMUTE}
            </button>
          )}

          {/* CUSTOM CONTROLS BAR (eski repo tarzı — hover-show; pause'da daima görünür; mobil-dostu) */}
          {hasStarted && !adActive && !streamError && (
            <div
              className="video-controls"
              style={{
                position: 'absolute', bottom: 0, left: 0, right: 0,
                background: 'linear-gradient(to top, rgba(0,0,0,0.85), transparent)',
                padding: '12px 14px', zIndex: 30,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
                opacity: !isPlaying ? 1 : 0, transition: 'opacity 0.25s',
                flexWrap: 'wrap',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = !isPlaying ? '1' : '0')}
              data-testid="video-controls"
            >
              <div className="controls-left" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <button
                  onClick={togglePlay}
                  data-testid="playpause-btn"
                  className="control-btn"
                  style={{ background: 'none', border: 'none', color: 'var(--cyan, #00f0ff)', cursor: 'pointer', padding: 4, fontSize: 22, lineHeight: 1 }}
                  aria-label={isPlaying ? 'Duraklat' : 'Oynat'}
                  title={isPlaying ? 'Duraklat' : 'Oynat (canlıya atla)'}
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                    {isPlaying
                      ? <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                      : <path d="M8 5v14l11-7z" />}
                  </svg>
                </button>
                <button
                  onClick={toggleMute}
                  data-testid="mute-btn"
                  className="control-btn"
                  style={{ background: 'none', border: 'none', color: 'var(--cyan, #00f0ff)', cursor: 'pointer', padding: 4 }}
                  aria-label={muted ? TR.UNMUTE : TR.MUTE}
                  title={muted ? TR.UNMUTE : TR.MUTE}
                >
                  {muted
                    ? <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" /></svg>
                    : <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" /></svg>
                  }
                </button>

                {/* 🎬 SUBTITLE SELECTOR — sol alt */}
                <div className="subtitle-selector" data-testid="subtitle-selector" style={{ position: 'relative' }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); setSubtitleOpen((o) => !o); }}
                    data-testid="subtitle-btn"
                    className="control-btn"
                    aria-label="Altyazı"
                    title="Altyazı"
                    style={{
                      background: subtitleTracks.length > 0 && currentSubtitle !== -1
                        ? 'rgba(0,240,255,0.18)'
                        : 'none',
                      border: 'none',
                      color: subtitleTracks.length === 0 ? 'rgba(255,255,255,0.35)' : 'var(--cyan, #00f0ff)',
                      cursor: subtitleTracks.length === 0 ? 'not-allowed' : 'pointer',
                      padding: 4,
                      borderRadius: 4,
                    }}
                    disabled={subtitleTracks.length === 0}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                      <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zM4 12h4v2H4v-2zm10 6H4v-2h10v2zm6 0h-4v-2h4v2zm0-4H10v-2h10v2z" />
                    </svg>
                  </button>
                  {subtitleOpen && (
                    <div
                      data-testid="subtitle-dropdown"
                      style={{
                        position: 'absolute', bottom: '120%', left: 0,
                        background: 'rgba(10,5,16,0.95)',
                        border: '1px solid var(--cyan, #00f0ff)',
                        minWidth: 130, padding: '4px 0',
                        boxShadow: '0 6px 16px rgba(0,0,0,0.5)',
                      }}
                    >
                      <div
                        onClick={() => setSubtitle(-1)}
                        data-testid="subtitle-off"
                        style={{
                          padding: '8px 14px', fontSize: 11, cursor: 'pointer',
                          fontFamily: 'VT323, monospace',
                          color: currentSubtitle === -1 ? 'var(--cyan, #00f0ff)' : 'var(--text-dim)',
                          background: currentSubtitle === -1 ? 'rgba(0,240,255,0.1)' : 'transparent',
                        }}
                      >
                        KAPALI{currentSubtitle === -1 ? ' ✓' : ''}
                      </div>
                      {subtitleTracks.length === 0 && (
                        <div style={{
                          padding: '8px 14px', fontSize: 10,
                          fontFamily: 'VT323, monospace', color: 'var(--text-dim)',
                          fontStyle: 'italic',
                        }}>
                          Bu yayında altyazı yok
                        </div>
                      )}
                      {subtitleTracks.map((s) => (
                        <div
                          key={s.id}
                          onClick={() => setSubtitle(s.id)}
                          data-testid={`subtitle-${s.id}`}
                          style={{
                            padding: '8px 14px', fontSize: 11, cursor: 'pointer',
                            fontFamily: 'VT323, monospace',
                            color: currentSubtitle === s.id ? 'var(--cyan, #00f0ff)' : 'var(--text-dim)',
                            background: currentSubtitle === s.id ? 'rgba(0,240,255,0.1)' : 'transparent',
                          }}
                        >
                          {s.name}{currentSubtitle === s.id ? ' ✓' : ''}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 🔴 LIVE ROZETİ — controls bar içinde, oynuyorken */}
                {isPlaying && (
                  <div
                    data-testid="live-badge"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '4px 10px', borderRadius: 4,
                      background: 'linear-gradient(135deg, rgba(255,0,80,0.92), rgba(220,0,60,0.92))',
                      border: '1px solid rgba(255,255,255,0.35)',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.4), 0 0 10px rgba(255,0,80,0.4)',
                      fontFamily: 'Orbitron, sans-serif', fontSize: 10, fontWeight: 800, letterSpacing: 2.5, color: '#fff',
                      pointerEvents: 'none', userSelect: 'none',
                    }}
                  >
                    <span style={{
                      width: 6, height: 6, borderRadius: '50%', background: '#fff',
                      boxShadow: '0 0 8px #fff, 0 0 14px rgba(255,255,255,0.7)',
                      animation: 'live-pulse 1.4s ease-in-out infinite',
                    }} />
                    CANLI
                  </div>
                )}
              </div>

              {/* 📶 CONNECTION INDICATOR — orta */}
              <div
                data-testid="connection-indicator"
                title={`Bağlantı: ${netType}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '4px 9px', borderRadius: 4,
                  background: 'rgba(8,4,14,0.6)',
                  border: '1px solid rgba(0,240,255,0.25)',
                  color: netType === 'OFFLINE' ? '#ff3060' : 'var(--cyan, #00f0ff)',
                  fontFamily: 'Orbitron, sans-serif', fontSize: 10, fontWeight: 700, letterSpacing: 1.5,
                  pointerEvents: 'none', userSelect: 'none',
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  {netType === 'WiFi' ? (
                    <path d="M1 9l2 2c4.97-4.97 13.03-4.97 18 0l2-2C16.93 2.93 7.08 2.93 1 9zm8 8l3 3 3-3c-1.65-1.66-4.34-1.66-6 0zm-4-4l2 2c2.76-2.76 7.24-2.76 10 0l2-2C15.14 9.14 8.87 9.14 5 13z" />
                  ) : (
                    <path d="M2 22h20V2L2 22z" />
                  )}
                </svg>
                {netType}
              </div>

              <div className="controls-right" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {/* QUALITY SELECTOR — daima görünür (pembe rozet) */}
                <div className="quality-selector" data-testid="quality-selector" style={{ position: 'relative' }}>
                  <button
                    className="quality-btn"
                    onClick={(e) => { e.stopPropagation(); if (levels.length > 0) setQualityOpen((o) => !o); }}
                    data-testid="quality-btn"
                    disabled={levels.length === 0}
                    title={levels.length === 0 ? 'Yayın yüklenmedi' : 'Kalite seçimi'}
                    style={{
                      background: 'linear-gradient(135deg, rgba(255,0,170,0.25), rgba(170,0,255,0.25))',
                      border: '1.5px solid var(--pink, #ff00aa)',
                      color: '#fff',
                      padding: '4px 12px', fontSize: 10, fontWeight: 800, letterSpacing: 1.5,
                      cursor: levels.length === 0 ? 'not-allowed' : 'pointer',
                      fontFamily: 'Orbitron, sans-serif',
                      borderRadius: 4,
                      boxShadow: '0 0 10px rgba(255,0,170,0.45)',
                      textShadow: '0 0 6px rgba(255,0,170,0.7)',
                      opacity: levels.length === 0 ? 0.55 : 1,
                    }}
                  >
                    {levels.length === 0 ? TR.AUTO : currentLabel}
                  </button>
                  {qualityOpen && levels.length > 0 && (
                      <div
                        className="quality-dropdown open"
                        data-testid="quality-dropdown"
                        style={{
                          position: 'absolute', bottom: '120%', right: 0,
                          background: 'rgba(10,5,16,0.95)', border: '1px solid var(--pink, #ff00aa)',
                          minWidth: 110, padding: '4px 0',
                        }}
                      >
                        <div
                          className={`quality-option ${currentLevel === -1 ? 'active' : ''}`}
                          onClick={() => setQuality(-1)}
                          data-testid="quality-auto"
                          style={{
                            padding: '8px 14px', fontSize: 11, cursor: 'pointer',
                            fontFamily: 'VT323, monospace',
                            color: currentLevel === -1 ? 'var(--cyan, #00f0ff)' : 'var(--text-dim)',
                            background: currentLevel === -1 ? 'rgba(0,240,255,0.1)' : 'transparent',
                          }}
                        >
                          {TR.AUTO}{currentLevel === -1 ? ' ✓' : ''}
                        </div>
                        {levels.map((l) => (
                          <div
                            key={l.index}
                            className={`quality-option ${currentLevel === l.index ? 'active' : ''}`}
                            onClick={() => setQuality(l.index)}
                            data-testid={`quality-${l.height}`}
                            style={{
                              padding: '8px 14px', fontSize: 11, cursor: 'pointer',
                              fontFamily: 'VT323, monospace',
                              color: currentLevel === l.index ? 'var(--cyan, #00f0ff)' : 'var(--text-dim)',
                              background: currentLevel === l.index ? 'rgba(0,240,255,0.1)' : 'transparent',
                            }}
                          >
                            {qualityLabel(l.height)}{currentLevel === l.index ? ' ✓' : ''}
                          </div>
                        ))}
                      </div>
                    )}
                </div>
                <button
                  onClick={togglePip}
                  data-testid="pip-btn"
                  title={TR.PIP}
                  className="control-btn"
                  style={{ background: 'none', border: 'none', color: 'var(--cyan, #00f0ff)', cursor: 'pointer', padding: 4 }}
                  aria-label={TR.PIP}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z" />
                  </svg>
                </button>
                <button
                  onClick={toggleFullscreen}
                  data-testid="fullscreen-btn"
                  title={TR.FULLSCREEN}
                  className="control-btn"
                  style={{ background: 'none', border: 'none', color: 'var(--cyan, #00f0ff)', cursor: 'pointer', padding: 4 }}
                  aria-label={TR.FULLSCREEN}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
                  </svg>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* CHANNEL SIDEBAR — desktopta SAĞ YANDA, mobilde video ALTINDA yatay kaydırmalı */}
        <div
          className="channel-sidebar"
          data-testid="channel-sidebar"
        >
          {CHANNELS.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                // Reklam veya manuel-play bekleme sırasında kanal değişimi BLOKE
                if (adActive || awaitingResume) return;
                setSelected(c);
              }}
              disabled={adActive || awaitingResume}
              data-testid={`channel-${c.id}`}
              className={`sidebar-ch-btn ${selected.id === c.id ? 'active' : ''}`}
              style={(adActive || awaitingResume) ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
            >
              <span style={{
                display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
                marginRight: 6, verticalAlign: 'middle',
                background:
                  c.status === 'online' ? 'var(--green)' :
                  c.status === 'maintenance' ? 'var(--orange, #ffa600)' :
                  c.status === 'checking' ? 'var(--orange, #ffa600)' : 'var(--text-dim)',
                boxShadow:
                  c.status === 'online' ? '0 0 6px var(--green)' :
                  c.status === 'maintenance' ? '0 0 6px var(--orange, #ffa600)' : 'none',
              }} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
              {c.badge && <span className="new-badge">{c.badge}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* HOVER-SHOW: aslında .video-wrapper:hover .video-controls CSS'i ile yapılmalı,
          inline style ile mouseEnter/Leave kullandık çünkü Next CSS modules eklemek gereksiz */}
      <style jsx>{`
        .video-wrapper:hover :global([data-testid="video-controls"]) { opacity: 1 !important; }
        @keyframes live-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.85); }
        }
      `}</style>
    </main>
  );
}
