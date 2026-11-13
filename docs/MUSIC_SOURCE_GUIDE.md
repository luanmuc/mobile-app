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
| `actions` | 提供的接口：`musicUrl`（取播放链接）、`lyric`（歌词）、`pic`（封面）、`health`（健康快照，v4.0 起）、`toggle`/`probe`（单源开关/整轮手动探测，v4.0 起；全局探测 App 先确认再应用）、`probeSource`（单源探测，默认只读；用户确认后可 `apply:true` 落账，v8.14 起）、`reportPlayback`（App 真实播放回传，v8.14 起）、`config`（配置热更新）、`trend`（健康趋势，v8.0 起）、`healthEvents`（只读事件环形缓冲，2.4 方案）、`exportHealthState`/`restoreHealthState`（健康持久化，v8.13.0 起） |
| `qualitys` | 该源支持的音质列表（映射到 App 的 `FULL_QUALITYS_LIST`） |
| `onScriptAction` | 处理 App 请求，返回 Promise 结果 |

脚本内可调用 App 提供的 `request`（HTTP 请求，带 UA/防爬头）、`logInfo` 等能力。

**action 权威表（P0 / Source Contract v2）**：App 侧唯一权威列表是 `src/core/init/userApi/sourceContract.ts` 的 `SOURCE_ACTIONS`（11 个）。`user-api-preload.js` 不再按 source 维护 `supportActions` 白名单，而是直接透传源脚本声明的 `actions`；App 在 `normalizeSourceInfo` 中过滤未知 action、非法音质和非 `music` 源。新增 action 的最小改动变为：源脚本 `inited` 声明 1 处 + App `sourceContract.ts` 列表 1 处 + App `index.ts` handler 1 处 + **preload `handleRequest` 对应 case 1 处**（否则结果到 App 会是 `undefined`）。

**降级所有权（P1）**：源可在 `inited.sources[source].fallbackOwner` 声明 `"host"`（默认，App 负责换源）或 `"source"`（源内部已换源，App 不再启动自己的换源）。bundled 聚合源 5 个平台均声明 `"source"`；未声明的第三方源缺省为 `"host"`，行为与 P0 前一致。App 只把该值用于 `handleGetOnlineMusicUrl` 的 URL 换源 gate；歌词/封面/local 路径不受影响。

**结果契约（P0）**：`unwrapSourceResult` 同时接受旧 raw 与 v2 envelope。v2 成功返回 `{ok:true,data}`，失败返回 `{ok:false,error:{code,message,retryable?,stage?}}`；失败码固定 8 个：`NO_MATCH` / `NOT_AUDIO` / `NETWORK` / `TIMEOUT` / `RATE_LIMITED` / `INVALID_REQUEST` / `UNSUPPORTED_ACTION` / `INTERNAL`。`retryable` 缺省按 code 派生：`NETWORK` / `TIMEOUT` / `RATE_LIMITED` 为 true，其余为 false。旧音源不需要改。

**musicUrl 返回契约（v6.0+ / b52+ 起）**——支持三态：

| 返回形态 | 说明 |
|---|---|
| `string`（URL） | 旧音源裸链接，子源未知（播放页只显示平台名） |
| `{url, type}` | 携带实际交付音质（v1.0+），子源未知 |
| `{url, type, subSource, subSourceName, sourcePlatform}` | **v8.12.0 推荐**：再携带实际交付平台（`tx`/`wy`/`kw`），播放页显示「实际平台 · 子源名」（如「企鹅音乐 · Juhe聚合(tx)」）；旧音源无该字段时回退主平台 |
| `{url, type, subSource, subSourceName}` | v6.0+ 兼容：只带子源，播放页显示「主平台 · 子源名」 |

