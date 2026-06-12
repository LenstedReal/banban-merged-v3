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
  if (h >= 1440) return `${h}p QHD`;
  if (h >= 1080) return '1080p HD';
  if (h >= 720) return '720p HD';
  return `${h}p`;
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

  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<any>(null);
  const playedTimeRef = useRef(0);
  const adVideoRef = useRef<HTMLVideoElement>(null);
  const adSafetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // ===== Pre-roll on channel change =====
  useEffect(() => {
    if (!hasStarted) return;
    // Yayın altyapısını durdur — reklam oynarken arka planda video çalışmamalı (eski repo davranışı)
    if (hlsRef.current) { try { hlsRef.current.destroy(); } catch { /* noop */ } hlsRef.current = null; }
    if (videoRef.current) { videoRef.current.pause(); videoRef.current.removeAttribute('src'); videoRef.current.load(); }
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

  // ===== Load HLS / fallback — REKLAM YOKKEN VE MANUEL PLAY BEKLEME YOKKEN =====
  useEffect(() => {
    if (adActive || awaitingResume || !hasStarted) return;
    setStreamError(''); setLevels([]); setCurrentLevel(-1);
    const v = videoRef.current; if (!v) return;
    if (hlsRef.current) { try { hlsRef.current.destroy(); } catch { /* noop */ }; hlsRef.current = null; }
    if (!selected.src || selected.status === 'maintenance' || selected.status === 'coming_soon') {
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
        v.src = selected.src!;
        try { await v.play(); } catch { /* noop */ }
        return;
      }
      try {
        const mod: any = await import('hls.js');
        const Hls = mod.default;
        if (cancelled) return;
        if (Hls.isSupported()) {
          const h = new Hls({
            // Eski repodan agresif config — düşük gecikme + dayanıklılık
            enableWorker: true,
            lowLatencyMode: true,
            backBufferLength: 15,
            maxBufferLength: 20,
            maxMaxBufferLength: 40,
            manifestLoadingTimeOut: 10_000,
            manifestLoadingMaxRetry: 2,
            levelLoadingTimeOut: 10_000,
            fragLoadingTimeOut: 15_000,
            startLevel: -1,
            abrEwmaDefaultEstimate: 500_000,
            testBandwidth: true,
            progressive: true,
            xhrSetup: (xhr: XMLHttpRequest) => {
              xhr.setRequestHeader('Accept', '*/*');
            },
          });
          hlsRef.current = h;
          h.loadSource(selected.src!);
          h.attachMedia(v);
          h.on(Hls.Events.MANIFEST_PARSED, () => {
            const ls: Level[] = (h.levels || []).map((l: any, i: number) => ({
              index: i,
              height: l.height || 0,
              bitrate: l.bitrate || 0,
            })).sort((a: Level, b: Level) => b.height - a.height);
            setLevels(ls);
            networkRetryRef.current = 0;
            v.play().catch(() => { /* noop */ });
          });
          h.on(Hls.Events.LEVEL_SWITCHED, (_: any, data: any) => {
            if (h.currentLevel === -1) setCurrentLevel(-1);
            else setCurrentLevel(data.level ?? -1);
          });
          // ===== HLS ERROR HANDLING (eski repo mantığı) =====
          h.on(Hls.Events.ERROR, (_: any, data: any) => {
            if (!data?.fatal) return;
            // NETWORK ERROR — segment yüklenemiyor, recover dene (3 deneme)
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              if (networkRetryRef.current < MAX_NETWORK_RETRIES) {
                networkRetryRef.current += 1;
                try { h.startLoad(); } catch { /* noop */ }
                return;
              }
              // 3 deneme sonrası başarısız → freeze overlay
              setFreezeOverlay(true);
              return;
            }
            // MEDIA ERROR — codec/decoder sorunu, recoverMediaError dene
            if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              try { h.recoverMediaError(); } catch { /* noop */ }
              return;
            }
            // Diğer fatal hatalar (parse vs.) → freeze overlay → auto-retry
            setFreezeOverlay(true);
          });
        } else {
          v.src = selected.src!;
        }
      } catch {
        v.src = selected.src!;
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
      cleanupListenersRef.current = () => {
        v.removeEventListener('waiting', onWaiting);
        v.removeEventListener('stalled', onStalled);
        v.removeEventListener('error', onError);
      };
    })();
    return () => {
      cancelled = true;
      if (crashCheckRef.current) { clearInterval(crashCheckRef.current); crashCheckRef.current = null; }
      if (freezeAutoRetryRef.current) { clearTimeout(freezeAutoRetryRef.current); freezeAutoRetryRef.current = null; }
      cleanupListenersRef.current?.();
      if (hlsRef.current) { try { hlsRef.current.destroy(); } catch { /* noop */ } hlsRef.current = null; }
    };
  }, [selected.id, adActive, awaitingResume, hasStarted]);

  // ===== Controls =====
  const handlePlay = useCallback(() => {
    setHasStarted(true); setMuted(false);
    if (videoRef.current) videoRef.current.muted = false;
  }, []);

  // Reklam bittikten sonra kullanıcının yayını başlatmak için bastığı manuel Play tuşu
  const handleResume = useCallback(() => {
    setAwaitingResume(false);
    setMuted(false);
    if (videoRef.current) videoRef.current.muted = false;
  }, []);

  // Reklam doğal sonuna geldi → store'a yönlendir + kullanıcıyı manuel-play ekranına al
  const handleAdEnded = useCallback(() => {
    const ad = AD_LIBRARY[adIndex];
    setAdActive(false);
    setAwaitingResume(true);
    // Doğal bitiş = store yönlendirme (eski repo davranışı)
    if (ad?.store) redirectToStore(ad.store);
  }, [adIndex]);

  // ===== Stream Retry (eski repo: retryStream) =====
  // Aynı kanalın HLS bağlantısını sıfırdan kurar — reklam YENİDEN OYNAMAZ
  const retryStream = useCallback(() => {
    setFreezeOverlay(false);
    stallCountRef.current = 0;
    networkRetryRef.current = 0;
    if (freezeAutoRetryRef.current) { clearTimeout(freezeAutoRetryRef.current); freezeAutoRetryRef.current = null; }
    // HLS'i temizle, video'yu sıfırla
    if (hlsRef.current) { try { hlsRef.current.destroy(); } catch { /* noop */ } hlsRef.current = null; }
    const v = videoRef.current;
    if (v) {
      try { v.pause(); } catch { /* noop */ }
      v.removeAttribute('src');
      v.load();
    }
    // Aynı kanalı tekrar seç — useEffect tetiklenir, ama reklam state'i değişmez
    // Trigger re-load by toggling a key state
    setSelected((s) => ({ ...s })); // shallow clone — id aynı → useEffect dep değişmez
    // Bunun yerine HLS'i manuel olarak yeniden kur
    setTimeout(() => {
      if (!v || !selected.src) return;
      (async () => {
        try {
          if (selected.src!.includes('.m3u8') || selected.src!.includes('/api/')) {
            const HlsMod = (await import('hls.js')).default;
            if (HlsMod.isSupported()) {
              const h = new HlsMod({
                lowLatencyMode: true,
                manifestLoadingTimeOut: 10_000,
                manifestLoadingMaxRetry: 3,
                fragLoadingTimeOut: 15_000,
              });
              hlsRef.current = h;
              h.loadSource(selected.src!);
              h.attachMedia(v);
              h.on(HlsMod.Events.MANIFEST_PARSED, () => v.play().catch(() => { /* noop */ }));
            } else { v.src = selected.src!; v.play().catch(() => { /* noop */ }); }
          } else { v.src = selected.src!; v.play().catch(() => { /* noop */ }); }
        } catch { /* noop */ }
      })();
    }, 100);
  }, [selected]);

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
    if (!qualityOpen) return;
    const onClick = (e: MouseEvent) => {
      if (!(e.target as HTMLElement)?.closest('[data-testid="quality-selector"]')) {
        setQualityOpen(false);
      }
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [qualityOpen]);

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
            // controls={false} — KENDİ control bar'ımız var (eski repo tarzı)
            data-testid="video-player"
          />

          {/* AD OVERLAY — SKIP YOK, kullanıcı sonuna kadar izlemek zorunda */}
          {adActive && (
            <div style={{ position: 'absolute', inset: 0, zIndex: 50 }} data-testid="ad-overlay">
              <video
                ref={adVideoRef}
                src={AD_LIBRARY[adIndex].src}
                autoPlay playsInline muted={muted}
                onEnded={handleAdEnded}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', background: '#000' }}
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
              {/* ALT — Atlanamaz uyarısı */}
              <div style={{
                position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
                padding: '6px 14px', borderRadius: 4,
                background: 'rgba(0,0,0,0.6)', color: 'var(--text-dim)',
                fontFamily: 'VT323, monospace', fontSize: 12, letterSpacing: 2,
                border: '1px solid rgba(255,255,255,0.08)',
                pointerEvents: 'none',
              }}>
                Bu reklam atlanamaz — Bitmesini bekle
              </div>
            </div>
          )}

          {/* MANUEL PLAY — Reklam bitti, kullanıcı yayını başlatmak için butona basmalı */}
          {!adActive && awaitingResume && hasStarted && (
            <div className="overlay" data-testid="resume-overlay" style={{ background: 'rgba(7,7,11,0.92)', zIndex: 30 }}>
              <button
                onClick={handleResume}
                className="shelby-play-btn"
                data-testid="resume-play-btn"
                aria-label="Yayını başlat"
              >
                <svg width="44" height="44" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: 4 }}>
                  <path d="M8 5v14l11-7z" />
                </svg>
              </button>
              <div style={{
                marginTop: 18, color: 'var(--cyan)', fontFamily: 'Orbitron, sans-serif',
                fontSize: 13, letterSpacing: 3, textShadow: '0 0 10px var(--cyan)',
              }}>
                YAYINI BAŞLATMAK İÇİN TIKLA
              </div>
              <div style={{
                marginTop: 8, color: 'var(--text-dim)', fontFamily: 'VT323, monospace',
                fontSize: 12, letterSpacing: 2,
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

          {/* CUSTOM CONTROLS BAR (eski repo tarzı — hover-show) */}
          {hasStarted && !adActive && !streamError && (
            <div
              className="video-controls"
              style={{
                position: 'absolute', bottom: 0, left: 0, right: 0,
                background: 'linear-gradient(to top, rgba(0,0,0,0.85), transparent)',
                padding: '12px 14px', zIndex: 30,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
                opacity: 0, transition: 'opacity 0.25s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = '0')}
              data-testid="video-controls"
            >
              <div className="controls-left" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button
                  onClick={toggleMute}
                  data-testid="mute-btn"
                  className="control-btn"
                  style={{ background: 'none', border: 'none', color: 'var(--cyan, #00f0ff)', cursor: 'pointer', padding: 4 }}
                  aria-label={muted ? TR.UNMUTE : TR.MUTE}
                  title={muted ? TR.UNMUTE : TR.MUTE}
                >
                  {muted ? '🔇' : '🔊'}
                </button>
              </div>
              <div className="controls-right" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {/* QUALITY SELECTOR */}
                {levels.length > 1 && (
                  <div className="quality-selector" data-testid="quality-selector" style={{ position: 'relative' }}>
                    <button
                      className="quality-btn"
                      onClick={(e) => { e.stopPropagation(); setQualityOpen((o) => !o); }}
                      data-testid="quality-btn"
                      style={{
                        background: 'linear-gradient(135deg, rgba(0,240,255,0.2), rgba(255,0,170,0.2))',
                        border: '1px solid var(--pink, #ff00aa)', color: 'var(--pink, #ff00aa)',
                        padding: '4px 10px', fontSize: 10, fontWeight: 700, letterSpacing: 1,
                        cursor: 'pointer', fontFamily: 'Orbitron, sans-serif',
                      }}
                    >
                      {currentLabel}
                    </button>
                    {qualityOpen && (
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
                )}
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
              {c.premium && <span style={{ fontSize: 9, color: 'var(--orange, #ffa600)', marginLeft: 4, letterSpacing: 1 }}>PRO</span>}
            </button>
          ))}
        </div>
      </div>

      {/* HOVER-SHOW: aslında .video-wrapper:hover .video-controls CSS'i ile yapılmalı,
          inline style ile mouseEnter/Leave kullandık çünkü Next CSS modules eklemek gereksiz */}
      <style jsx>{`
        .video-wrapper:hover :global([data-testid="video-controls"]) { opacity: 1 !important; }
      `}</style>
    </main>
  );
}
