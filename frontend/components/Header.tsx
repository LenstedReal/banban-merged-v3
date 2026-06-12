'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from './AuthProvider';

export default function Header() {
  const { user } = useAuth();
  const [notifOn, setNotifOn] = useState(false);

  useEffect(() => {
    if (typeof Notification !== 'undefined') setNotifOn(Notification.permission === 'granted');
  }, []);

  const toggleNotif = async () => {
    if (typeof Notification === 'undefined') return alert('Bu tarayıcı bildirim desteklemiyor');
    if (Notification.permission === 'granted') { setNotifOn(false); return; }
    if (Notification.permission === 'denied') return alert('Bildirim izni reddedilmiş. Ayarlardan açabilirsiniz.');
    const p = await Notification.requestPermission();
    setNotifOn(p === 'granted');
    if (p === 'granted') new Notification('banbansports', { body: 'Bildirimler açık', icon: '/icons/info.png' });
  };

  return (
    <header className="header" data-testid="header">
      <div className="header-content">
        <div className="logo-section">
          <div className="logo-wrapper">
            <Link href="/" style={{ textDecoration: 'none' }}>
              <div className="logo glitch" data-text="banbansports" data-testid="logo">banbansports</div>
              <div className="logo-sub">UNDERGROUND HD</div>
            </Link>
          </div>
          <div className="live-badge" data-testid="status-badge">
            <span className="live-dot"></span>
            <span>CANLI</span>
          </div>
        </div>
        <div className="header-right">
          {user?.role === 'admin' && (
            <Link
              href="/admin"
              data-testid="admin-link"
              style={{
                padding: '8px 14px', borderRadius: 6,
                border: '1px solid var(--orange, #ffa600)',
                color: 'var(--orange, #ffa600)',
                fontFamily: 'Orbitron, sans-serif', fontSize: 11, letterSpacing: 2,
                textDecoration: 'none', textShadow: '0 0 8px rgba(255,166,0,0.5)',
              }}
            >
              ADMIN
            </Link>
          )}
          <button
            type="button"
            className="notif-toggle"
            onClick={toggleNotif}
            data-testid="notif-toggle"
            title="Maç bildirimleri"
            data-active={notifOn ? 'on' : 'off'}
          >
            <svg viewBox="0 0 24 24"><path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/></svg>
            <span>BİLDİRİM</span>
            <span className="notif-status">{notifOn ? 'AÇIK' : 'KAPALI'}</span>
          </button>
        </div>
      </div>
    </header>
  );
}
