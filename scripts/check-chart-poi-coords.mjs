#!/usr/bin/env node
// 海图坐标撞车门（触摸遮挡修复的配套机制·2026-07-03·quirk #215）。
//
// 背景：海图标记的可点区域现在是"容器拦截+世界坐标最近距离分发"（ChartViewport.tsx::endDrag，
// TAP_HIT_RADIUS_PX）——但两个点若 resolve 后的**绝对坐标完全相同**（典型错法：owner-anchored 偏移
// mapX/mapY 手滑填了跟另一条一样的数），"最近"就是平局，算法分不出该选谁，其中一个必然摸不到。
// 实测案例（本次已挪开·作为本门的活样本）：`roam.vent_dead_chimneys`「死烟囱」撞
// `poi.anchor.serpentine_deep_vent`「蛇行深处·热液侧口」、`roam.vent_cold_seep`「冷泉洼」撞
// `poi.anchor.flooded_gallery_vent`「漫水回廊·热液侧口」，均在 lighthouse.ch1_vent_outpost 偏移下——
// 两边解锁条件互不排斥（roaming 只要 tutorial_complete；锚点多一条 cave_exit_* flag，互不踢出对方选取池），
// 一旦同一天两者都在图上就完全叠住。
//
// 把这条约定焊成会红的检查：扫 chart_pois.json 的 anchors + roamingTemplates，按 owner-anchored 规则
// resolve 成绝对坐标（同 engine/chart.ts::resolveOwnerCoords 口径·纯 JS 独立实现，因为 check 脚本走
// node 不吃 ts），两两算距离，低于 EPSILON（视为"同一个数字"）就报红。
//
// 有意窄化：只抓"精确撞车"（拷贝粘贴打错数字），不抓"离得近但不同"的密集聚簇——后者是设计内容
// （vent/slope/midwater 前哨群普遍 0.01–0.06 间距），已被最近距离分发兜住，硬做模糊阈值门容易误伤。
//
// 跑法：node scripts/check-chart-poi-coords.mjs  或在 npm run regress 里作 check-chart-poi-coords 任务。
// 退出码：全过=0，任一撞车=1。纯 node·无依赖·进程隔离友好。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/** "视为同一坐标"的世界单位阈值——两点解析后距离小于它即报红（浮点误差量级，非模糊密集判定）。 */
const EPSILON = 1e-6;

/**
 * 从 lighthouse_upgrades.json 派生 owner id → 绝对坐标（同 engine/lighthouses.ts::ownerAnchorPos 口径：
 * home 常量 + 各前哨/废墟 result 的静态声明坐标）。
 * @param {any} lhFile
 * @returns {Map<string, {x:number, y:number}>}
 */
export function ownerPositions(lhFile) {
  const m = new Map();
  if (lhFile?.home?.id) m.set(lhFile.home.id, { x: lhFile.home.mapX, y: lhFile.home.mapY });
  for (const o of lhFile?.outposts ?? []) {
    if (o?.result?.id) m.set(o.result.id, { x: o.result.mapX, y: o.result.mapY });
  }
  for (const r of lhFile?.ruins ?? []) {
    if (r?.result?.id) m.set(r.result.id, { x: r.result.mapX, y: r.result.mapY });
  }
  return m;
}

/**
 * 纯逻辑：扫 chart_pois.json（anchors + roamingTemplates），resolve 成绝对坐标，
 * 找出所有两两距离 < EPSILON 的点对。data in / violations out，无 IO，便于单测。
 * @param {any} chartPoisJson chart_pois.json 内容（顶层各段含 anchors/roamingTemplates）
 * @param {Map<string, {x:number, y:number}>} ownerPos ownerPositions() 的产出
 * @returns {Array<{a:{kind:string,id:string,name?:string,x:number,y:number}, b:{kind:string,id:string,name?:string,x:number,y:number}, dist:number}>}
 */
export function findCoordCollisions(chartPoisJson, ownerPos) {
  const pts = [];
  for (const [key, seg] of Object.entries(chartPoisJson ?? {})) {
    if (typeof seg !== 'object' || seg === null || key.startsWith('_')) continue;
    for (const kind of ['anchors', 'roamingTemplates']) {
      for (const node of seg[kind] ?? []) {
        if (typeof node?.mapX !== 'number' || typeof node?.mapY !== 'number') continue;
        const base = node.owner ? ownerPos.get(node.owner) : undefined;
        const x = (base?.x ?? 0) + node.mapX;
        const y = (base?.y ?? 0) + node.mapY;
        pts.push({ kind, id: node.id ?? node.templateId, name: node.name, x, y });
      }
    }
  }
  const collisions = [];
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const dist = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
      if (dist < EPSILON) collisions.push({ a: pts[i], b: pts[j], dist });
    }
  }
  return collisions;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const readJson = (p) => JSON.parse(readFileSync(p, 'utf-8'));
  const chartPoisJson = readJson(resolve(ROOT, 'src/data/chart_pois.json'));
  const lhFile = readJson(resolve(ROOT, 'src/data/lighthouse_upgrades.json'));

  const collisions = findCoordCollisions(chartPoisJson, ownerPositions(lhFile));

  if (collisions.length) {
    console.error(`✘ 海图坐标撞车 ${collisions.length} 处（两点 resolve 后绝对坐标完全相同）：\n`);
    for (const c of collisions) {
      console.error(
        `  [${c.a.kind}] ${c.a.id}「${c.a.name ?? ''}」  <->  [${c.b.kind}] ${c.b.id}「${c.b.name ?? ''}」` +
          `  绝对坐标 (${c.a.x.toFixed(3)}, ${c.a.y.toFixed(3)})`,
      );
    }
    console.error(
      '\n两点若同时在图上会完全叠在一起——命中分发（ChartViewport 最近距离）在此是平局，其中一个必然摸不到。' +
        '\n改法：把其中一个的 mapX/mapY 偏移挪到附近的空位（参考本次案例挪动幅度 ~0.02–0.04，与同 owner 群里其它点留够距离）。',
    );
    process.exit(1);
  }

  console.log('✓ 海图坐标撞车门：anchors + roamingTemplates 两两 resolve 后绝对坐标均不重合。');
  process.exit(0);
}
