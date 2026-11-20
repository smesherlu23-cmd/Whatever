import { useCallback, useState } from 'react';
import { Board } from './canvas/Board';
import { type Tool, Toolbar } from './ui/Toolbar';
import styles from './App.module.css';

export function App() {
  const [tool, setTool] = useState<Tool>('select');
  const [zoom, setZoom] = useState(1);
  const onZoomChange = useCallback((z: number) => setZoom(z), []);

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <span className={styles.logo}>Whatever</span>
        <span className={styles.title}>Новая доска</span>
      </header>
      <main className={styles.main}>
        <Board onZoomChange={onZoomChange} />
        <div className={styles.toolbar}>
          <Toolbar tool={tool} onChange={setTool} />
        </div>
        <div className={styles.zoom} aria-live="polite">
          {Math.round(zoom * 100)}%
        </div>
      </main>
    </div>
  );
}
