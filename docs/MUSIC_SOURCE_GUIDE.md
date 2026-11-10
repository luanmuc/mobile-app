# 内置音源指南（MUSIC SOURCE GUIDE）

本仓库的音源体系 = **官方平台 SDK（内置 7 个：kw/kg/mg/tx/wy/bd/xm）+ 自定义源（QuickJS 脚本）**。定制版的核心差异在于内置了「豆包定制」聚合音源。

## 一、音源架构

```
musicSdk（内置官方源）  ──┐
  kw/kg/mg/tx/wy/bd/xm  │  统一接口：getMusicUrl / getLyric / getPic
                         ├─→  apis 对象（global.lx.apis）
自定义源（QuickJS 脚本）──┘   qualitys（global.lx.qualityList）
  assets/builtin_source.js   ↑   （构建时自动生成，见下）
  （豆包定制聚合源）        core/music/* 通过 apis 调用，不区分来源
```

- **官方源**：`src/utils/musicSdk/{kw,kg,mg,tx,wy,bd,xm}/`，直接请求平台公开接口，随上游更新
- **自定义源**：JS 脚本在 QuickJS 线程执行（`android/.../userApi/`），与 RN 通过 `onScriptAction/sendAction` 双向通信
- **聚合源**：内置 `assets/builtin_source.js`（**由每次构建从 `luanmuc/backend-api` 拉取最新生成，本仓库不内置副本**）= 「豆包定制[聚合音源]」，由**独立仓库** `luanmuc/backend-api` 维护

## 二、内置音源的发布链路（重要）

1. **CI 拉取**：`.github/workflows/release.yml` 每次构建时，通过 GitHub Contents API（`?ref=master`）从 `luanmuc/backend-api` 拉取最新脚本 → **生成** `assets/builtin_source.js`（本仓库**不内置音源副本**，该文件由每次构建自动创建；仓库内若删除/不存在也由构建重建）
2. **校验**：文件 >50KB 且包含 `@name` 声明才通过，防止拉取到损坏文件；拉取失败（curl 非 0）即构建中断，不会出无音源的包
3. **启动导入**：App 启动时 `core/init/userApi/index.ts` 读取内置脚本，与已导入版本比对（正则提取 `聚合音源 vX.Y`），版本更新则自动导入/替换，并清理旧版（含历史 bug 残留的多份「豆包定制」源）
4. **运行时**：音源脚本在 QuickJS 中运行，向 App 注册 `musicUrl/lyric/pic` 等 actions，App 侧统一调用

