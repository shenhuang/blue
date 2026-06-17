import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// dev 工具页（独立 sibling 根·与游戏 App 解耦·lazy 加载·不进游戏主包）：
//   ?editor       海图编辑器（src/ui/MapEditor）
//   ?storyeditor  剧情编辑器（src/ui/StoryEditor·测剧情库本身·不碰存档）
const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
const isEditor = params.has('editor');
const isStoryEditor = params.has('storyeditor');
const MapEditor = lazy(() => import('./ui/MapEditor'));
const StoryEditor = lazy(() => import('./ui/StoryEditor'));

function Root() {
  if (isStoryEditor) {
    return (
      <Suspense fallback={null}>
        <StoryEditor />
      </Suspense>
    );
  }
  if (isEditor) {
    return (
      <Suspense fallback={null}>
        <MapEditor />
      </Suspense>
    );
  }
  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
