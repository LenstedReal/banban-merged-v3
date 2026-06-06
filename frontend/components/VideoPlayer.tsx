'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { TR } from '@/lib/i18n';

type Channel = { id: string; name: string; status: 'online' | 'maintenance' | 'checking' | 'coming_soon'; premium?: boolean; src?: string; badge?: string };

const CHANNELS: Channel[] = [
  { id: 'fastx',     name: 'HIZLI VE ÖFKELİ 11', status: 'coming_soon', badge: 'YAKINDA' },
  { id: 'spiderman', name: 'SPIDER-MAN: BND',    status: 'online', src: '/spiderman_trailer.mp4', badge: 'NEW' },
  { id: 'trt1',      name: 'TRT 1',              status: 'online' },
  { id: 'trthaber',  name: 'TRT HABER',          status: 'online' },
  { id: 'tv8',       name: 'TV 8',               status: 'online' },
  { id: 'trtspor',   name: 'TRT SPOR',           status: 'checking' },
  { id: 'bein1',     name: 'beIN SPORTS 1',      status: 'maintenance', premium: true, src: '/api/bein1/stream.m3u8' },
  { id: 'bein2',     name: 'beIN SPORTS 2',      status: 'maintenance', premium: true },
  { id: 'ssport',    name: 'S SPORT',            status: 'maintenance', premium: true },
  { id: 'gstv',      name: 'GS TV',              status: 'maintenance' },
  { id: 'fbtv',      name: 'FB TV',              status: 'maintenance' },
  { id: 'atv',       name: 'ATV',                status: 'maintenance' },
  { id: 'aspor',     name: 'A SPOR',             status: 'maintenance' },
];

const AD_LIBRARY = [
  { name: 'eFootball',    src: '/ad_efootball.mp4' },
  { name: 'PUBG Mobile',  src: '/ad_pubg.mp4' },
  { name: 'Call of Duty', src: '/ad_cod.mp4' },
  { name: 'Lords Mobile', src: '/ad_lords.mp4' },
];

const MID_ROLL_INTERVAL_SEC = 17 * 60;
const SKIP_AFTER_SEC = 5;

type Level = { index: number; height: number; bitrate: number };

const qualityLabel = (h: number): string => {
  if (h >= 1440) return `${h}p QHD`;
  if (h >= 1080) return '1080p HD';
  if (h >= 720) return '720p HD';
  return `${h}p`;
};

export default function VideoPlayer() {
  const [selected, setSelected] = useState<Channel>(CHANNELS[2]); // TRT 1 default
  const [hasStarted, setHasStarted] = useState(false);
  const [adActive, setAdActive] = useState(false);
  const [adIndex, setAdIndex] = useState(0);
  const [skipReady, setSkipReady] = useState(false);
  const [adCountdown, setAdCountdown] = useState(SKIP_AFTER_SEC);
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

  // ===== Pre-roll on channel change =====
  useEffect(() => {
    if (!hasStarted) return;
    setAdIndex(Math.floor(Math.random() * AD_LIBRARY.length));
    setAdActive(true); setSkipReady(false); setAdCountdown(SKIP_AFTER_SEC);
  }, [selected.id, hasStarted]);

  // ===== Skip countdown =====
  useEffect(() => {
    if (!adActive) return;
    setSkipReady(false); setAdCountdown(SKIP_AFTER_SEC);
    const id = setInterval(() => {
      setAdCountdown((c) => { if (c <= 1) { setSkipReady(true); clearInterval(id); return 0; } return c - 1; });
    }, 1000);
    return () => clearInterval(id);
  }, [adActive, adIndex]);

  // ===== Mid-roll timer =====
  useEffect(() => {
    if (!hasStarted) return;
    const id = setInterval(() => {
      if (adActive) return;
      playedTimeRef.current += 0.5;
      if (playedTimeRef.current >= MID_ROLL_INTERVAL_SEC) {
        playedTimeRef.current = 0;
        setAdIndex(Math.floor(Math.random() * AD_LIBRARY.length));
        setAdActive(true);
      }
    }, 500);
    return () => clearInterval(id);
  }, [adActive, hasStarted]);

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

  // ===== Load HLS / fallback =====
  useEffect(() => {
    if (adActive || !hasStarted) return;
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
            v.play().catch(() => { /* noop */ });
          });
          h.on(Hls.Events.LEVEL_SWITCHED, (_: any, data: any) => {
            if (h.currentLevel === -1) setCurrentLevel(-1);
            else setCurrentLevel(data.level ?? -1);
          });
          h.on(Hls.Events.ERROR, (_: any, data: any) => {
            if (data?.fatal) {
              setStreamError(TR.STREAM_UNAVAILABLE);
              try { h.destroy(); } catch { /* noop */ }
            }
          });
        } else {
          v.src = selected.src!;
        }
      } catch {
        v.src = selected.src!;
      }
    })();
    return () => {
      cancelled = true;
      if (hlsRef.current) { try { hlsRef.current.destroy(); } catch { /* noop */ } hlsRef.current = null; }
    };
  }, [selected.id, adActive, hasStarted]);

  // ===== Controls =====
  const handlePlay = useCallback(() => {
    setHasStarted(true); setMuted(false);
    if (videoRef.current) videoRef.current.muted = false;
  }, []);

  const skipAd = useCallback(() => { if (skipReady) setAdActive(false); }, [skipReady]);

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

          {/* AD OVERLAY */}
          {adActive && (
            <div style={{ position: 'absolute', inset: 0, zIndex: 50 }} data-testid="ad-overlay">
              <video
                src={AD_LIBRARY[adIndex].src}
                autoPlay playsInline
                onEnded={() => setAdActive(false)}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                data-testid="ad-video"
              />
              <div style={{
                position: 'absolute', top: 12, left: 12, padding: '6px 12px',
                borderRadius: 6, background: 'rgba(0,0,0,0.7)', color: 'var(--orange, #ffa600)',
                fontFamily: 'Orbitron', fontSize: 11, letterSpacing: 2,
                border: '1px solid rgba(255,136,0,0.4)',
              }}>
                {TR.AD_RUNNING} · {AD_LIBRARY[adIndex].name}
              </div>
              <button
                onClick={skipAd}
                disabled={!skipReady}
                style={{
                  position: 'absolute', bottom: 16, right: 16,
                  padding: '8px 16px', borderRadius: 6,
                  fontFamily: 'Orbitron', letterSpacing: 2, fontSize: 12, fontWeight: 700,
                  background: skipReady ? '#fff' : 'rgba(0,0,0,0.6)',
                  color: skipReady ? '#000' : 'var(--text-dim)',
                  border: `1px solid ${skipReady ? '#fff' : 'rgba(255,255,255,0.2)'}`,
                  cursor: skipReady ? 'pointer' : 'not-allowed',
                }}
                data-testid="skip-ad-btn"
              >
                {skipReady ? `${TR.AD_SKIP} ▶` : `${TR.AD_SKIP_IN} ${adCountdown}s`}
              </button>
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

        {/* CHANNEL SIDEBAR — video'nun SAĞ YANINDA (eski repo layout) */}
        <div
          className="channel-sidebar"
          data-testid="channel-sidebar"
          style={{
            width: 180,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            overflowY: 'auto',
            // Video aspect-ratio 16:9 → sidebar height eşleşsin
            maxHeight: 'calc((100vw - 220px) * 9 / 16)',
            padding: '4px 0',
          }}
        >
          {CHANNELS.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelected(c)}
              data-testid={`channel-${c.id}`}
              className={`sidebar-ch-btn ${selected.id === c.id ? 'active' : ''}`}
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