**透传链路（b72/b73 修复后全链路打通）**：
`音源脚本 getUrlWithFallback 返回 → VM 桥 user-api-preload.js handleRequest.musicUrl（b72 起透传 subSource/subSourceName；v8.12.0 起透传 sourcePlatform）→ apis[source].getMusicUrl（init/userApi）→ handleGetOnlineMusicUrl 解构 → online.ts 构造 {id, name, platform} → player.ts onSource → setPlaySource → PlayInfo 渲染`
> 历史教训：preload（APK 资产）与 `core/music/index.ts` 路由层都曾丢字段（b72/b73 两轮根因修复），改动透传链必须回归验证（音源 v7.0 已固化子源透出回归用例，冒烟覆盖 10+ 处 subSource 断言）。

App 侧入口：`src/core/init/userApi/index.ts`；原生 QuickJS 引擎：`android/app/src/main/java/cn/toside/music/mobile/userApi/`。

## 四、聚合源内部结构（豆包定制 v8.13.0）

> 每次构建自动拉取音源仓库 master 最新版，以下为当前结构；随音源迭代会更新。
> **产物状态**：v8.13.0 目前只在源仓工作区；最近发布 b115 仍内置 v8.12.5，尚未重建带 v8.13.0 的 APK。
>
> **P3（v8.13.0，2026-11-13）**：Redis 无关的宿主侧健康持久化。源侧只暴露 `exportHealthState`/`restoreHealthState`（schema v1、源版本 8.13.0、7 天 TTL、256KB、禁止 `url/successUrl/cache/name/singer/account/cookie/token/headers/body` 等键），只恢复 `breaker/byQuality/playDead/qualityShortCircuit`，**不恢复** `successCache/failCache/fragmentUrlMap/qualityCeilingMap`；App 新增 `src/core/sourceHealthPersistence.ts`：健康快照是全局元数据，统一写入单一 canonical key `@___SOURCE_HEALTH___global`，不再按平台复制 5 份；旧平台键 `kw/wy/tx/mg/kg` 仅在首次读取时迁移并清理。`getMusicUrl/getHealth` 首个请求前等待 restore，`getHealth` 成功后异步 save，失败只降级不阻断播放。跨平台目标收敛为 `tx→wy→kw`；mg/kg 保留直连，但 `suyinKuwo` 实际交付酷我 CDN 时 `sourcePlatform` 回填 `kw`。源仓 `aa-p3-persist` 6/0、`u-cross-platform` 15/15（U15 先红后绿）；App `check_source_health_persistence` 13/0（canonical key A12/A13、存储异常 A10、五平台并发 A11、G5 动态源/版本 G5-A1）。G5 已关闭：不再维护 12 个 provider 固定名单，`sourceVersion` 取源快照自带值，宿主只校验源 ID 形态；增源/升版不再需要改 App 常量。
>
> **注**：`v8.13.0` 为音源本体当前版本（2026-11-12 源完全体基线 + 2026-11-13 P3 持久化/矩阵）。此前 `v8.12.5`（2026-11-12 死代码清理：删除未被任何路径调用的 `getFailCached` 包装与 `safeConsole.error`，运行行为不变；源仓 25 个测试入口全量回归（核心 19 + 压测 3 + 专项 3））｜v8.12.4（P2 负向归因：缺片返回 `TRUNCATED_MEDIA`、`byteLength`/base64 不符返回 `BAD_ENVELOPE`，probe/admit 均保留错误码；`x-media-envelope` X1~X12 先红后绿）｜v8.12.3（P2 桥媒体信封：App 对声明 `inited.mediaEnvelope=2` 的脚本，把 binary 响应改为 `{__lxMedia:2,encoding:"base64",byteLength}`，>256KB 按 256KB 分片；源侧 `toBytes` 识别信封并按片独立解码，`byteLength` 不符返回 null；`x-media-envelope` X1~X8 先红后绿）｜v8.12.2（P1 降级所有权：5 个平台显式声明 `fallbackOwner="source"`，App 对声明源不再重复换源；v8.12.1 跨平台缓存失效 + 面板开关：`toggleSource` 关闭/开启子源时清 10min 跨平台结果缓存、成功缓存命中若来源已被手动关闭则丢弃重解析、`crossPlatformEnabled` 总开关已暴露到 App 配置面板、`u-cross-platform` 10 条；v8.12.0 跨平台兜底：主平台 `NOT_FOUND`/同名错歌/网络超时时按 `tx→wy→kw` 换平台，严格歌名归一 + 歌手分词 + 时长 ±5s，命中后用目标平台自己的 songmid/id/rid 走目标源链；确定性失败立即回退、`NETWORK_TIMEOUT` 等 6s grace；10min 跨平台缓存 + `cross_platform` 事件；`juheTx` 默认开启。跨平台 3 个配置键中，`crossPlatformEnabled` 已暴露到 App 配置面板（默认 true）；`crossPlatformGraceMs`/`crossPlatformSearchTimeoutMs` 仍只读（面板不可写））。此前的 `v8.11.7`（2026-11-10 健康面板配置可管：`config` 写模式开放 8 个布尔开关并严格校验类型，数字白名单补齐高音质缓存/验真/竞速批/冷启动/档位短路共 13 键，`verifyDurRatio`/`verifyDurGapSec` 允许 0；`e-extra` 94 条）。此前的 `v8.11.6`（2026-11-10 收尾加固：`buildSourceChain` 过滤改用无副作用 `structuralSkipReason`、`toggleSource` 开/关都清账、`fallbackRace` 改 `attempts+admit`（交付类码优先）、`probeByHeaders` HEAD 补证；`r-admission` 23 条）。此前的 `v8.11.5`（2026-11-10 **L4 裁决层落地**：把散在六处的「判定 + 记账」收成 `admit()` 单一入口 + `ADMISSION_POLICY` 策略表 + 三个调用点；新增 L0 归一层 `toBytes`/`kindOf`/`headerEvidence`，修 App 桥 `JSON.stringify(Buffer)` 导致的全源 `NOT_AUDIO`；代表码改为交付类优先，`NOT_AUDIO` 不再被 `NOT_FOUND` 吞成 1h 歌级锁；`clearSourceLedger` 统一清账治「关源/重开无效」；弱证据 TTL 一律 ≤60s；`r-admission` 18 条先红后绿）。此前的 `v8.11.4` 为 2026-11-10 云端真测 F-01 **错歌兜底修复**：`xinghaiBackend` 缺 `songmid` 时旧实现兜底成 1 号歌（该源只按 mid 出链、歌名不参与校验）→ 必交付别人的音频；片段兜底（B 方案）又只判「是不是 5 秒音频」不判「是不是这首歌」，不存在的歌会被标成「试听版」交付。现改为缺 id 直接 `PARAM_ERROR`，且 B 方案以「有 hash/mid 锚点」为前提，无锚点报错不猜歌；`q-dfix` Q5 先红后绿）。此前的 `v8.11.3`（源开关失败缓存失效：`toggle` 开启某源时按该源 `platforms` 前缀清 `fail_<平台>` 失败缓存，旧实现只重置熔断/探测状态、开启后仍命中「歌不存在 1h」；`v8.11.2` 通读缺陷修复：Juhe `code` 字符串/数字归一、303 重定向校验宽松比、`flac24bit` 起跑补齐 320k 档、`CONFIG_ERROR` 失败缓存按 5 分钟过期；`v8.11.1` **交付真实性闸门**：交付前 1KB 字节验真、标签按实交付音质回填、128k 保底、片段标「试听版」不缓存；`v8.11.1` 另修非法协议误报 `LINK_EXPIRED`、同歌同档并发合并、星海备按映射表过滤平台、审计脚本接入 CI）。此前巡检脚本侧迭代（`v8.10.5`~`v8.10.11`）已并入本版基线；`gdWy` 已于音源仓 `39a0fa8` 默认关闭。

