import { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useNet } from './net';
import { Home } from './Home';
import { Lobby } from './Lobby';
import { Table } from './Table';
import { CardDefs } from './Card';

export function App() {
  const { room, connected, toast } = useNet();

  useEffect(() => {
    // keep the viewport height honest on mobile browsers
    const fix = () => document.documentElement.style.setProperty('--vh', `${window.innerHeight / 100}px`);
    fix();
    window.addEventListener('resize', fix);
    return () => window.removeEventListener('resize', fix);
  }, []);

  return (
    <div className="felt">
      <CardDefs />
      {!room ? <Home /> : !room.game ? <Lobby room={room} /> : <Table room={room} />}

      {!connected && <div className="offline">正在连接服务器…</div>}

      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            className="toast"
            role="status"
            initial={{ opacity: 0, y: -12, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, x: '-50%' }}
          >
            {toast.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
