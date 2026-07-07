# 深海回响 · 蜂群 boss / The Warren（攻坚追猎 · Hatchery 死角终局）SPEC

> **状态：v0 设计定稿 · 未实装（作者 2026-07-06 co-design 拍板）。** 把 boss 蓝图「菌群鱼（女王/工蜂）」那条从「单场·揭示锚母」谜题，演化成一场**一次下潜、单个多节点洞穴（The Warren）内的攻坚追猎**：穿过外层进近区 → 破进内层巢室、声呐追那具**动不了的女王被巢一节节往深处「撤」** → 每破一间给你一个输出窗、她靠**吞食 Spawn/卵回满血逃走**（所以开阔处杀不掉）→ 三间巢室退到 the Hatchery **无处可撤、背水一战** → 在死角耗尽她那点有限的回血（吃 Spawn、再吃自己的卵）**把她杀死＝取胜** → 女王一死、其余所有单位**陷入混乱、相互攻击、慢性死亡**（崩解）。核心不是数值膨胀——是**逼这个「连女王都只剩生殖功能」的帝国把自己吃光**。承接 boss 蓝图（`boss-enemy-design` 记忆·2026-06-21）、感知重做 SPEC（声呐＝诚实侦察）、战斗系统 SPEC（出口语义）、古文明 SPEC（蜂群派·仅情绪伏笔·见 §2）。生物原型/外形见 §2b–§2c（趋同真社会性鱼·2026-07-06 锁）。**巨型 boss 档：建议专门 session、作者在场逐拍死角终局手感。**

---

## 1. 北极星 / 为什么

- **让玩家的身体先学会「这个形状＝残酷」**：这场战斗的唯一目的，是让玩家亲手体会真社会性巢的残酷——个体的命随时可弃、整巢只为一个中心运转。不是读到的、是打出来的。
- **最狠的一层：连女王也只是生殖机器**（作者 2026-07-06）：这不是「一个享受权力的暴君奴役工蜂」。**连女王自己都被剥夺到只剩功能**——一具动不了、不思考、只会产卵和吞食的肉囊。这个帝国里**没有「人」**：从 Spawn 到女王，人人都被夺尽自我，残酷**没有受益者**，是这个「形态」本身吃掉了所有人。这比「有个爽的暴君」狠得多，也把古文明蜂群派那个「里子」顶到最高。
- **boss ＝规则变化、不是数值膨胀**：核心一刻是玩家发现「开阔处砍她的血没用」——你把她打到阈值，她被拖走、吞 Spawn/卵回满逃了。**真正的解法是把她逼进无法逃跑的死角**（最深的 the Hatchery）：退无可退时，你才能耗过她那点有限的回血把她杀掉。旧打法（追着砍血）失效 → 换一套（逼进死角、耗干她）。
- **残忍即机制，不是 flavor**：威胁不来自女王（她不攻击），来自**整巢为她自我消耗**——Spawn 自爆当矛、当盾，Wardens 拿命拦截，巢把他们（连 Wardens）喂给女王续命。你的取胜路径本身，就是**逼这座巢把自己吃到只剩一具肉囊、再补最后一刀**。主题写在行为与胜利条件里，不在图鉴里。
- **可生存 · 无脚本死**（承战斗系统 SPEC 出口语义）：封闭巢内是有意的 attrition，但**逃生阀门始终在**——`flee`（需氧≥3）随时可退、拉开 graph 距离可脱离。撑不住可以走，走了巢会回补、下次重来。

---

## 2. 定调收窄（这场**不是**什么 · 作者 2026-07-06）

> 「暗示蜂群派的残酷，而非社会性；生物意义上没有关联。」

- **不是优雅的超个体，是一台绞肉机**：不做「惊叹协作之美」的呈现。Spawn 褴褛、被驱赶、当场消耗；女王是个臃肿、**无自我的生殖机器**（连她都不是「人」·见 §1）。玩家该有的观感是**恐怖与厌恶**，不是敬畏。
- **与古文明蜂群派：只走情绪伏笔、无生物血缘**：古文明 SPEC 把「蜂群派」定为「表＝社会性顶点、里＝工蜂被夺自由意志、整巢服务单一中心」。本 boss **只提前替玩家的直觉装上「里子」那一半（残酷）**，让他们日后在废墟/Voss 笔记里读到「社会性顶点」时本能后退。
- **图鉴/lore 不写任何古文明关联**（守揭示锁三章·古文明碎片走壁画/录音/Voss 深条目那套）：这只鱼群就是一只鱼群，血缘、来历都不点古文明。伏笔纯情绪，不是可考的世界观线索。
- **命名（作者 2026-07-06 定）**：物种/巢/遭遇＝**The Warren**（学名 *Regina cavernarum*·洞穴女王）；女王＝**the Gravid Queen**（gravid＝满腹待产·你在最深处杀死的那只·杀她＝取胜）；工蜂＝**Spawn**（卵孵的可弃炮灰/口粮）；亲卫兵种姓＝**Wardens**（warren↔warden 同根·守巢的精英）；卵团＝**the Clutch**；最深的育体巢室/终局死角＝**the Hatchery**（女王的核心与卵仓·她退无可退的末路之地·**是个地方、不是可摧毁目标**）。管线：the Clutch（卵）在 the Hatchery 孵成 Spawn。图鉴（Voss 笔记）可把 Spawn/Wardens 记作 *minor/major* 工兵（真社会性昆虫术语·加科学味）。中文绰号可并存（穴群/巢母/孵仔/巢卫/卵床）。**本 SPEC 正文继续用中文设计简称（蜂群/女王/工蜂/亲卫/产卵巢）图省事，对应上表。**

---

## 2b. 生物原型 · 种姓 · 卵（作者 2026-07-06 锁）

> ⚠ **生物由头已被 §16 重定义（2026-07-07 · #271）**：本节「趋同演化出真社会性的鱼」的 **origin 作废**——本体实为寄生虫（**髓织虫 / Radicula Laceworm**）控制宿主鱼。下述**种姓 / 卵 / 形态 / 机制描述照旧有效**，只是「为什么长成这样」换成寄生（详见 §16）。

### 生物原型：趋同演化出真社会性的鱼

**这不是蜜蜂、也不是管水母，是一种为深渊量身长出来的鱼。** 蜂群＝一个**趋同演化出真·真社会性的鱼种**（海底版「裸鼹鼠」）：洞穴隧道筑巢、单一产卵女王、工蜂 + 亲卫（兵）两种姓，个体可弃、绝对服务于繁殖中心。

- **为什么这条路最干净**：它**原生**兑现我们锁的全部机制——穴居（洞穴筑巢）、产卵孵工蜂（真产卵）、工蜂/亲卫种姓——不用再给任何机制打生物学补丁。（前两版走管水母栽在这：管水母**浮游、出芽非产卵**，跟「穴居蜂巢 + 产卵孵工蜂」根本对不上。）
- **接受一步科幻·但站得住**：现实里没有真社会性的鱼；但真社会性**独立演化过 20+ 次**（蜜蜂/蚂蚁/白蚁/合鼓虾，脊椎动物里还有裸鼹鼠）。给这条鱼一个**演化由头**就落地（见 §2c）。
- **女王无需任何智力**：她不思考、不沟通、不指挥、连逃都不会——只反射性地**产卵和吞食**。所谓「转移、断后、牺牲亲卫」全是**巢的真社会性本能**在护中心，不是她的决定。这也**天然把她和古文明蜂群派隔开**（那是智慧头足类『一个心智借众多身体』；这只是**没有心智的形态**）。
- **和古文明蜂群派：形状相同·来路无关**（守 §2 情绪伏笔·无血缘）：这条鱼＝**盲目演化**撞出的真社会性形态；古文明蜂群派＝**智慧头足类主动选择**的集体。同一个形状（绝对繁殖中心 + 可弃的众多），毫无生物学关联。玩家先在这条鱼身上学会「这个形状＝残酷」，日后读到古文明那版本能后退。