当前内置聚合源含多个后端，按需路由与降级：

- 后端：溯音（酷我 / 咪咕 verified、163、QQ）/ 星海后端 / 酷我官方 / 长青 / 念心 / helloworld(kw 备用) / 网易云 outer / GDAPI / Juhe 聚合（kw/tx/wy/kg/mg）/ ikun / 灰灰 / 聆川 等
- 特性：音质校验（探测歌曲实际可用音质）、双音质分域探测、探测歌曲池轮换、失败兜底降级、URL 有效期处理、健康探测自愈（休眠/自动关闭/复活）、子源透出（v6.0+）、沙箱兼容（v6.0）、试听片段检测（v8.0：helloworld 等源若返回酷我 VIP 5 秒试听链接（URL 含 preview/test/sample/试听/片段等关键词）自动判失败换源，且该源降为低优先级备用）；ikun 源复活（v8.1：域名 c.wwwweb.top + POST /music/url + 公益版免卡密，默认关闭开启即用）；ikun 探针与 POST 探测修复（v8.2：手动开启后自动监控健康，tier=secondary 每3轮一探；修复探测包装漏透传 method/body）；ikun 默认开启（v8.3：公益版免卡密，kw 链尾兜底 + 探测自动托管）；全源全接口深度巡检修复（v8.4：suyinKuwo 128k br=9 修正、xinghaiBackend 匿名调用适配，可用源 15→21/35）；巡检工具与监控口径升级（v8.5：新增 scripts/source-audit.js 源级取链巡检 + docs/SOURCE_AUDIT.md 基线，probe 端点巡检加取链可播二次校验治理假阳性）；huibq 默认开启（v8.6：A 方案——全平台全音质实测可用，进 kw/wy/tx/mg/kg 五平台链尾兜底，探针自动托管）；huibq 假成功治理（v8.7：上游「无法获取播放链接」仍返回 code=0 + 可播错链，按 msg 失败词判失败避免播错歌）；竞速引擎改造（v8.8：全链分批错峰并发替代"竞速3+串行rest"（kw 128k 最坏 31s→≤10.5s）、跨音质档共享 12s 总预算、档位短路（历史 0 成功的档跳过 + 每 6h 放行探路）、冷启动源预热与 8s 超时（huibq onrender）、gdWy 配额源降后批、verified 精确等待（无 verified 在飞立即交付））；v8.9 收尾修复：huibq 平台能力收窄——实测仅 kw/wy 可用（tx/mg/kg 返回「无法获取播放链接」必败），已按 handler `platforms` 声明移出三平台链尾，不再白耗 1~1.5s；档位短路判据拆分——排除 businessFail（404 无版权不误伤源该档），保留 linkExpired（410 VIP 死链仍短路）；巡检脚本支持 --strict 退出码；v8.10 分档预算与缓存分级：分档预算 flac6s/320k4s/128k4s + 末档保底 3s（防高音质吃满总预算饿死低档致点歌无声）；冷启动源探针超时放宽到 30s + 豁免自动关闭（onrender 冷态 30s 不再被 20min 误摘）；短路探路窗口 6h→1h；高音质缓存分级 TTL——flac/320k 30min（原 6h 链接已死仍返回死链），128k 保持 6h；历史快照 60→144（趋势图跨天不断）；v8.10.1 补修：缓存 LRU 缺 delete 方法（高音质缓存超 30min 重播必抛 TypeError），冒烟 T46/T47/T48 由空壳断言改为真行为验证；v8.10.2 记账顺序修复：`validateUrl` 与 `recordSuccess` 顺序倒置会让「URL 非法」既记成功又记业务失败（双记账），改为先验证后记账，并补齐半开试探的收口（业务失败/本地节流也要 half-open→open，否则该源永久不被调用）；v8.10.3 全覆盖审计 15 项修复：冷启动源探针的 `cfg` 形参遮蔽全局函数致 huibq 探针 100% TypeError、429 不再计入成功率分母、降档交付按实际音质入缓存槽、失败缓存还原代表性 code、平台分组改由竞速链生成、探针通过一并复位断路器与限流退避、末端预算显式钳在总预算+保底、`validateUrl` 返回 trim 后 URL、单档预算 4s→5s 对齐、删死键 `raceOverallTimeoutMs`（面板改暴露真键 `raceBudgetMs`）、假成功判据单点化、lingchuan 补 `platforms` 声明、A19 快照备注 20→144、冒烟补 T50–T55 共 55 组
- 音质优先级：`flac24bit → flac → wav → ape → 320k → 192k → 128k`（与 App 端 `core/music/utils.ts` 的 `FULL_QUALITYS_LIST` 对齐）

