import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// dev 海图编辑器（?editor）：独立 sibling 根·与游戏 App/SeaChartView 解耦·lazy 加载（不进游戏主包）。
const isEditor = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('editor');
const MapEditor = lazy(() => import('./ui/MapEditor'));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isEditor ? (
      <Suspense fallback={null}>
        <MapEditor />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>
);
