// 兼容垫片：材料图标已并入「全道具图标系统」（ui/itemIcons.tsx·2026-06-28）。
// 旧引用（SeaChartView 的潜点「可能收获」chip）继续从这里 import MaterialIcon；
// 新代码直接用 ItemIcon（只要 id 就出图·分层解析·见 itemIcons.tsx 文件头）。
export { ItemIcon, MaterialIcon } from './itemIcons';