**已锁的机制在这套生物学下全部原生成立（无需再打补丁）：** §4 回血＝女王**吞食 Spawn/卵**自愈（现实鱼类行为）；§4 取胜＝**杀死女王**（她逃 + 回满血 → 开阔处杀不掉·唯死角 the Hatchery 退无可退时耗过她那点有限回血拿下）；§3「追猎」＝你往里破、巢把**动不了的女王**一节节抬向更深、驱 Spawn 断后；§4 崩解＝女王死后其余单位**失序、自相残杀、慢性死亡**（真社会性物种失王后的真实行为）。

### 种姓：工蜂 / 亲卫（第 2 问）

- **工蜂（Spawn）**：弱、可弃的燃料，由卵孵化。炮灰 + 回血口粮（女王食 Spawn/食卵回血＝现实鱼类行为，正好演「消耗品」）。
- **亲卫（Wardens）**：更强更少的兵种姓，贴身护着女王与 the Hatchery，对玩家是真威胁（价值高于 Spawn）。
- **一切都是消耗品·连 Wardens 也照喂**：被逼急时，巢会把一个 Warden 塞给女王吞食回血、或推它上去当肉盾。价值有高低，但在这座巢里**一切都是消耗品**——而且**没有谁在「决定」牺牲，是形态在吞自己**。比单一 Spawn 更狠。
- 克制（守「敌人别太多」）：**亲卫只出现在女王/the Hatchery 近旁**，不满图撒。

### 卵与孵化（第 3 问 + 战斗中产卵）

- **the Hatchery 不断产卵，女王战斗中也持续下卵**（§5）；卵带**孵化计时**，你不压制 → 到点孵成 Spawn → 你被淹。复用蓝图「茧化」计时器（这次的玩家目标＝趁计时内打掉、别让它孵）。
- **卵一物两用**：既是 Spawn 管线，也是女王山穷水尽时的**最后回血燃料**——**食掉自己未孵的卵**（现实鱼类的食卵行为）＝最恶心那一拍，且**有限**，吃光即再无得吃、也再无 Spawn 可补。
- 护栏：同屏卵数封顶、卵只在 the Hatchery（女王核心巢室）产出——不做无限刷。

---

## 2c. 演化由头 + 外形（作者 2026-07-06）

### 为什么一条鱼会长成这样（演化由头·海底裸鼹鼠）

> ⚠ **此「演化由头」整段被 §16 的寄生 reframe 取代**（2026-07-07 · #271）：裸鼹鼠式趋同演化 origin 作废，改为寄生虫（髓织虫 / Radicula Laceworm）劫持宿主。下方「外形」描述仍有效。

把逼出裸鼹鼠真社会性的条件搬到深渊，逻辑照抄：

- **贫瘠 + 出走即死**：深渊食物稀、散、远，游进开阔水去单独繁殖＝几乎必死（捕食者/无遮蔽/巨距）。留巢帮那唯一的繁殖者，远比自己出去赌安全——真社会性的经典触发条件。
- **一个稀缺堡垒**：巢建在一处**罕见的化能食物源**（冷泉/喷口渗漏）旁——深渊里少数养得起一整群的地方，值得世代死守、继承、不弃（＝「占用洞穴」的 in-world 由头）。
- **只养得起一个女王**：洞小食寡 → 只够一个全职繁殖者。她**抑制其余个体的生育**（激素/行为压制·裸鼹鼠女王如此），其余全成不育的 Spawn 与 Wardens。
- **臃肿的由来（physogastry）**：只剩产卵一事，身体就朝产卵机器特化——裸鼹鼠女王拉长脊椎变大、白蚁蜂王腹部胀成巨大卵袋。这只走到极端：**几乎只剩一个子宫加一张嘴、自己动不了**。
- **吃自己续命有依据**：鱼在压力/匮乏下**吃自己的卵和幼体**（filial cannibalism）是真实行为。整个巢是一本封闭营养账，女王是那个代谢黑洞——受威胁时清算自己的骨肉（Spawn、卵）续命。图鉴点一句由头即可（守 §2「碎片式、不 info-dump」）。

### 外形（统一「绞肉机·不优雅」——恶心 > 敬畏）

- **底子鱼**：苍白、无鳞、退化眼（洞穴黑暗→失明失色 troglomorphy），细长能穿隧道，嘴生**啃凿状牙**（世代啃挖洞壁），皮薄半透隐约见内脏。海底裸鼹鼠感·丑而蠕动。
- **Spawn**：最小、最多、**像没长完的幼体**（幼态延续——不育 helper 停在半成品），苍白抽搐、成群涌动，有的半成形（刚出 the Clutch）。一眼「量产、可弃、半成品」。
- **Wardens**：更大更「成形」，**头颚肥大**特化成武器（碾咬）——蚁群大工/兵蚁感。少而硬、贴着女王与 the Hatchery。看着「被投资过」，所以被喂进去时更瘆人。
- **morph 形态（结茧羽化·见 §5）**：**Puffer**＝胀圆的活炸弹（河豚样·半透见涨满的气/毒囊）；**Guard**＝结茧硬壳、迟缓的活盾；**Berserker**＝颚与肌肉过度增生、痉挛突进。茧本身＝一颗高 armor、不动的硬壳（击破有奖励）。
- **the Gravid Queen**：一张小小的盲眼啃牙「鱼脸」接在**巨大、苍白、半透、塞满卵的腹囊**上（隔皮见 the Clutch 翻搅）。**几乎不能自主移动**——被 Wardens/Spawn 拖动；嘴过大、一直在动（被喂、也直接吞 Spawn 和卵）。一具**带着一张嘴的子宫**，搏动、青筋暴露、臃肿下流。
- **the Clutch / the Hatchery**：最深一室，四壁嵌满卵团（半透膜·里面 Spawn 已在抽动），温热（旁边就是那处化能热源＝当初定居的原因）。女王插在正中、退无可退——**这里是杀死她的地方，不是要摧毁的东西**。
- **The Warren 整体**：一座被啃挖、包被、掏空的洞——隧道被世代啃凿磨得溜光、壁上布满新旧卵室、覆着黏液；越深 Spawn 越密、卵室越多，直到 the Hatchery。看着就是「被占据、被感染、被住进去」。

---

## 3. 核心结构：攻坚追猎（作者 co-design 锁 · 2026-07-06 修）

**一次下潜、一个洞穴（The Warren）。女王从不出来——是你往里破，巢把这具动不了的女王一节节往深处「撤」。**（她是产卵机器，靠 Wardens/Spawn 拖动；绝对中心连逃都要靠奴隶抬。）