> ⚠️ **本仓库不再内置 `assets/builtin_source.js` 静态副本**（v1.9.1-b74 起移除）：它由每次构建自动生成并覆盖。改音源请到 [luanmuc/backend-api](https://github.com/luanmuc/backend-api)；本地调试可用最新脚本手动放置同名文件。

## 三、自定义源脚本契约（QuickJS）

音源脚本需要声明：

| 声明 | 说明 |
|---|---|
| `name` | 音源名称（含「豆包定制」会被内置导入逻辑识别/清理） |
| `version` | 版本号（`vX.Y` 格式，用于启动时版本比对） |
| `actions` | 提供的接口：`musicUrl`（取播放链接）、`lyric`（歌词）、`pic`（封面）、`health`（健康快照，v4.0 起）、`toggle`/`probe`（单源开关/手动探测，v4.0 起）、`config`（配置热更新）、`trend`（健康趋势，v8.0 起） |
| `qualitys` | 该源支持的音质列表（映射到 App 的 `FULL_QUALITYS_LIST`） |
| `onScriptAction` | 处理 App 请求，返回 Promise 结果 |

脚本内可调用 App 提供的 `request`（HTTP 请求，带 UA/防爬头）、`logInfo` 等能力。

**musicUrl 返回契约（v6.0+ / b52+ 起）**——支持三态：

| 返回形态 | 说明 |
|---|---|
| `string`（URL） | 旧音源裸链接，子源未知（播放页只显示平台名） |
| `{url, type}` | 携带实际交付音质（v1.0+），子源未知 |
| `{url, type, subSource, subSourceName}` | **推荐**：携带实际交付子源（id + 中文名），播放页显示「平台 · 子源名」（如「酷我音乐 · 溯音酷我」） |

**透传链路（b72/b73 修复后全链路打通）**：
`音源脚本 getUrlWithFallback 返回 → VM 桥 user-api-preload.js handleRequest.musicUrl（b72 起透传 subSource/subSourceName）→ apis[source].getMusicUrl（init/userApi）→ handleGetOnlineMusicUrl 解构 → online.ts 构造 {id, name} → player.ts onSource → setPlaySource → PlayInfo 渲染`
> 历史教训：preload（APK 资产）与 `core/music/index.ts` 路由层都曾丢字段（b72/b73 两轮根因修复），改动透传链必须回归验证（音源 v7.0 已固化子源透出回归用例，冒烟覆盖 10+ 处 subSource 断言）。

App 侧入口：`src/core/init/userApi/index.ts`；原生 QuickJS 引擎：`android/app/src/main/java/cn/toside/music/mobile/userApi/`。

## 四、聚合源内部结构（豆包定制 v8.11.7）

> 每次构建自动拉取音源仓库 master 最新版，以下为当前结构；随音源迭代会更新。
> **注**：`v8.11.7` 为音源本体当前版本（2026-11-10 健康面板配置可管：`config` 写模式开放 8 个布尔开关并严格校验类型，数字白名单补齐高音质缓存/验真/竞速批/冷启动/档位短路共 13 键，`verifyDurRatio`/`verifyDurGapSec` 允许 0；`e-extra` 94 条）。此前的 `v8.11.6`（2026-11-10 收尾加固：`buildSourceChain` 过滤改用无副作用 `structuralSkipReason`、`toggleSource` 开/关都清账、`fallbackRace` 改 `attempts+admit`（交付类码优先）、`probeByHeaders` HEAD 补证；`r-admission` 23 条）。此前的 `v8.11.5`（2026-11-10 **L4 裁决层落地**：把散在六处的「判定 + 记账」收成 `admit()` 单一入口 + `ADMISSION_POLICY` 策略表 + 三个调用点；新增 L0 归一层 `toBytes`/`kindOf`/`headerEvidence`，修 App 桥 `JSON.stringify(Buffer)` 导致的全源 `NOT_AUDIO`；代表码改为交付类优先，`NOT_AUDIO` 不再被 `NOT_FOUND` 吞成 1h 歌级锁；`clearSourceLedger` 统一清账治「关源/重开无效」；弱证据 TTL 一律 ≤60s；`r-admission` 18 条先红后绿）。此前的 `v8.11.4` 为 2026-11-10 云端真测 F-01 **错歌兜底修复**：`xinghaiBackend` 缺 `songmid` 时旧实现兜底成 1 号歌（该源只按 mid 出链、歌名不参与校验）→ 必交付别人的音频；片段兜底（B 方案）又只判「是不是 5 秒音频」不判「是不是这首歌」，不存在的歌会被标成「试听版」交付。现改为缺 id 直接 `PARAM_ERROR`，且 B 方案以「有 hash/mid 锚点」为前提，无锚点报错不猜歌；`q-dfix` Q5 先红后绿）。此前的 `v8.11.3`（源开关失败缓存失效：`toggle` 开启某源时按该源 `platforms` 前缀清 `fail_<平台>` 失败缓存，旧实现只重置熔断/探测状态、开启后仍命中「歌不存在 1h」；`v8.11.2` 通读缺陷修复：Juhe `code` 字符串/数字归一、303 重定向校验宽松比、`flac24bit` 起跑补齐 320k 档、`CONFIG_ERROR` 失败缓存按 5 分钟过期；`v8.11.1` **交付真实性闸门**：交付前 1KB 字节验真、标签按实交付音质回填、128k 保底、片段标「试听版」不缓存；`v8.11.1` 另修非法协议误报 `LINK_EXPIRED`、同歌同档并发合并、星海备按映射表过滤平台、审计脚本接入 CI）。此前巡检脚本侧迭代（`v8.10.5`~`v8.10.11`）已并入本版基线；`gdWy` 已于音源仓 `39a0fa8` 默认关闭。

当前内置聚合源含多个后端，按需路由与降级：

- 后端：溯音（酷我 / 咪咕 verified、163、QQ）/ 星海后端 / 酷我官方 / 长青 / 念心 / helloworld(kw 备用) / 网易云 outer / GDAPI / Juhe 聚合（kw/tx/wy/kg/mg）/ ikun / 灰灰 / 聆川 等
- 特性：音质校验（探测歌曲实际可用音质）、双音质分域探测、探测歌曲池轮换、失败兜底降级、URL 有效期处理、健康探测自愈（休眠/自动关闭/复活）、子源透出（v6.0+）、沙箱兼容（v6.0）、试听片段检测（v8.0：helloworld 等源若返回酷我 VIP 5 秒试听链接（URL 含 preview/test/sample/试听/片段等关键词）自动判失败换源，且该源降为低优先级备用）；ikun 源复活（v8.1：域名 c.wwwweb.top + POST /music/url + 公益版免卡密，默认关闭开启即用）；ikun 探针与 POST 探测修复（v8.2：手动开启后自动监控健康，tier=secondary 每3轮一探；修复探测包装漏透传 method/body）；ikun 默认开启（v8.3：公益版免卡密，kw 链尾兜底 + 探测自动托管）；全源全接口深度巡检修复（v8.4：suyinKuwo 128k br=9 修正、xinghaiBackend 匿名调用适配，可用源 15→21/35）；巡检工具与监控口径升级（v8.5：新增 scripts/source-audit.js 源级取链巡检 + docs/SOURCE_AUDIT.md 基线，probe 端点巡检加取链可播二次校验治理假阳性）；huibq 默认开启（v8.6：A 方案——全平台全音质实测可用，进 kw/wy/tx/mg/kg 五平台链尾兜底，探针自动托管）；huibq 假成功治理（v8.7：上游「无法获取播放链接」仍返回 code=0 + 可播错链，按 msg 失败词判失败避免播错歌）；竞速引擎改造（v8.8：全链分批错峰并发替代"竞速3+串行rest"（kw 128k 最坏 31s→≤10.5s）、跨音质档共享 12s 总预算、档位短路（历史 0 成功的档跳过 + 每 6h 放行探路）、冷启动源预热与 8s 超时（huibq onrender）、gdWy 配额源降后批、verified 精确等待（无 verified 在飞立即交付））；v8.9 收尾修复：huibq 平台能力收窄——实测仅 kw/wy 可用（tx/mg/kg 返回「无法获取播放链接」必败），已按 handler `platforms` 声明移出三平台链尾，不再白耗 1~1.5s；档位短路判据拆分——排除 businessFail（404 无版权不误伤源该档），保留 linkExpired（410 VIP 死链仍短路）；巡检脚本支持 --strict 退出码；v8.10 分档预算与缓存分级：分档预算 flac6s/320k4s/128k4s + 末档保底 3s（防高音质吃满总预算饿死低档致点歌无声）；冷启动源探针超时放宽到 30s + 豁免自动关闭（onrender 冷态 30s 不再被 20min 误摘）；短路探路窗口 6h→1h；高音质缓存分级 TTL——flac/320k 30min（原 6h 链接已死仍返回死链），128k 保持 6h；历史快照 60→144（趋势图跨天不断）；v8.10.1 补修：缓存 LRU 缺 delete 方法（高音质缓存超 30min 重播必抛 TypeError），冒烟 T46/T47/T48 由空壳断言改为真行为验证；v8.10.2 记账顺序修复：`validateUrl` 与 `recordSuccess` 顺序倒置会让「URL 非法」既记成功又记业务失败（双记账），改为先验证后记账，并补齐半开试探的收口（业务失败/本地节流也要 half-open→open，否则该源永久不被调用）；v8.10.3 全覆盖审计 15 项修复：冷启动源探针的 `cfg` 形参遮蔽全局函数致 huibq 探针 100% TypeError、429 不再计入成功率分母、降档交付按实际音质入缓存槽、失败缓存还原代表性 code、平台分组改由竞速链生成、探针通过一并复位断路器与限流退避、末端预算显式钳在总预算+保底、`validateUrl` 返回 trim 后 URL、单档预算 4s→5s 对齐、删死键 `raceOverallTimeoutMs`（面板改暴露真键 `raceBudgetMs`）、假成功判据单点化、lingchuan 补 `platforms` 声明、A19 快照备注 20→144、冒烟补 T50–T55 共 55 组
- 音质优先级：`flac24bit → flac → wav → ape → 320k → 192k → 128k`（与 App 端 `core/music/utils.ts` 的 `FULL_QUALITYS_LIST` 对齐）

## 四b、音源健康面板与健康分（App 侧语义）

**数据流**：音源脚本（backend-api v4.0 起）注册 `health` action → 返回 `getHealthSnapshot()` 全源快照 → App 设置页「音源健康」子页（`src/screens/Home/Views/Setting/settings/Health.tsx`）消费展示，可刷新/单源开关/手动探测。

**健康分语义（v1.9.2-b5 起，配套音源 v7.0）**：

| 项 | 值 |
|---|---|
| 量纲 | **0~10 分制**（一位小数，如 8.5）；内部评分 0~1 不变，快照输出 ×10 换算 |
| 颜色阈值 | **≥3 绿 / ≥−5 默认（黑） / <−5 红** |
| 负分 | 保留（严重异常源可为负）——配合 `closed 且成功率 0% 且健康分<0` → 状态显示「异常」红（v-b45 语义） |
| 无样本 | 显示 `-`（音源侧 successRate/avgTime 返回 null，v4.0 语义） |

**快照附加字段（v26.1 / v17.2 起）**：源条目除 `score`/`successRate`/`closed` 外还提供 `playDead`（播放死链标记）与 `rateLimited`（限流中标记）；App 的 `HealthItem` 已补这两个可选字段并在状态列展示，缺字段时按正常处理。

**面板分区排序（音源 v6.0 起）**：使用中 → 正常 → 待采样 → 休眠 → 已关（按 `lastUsedAt` 真实播放记录分组）。

> 评分公式与口径（成功率置信度收缩 / 均时惩罚 / 连败惩罚 / 版权失败不惩罚）见 [backend-api DEV_GUIDE §3.4b](https://github.com/luanmuc/backend-api/blob/master/docs/DEV_GUIDE.md)。

## 五、如何测试音源

1. **本地替换**：手动用最新脚本覆盖 `assets/builtin_source.js`，`npm run dev` 跑 debug 包
2. **看日志**：设置 → 开启调试日志；或 `adb logcat | grep -i userApi`
3. **验证项**：搜索正常？播放返回的 URL 能播？音质降级链正确？歌词/封面正常？
4. **发布**：推到 `luanmuc/backend-api`，下次云编译自动带入

## 六、音源相关 FAQ

- **为什么音源不放在本仓库**：音源迭代频繁、与 App 发版解耦；App 每次构建自动拉最新，音源修复当天即可随新构建生效
- **为什么 App 里有多份「豆包定制」**：历史 bug 曾导致重复导入，当前版本启动时会自动清理旧的多余源
- **某首歌没音质可选**：聚合源对该歌探测到的实际音质有限，属正常；选择更低的音质即可
