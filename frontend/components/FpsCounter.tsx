'use client';
import { useEffect, useRef, useState } from 'react';

/** FPS counter — uses original .fps-counter class with .good/.warn/.crit. */
export default function FpsCounter() {
  const [fps, setFps] = useState(60);
  const [hidden, setHidden] = useState(false);
  const frames = useRef(0);
  const last = useRef<number>(typeof performance !== 'undefined' ? performance.now() : 0);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    let mounted = true;
    const tick = (t: number) => {
      frames.current++;
      const elapsed = t - last.current;
      if (elapsed >= 1000) {
        if (mounted) setFps(Math.round((frames.current * 1000) / elapsed));
        frames.current = 0;
        last.current = t;
      }
      if (mounted) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { mounted = false; if (raf.current) cancelAnimationFrame(raf.current); };
  }, []);

  if (hidden) return null;
  const cls = fps >= 55 ? 'good' : fps >= 35 ? 'warn' : 'crit';
  return (
    <div className={`fps-counter ${cls}`}
         onClick={() => setHidden(true)}
         data-testid="fps-counter"
         title="FPS — tıkla gizle">
      <span>{fps}</span><small>FPS</small>
    </div>
  );
}