- **外层进近区**：先穿过一段**没有女王**的外层巢道——Spawn 防守、耗氧起步。女王在深处，**绝不靠近洞口**（作者锁）。
- **内层三间巢室（女王位）**：
  1. **定位**：用**诚实声呐**（感知重做 SPEC·ping 单记 + 射程 lookahead）扫出巢把女王**转移到了哪间**——你追的是一个被抬着走的目标。
  2. **破进 → 暴露窗**：打穿一间巢室的 Spawn/Wardens 防线 → 女王（正被拖向远端出口、无助）**短暂暴露**＝你的输出窗。
  3. **撤（hop）**：窗一过，Wardens/Spawn 把她拽走、留下来**组成一道封口墙**断后 → 转移途中**喂她 Spawn/卵回满血**、巢**回补** → 你**杀穿封口墙**才能追进下一间（1st＝Spawn 墙·2nd＝Guards 墙）。越深防御越密、越强、morph 形态越多（见 §5）。**关键：前两间她总能逃 + 回满，所以你在这儿杀不掉她**（§4）。
- **the Hatchery（第三间 · 终局死角）**：**无处可撤**（禁 evacuation）→ 女王插在产卵核心、背水一战。**这里是唯一能杀掉她的地方**：她逃不了，你耗过她那点有限的回血就赢（§4）。

> 她从不移动、从不迎敌。**是巢把她抬着退**——「绝对中心」连逃都要靠奴隶。你不是在追一个会打的 boss，是在**破一座为一具肉囊拼命的巢**，把它逼到再没有下一间可退。

---

## 4. 取胜＝杀死女王（她会逃 + 回血·唯死角杀得掉 · 作者锁 2026-07-06）

> 取胜条件极简：**杀死 the Gravid Queen ＝取胜**。the Hatchery 只是她退无可退的**地方**，不是要摧毁的目标（早前「摧毁 the Hatchery 才能杀她」的写法是误加·已废）。

- **为什么前两间杀不掉她**：**她会逃 + 回满血**。你在开阔巢室把她打到阈值，巢就把她拖走、途中吞 Spawn/卵回满 → 她跑了，你没能收尾。不是「有个总源在补所以砍不动」，是**她根本没留在原地给你砍死**。
- **死角＝唯一能杀掉她的地方**：退到最深的 the Hatchery，**无处可撤**（禁 evacuation·§3）。她仍想回血——吃 Spawn、Spawn 光了吃自己的卵（§5 终局最狞一拍）——但**这些有限、且她逃不掉**。你**耗过/压过她那点递减的回血**，把她打死 → **取胜**。
- **终局的张力＝一场「回血耗尽赛 + 群拦截」**：她背水一战、Wardens/Guards/Berserkers 死守、the Hatchery 还在吐 Spawn（§5）；你要在**自己氧气耗光前**扛住拦截、耗干她的食源（Spawn→卵）、拿下女王。**终局最狞一拍（作者定·做）**：Spawn 被吃光后，她开始**吞食自己未孵的卵**做最后回血——卵有限，吃光即再无得吃、也再无 Spawn 可补 → 你补上最后一刀。
- **崩解结局（作者锁）**：女王一死 → **其余所有单位陷入混乱、相互攻击、慢性死亡**（失王真社会性巢的真实行为）。且打到这步群本就所剩无几（都被她吃了）——崩解的只是一小撮残余。**帝国在你补最后一刀前，早被自己吃干净了。**

---

## 5. 威胁来自巢，不来自女王（种姓 · 结茧 morph · 逐间升级）

女王**不攻击**（动不了、无攻击器官）。威胁全来自她的巢——两条基础种姓 + 结茧 morph 出的升级形态，逐间加码。每一下都是「一条命被当消耗品花掉」。

**基础种姓：**
- **Spawn（役·炮灰）**：攻击力低、极易死、数量多。战斗中就是消耗你行动/资源的肉；女王转移时**留下来封口**（组成挡路的墙·见下）。
- **Warden（兵）**：数量相对少、**会主动攻击**（真正的伤害）；Spawn 死光后还**替女王挡攻击**（肉盾）。

**结茧 morph（复用 boss 蓝图「茧化」计时机制·玩家目标＝趁茧期击破、别让它孵成更凶形态）：** 单位结茧 → 计时内没被击破就羽化成升级形态（茧期 armor 高、不动、不攻击、**击破有奖励**——同蓝图茧化）。
- **Spawn → Puffer（河豚）**：胀成活炸弹，**被攻击或到点自爆**（AoE）；**远程击破不吃自爆伤害、近战会**——逼你对它换远程/拉距（接武器：鱼叉/气动手枪 vs 刀斧）。
- **Warden → Guard（守卫）**：防御大幅提高（做「墙」的料）。
- **Warden → Berserker（狂徒）**：攻击大幅提高。

**封口墙（「留下来断后」的机制化）：** 女王被撤时，留下的单位**组成挡路的墙**，你得杀穿才能追进下一间。1st 逃跑＝**Spawn 墙**；2nd 逃跑＝**Guards 墙**（Warden 已结茧成 Guard）。

**逐间升级（＝规则皱褶·不是数值堆·守 boss 北极星）：**
- **巢室①**：Spawn（炮灰）+ 少量 Warden。→ 1st 逃跑破 **Spawn 墙**。
- **巢室②**：**自带 Puffer** + **Spawn 结茧率↑**（更多 Spawn 变炸弹）+ **Warden 开始结茧**（→Guard/Berserker）。→ 2nd 逃跑破 **Guards 墙**。
- **巢室③（the Hatchery·死角终局）**：**自带 Guards + Berserkers**，女王退无可退、背水一战（§4）。

**女王本人**：仍**不攻击**——只 ①**战斗中持续产卵**（补 the Clutch → 孵 Spawn·the Hatchery 供养）②**吞食回血**（吃 Spawn/卵，Spawn 光了连 Warden 也吃）。（可选终局反射：喷卵/痉挛一次·纯演出。）**别给女王塞攻击表**——她的无力正是主题（不是强大的暴君，是最彻底的被剥夺者）。

- **环境**：封闭巢内耗氧（§7）；越近核心水越「稠」＝靠近 the Hatchery 的额外压力。

---

## 6. 打法 A（唯一交付）

- **打法 A · 正面攻坚（唯一打法）**：如 §3–§5，穿进近区、声呐追女王被撤到最深的 the Hatchery、在死角耗过她那点有限的回血、**杀死女王＝取胜**。这是本 boss 完整、也是唯一的交付。
- **第二打法＝作废（作者 2026-07-06 定）**：原「潜入先破 the Hatchery」不成立——the Hatchery **不是可摧毁的取胜门、只是死角地方**；且它是最深、防御最密的终点，没有「先破/抄近路」。**连带备选的「断食源生态围困」方向一并作废**——不做第二打法、也不为它留后手。

---

## 7. 战场压力与可生存