## 四b、音源健康面板与健康分（App 侧语义）

**数据流**：音源脚本（backend-api v4.0 起）注册 `health` action → 返回 `getHealthSnapshot()` 全源快照 → App 设置页「音源健康」子页（`src/screens/Home/Views/Setting/settings/Health.tsx`）消费展示，可刷新/单源开关/手动探测。

**v8.14 探测语义（2026-11-13）**：

- 全局「手动探测」保留整轮 `runHealthCheck` 并应用结果，但 App 先弹确认，文案明确“通过可能解除自动关闭、失败可能触发自动关闭”；用户取消则不发起探测。
- 行内单源探测仍是 `probeSource` 默认 `apply:false` 只读；结果返回后再弹确认，确认才 `apply:true` 落账。
- 快照新增 `qualityShortCircuit: {128k,320k,flac,flac24bit}` 只读布尔；健康页行内在源名下方显示“档位短路：FLAC/320K”，不再只把短路藏在链构建内部。
- 链项携带 `eligibility`；`wrapExecute` 发请求前重取一次结构资格，建链后用户关源/自动关闭/休眠/摘除的旧链项会被拦截。

**本地诊断闭环（2.4 方案，只本地不上传）**：

- 音源侧新增只读 `healthEvents` action：容量 500 的环形缓冲，返回 `{schema, capacity, dropped, events}`；事件只含 `traceId/event/sourceId/platform/quality/ok/code/latencyMs/reason`，不记歌名、URL、搜索词、账号、设备 ID、位置。
- **action 透传（P0 起）**：`user-api-preload.js` 不再维护按 source 的 `supportActions` 白名单，直接把源脚本声明的 `actions` 透传给 App；App 的 `normalizeSourceInfo` 只保留 `sourceContract.ts` 中 13 个合法 action（含 `probeSource/reportPlayback/exportHealthState/restoreHealthState`），未知 action 不注册。契约 H10 看护。preload 同时透传 `fallbackOwner`，缺省由 `normalizeFallbackOwner` 归为 `host`。
- App 侧一次播放生成一个 `traceId`，经 `online.ts → music/utils.ts → init/userApi/index.ts → 5 个 musicSdk/*/index.js` 透传到 `musicUrl.info.traceId`；换源候选复用同一 `traceId`。
- 本地日志：`source_health_YYYYMMDD.jsonl` 按天滚动，失败 100% 记、成功 1/5 采样；缓存命中单独记 `cache_hit`，只说明本地已有 URL，不计入取链成功率；单文件 2MB 封顶保留尾部；保留 7 天；失败时抓同 `traceId` 的源事件一起落盘。报告里的成功率按采样权重还原（成功 weight=5、失败 weight=1），是本地估算而非服务端真值。
  面板表格的「源内成功率」来自音源快照，和「本地诊断」的播放成功率不是同一口径；前者看源自身探测，后者看 App 实际取链。
