// playthrough 公共 harness —— 34 个 scripts/playthrough-*.ts 各自手抄的样板段
// （const log + L + assert + 结尾双 console.log）收口一处：
//
//   const pt = makeHarness('深度 band / 深入下潜回归');
//   const { L } = pt;
//   const assert: PtAssert = pt.assert;   // 显式类型注解＝保住 asserts 窄化（TS2775 要求）
//   ...
//   pt.done();                            // 成功收尾：打印全部日志 + '✓ <name>通过'
//
// 约定（nightly REPORT 解析依赖·别改格式）：
//   - 日志先缓冲进 log[]，assert 失败时整段吐 stderr 再 throw '断言失败：<msg>'（exit 1）；
//   - 成功时 done() 统一打印日志 + '\n✓ <name>通过'。
// 与既有 23 份手抄样板逐字节同格式——迁移只删样板、不动断言语义。
// 各脚本自己的领域 helper（combat 的 snap(label)、scenario 跑批等）不属于样板·留在各脚本。

/** 断言函数类型（消费方用它给解构出的 assert 显式注解·否则 TS2775：asserts 调用点要求显式类型）。 */
export type PtAssert = (cond: unknown, msg: string) => asserts cond;

export interface PtHarness {
  /** 缓冲日志（几乎不需要直接摸——用 L 追加、done/assert 负责打印）。 */
  log: string[];
  /** 追加一行缓冲日志。 */
  L: (s: string) => void;
  /** 断言：失败时先把缓冲日志吐到 stderr（保留现场），再 throw '断言失败：<msg>'。 */
  assert: PtAssert;
  /** 浮点近似相等（|a-b| ≤ eps·默认 1e-9）。 */
  near: (a: number, b: number, eps?: number) => boolean;
  /** 成功收尾：打印全部缓冲日志 + '\n✓ <name>通过'。 */
  done: () => void;
}

export function makeHarness(name: string): PtHarness {
  const log: string[] = [];
  const L = (s: string): void => {
    log.push(s);
  };
  const assert: PtAssert = (cond, msg) => {
    if (!cond) {
      console.error(log.join('\n'));
      throw new Error('断言失败：' + msg);
    }
  };
  const near = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps;
  const done = (): void => {
    console.log(log.join('\n'));
    console.log(`\n✓ ${name}通过`);
  };
  return { log, L, assert, near, done };
}