- **氧气 attrition**（`environmentalPressure.oxygenDrainBonus`）：巢内每回合额外耗氧，随深入加剧（越近核心叠加「稠水」压力·§5）。封闭洞穴**无上浮口**——低氧无出路是**有意**的（承战斗系统 SPEC / `combat-exit-semantics` 记忆），不是无脚本死破口。
- **奖励激进**：女王靠吞食回血、巢不停补 Spawn，龟缩只会让你耗氧而巢无损。设计上**逼玩家快速推进、把她逼进死角、在自己氧气耗光前耗干她的食源拿下**——这也顺手压住单潜攻坚的氧气预算，不让战斗拖沓。
- **逃生阀门始终在**（无脚本死）：`flee`（需氧≥3）随时退出、拉开 graph 距离脱离。
- **撤退与重来（作者 2026-07-06 定·接月相潮汐）**：撤退不清零——**一个月相之内回来，女王位置不变**（不用从①重推）；窗口**按总天数算、不按月相跳变**（离开时起算固定天数·公平·复用月相潮汐 `advanceDays`/总天数·见 `lunar-tide-system` 记忆）。**超过一个月相**没回 → 巢已恢复、女王退回起点、**整场重来**（Spawn/Warden 补满、卵室复原）。这不是「跨潜持久猎杀」（那条早否了），是**一个有时限的存档窗**：核心仍是单潜规模攻坚，只是允许你撤出补给、限期内接着打。
- **理智**（可选·tunable）：绞肉机的目击可给轻微 `sanityDamagePerTurn`；默认以氧气为主压力轴，理智留小量或关闭，避免与感知重做的「低 san 幻觉轴」抢戏。

---

## 8. 场地 / mapgen（攻坚结构决定了场地）

结构反过来定死了场地形态——之前搁置的「占用现有洞 vs 新生成」由此解决：

- **占用持久洞 + 蜂巢覆写**：复用多口持久洞（`深海回响_多口持久洞_SPEC`）+ 地图形状层（`map-layout-styles` 记忆·`LayoutStyle`/`mapShape` 单一来源）。把「蜂巢」做成一个布局变体，**覆写**在一个既有洞穴上——主题上蜂群＝殖民/感染，占据并掏空一个空间，比凭空造巢更有「蔓延/殖民」的恐怖，且比一次性专用 arena 更可扩展（约定落成机制、别一次性）。
- **拓扑要求**：图内含**一段外层进近区（无女王·Spawn 防守）** ＋ **女王的三间内层巢室**（最深一间是 the Hatchery·终局死角·禁 evacuation）；**女王起点已在深处、绝不靠近洞口**（作者锁）；Spawn 遭遇密度**按到女王当前巢室的距离缩放**（越深越密越强），女王被撤后重算（派生字段·不入存档）。
- **具体拓扑/节点数/连通**：留 mapgen 实装期定；SPEC 只约束「外层进近 + 三间内层女王巢室 + 最深 the Hatchery 死角 + 女王恒在深处 + 密度随近女王递增」这几条硬性。

---

## 9. 引擎映射（复用 vs 新增）

已核对代码（`src/types/enemies.ts` / `src/engine/combat-mechanics.ts`）——大半是现成的：

**复用（已 ship）：**
- `EnemyRole` 已含 `'swarm' | 'boss' | 'miniboss'`（enemies.ts）。女王＝`boss`（带 `phases`·做 evacuation 相位载体），Spawn＝`swarm`，Wardens＝`swarm`/`miniboss`。
- `BossPhase`（`hpThreshold`/`transitionText`/`attacksOverride`/`aiPatternOverride`/`stanceForce`）+ `EnemyDef.phases?` + `EnemyInstance.phaseAttacksOverride/…` 全在。
- `maybeBossPhaseShift`（HP 变化后查阶段）+ `applyEnvironmentalPressure`（每回合累计 boss 战场压力扣资源）全在。
- **链鳗那套 party-state 触发的行为替换**（`maybeChainEelEnrage`／「护巢仔全灭后狂暴」·复用 `phaseAttacksOverride` 写法）——**崩解结局**可直接套（反过来用：女王死 → 残余 Spawn 切「无首失序/自相残杀」AI）。

**新增（全部加法·不撕已测机制）：**
1. **女王「被撤」（evacuation·前 2 间）**：暴露窗内 `hpThreshold`/window 命中 → 触发 `maybeSwarmQueenRelocate`（把女王移到下一间巢室 + 吞 Spawn 回满血 + 巢回补）。**女王自身无移动/攻击 AI**——移动是被 Wardens/Spawn 拖动的表现层。**第三间（the Hatchery）禁用 evacuation**——这正是「只有死角杀得掉她」的机制落点（§4）。
2. **the Hatchery ＝终局死角节点（非可摧毁目标）**：最深巢室，`maybeSwarmQueenRelocate` 在此**禁用**（女王退无可退）。取胜＝**女王 HP 归零**（不是「破坏某个结构」）。前两间她 relocate + 回满逃走故杀不掉；死角里她逃不掉、回血食源（Spawn→卵）有限 → 耗过她即可致死。the Hatchery 只是地方。
3. **女王 def 无攻击表**：女王 `EnemyDef` 无有效 `attacks`（或空）；她的「动作」只有 **产卵（战斗中 spawn the Clutch）** + **吞食回血**（消耗 Spawn/卵/Warden）。伤害 DPS 全在 Spawn/Wardens def 与 `environmentalPressure`。
4. **卵＝孵化计时实体**：复用「茧化」计时器——到点 spawn 一只 Spawn、可被提前打掉（趁计时内）；卵只在 the Hatchery 产出，也是女王终局的有限回血食源（§4）。
5. **Spawn/Wardens 种姓 + 密度按近女王距离派生**：两个独立 `EnemyDef`（Spawn 弱 · Warden 强且仅在女王/the Hatchery 近旁）；`spawnDensity(node) = f(distance to queenNode)`，女王被撤后重算（派生·不入存档·承存档约定 quirk #99）。「牺牲 Warden」＝巢把一个 Warden 喂给女王回血/当盾的一次触发。
6. **崩解终态**：女王死 → 残余 Spawn/Wardens 进「无首失序」（攻击随机目标/自相残杀·伤害去协调化）→ 数回合内慢性死亡 / 遭遇收束（套 `maybeChainEelEnrage` 模式）。**这是取胜后的演出，不是取胜条件**（取胜＝女王死）。
7. **mapgen：外层进近 + 三内层巢室 + 最深 the Hatchery 死角**（§8），女王恒深处。
8. **结茧 morph（复用蓝图「茧化」计时器·目标＝趁茧期击破、别让它孵）**：Spawn→Puffer、Warden→Guard/Berserker；茧期高 armor·不动·不攻击·击破有奖励·到点羽化。逐间 morph 率与自带形态按 §5 升级。~~**依赖茧化机制**（蓝图待实装项·本 boss 与它共建）~~ **【纠错 2026-07-06】茧化机制早已 ship·非待实装·非共建**：`maybeMetamorphosis`/`maybeCocoonCountdown`（`combat-mechanics.ts`）+ `EnemyDef.metamorphosis` 随 `cocooned_resident` 落地，直接复用即可（`adultAttacksOverride`＝Berserker 攻击升级；`cocoonBreakBonus`＝击破奖励）。**§4「共建茧化」前提作废**·详见 §13。
9. **Puffer 自爆 + 远程豁免**：被近战攻击或计时到点自爆（AoE）；**远程击破不对玩家触发自爆伤害**（接武器远/近·鱼叉/气动手枪 vs 刀斧）。
10. **封口墙＝逃跑门**：每次 evacuation 在通道生成一道「墙」party（1st＝Spawn·2nd＝Guards），**杀穿才解锁追到下一巢室**。
11. **撤退/月相窗状态存档**：Warren 状态（女王当前巢室等）**按总天数 banked**（复用月相潮汐 `advanceDays`/总天数·`lunar-tide-system`）；≤一个月相回来续、>一个月相 reset 回起点。

