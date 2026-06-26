// 运行环境判定（单点真相）。
//
// 取代此前散在 psm.mjs::isSandbox / handoff.mjs::inSandbox / setup-weekend-worktree.mjs 各处的
// `startsWith('/sessions/') || includes('/mnt/')` 复制粘贴（#1/#165·handoff.mjs:26 注释自己都标了
// 「若改两处同步」——正是该收成单点的信号）。改沙箱路径约定只动这一处。
//
// 沙箱 = Cowork mount（mount 不能 unlink·quirk #1）：push / rebase+ff / worktree 删除 / 全量 esbuild
// 行为测都留 Mac/夜间。判定按「仓库根路径是否落在沙箱 mount 下」，故调用方传各自的 ROOT。

/**
 * @param {string} [p] 待判定路径（默认 process.cwd()）。约定传仓库根（psm ROOT / handoff ROOT）。
 * @returns {boolean} 是否在 Cowork 沙箱 mount 下。
 */
export function isSandbox(p) {
  const x = p || process.cwd();
  return x.startsWith('/sessions/') || x.includes('/mnt/');
}
