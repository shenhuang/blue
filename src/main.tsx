import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// dev 工作台（独立 sibling 根·与游戏 App 解耦·lazy 加载·不进游戏主包）：
//   ?editor / ?editor=<tool>  dev 工作台（EditorApp·6 工具按域分组：事件/剧情·战斗·地图）
//   ?storyeditor              旧别名 → 工作台 story tab（回退兼容）
//   裸 ?editor                → 海图 tab（保住旧 ?editor＝海图书签）
// EditorApp 内部按 URL 选初始 tab 并 lazy() 各工具；详见 docs/spec/深海回响_dev工作台_SPEC.md
const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
const isWorkbench = params.has('editor') || params.has('storyeditor');
const EditorApp = lazy(() => import('./ui/EditorApp'));

function Root() {
  if (isWorkbench) {
    return (
      <Suspense fallback={null}>
        <EditorApp />
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