---

## 10. 数值 / 手感：一律 defer

所有数值与手感——女王/Spawn/Warden HP、Spawn 场上限与密度曲线、孵化速率、每回合耗氧、暴露窗触发阈值、三间的具体 threshold、回血量、卵的数量与孵化计时、存档窗天数——**统一留作者最后一次性调**（承 `defer-number-tuning` 记忆）。SPEC 与实装只搭机制骨架与占位默认，标 `待作者调`，不在过程中反复调参。

---

## 11. 实装排期

**先写死本 SPEC（当前）→ 再谈实装。** 巨型 boss 档（与「深口」「暖涌」同级），boss 蓝图约定这类「专门 SPEC 先写、可能专门 session」。

**Phase 1（引擎骨架 · schema 已 ship 故起点低）：**
- `maybeSwarmQueenRelocate`（前 2 间「被撤」+ 回满血 + 回补；**第 3 间 the Hatchery 禁撤＝女王在此可致死**）
- Spawn 密度按近女王距离派生 + Warden 近核限定
- 卵＝孵化计时实体（复用茧化计时器·也是女王终局有限回血食源）
- 崩解终态（套链鳗 party-state 模式·女王死后的演出）
- 蜂巢 mapgen 覆写（外层进近 + 三内层巢室 + 最深 the Hatchery 死角）
- 结茧 morph（Spawn→Puffer / Warden→Guard·Berserker·复用茧化计时器）+ Puffer 自爆远程豁免 + 封口墙逃跑门
- 撤退/月相存档窗（按总天数 banked·接 lunar-tide·≤一月相续、>一月相 reset）

**Phase 1 内容线（数据·可与引擎线并行）：**
- 女王（无攻击·产卵+吞食回血）/ Spawn(+Puffer morph·自爆) / Warden(+Guard/Berserker morph·碾咬拦截·护核) JSON（`phases` 用 evacuation 触发·结茧计时·封口墙·`environmentalPressure` 耗氧·逐间升级见 §5）
- baseline 回归 scenario（承 `scenario_framework` 记忆：加内容必配 baseline）

**并行计划（PSM · 见 parallel-sessions）：** 引擎钩子线（车道：`src/engine/**` combat/mapgen）与内容数据线（车道：敌人 JSON + scenarios）**车道不重叠**，可两条并行；合并后在 main 跑完整 regress（隔离 agent 看不到跨切断裂·承 `cowork-parallel-agents` 记忆）。

**（无 Phase 2）：** 第二打法已作废（§6）——本 boss 单打法交付。

**建议起手 prompt / 模型：** 引擎骨架线 **Opus · high effort**（新钩子横跨 combat/mapgen/存档派生，架构敏感）；内容 JSON 线 **Sonnet · medium effort**（照 §5 + 敌人入库 SKILL 填数据，数值 defer）。死角终局手感建议作者在场逐拍。起手 prompt 见 `docs/archive/深海回响_蜂群boss_Phase1_impl_prompt.md`。

---

## 12. 拍板状态

- **设计层全部拍板完毕**（2026-07-06）：主题、生物原型/外形、结构（攻坚追猎 + evacuation + 封口墙）、种姓 + 结茧 morph、**取胜（杀死女王·唯死角 the Hatchery 退无可退时杀得掉·the Hatchery 只是地方非可摧毁目标）**、终局（女王吃己卵做最后回血）、崩解（女王死后其余单位混乱自噬慢性死亡）、撤退月相窗、命名——均已定。
- **终局吃卵＝做**（§4）；**第二打法＝作废**（§6·单打法交付）。
- 仅余 **数值 / 手感 defer**（§10·女王/Spawn/Warden/morph HP、结茧计时与 morph 率、孵化速率、耗氧、暴露窗阈值、卵数、存档窗天数…作者最后一次性调）。

---

## 13. Phase 1 实装状态（2026-07-06 · Cowork 交互 · core spine · on main · 未提交 · 沙箱 regress 94/94 绿）

**① 纠错——§4/§9.8「共建茧化」前提作废（起点比 SPEC 以为的低得多）。** 实装起手核对代码发现：女王那整套「每回合 kit」**早已随 `mycelial_fish`（菌群鱼女王）+ `cocooned_resident` 落地**，不是待实装：
- 茧化 morph → `maybeMetamorphosis` / `maybeCocoonCountdown` + `EnemyDef.metamorphosis`（larva→cocoon→adult·`cocoonBreakBonus` 击破奖励）✓
- 吞食回血 → `corpseEating`（任一单位死→回血）+ `maternalBehavior.consumeJuvenileHpGain`（HP<50% 吞仔）✓
- 产卵补 Spawn → `droneReplenish`（补到 minCount·不 shield）✓
- 破墙才暴露女王 → `shieldedBy`（`checkActionAvailability` 门·即天然的「封口墙」原语）✓
- 护巢仔全灭→enrage → `applyMaternalEnrageIfAlone`（崩解可反用同款 party-state 模式）✓
- HP 阶段 / 耗氧 → `phases`(`BossPhase`) / `environmentalPressure` ✓

所以 Phase 1 真·新工作收敛到**空间/结构层**，其余是「接线复用」。

**② 架构决定——map-level hybrid 追猎循环（作者拍板 2026-07-06）。** 解 §9.1「移动是表现层」（读作 phase-based）vs §9.11「banked 女王当前巢室」（只在 map-level 才存在）的自相矛盾：**每间巢室＝一个 dive-map 节点**；每间的战斗复用既有 combat 钩子；女王每间满血（§4）→ 非死角只能把她打进**暴露阈值**→ 巢撤走（房间清空·女王逃脱）→ 回图用**诚实声呐**找下一间→ 破进；**唯 the Hatchery 节点禁撤**＝她被打死＝取胜。追猎进度住 `RunState.warrenHunt`（正是 §9.11 存档窗的挂点）。

**③ 本 session 落地（全 additive·不 bump SAVE·守 check-boundaries）：**
- 类型：`EnemyDef.swarmRelocate{exposureThreshold,relocateText,collapseText}` · `CombatState.warrenRoom{isHatchery?}`+`pendingSwarmRelocate` · `CombatEncounterDef.warrenRoom` · `RunState.warrenHunt{roomsCleared,queenNodeId?,inHatchery?}`（真条件字段·同 `stalker`/`decoy`）。
- 引擎（`combat-mechanics.ts`+`combat.ts`）：`maybeSwarmQueenRelocate`（非死角·HP≤阈值→置 `pendingSwarmRelocate`·含 overkill/DoT）→ `applyPlayerAction` 第 **4a** 步（**先于**胜负判定）走 `finalizeSwarmRelocate`（进 `warrenHunt.roomsCleared`·路由 `victoryEventId`/rest·无战利品）；`maybeSwarmCollapse`（**仅死角**·女王 hp≤0→残余 hp→0+记 `fledInstanceIds`→令 `allEnemiesDefeated`＝取胜演出）；`runEnemyTurn` 加**无攻击表 passive 守栏**（女王 `attacks:[]` 不出手·全库通用·兼作 `enemyAttackPlayer` 空表护栏·守 SPEC §3「不写单敌专属分支」）。
- 内容（`src/data/enemies/warren.json`）：the Gravid Queen（无攻击·`shieldedBy`+`swarmRelocate`+`droneReplenish`+`corpseEating`+`environmentalPressure`）/ Spawn / Warden（`metamorphosis`→Berserker）/ Guard（高 armor 静态墙）+ 遭遇 approach/room1/room2/hatchery(`isHatchery`)/hatchery_solo。
- baseline（`scenarios/combat/`·实跑抄 quirk #43）：`warren_room1__queen_relocate`（破巢卫墙→relocate·covers warden+spawn+queen）·`warren_room2__queen_relocate`（破 Guards 墙→relocate·covers guard+spawn+queen）·`warren_hatchery_solo__kill_collapse`（死角杀女王→崩解·covers queen）。