- 健康页「最近异常」默认折叠，点标题展开为四层：数据可信度（覆盖时长/是否截断）、近 24h 总体（取链/成功/失败/本地成功率）、错误码、其他线索；展开后仍展示异常规则（本地 0% 但快照健康、成功率跌 20pp、P95 翻倍、新错误码（仅在有前 24h 基线时判定）、最近 4 次快照成功率连续下降且累计 ≥15pp）；页面顶部趋势预警与报告共用同一条 `trend_decline` finding，不再维护第二套健康分阈值；同一错误码不会同时以“新错误码”和“近期失败”重复出现；窗口覆盖不足时标记 `covered=false` 并提示实际覆盖时长，7 天结论仅供参考。诊断聚合按取链（`source_result`）/ 播放（`play_result`）/ 探测（`probe_result`）三块独立算成功率，`windows` 只代表取链；报告同时给出 `playWindows/probeWindows`，缓存命中单独计数。

「导出诊断包」生成 `schema:2` 证据包：`manifest + report + events + snapshot + trend + logTail`；manifest 记录版本/计数/上限/截断标记/估算字节，事件最近 1000 条、趋势最近 200 条、日志尾部 UTF-8 64KB、总量 2MB 上限；快照与日志均递归脱敏 URL/歌名，手动分享/失败回退复制摘要，不自动上传、不自动关源。

