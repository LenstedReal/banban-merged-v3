'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { postClient } from '@/lib/api';
import { useAuth } from './AuthProvider';
import { TR } from '@/lib/i18n';

type Msg = { id: string; user_id: string; name: string; role?: string; text: string; ts: string };

export default function ChatBox() {
  const { user } = useAuth();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [connected, setConnected] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ===== WebSocket bağlantısı =====
  const connect = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (wsRef.current && wsRef.current.readyState <= 1) return; // zaten bağlı

    // Backend URL'inden ws:// veya wss:// türet
    const backend = process.env.NEXT_PUBLIC_BACKEND_URL || '';
    let wsUrl = '';
    if (backend) {
      wsUrl = backend.replace(/^http/, 'ws') + '/api/chat/ws';
    } else {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      wsUrl = `${proto}//${window.location.host}/api/chat/ws`;
    }

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        // Otomatik yeniden bağlan (3 saniye sonra)
        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = setTimeout(connect, 3000);
      };
      ws.onerror = () => { /* onclose handle eder */ };
      ws.onmessage = (e) => {
        try {
          const payload = JSON.parse(e.data);
          if (payload.type === 'chat_history' && Array.isArray(payload.messages)) {
            setMsgs(payload.messages);
          } else if (payload.type === 'chat_message') {
            setMsgs((prev) => [...prev, payload as Msg].slice(-200));
          } else if (payload.type === 'chat_delete') {
            setMsgs((prev) => prev.filter((m) => m.id !== payload.id));
          }
        } catch { /* noop */ }
      };
    } catch {
      // Connection failed → reconnect after 5s
      reconnectTimerRef.current = setTimeout(connect, 5000);
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) { try { wsRef.current.close(); } catch { /* noop */ } wsRef.current = null; }
    };
  }, [connect]);

  // Ping her 25 saniyede
  useEffect(() => {
    const id = setInterval(() => {
      const ws = wsRef.current;
      if (ws && ws.readyState === 1) {
        try { ws.send('ping'); } catch { /* noop */ }
      }
    }, 25_000);
    return () => clearInterval(id);
  }, []);

  // Otomatik scroll
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [msgs.length]);

  const send = async () => {
    if (!text.trim() || !user) return;
    const ws = wsRef.current;
    setSending(true);
    try {
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'send', text: text.trim() }));
        setText('');
      } else {
        // WS down → HTTP fallback
        const res = await postClient<{ ok: boolean; message?: Msg }>('/api/chat/send', { text: text.trim() });
        if (res?.ok) {
          setText('');
          if (res.message) setMsgs((p) => [...p, res.message as Msg]);
        }
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <section id="chat" style={{maxWidth:1400, margin:'40px auto 0', padding:'0 20px'}} data-testid="chat-box">
      <div style={{marginBottom:14, display:'flex', alignItems:'flex-end', justifyContent:'space-between', flexWrap:'wrap', gap:12}}>
        <div>
          <h2 className="section-title-pink">{TR.CHAT}</h2>
          <div style={{color:'var(--text-dim)', fontSize:12, letterSpacing:2, marginTop:4}}>{TR.CHAT_SUB}</div>
        </div>
        <div style={{
          fontFamily:'VT323, monospace', fontSize:11, letterSpacing:2,
          color: connected ? 'var(--green)' : 'var(--text-dim)',
          textShadow: connected ? '0 0 6px var(--green)' : 'none',
        }} data-testid="chat-ws-status">
          {connected ? '● CANLI' : '○ BAĞLANIYOR…'}
        </div>
      </div>
      <div style={{background:'rgba(15,8,24,0.5)', border:'1px solid rgba(255,0,170,0.2)', borderRadius:8, overflow:'hidden'}}>
        <div ref={listRef} style={{height:360, overflowY:'auto', padding:12, display:'flex', flexDirection:'column', gap:8}} data-testid="chat-list">
          {msgs.length === 0 ? (
            <div style={{textAlign:'center', color:'var(--text-dim)', padding:'48px 0', fontSize:13}} data-testid="chat-empty">{TR.CHAT_EMPTY}</div>
          ) : (
            msgs.map(m => (
              <div key={m.id} style={{display:'flex', gap:10, alignItems:'flex-start'}} data-testid={`chat-msg-${m.id}`}>
                <div style={{width:32, height:32, borderRadius:'50%', background: m.role === 'admin' ? 'linear-gradient(135deg, #ffa600, var(--pink))' : 'linear-gradient(135deg, var(--cyan), var(--pink))', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'Orbitron', fontSize:13, color:'#000', flexShrink:0, fontWeight:700}}>
                  {(m.name||'?').slice(0,1).toUpperCase()}
                </div>
                <div style={{minWidth:0, flex:1}}>
                  <div style={{fontSize:11, fontFamily:'VT323', letterSpacing:1}}>
                    <span style={{color:'var(--cyan)', textShadow:'0 0 6px var(--cyan)'}}>{m.name}</span>
                    {m.role === 'admin' && (
                      <span style={{color:'#ffa600', marginLeft:6, fontSize:9, padding:'1px 4px', border:'1px solid #ffa600', borderRadius:3}}>ADMIN</span>
                    )}
                    <span style={{color:'var(--text-dim)', marginLeft:6}}>· {new Date(m.ts).toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'})}</span>
                  </div>
                  <div style={{color:'#fff', wordBreak:'break-word', fontFamily:'VT323', fontSize:16}}>{m.text}</div>
                </div>
              </div>
            ))
          )}
        </div>
        <div style={{borderTop:'1px solid rgba(255,0,170,0.2)', padding:8, display:'flex', gap:8}}>
          <input type="text"
            value={text}
            disabled={!user || sending}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') send(); }}
            placeholder={user ? TR.CHAT_PLACEHOLDER_AUTH : TR.CHAT_PLACEHOLDER_GUEST}
            className="input-neon" style={{flex:1, fontSize:14}}
            data-testid="chat-input"
            maxLength={300}/>
          <button onClick={send} disabled={!user || sending || !text.trim()} className="btn-neon-pink" data-testid="chat-send">
            {sending ? '...' : TR.CHAT_SEND}
          </button>
        </div>
      </div>
    </section>
  );
}