**④ Deferred（非 core spine·留后续 Phase）：** Spawn→Puffer **自爆 + 远程豁免**（§9.9/E4·唯一真·新 hook）；**封口墙独立 party**（§9.10·现折叠进 `shieldedBy`「破墙才暴露」）；**蜂巢 mapgen 覆写 + Spawn 密度距离派生**（§8/§9.5/§9.7/E6/E9·现用既有 encounter + 占位节点）；**撤退/月相存档窗**（§9.11/E8·`warrenHunt` 已留挂点·接 `lunar.ts`）；**数值/文案 tuning**（§10·`exposureThreshold` 现占位 0.7＝短暴露窗）。

**⑤ 验证：** 沙箱 `npm run regress` **94/94 绿**（含 `playthrough-combat-scenarios` 验三 baseline·`check-enemy-refs` 四门·`check-boundaries`·`typecheck`）；vite production build 缺 `rollup-linux` 沙箱跳过 → **留 Mac/nightly ship 门补跑**（`blue_regress_sandbox`）。未提交（交互 session·push 留 Mac/nightly·quirk #104）。

---

## 14. Puffer 自爆 + 女王吼叫/信息素/产卵（2026-07-07 · Cowork 交互 · Opus · on main · 未提交 · 沙箱 regress 94/94 绿）

**① Puffer 自爆 + 远程豁免（§9.9/E4·接 §13④ deferred·本 session 落地）。** 全 additive·不 bump SAVE：
- 新 `EnemyDef.selfDestruct{staminaDamage,sanityDamage?,detonateText,defusedText?}`·武装门 `pufferArmed`（有 metamorphosis 仅 **adult** 态武装·否则恒武装）。
- 三触发点（`combat.ts`/`combat-mechanics.ts::maybePufferMeleeDetonate`+`detonateSelfDestruct`）：**近战**命中 armed Puffer → 当场引爆·溅玩家（含被这一击打死·detonate 不 guard hp≤0）；**远程**击破 → 豁免不溅（走普通死亡·可选 defusedText）；**到点** → 其敌方回合自爆（`runEnemyTurn`·**先于**无攻击表 passive 守栏 quirk #231·否则 adult 空攻击表被跳过不炸）。战斗无位置 ⇒ AoE 落点＝玩家。
- 新 `enemy.warren_puffer`（larva 弱咬→茧→adult 活炸弹·复用茧化计时器）+ 3 baseline（近战溅伤 / 远程豁免 / 到点自爆·判据＝`sanity` delta·抗数值调）。

**② 女王吼叫 / 信息素 + 产卵召唤（作者 2026-07-07 加·§5 扩展）。** 女王仍无攻击表；新行为在 `runEnemyTurn` 起手（`maybeWarrenPheromone` **先于** `maybeWarrenReinforce`·后者新产的卵不被同回合 forceHatch 秒孵＝留「凿破卵」窗）：
- 新 `EnemyDef.warrenPheromones{roarChance,cocoonBoostChance?,detonatePuffers?,forceHatch?,roarText}`·**条件优先级择一**：② armed Puffer 存在→全部立即引爆；③ 否则有茧/卵→全部 `cocoonTurnsLeft→0` 立即孵化；① 否则 larva·带 metamorphosis 的单位掷 `cocoonBoostChance` 立即结茧（↑结茧率）。
- 新 `EnemyDef.warrenReinforce{lowUnitThreshold,baseCap,capPerRelocate,eggDefId,maxPartySize,layText}`·场上活的**非女王**单位 ≤ 阈值 → 产 `baseCap + warrenHunt.roomsCleared × capPerRelocate` 枚卵（**每次被击退／relocate 上限递增**·roomsCleared 派生不入档·quirk #99）·受 maxPartySize 约束。
- 新 `enemy.warren_egg`（passive·spawn 时初始化 cocoon 阶段·复用 metamorphosis 计时·**不打掉就孵化成敌人**；`metamorphosis.breakDestroys=true`＝**打掉即毁·不复活**·§9.5）+ 2 baseline（产卵/卵生命周期·信息素引爆 Puffer）。
- 新 `metamorphosis.breakDestroys?`（缺省=既有「破茧复活成体」·Puffer/Warden 用；true=销毁·卵用）。

**③ 仍 Deferred：** 蜂巢 mapgen 覆写 + Spawn/Puffer 密度距离派生 + 封口墙独立 party（§8/§9.5/§9.7/§9.10·**架构敏感·有未建依赖多口持久洞 + encounter→node 绑定缺失·留专门 session**）；撤退/月相存档窗（§9.11·`warrenHunt.lastVisitDay` 待接 `lunar.ts` `moonPhasesElapsed`）；数值/文案 tuning（§10·全占位）。

**④ 验证：** 沙箱 `npm run regress` **94/94 全绿**（5 warren baseline + `check-enemy-refs` 传递闭包覆盖动态产出 defId + `check-file-budget`〔`combat.ts` melee 触发抽进 `combat-mechanics.ts` 守 1170 预算〕+ `check-boundaries` + `typecheck`）；build 留 nightly。未提交（push 留 Mac/nightly·quirk #104）。

---

## 15. 身体库存主线（女王「吼叫 / 信息素」菜单扩展 · 2026-07-07 · #271 拍板 · 待实装）

> **一句话**：把 §14 女王那堆分散动作（吼叫 / 信息素 / 产卵 / 回血 / 结盾）收口成**一条主线＝耗空她的身体库存**。不是新机制堆料，是 §5「威胁来自巢」的**经济机制化** + §4「递减回血」的**单一资源模型**：女王的 feed（回血）/ screen（结盾）/ lay（产卵）/ relocate（撤走）**全从同一个池子——她的工蜂 / 亲卫 / 卵——里花身体**。死角 the Hatchery 池见底 ＝ 暴露且回不了血 ＝ 可杀，正好落 §4「耗过她那点递减的回血 + 群拦截」。

**设计叉（作者 2026-07-07 拍板）：** feed/screen **直接替换** `corpseEating`/`shieldedBy`（不并存·代码更干净）；screen **本批一起做**（不拆）；选择＝**需求优先级树**（§15.3·非随机）。

