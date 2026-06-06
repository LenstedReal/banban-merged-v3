'use client';
import { useEffect, useState } from 'react';
import { getClient } from '@/lib/api';
import { TR, STAT_LABEL, STAT_ORDER, isPreMatchStatus } from '@/lib/i18n';
import { AuthProvider, useAuth } from '@/components/AuthProvider';

type Stats = any;

const EVENT_ICON: Record<string, string> = {
  goal: '/icons/goal.png',
  yellow: '/icons/yellowcard.png',
  red: '/icons/redcard.png',
  sub: '/icons/info.png',
};

const toNum = (v: any) => {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v).replace('%', ''));
  return isNaN(n) ? 0 : n;
};

export default function MatchDetailClient({ home, away, initial }: { home: string; away: string; initial: Stats | null }) {
  return (
    <AuthProvider>
      <MatchDetailInner home={home} away={away} initial={initial} />
    </AuthProvider>
  );
}

function MatchDetailInner({ home, away, initial }: { home: string; away: string; initial: Stats | null }) {
  const { user } = useAuth();
  const [data, setData] = useState<Stats | null>(initial);
  const [myPred, setMyPred] = useState<any | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const d = await getClient<Stats>(`/api/match/stats?home=${encodeURIComponent(home)}&away=${encodeURIComponent(away)}`);
      if (alive && d) setData(d);
    };
    tick();
    const live = data?.eps && ['1H', '2H', 'HT', 'ET', 'PEN'].includes(data.eps);
    const intervalMs = live ? 15_000 : 60_000;
    const id = setInterval(tick, intervalMs);
    return () => { alive = false; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [home, away]);

  useEffect(() => {
    if (!user) { setMyPred(null); return; }
    let alive = true;
    getClient<{ items: any[] }>('/api/predictions/me').then((r) => {
      if (!alive || !r?.items) return;
      const found = r.items.find((p) =>
        p.team1?.toLowerCase() === home.toLowerCase() &&
        p.team2?.toLowerCase() === away.toLowerCase());
      if (found) setMyPred(found);
    });
    return () => { alive = false; };
  }, [home, away, user]);

  const isPreMatch = data ? (!data.score || isPreMatchStatus(data.eps) || data.eps === 'NS') : false;

  return (
    <div data-testid="match-detail-client">
      {/* TAHMİN ROZETİ */}
      {myPred && (
        <div data-testid="match-page-pred-badge" style={{
          padding: '12px 20px', marginBottom: 16,
          background: myPred.settled
            ? (myPred.points >= 5 ? 'linear-gradient(90deg, rgba(0,255,127,0.18), rgba(0,240,255,0.12))'
              : myPred.points >= 3 ? 'linear-gradient(90deg, rgba(0,240,255,0.15), rgba(170,0,255,0.10))'
              : myPred.points >= 1 ? 'linear-gradient(90deg, rgba(255,170,0,0.15), rgba(255,0,170,0.08))'
              : 'linear-gradient(90deg, rgba(120,120,120,0.15), rgba(60,60,60,0.08))')
            : 'linear-gradient(90deg, rgba(255,0,170,0.12), rgba(0,240,255,0.08))',
          border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontFamily: 'Orbitron', fontSize: 10, letterSpacing: 3, color: 'var(--text-dim)' }}>Tahminin</span>
            <span style={{ fontFamily: 'Orbitron', fontSize: 22, color: 'var(--cyan)', letterSpacing: 2 }}>{myPred.score1}–{myPred.score2}</span>
            {myPred.settled && myPred.final_score && (
              <>
                <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>vs SONUÇ</span>
                <span style={{ fontFamily: 'Orbitron', fontSize: 18, color: '#fff' }}>{myPred.final_score[0]}–{myPred.final_score[1]}</span>
              </>
            )}
          </div>
          <div style={{ fontFamily: 'Orbitron', fontSize: 13, fontWeight: 700, letterSpacing: 2 }}>
            {myPred.settled
              ? (myPred.points >= 5 ? <span style={{ color: '#00ff7f', textShadow: '0 0 12px rgba(0,255,127,0.7)' }}>★ TAM SKOR · +5p</span>
                : myPred.points >= 3 ? <span style={{ color: 'var(--cyan)' }}>✓ GOL FARKI · +3p</span>
                : myPred.points >= 1 ? <span style={{ color: 'var(--orange, #ffa600)' }}>✓ SONUÇ · +1p</span>
                : <span style={{ color: 'var(--text-dim)' }}>✗ KAÇIRDIN · 0p</span>)
              : <span style={{ color: 'var(--text-dim)' }}>⏳ MAÇ BİTİNCE PUANLANACAK</span>
            }
          </div>
        </div>
      )}

      {/* PRE-MATCH PANEL */}
      {isPreMatch && (
        <div style={{ padding: 40, textAlign: 'center', background: 'rgba(0,0,0,0.25)', borderRadius: 10, border: '1px solid rgba(255,0,170,0.15)', marginBottom: 20 }} data-testid="match-page-pre-match">
          <div style={{ fontSize: 56, marginBottom: 14, filter: 'drop-shadow(0 0 14px var(--cyan, #00f0ff))' }}>⏱</div>
          <div style={{ fontFamily: 'Orbitron', fontSize: 18, letterSpacing: 3, color: 'var(--cyan)', textShadow: '0 0 12px var(--cyan)', marginBottom: 10 }}>{TR.STATS_PRE_MATCH_TITLE}</div>
          <div style={{ fontFamily: 'VT323', fontSize: 16, color: 'var(--text-dim)', letterSpacing: 1, maxWidth: 500, margin: '0 auto' }}>{TR.STATS_PRE_MATCH_SUB}</div>
        </div>
      )}

      {/* MAÇ OLAYLARI */}
      {!isPreMatch && data?.events && data.events.length > 0 && (
        <div style={{ background: 'rgba(15,8,24,0.5)', border: '1px solid rgba(255,0,170,0.2)', borderRadius: 8, padding: 14, marginBottom: 20 }}>
          <div style={{ fontFamily: 'Orbitron', fontSize: 13, letterSpacing: 3, color: 'var(--pink)', marginBottom: 10 }}>{TR.EVENTS_TITLE}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {data.events.map((e: any, i: number) => (
              <div key={i} data-testid={`match-page-event-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 10px', background: 'rgba(255,255,255,0.03)', borderRadius: 4 }}>
                <img src={EVENT_ICON[e.type]} alt="" style={{ width: 18, height: 18 }} />
                <span style={{ fontFamily: 'VT323', color: 'var(--pink)', minWidth: 35 }}>{e.minute}'</span>
                <span style={{ flex: 1, color: e.team === 'home' ? 'var(--cyan)' : 'var(--pink)', textAlign: e.team === 'home' ? 'left' : 'right' }}>
                  <strong>{e.player}</strong>
                  {e.assist && <span style={{ color: 'var(--text-dim)', marginLeft: 6, fontSize: 11 }}> · {e.assist}</span>}
                </span>
                <span style={{ fontSize: 9, color: 'var(--text-dim)', letterSpacing: 1, minWidth: 80, textAlign: 'right' }}>{e.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* İSTATİSTİK */}
      {!isPreMatch && data?.stats && Object.keys(data.stats).length > 0 && (
        <div style={{ background: 'rgba(15,8,24,0.5)', border: '1px solid rgba(0,240,255,0.2)', borderRadius: 8, padding: 14 }} data-testid="match-page-stats">
          {STAT_ORDER.map(({ key, always, icon }) => {
            const raw = data.stats[key];
            const has = raw && raw.home != null && raw.away != null;
            if (!has && !always) return null;
            const hv = has ? raw.home : 0;
            const av = has ? raw.away : 0;
            const total = toNum(hv) + toNum(av) || 1;
            const hp = Math.max(2, Math.min(98, (toNum(hv) / total) * 100));
            return (
              <div key={key} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }} data-testid={`match-page-stat-${key}`}>
                <div style={{ fontFamily: 'Orbitron', color: 'var(--cyan)', fontSize: 14, minWidth: 30, textAlign: 'right' }}>{has ? hv : 0}</div>
                <div style={{ textAlign: 'center', fontFamily: 'VT323', fontSize: 12, color: 'var(--text-dim)', letterSpacing: 2 }}>
                  {icon && <img src={icon} alt="" style={{ width: 12, height: 12, marginRight: 6, verticalAlign: 'middle' }} />}
                  {STAT_LABEL[key] || key.toUpperCase()}
                </div>
                <div style={{ fontFamily: 'Orbitron', color: 'var(--pink)', fontSize: 14, minWidth: 30 }}>{has ? av : 0}</div>
                <div style={{ gridColumn: '1/-1', display: 'flex', height: 3, borderRadius: 2, overflow: 'hidden', background: 'rgba(255,255,255,0.06)' }}>
                  <div style={{ background: 'var(--cyan)', width: `${hp}%` }} />
                  <div style={{ background: 'var(--pink)', width: `${100 - hp}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!data?.available && (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-dim)', fontFamily: 'VT323', fontSize: 15 }} data-testid="match-page-empty">
          <div style={{ fontFamily: 'Orbitron', fontSize: 14, letterSpacing: 3, color: 'var(--orange, #ffa600)', marginBottom: 10 }}>{TR.STATS_UNAVAILABLE_TITLE}</div>
          <div>{data?.message || TR.STATS_UNAVAILABLE_SUB}</div>
        </div>
      )}

      {data?.sources && data.sources.length > 0 && (
        <div style={{ textAlign: 'center', marginTop: 20, fontSize: 9, color: 'var(--text-dim)', letterSpacing: 2 }}>
          {TR.STATS_SOURCES} · {data.sources.map((s: string) => s.toUpperCase()).join(' + ')}
        </div>
      )}
    </div>
  );
}
