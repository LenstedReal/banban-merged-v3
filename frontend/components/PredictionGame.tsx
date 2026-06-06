'use client';
import { useEffect, useState } from 'react';
import { getClient, postClient } from '@/lib/api';
import { useAuth } from './AuthProvider';
import { TR } from '@/lib/i18n';

type Pred = { id: string; team1: string; team2: string; league: string; kickoff: string; status_label?: string; status: 'open'|'closed'|'settled' };
type LB = { user_id: string; name: string; points: number; correct: number; exact: number };

export default function PredictionGame() {
  const { user } = useAuth();
  const [items, setItems] = useState<Pred[]>([]);
  const [picks, setPicks] = useState<Record<string,{s1:string;s2:string}>>({});
  const [lb, setLb] = useState<LB[]>([]);
  const [busy, setBusy] = useState<string|null>(null);
  const [msg, setMsg] = useState('');

  const load = async () => {
    const d = await getClient<{ items: Pred[] }>('/api/predictions/open');
    if (d?.items) setItems(d.items);
    const board = await getClient<{ leaderboard: LB[] }>('/api/predictions/leaderboard');
    if (board?.leaderboard) setLb(board.leaderboard);
  };
  useEffect(() => { load(); }, []);

  const submit = async (p: Pred) => {
    if (!user) { setMsg(TR.PREDICTIONS_LOGIN_REQUIRED); setTimeout(() => setMsg(''), 3000); return; }
    const pick = picks[p.id];
    if (!pick || pick.s1 === '' || pick.s2 === '') { setMsg(TR.PREDICTIONS_NEED_SCORE); setTimeout(() => setMsg(''), 3000); return; }
    setBusy(p.id);
    const res = await postClient('/api/predictions/submit', { match_id: p.id, score1: parseInt(pick.s1,10), score2: parseInt(pick.s2,10) });
    setBusy(null);
    if (res?.ok) { setMsg(TR.PREDICTIONS_SAVED); load(); }
    else setMsg(res?.error || TR.ERROR_GENERIC);
    setTimeout(() => setMsg(''), 3000);
  };

  return (
    <section id="predict" style={{maxWidth:1400, margin:'40px auto 0', padding:'0 20px'}} data-testid="prediction-game">
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-end', marginBottom:14, flexWrap:'wrap', gap:12}}>
        <div>
          <h2 className="section-title-cyan">{TR.PREDICTIONS}</h2>
          <div style={{color:'var(--text-dim)', fontSize:12, letterSpacing:2, marginTop:4}}>{TR.PREDICTIONS_SUB}</div>
        </div>
        {msg && <div style={{color:'var(--orange)', fontFamily:'VT323', fontSize:16}} data-testid="predict-msg">{msg}</div>}
      </div>

      <div style={{display:'grid', gridTemplateColumns:'1fr 320px', gap:16}} className="predict-grid">
        <div style={{background:'rgba(15,8,24,0.5)', border:'1px solid rgba(255,0,170,0.2)', borderRadius:8, padding:6}} data-testid="predict-list">
          {items.length === 0 ? (
            <div style={{textAlign:'center', color:'var(--text-dim)', padding:40}}>{TR.PREDICTIONS_NO_MATCHES}</div>
          ) : (
            <ul style={{listStyle:'none', margin:0, padding:0}}>
              {items.map(p => (
                <li key={p.id} className="match-card" style={{margin:6, cursor:'default'}} data-testid={`predict-row-${p.id}`}>
                  <div className="match-card-league">{p.league} · {p.status_label || new Date(p.kickoff).toLocaleString('tr-TR')}</div>
                  <div style={{display:'grid', gridTemplateColumns:'1fr auto 1fr auto', alignItems:'center', gap:12}}>
                    <div className="match-card-team" style={{textAlign:'right'}}>{p.team1}</div>
                    <div style={{display:'flex', alignItems:'center', gap:6}}>
                      <input type="number" min={0} max={20}
                        className="input-neon" style={{width:42, textAlign:'center', padding:'6px 4px'}}
                        value={picks[p.id]?.s1 ?? ''}
                        onChange={e => setPicks({ ...picks, [p.id]: { s1: e.target.value, s2: picks[p.id]?.s2 ?? '' } })}
                        data-testid={`predict-s1-${p.id}`}/>
                      <span style={{color:'var(--text-dim)'}}>–</span>
                      <input type="number" min={0} max={20}
                        className="input-neon" style={{width:42, textAlign:'center', padding:'6px 4px'}}
                        value={picks[p.id]?.s2 ?? ''}
                        onChange={e => setPicks({ ...picks, [p.id]: { s1: picks[p.id]?.s1 ?? '', s2: e.target.value } })}
                        data-testid={`predict-s2-${p.id}`}/>
                    </div>
                    <div className="match-card-team">{p.team2}</div>
                    <button onClick={() => submit(p)} disabled={busy === p.id} className="btn-neon-cyan" data-testid={`predict-submit-${p.id}`}>
                      {busy === p.id ? '...' : TR.PREDICTIONS_SAVE}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <aside style={{background:'rgba(15,8,24,0.5)', border:'1px solid rgba(0,240,255,0.2)', borderRadius:8, padding:12}} data-testid="leaderboard">
          <div style={{fontFamily:'Orbitron', fontSize:14, letterSpacing:3, color:'var(--cyan)', textShadow:'0 0 10px var(--cyan)', paddingBottom:10, borderBottom:'1px solid rgba(0,240,255,0.2)', marginBottom:10}}>{TR.LEADERBOARD}</div>
          {lb.length === 0 ? (
            <div style={{textAlign:'center', color:'var(--text-dim)', padding:'20px 0', fontSize:13}}>{TR.LEADERBOARD_EMPTY}</div>
          ) : (
            <ol style={{listStyle:'none', margin:0, padding:0}}>
              {lb.slice(0,10).map((u, i) => (
                <li key={u.user_id} style={{display:'flex', alignItems:'center', justifyContent:'space-between', padding:'6px 4px', borderRadius:4, fontFamily:'VT323', fontSize:16}}>
                  <span style={{color:'var(--text-dim)', width:24}}>{i+1}.</span>
                  <span style={{flex:1, color:'#fff', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{u.name}</span>
                  <span style={{color:'var(--green)', textShadow:'0 0 6px var(--green)'}}>{u.points}p</span>
                </li>
              ))}
            </ol>
          )}
        </aside>
      </div>
      <style>{`@media (max-width: 768px) { .predict-grid { grid-template-columns: 1fr !important; } }`}</style>
    </section>
  );
}