### 15.1 身体库存模型（the body pool）
- **池子＝场上活的非女王单位 + the Clutch 卵**（Spawn / Warden(+Guard/Berserker/Puffer morph) / `warren_egg`）。这些**就是**她的库存——每一次回血 / 结盾 / 产卵 / 撤走都在花身体。
- **派生·不新增存档字段**（承 quirk #99）：池子是对现有战斗态（enemies 数组 + 卵实体）的**视图**，不是独立存的数字。读处按「活着的非女王单位 + 卵」现算。
- **死角保证净耗尽**：前两间女王 relocate + `warrenReinforce` 补池（净不减）；the Hatchery **禁 relocate（§4 已 ship）+ 限/禁 reinforce**（死角不补）→ 池子**只出不进**。终局耗尽顺序＝ §4：Spawn → Warden → 卵 → 空 → 她暴露、回不了血 → 补刀。

### 15.2 六个动作（feed / screen / lay / detonate / hatch / cocoon-boost）
挂 `runEnemyTurn` 起手 + `warrenPheromones` 子字段（复用 §14 已 ship 钩子·小加法）。**替换**标 ⟳、**复用 §14**标 ♻：

- **⟳ feed（献祭回血 · 替换 `corpseEating` + `maternalBehavior` 被动回血）**：她**主动**献祭一只活单位（巢送进嘴·她不动）回血。**关键改动**：删「任一单位死 → 女王回血」的被动（`corpseEating`）——**你清怪不再顺手喂她**，只她主动 feed 才回血。花：一只活 Spawn（优先）/ Warden / 卵。直接实例化 §4「吃 Spawn·Spawn 光了吃卵」。⚠ `maternalBehavior.consumeJuvenileHpGain`（§13·HP<50% 吞仔）是**第二条被动回血**·一并收进 feed 主动化（否则又是单一真相破口·impl 时退役其回血侧）。
- **⟳ screen（动态肉盾 · 替换 `shieldedBy`）**：吼出 N 个肉盾（从池子拉活单位站到女王前）·**杀穿才可选中女王**。替换现**静态** `shieldedBy`（§14 `checkActionAvailability` 门·固定挡）。花：N 只活单位当盾。**⚠ 本批最大件 + 跑步机风险**：screen 的「再结盾」**必须受身体库存约束**——池子空了就结不出盾。暴露窗（`maybeSwarmQueenRelocate` 的 `exposureThreshold`·§9.1 已 ship·现占位 0.7）**须与 screen + 池子一起调**，否则「杀穿 → 她再结盾」变**打不动的跑步机**。死角净耗尽（§15.1）是这条不成跑步机的**机制保证**——池空 → screen 熄火 → 暴露窗常开 → 可杀。**别当小加法**。
- **♻ lay / force-hatch（产卵 · 复用 `warrenReinforce` §14）**：作战单位少 → 有卵 **force-hatch**（催孵现有 `warren_egg` 成 Spawn）·否则 **lay**（产新卵）。**唯一「加」的一支**——但 the Hatchery 受限/禁（§15.1）保证净耗尽。
- **♻ detonate（引爆 armed Puffer · 复用 `warrenPheromones.detonatePuffers` §14②）**：吼一声引爆场上 armed Puffer（AoE 溅玩家·§14①）。花：那些 Puffer。
- **♻ hatch（催孵茧/卵 · 复用 `warrenPheromones` §14③）**：全部 `cocoonTurnsLeft→0` 立即孵化。
- **♻ cocoon-boost（↑结茧率 · 复用 `warrenPheromones` §14①）**：larva 掷 `cocoonBoostChance` 立即结茧。

### 15.3 选择＝需求优先级树（非随机 · boss 反制你的打法 · 作者拍「按这个」）
每个女王回合（`runEnemyTurn` 起手）**从上往下取第一个满足的**：
1. **血低 + 有可献祭单位 → feed**（她要活命·先回血）
2. **近期反复挨打（对女王伤害计数 ↑）+ 盾破（无 active screen）+ 有身体 → screen**（你突脸了·她结盾自保）
3. **作战单位少（活的非女王攻击单位 ≤ 阈值）→ 有卵 force-hatch·否则 lay**（补拦截）
4. **都不满足 → detonate > hatch > cocoon-boost**（顺手加压 / 催化·三者按此序）

- **非随机 ＝ boss 反制你打法**：你突脸 → 她 screen；你清场 → 她 lay/hatch；你放着她 → 她 feed 回血 + cocoon-boost 升级。玩家换招 → 她换招。
- `maybeWarrenPheromone` 从现「三分支条件择一」（§14②）**扩成这棵六分支优先级树**·仍**先于** `maybeWarrenReinforce`（留凿破卵窗·quirk #231/#232 语境不变）。

### 15.4 需要的新战斗态（最小加法）
- **女王 HP 阈值**（喂条件 1「血低」）：读女王 instance HP% vs 占位阈值·无新存字段。
- **「近期对女王伤害」计数**（喂条件 2 screen）：滚动窗口计数（近 N 回合玩家对女王造成的伤害 / 命中）——**唯一真·新增战斗态**（run 级战斗态·不入存档）。窗口 N 占位（§10 defer）。
- 其余全复用 §14 已 ship：`runEnemyTurn` 起手钩子 · `warrenPheromones`/`warrenReinforce` 子字段 · 池子派生（§15.1）。

### 15.5 命名（dev 功能名 · 游戏内 [待过稿]）
- **分轴**：**吼（听得见）**＝齐扑 / detonate（引爆）——听得见的号令；**信息素（无声）**＝feed / screen / lay——无声的化学操控。弃 §14 的「X 吼」统称。
- **dev 用功能名**（`feed`/`screen`/`lay`/`detonate`/`hatch`/`cocoonBoost`）；**游戏内文案 [待过稿]**（作者定稿·守克制冷短句·**动物暴君不糊古文明**·别写成古文）。

### 15.6 实装边界 / 待接线（接 §11 排期 · 续 §14）
- **全加法 · 复用 §14 机制 · 不 bump SAVE**。
- **退役**：`corpseEating` + `shieldedBy`（+ `maternalBehavior` 被动回血并入 feed）——直接替换（作者拍·§15 抬头）。
- **改**：`maybeWarrenPheromone` → 六分支优先级树 dispatcher（§15.3）。现 `roarChance`（§14·每回合 1 过强）被优先级树取代——不再每回合无脑 roar，按需求触发。
- **新战斗态**：近期对女王伤害计数（§15.4）。
- **⚠ screen 须与暴露窗（`exposureThreshold`·§9.1）+ 池子一起调**（§15.2·跑步机风险）。
- **门**：feed/screen/lay 若动态产出新 defId → 进 `check-enemy-refs` 的 `spawnChildren` 传递闭包（quirk #232）；新触发点留意 `combat.ts` file-budget（§14④·melee 触发已抽进 `combat-mechanics.ts`）。
- **数值全 defer（§10）**：池子各档数量 · feed 回血量 · screen 盾数 N · 暴露窗×池子耦合 · 女王 HP 阈值 · 近期伤害窗口 · 各选择树触发阈值——占位·作者最后一次性调（`defer-number-tuning`）。

### 15.7 开放叉（impl 时定 · 未拍）
- `maternalBehavior` 除被动回血外若有别的效果（吞仔的**减员**表现等）——退役时只收回血侧、还是整个并进 feed？impl 读 `maternalBehavior` 全字段再定。
- feed/screen 的「可献祭 / 可拉盾单位」是否含**结茧中**的茧（不能动 vs 可被拽出来当消耗）——占位「只活动单位·茧不算」·手感期再定。

