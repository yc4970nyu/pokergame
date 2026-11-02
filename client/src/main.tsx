import { createRoot } from 'react-dom/client';
import { App } from './App';
import { preloadCards } from './Card';
import './styles.css';

preloadCards();
createRoot(document.getElementById('root')!).render(<App />);