**健康分语义（v1.9.2-b5 起，配套音源 v7.0）**：

| 项 | 值 |
|---|---|
| 量纲 | **0~10 分制**（一位小数，如 8.5）；内部评分 0~1 不变，快照输出 ×10 换算 |
| 颜色阈值 | **≥3 绿 / ≥−5 默认（黑） / <−5 红** |
| 负分 | 保留（严重异常源可为负）——配合 `closed 且成功率 0% 且健康分<0` → 状态显示「异常」红（v-b45 语义） |
| 无样本 | 显示 `-`（音源侧 successRate/avgTime 返回 null，v4.0 语义） |

**快照附加字段（v26.1 / v17.2 起）**：源条目除 `score`/`successRate`/`closed` 外还提供 `playDead`（播放死链标记）、`rateLimited`（连续多次 429 标记）与 `rateLimitActive`（当前仍在 429 退避期内）；App 的 `HealthItem` 已补这三个可选字段并在状态列展示，缺字段时按正常处理。`rateLimitActive` 一次 429 即可为真，`rateLimited` 需要连续多次被拒，两者不合并。

**面板分区排序（音源 v6.0 起）**：使用中 → 正常 → 待采样 → 休眠 → 已关（按 `lastUsedAt` 真实播放记录分组）。

> 评分公式与口径（成功率置信度收缩 / 均时惩罚 / 连败惩罚 / 版权失败不惩罚）见 [backend-api DEV_GUIDE §3.4b](https://github.com/luanmuc/backend-api/blob/master/docs/DEV_GUIDE.md)。

## 四c、音源配置面板（运行参数）

**入口**：设置 → 音源健康 → 「配置」按钮。面板只渲染音源 `config` 读模式实际返回的键；卡密（`ikunApiKey` / `lingchuanApiKey` / `xinghaiDeviceId`）和对象键 `raceBudgetPerQuality` 不渲染。

**持久化链路（v8.12.1）**：

1. 面板读取 `config` action 返回的当前值，按 `CONFIG_UNIT_CONFIG` 把 ms 自动换算成小时/分钟/秒/毫秒等直观单位。
2. 点「保存」先用 `buildConfigUpdates` 对 28 个数字键 + 9 个布尔键**全量校验**；任一项非法则整次不提交，弹窗内逐项红字提示，不会出现“填错了却提示已保存”。
3. 校验通过后调用 `config` 写模式，再 `saveData('lx_source_config')` 写入本地存储。
4. App 下次启动时 `filterConfigForInjection` 只注入音源契约内的合法键（布尔必须真布尔、数字必须非负且在上限内、0 只允许 `verifyDurRatio` / `verifyDurGapSec`），再写入 `__lxSourceConfig`；旧死键、错误类型、超限值一律丢弃。

**唯一契约源**：`src/core/sourceConfig.ts`。健康面板、启动注入、保存校验都从这里读键表/默认值/上下限，不再各自维护白名单；新增音源配置键只改这一处。

### 数字参数（28 项）

| 键 | 名称 | 单位 | 默认 | 允许范围 |
|---|---|---|---|---|
| `cacheTtlMs` | 成功缓存有效期 | 小时 | 6小时 | — ~ 168小时 |
| `cacheTtlHighQualityMs` | 高音质缓存有效期 | 分钟 | 30分钟 | — ~ 10080分钟 |
| `failCacheNotFoundMs` | 404 失败缓存 | 分钟 | 60分钟 | — ~ 1440分钟 |
| `failCacheExpiredMs` | 过期/死链失败缓存 | 秒 | 60秒 | — ~ 3600秒 |
| `breakerThreshold` | 熔断阈值 | 次 | 3次 | — ~ 20次 |
| `breakerCooldownMs` | 熔断冷却时间 | 分钟 | 3分钟 | — ~ 30分钟 |
| `rateLimitBackoffMs` | 限速退避时间 | 秒 | 30秒 | — ~ 300秒 |
| `maxConcurrency` | 单源最大并发 | 个 | 2个 | — ~ 5个 |
| `rateWindowMs` | 限速窗口 | 秒 | 3秒 | — ~ 10秒 |
| `rateWindowMax` | 限速窗口最大请求数 | 次 | 5次 | — ~ 20次 |
| `healthCheckIntervalMs` | 健康探测间隔 | 分钟 | 10分钟 | 1分钟 ~ — |
| `raceBudgetMs` | 竞速总预算 | 秒 | 12秒 | — ~ 15秒 |
| `raceBudgetFloorMs` | 末档保底预算 | 秒 | 3秒 | — ~ 15秒 |
| `raceBatchSize` | 每批并发源数 | 个 | 3个 | — ~ 10个 |
| `raceBatchStaggerMs` | 批间错峰间隔 | 毫秒 | 300毫秒 | — ~ 2000毫秒 |
| `raceMatchWaitMs` | 竞速匹配等待 | 秒 | 0.6秒 | — ~ 5秒 |
| `coldStartTimeoutMs` | 冷启动源单源超时 | 秒 | 8秒 | — ~ 30秒 |
| `coldStartProbeTimeoutMs` | 冷启动源探测超时 | 秒 | 30秒 | — ~ 60秒 |
| `coldStartWarmTtlMs` | 冷启动预热间隔 | 分钟 | 5分钟 | — ~ 60分钟 |
| `qualityShortCircuitSamples` | 档位短路样本门槛 | 次 | 3次 | — ~ 20次 |
| `qualityShortCircuitProbeMs` | 档位短路放行探路间隔 | 分钟 | 60分钟 | — ~ 1440分钟 |
| `verifyTimeoutMs` | 交付验真超时 | 毫秒 | 3000毫秒 | 500毫秒 ~ 10000毫秒 |
| `verifyMinOriginalSec` | 验真最短原曲时长 | 秒 | 90秒 | — ~ 3600秒 |
| `verifyDurRatio` | 验真时长比例阈值 | 倍 | 0.6倍 | — ~ 1倍（0 合法，表示关闭比例判定） |
| `verifyDurGapSec` | 验真时长差阈值 | 秒 | 15秒 | — ~ 300秒（0 合法，表示关闭差值判定） |
| `allFailShortTtlMs` | 全失败短缓存 | 分钟 | 0.5分钟 | — ~ 10分钟 |
| `playDeadReviveMs` | 已摘除源复活试探 | 分钟 | 5分钟 | — ~ 120分钟 |
| `memoryMapMax` | 记忆表条目上限 | 条 | 2000条 | 1条 ~ 20000条 |

> 预设值也受同一张上下限表约束：`raceBatchStaggerMs` 的旧 `0` 预设和 `allFailShortTtlMs` 的旧 `15 分钟`预设已删除，因为它们在音源侧存不进去。

### 布尔开关（9 项）

| 键 | 名称 | 默认 |
|---|---|---|
| `verifyDelivery` | 交付前验真 | true |
| `truthfulQuality` | 音质标签回填真话 | true |
| `qualityFloor` | 128K 保底 | true |
| `verifyOnCacheHit` | 缓存命中再验真 | true |
| `previewUrlPreFilter` | 试听 URL 预筛 | false |
| `fragmentFallback` | 全档片段兜底 | true |
| `qualityShortCircuit` | 档位短路 | true |
| `coldStartWarmEnabled` | 冷启动预热 | true |
| `crossPlatformEnabled` | 跨平台兜底总开关 | true |

### 11 态与 9 桶（表格与摘要同口径，v8.14 起 4 主状态 + reason）

状态判定优先级：**手动关闭 → 探测自动关闭 → 休眠/默认关闭 → 待采样 → 已摘除 → 异常 → 限流 → 熔断/半开/正常**。手动关闭与自动关闭不再共用“已关闭”，App 分别显示“已关闭·手动 / 已关闭·自动”，避免把系统判定误读成用户操作。旧 11 态不删除，信息降为 `offReason`/明细保留。摘要固定 9 桶，每个源只落一桶，合计等于音源数。

### 质量档矩阵（F16）

表格“音质”列可展开，按 128k / 320k / flac / flac24bit 四档分别显示请求数、成功、失败、业务失败、平均耗时、档位熔断/半开/限流。无样本档显示 0 次并标记无样本，不把“未请求”误读成“0% 失败”；档位熔断只影响该档，源级成功率不再平均掩盖单档故障。

| 状态 | 含义 | 摘要桶 |
|---|---|---|
| 已关闭·手动 | 用户手动关闭；`manualOff` 永久锁定，不竞速、不探测，只能由用户再打开 | `off` |
| 已关闭·自动 | 探测连续失败自动关闭；不竞速，但**保留恢复探测**，探测通过自动开启；真实播放成功也可提前解除 | `off` |
| 休眠中 | 健康探测连续失败 3 轮，暂停探测、每 10 轮复活试探 | `sleep` |
| 待采样 | 已启用但没有任何成功/失败/探测样本；不知道好坏，不是坏源 | `idle` |
| 异常 | 断路器闭合但成功率 0% 且健康分 <0，看着正常实际上游不可用 | `bad` |
| 已摘除 | App 回传的真实播放连续失败 3 次，从竞速链摘出；默认约 5 分钟后只放一个半开试探请求，成功才复活，失败重新计时 | `removed` |
| 限流中 | 正在 429 退避期，当前不参与竞速，退避结束自恢复 | `rate` |
| 被限流 | 连续多次 429，上游明显在限，比“限流中”更重 | `rate` |
| 熔断 | 某源某音质档连续失败达阈值，冷却期不接请求 | `open` |
| 半开 | 冷却后的试水态，只放一个请求；成功转正常，失败回熔断 | `half` |
| 正常 | 已启用且有样本，断路器闭合，可参与竞速 | `ok` |
| 使用中 | 最近 10 分钟有真实播放请求，排序置顶；仍归入其健康状态对应的桶 | 随状态 |

## 五、如何测试音源

1. **本地替换**：手动用最新脚本覆盖 `assets/builtin_source.js`，`npm run dev` 跑 debug 包
2. **看日志**：设置 → 开启调试日志；或 `adb logcat | grep -i userApi`
3. **验证项**：搜索正常？播放返回的 URL 能播？音质降级链正确？歌词/封面正常？
4. **发布**：推到 `luanmuc/backend-api`，下次云编译自动带入

## 六、音源相关 FAQ

- **为什么音源不放在本仓库**：音源迭代频繁、与 App 发版解耦；App 每次构建自动拉最新，音源修复当天即可随新构建生效
- **为什么 App 里有多份「豆包定制」**：历史 bug 曾导致重复导入，当前版本启动时会自动清理旧的多余源
- **某首歌没音质可选**：聚合源对该歌探测到的实际音质有限，属正常；选择更低的音质即可