---

## 16. 生物本体重定义：寄生 · 水鬼伞 · 命名（2026-07-07 · #271 · 作者拍板 · 待实装 / 待 canon 整合）

> **一句话**：The Warren 的**本体不是那条鱼**，是一种寄生虫（**髓织虫 / Radicula Laceworm**）控制了一只雌鱼。§2b/§2c 原来的「趋同演化出真社会性的鱼」由头**作废**——种姓 / 形态 / 机制描述照旧，但**为什么会这样**换成寄生。这条把 §5「女王＝最彻底的被剥夺者」推到极致（她不是被巢剥夺，是**身体被寄生虫夺走、改造成产卵机器**），并把它接进一张更大的 in-world 命名网（水鬼伞）。

### 16.1 本体＝寄生虫 髓织虫 / Radicula Laceworm
- **它做什么**：钻进宿主鱼，在体内长出**根系**（仿 Sacculina / 根头目 Rhizocephala 的 interna）、**缠进中枢神经直接驾驶身体**（仿脑吸虫 Euhaplorchis 的神经操纵）、**绝育宿主并劫持其繁殖**——激素把雌鱼改写成高效产卵机器。整窝＝**被寄生的鱼**（卵带寄生虫幼体·option A），不是自然鱼群。
- **生物学站位（诚实标注）**：真·根头目只寄生甲壳类、上不了脊椎动物；本设定是**把 Sacculina 的身体蓝图（体内铺根 / 绝育 / 劫持繁殖）＋ 脑吸虫的神经操纵，虚构地嫁接到脊椎宿主**。恐怖真、机制真，跨宿主那步是科幻许可（明说、别当纪实）。
- **信息素改招食物**：巢的信息素**只诱野鱼来当食物**，不再「吸引同类壮大群体」（繁殖靠被寄生的卵）。→ 强化 §4：死角没诱饵可吃 → 只能吞自己的宿主 / 卵续命（正接 §15 身体库存耗空 + Sacculina「宿主替寄生虫育幼」的行为）。
- **搬得慢·优先保产卵宿主**：寄生虫能换宿主但**慢**，且**最护会产卵的宿主**。→ 给 §9 已 ship 机制上锁：`swarmRelocate`＝拖着珍贵产卵宿主往深躲（非瞬移跳宿主）；死角杀得掉＝**没有能产卵的新宿主可跳、跳又慢**，只能连最后一具宿主被你杀。机制零改·叙事白捡「为什么只有死角能杀」。

### 16.2 水鬼伞 + who's-who（in-world 命名网）
in-world 的人**看不见寄生虫**、只看见宿主。他们按**外观**（水里、人形轮廓、动得不对）把好几种**成因不同**的东西归成一类——民间叫 **水鬼 / the Living Drowned**，学究叫 **恐人 / Horror sapiens**（戏仿 智人 / Homo sapiens）。这是一张**俗名伞**（potato / sweet-potato：一个名字底下罩着不同源的东西）。

| 成员 | 土名 | 学名 | 真相（成因） |
|---|---|---|---|
| 头足目（人一般大·深压退化·**非寄生**·原「尸衣者」·已改名 code `horror_sapien`） | 水鬼 / the Living Drowned | 恐人 / Horror sapiens | 古文明深压半成品 |
| 人类版（Ch2·被寄生的人·**也在水里**） | 水鬼 / the Living Drowned | 恐人 / Horror sapiens | 寄生虫 A（专寄生人） |
| 鱼版（被寄生的鱼＝The Warren·**鱼形·不进水鬼伞**） | —（鱼形不像人） | 恐鱼 / Horror piscis | 寄生虫 B（专寄生鱼·与 A 趋同） |
| 寄生虫本体（藏体内·解剖才现形） | —（看不见·无土名） | 髓织虫 / Radicula Laceworm | 真正的傀儡师 |

- **属名 Horror 一以贯之**（Horror sapiens / piscis）＝把**学究的归并错**焊进命名；中文「恐 X」（恐人 / 恐鱼）同构。**The Warren ＝整窝的名**（非个体·个体＝恐鱼）。
- **双重误分类（potato 核心）**：民间与学究都按**人形剪影**把头足 ＋ 人版并成「恐人 / 水鬼」（错——头足根本不是寄生的）；又都因**鱼不像人**把 恐鱼 单拎出去（错——鱼版才是人版真正的寄生近亲）。**该并的拆了、该拆的并了。** 头足最初被认成这玩意儿，正因暗处一瞥人形剪影像——**名字的第一个例子本身就是误分类**。

### 16.3 Ch2 人类版（方向 · 生物派主区氛围）
- Ch2 出现**人类版**：以类似「水鬼」的方式登场，**也在水里**；宿主人**用非人的方式使唤自己的四肢**（身体被一个不懂人类怎么动的东西驱动）＝ body-horror，服务 Ch2「恐怖 ＋ 恶意 ＋ 恶心」的定调。
- 背后是**与鱼版趋同、但不同种**的寄生虫（寄生虫 A）——**宿主专一·两条互不感染**（鱼那只不感染人）。

### 16.4 护栏（别塌）
- **各寄生虫生物学独立·趋同·不给共同来源**（别都算古文明造的）——一旦共源，potato 主题塌、canon 过度绑死。伞只在**认知层**归类，不在**成因层**。
- **寄生虫无智·纯生物**（Sacculina 那种·没意图、只有繁殖驱动）——守住「无智生物恐怖」，别滑进头足那种「有智悲剧」（原尸衣者·现 水鬼/恐人）地盘。
- **揭示克制**：别在台面摆分类学·留 dread（承揭示锁章纪律）。「水鬼不是鬼、是被寄生」是**科考队解剖才有的揭示拍点**——学究命名 Radicula（＝解剖学「神经根」）时，并不知道自己命名的正是「钻进神经根的东西」。

### 16.5 与既有 canon 的接缝 + 待办（⚠ 术语门重构·别顺手改）
- **§2b/§2c 的 origin 作废**（见该两节抬头指针）；种姓 / morph / 形态 / 机制**全留**。
- **§5 深化**：女王＝被寄生虫掏空的宿主（比「被巢剥夺」更彻底）。**§15 兼容**：feed＝宿主替寄生虫献祭 / 育幼（Sacculina 行为）。
- **✅「尸衣者」→水鬼 rename 已完成（本 session · #271 · 作者拍「替换」）**：code id `corpse_wearer`→`horror_sapien`（file `corpse-wearer.ts`→`horror-sapien.ts`·敌人库 / combat / 类型 / scenario / dev 面板 / baseline 全改·稳定 code 身份取自学名 Horror sapiens）；显示名 尸衣者→**水鬼**（默认·场景名 怪尸 / 似曾相识的尸体… 后续按景填）；英文 **the Living Drowned**；`check-terminology` 门 BANNED 改成「穿尸 / 尸衣者→水鬼」。sandbox regress **95/95 全绿**·SAVE 未 bump（敌人 id 不入档·`CombatState` 不序列化）。**仅剩 docs/spec 散文 term sweep**（门不扫 docs·非阻塞·收尾中）；QUIRKS/STATUS 走收尾（append-only + 新 quirk）。
- 本节暂落 boss SPEC；术语重构时再决定是否迁进 古文明 / story canon 主文。
