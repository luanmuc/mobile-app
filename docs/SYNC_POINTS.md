# 音源能力 → App 配套同步点总表

> 音源仓库每次迭代（新增 action / 改字段 / 改音质），App 端多个位置要跟着同步。
> 本表用于每次音源发布新版本后**照单检查**，避免"音源改了、App 没跟上"。

---

## 一、同步点总表

| 音源能力项 | App 需同步的位置 | 检查动作 |
|---|---|---|
| **音源 action（14 个）**<br>musicUrl / lyric / pic / health / toggle / probe / probeSource / reportPlayback / config / trend / healthEvents / exportHealthState / restoreHealthState / forceQualityProbe | ① `src/core/init/userApi/index.ts` 的 switch case<br>② `docs/MUSIC_SOURCE_GUIDE.md` 的 action 表 | 数一下音源侧 actions 数量，再数 userApi switch case 数量，再数 MUSIC_SOURCE_GUIDE 表里的数量——三者要一致 |
| **action 透传（P0 起）**<br>`android/app/src/main/assets/script/user-api-preload.js` 直接透传 `userSource.actions`，不再维护 `supportActions` 白名单 | 音源新增 action 只需源侧声明 + App `SOURCE_ACTIONS` 列表 + `index.ts` handler；preload 仍需有对应 `case` 才能分发 | `grep -n "healthEvents" android/app/src/main/assets/script/user-api-preload.js`；`node scripts/check_source_contract.js`；`node scripts/check_health_diagnostics.js` 的 H10 |
| **降级所有权（P1）**<br>`inited.sources[source].fallbackOwner` = `host` / `source` | ① `src/core/init/userApi/sourceContract.ts` 归一与 gate<br>② `src/core/init/userApi/index.ts` 写 `global.lx.fallbackOwners`<br>③ `src/core/music/utils.ts` 换源前判断 | bundled 源 5 平台声明 `source`；未声明源默认 `host`，行为不变；只 gate `handleGetOnlineMusicUrl`，lyric/pic/local 不 gate |
| **桥媒体信封（P2）**<br>`inited.mediaEnvelope=2` 声明能力；App `request.js` 对声明脚本的 binary 响应返回 `{__lxMedia:2,encoding:"base64",byteLength,body|chunks}`，>256KB 按 256KB 分片 | ① `src/core/init/userApi/mediaBody.ts` 编码<br>② `src/core/init/userApi/request.js` 按能力分流<br>③ `src/core/init/userApi/index.ts` 记录 `global.lx.mediaEnvelopes[info.id]`<br>④ `android/.../user-api-preload.js` request 带 `sourceId`<br>⑤ 源侧 `toBytes` 识别 `__lxMedia:2` 并按片解码 | 旧源未声明 `mediaEnvelope` 时继续收 Buffer，行为不变；新源必须同版升级，否则不启用信封。`node scripts/check_media_body.js`；源仓 `node test/audit/x-media-envelope.js` |
| **健康分字段**<br>低分 0 / 中分 1 / 无样本 2 / 高分 3（10 分制） | ① `src/screens/Home/Views/Setting/settings/Health.tsx` 健康分阈值（≥3 绿 / ≥−5 主题字体色 / <−5 红）<br>② 趋势弹窗排序权重（低分<中分<无样本<高分） | 看 Health.tsx 里的阈值数字，和音源侧的健康分定义对不对得上；趋势只表示健康分历史，不等于 4 主状态 |
| **trend 注释**<br>历史记录条数 | `src/screens/Home/Views/Setting/settings/Health.tsx` 的 trend action 调用注释 | 音源侧 trend 返回多少条历史，App 侧注释里写的条数要对得上 |
| **lang 词条**<br>新增 toast / nav / 设置项文案 | `src/lang/zh-cn.json` / `zh-tw.json` / `en-us.json` 三语言 | 三语言键数要一致（当前基线 1004 键，含定制 `dl_*` 102 键）；新增词条三语言都要加 |
| **subSource 透出**<br>播放页显示音源子源 | ① 播放页 UI（竖屏 + 横屏）<br>② 底部播放栏<br>③ 通知栏附加信息 | 音源侧 musicUrl 返回 subSource 字段，App 侧要接住并显示；v8.12.0 起同时返回 sourcePlatform，标签按实际平台显示（旧音源缺字段时回退主平台） |
| **音质档位表**<br>128k / 320k / flac / flac24bit / high | 音质选择弹窗 / 播放页音质标签 | 音源侧支持的音质档位，App 侧音质标签要能对应显示 |
| **版本号（统一读取规则）**<br>`@version` 首 token | ① `src/screens/Home/Views/Setting/settings/Basic/Source.tsx`（`parseSourceVersion`）<br>② `src/core/init/userApi/index.ts`（`parseSourceVersion` + `decideBuiltinSourceImport`） | 内置与在线升级都只认 `@version` 第一个 token；`@description` / `logInfo` 只作说明，不再作为启动导入真值。启动导入只在内置版本严格更高或首次安装时执行，在线升级成功后写 `imported_builtin_source_version`，较旧 APK 内置源不得反向覆盖。发布前核对 `@version` 与 `docs/MUSIC_SOURCE_GUIDE.md`；`check_source_update_logic.js` 看护 b131→b132 升级与 8.16→8.15 不降级。 |

---

## 二、迭代后检查流程（每次音源发新版本走一遍）

1. **数 actions**：`grep -o "action === '" lx-source.js | wc -l`  → 对照 App 侧 userApi switch case 数量
2. **看健康分**：音源侧健康分定义（阈值、权重）→ 对照 Health.tsx 里的数字
3. **看 trend**：音源侧 trend 返回多少条 → 对照 Health.tsx 注释里的条数
4. **看 lang**：有没有新增 toast / 设置文案 → 三语言都要加，键数一致
5. **看 subSource / 音质**：有没有新字段透出 → App 侧 UI 要接住
6. **看 `type` / `fragment`**：`type` 是源实际交付档（旧源可缺省，App 回退请求档）；`fragment` 是片段兜底标记（`subSourceName` 已带「试听版」，App 目前透传到播放诊断）。

---

## 三、回填机制

每次发现新的同步点，在"同步点总表"追加一行：
- 音源能力项（改了什么）
- App 需同步的位置（文件路径）
- 检查动作（怎么核对）

> 踩过的坑：action 表曾只列 3 个（实际 8 个）、zh-tw 曾缺 24 词条、trend 上限 20→60（v8.10 已再扩到 144）——都是靠人肉记得才发现的。有了本表，每次音源迭代后照单检查，避免再踩。

7. **`qualityConfidence` 字段**：源侧可在 `musicUrl` 返回 `exact/estimated/unknown`，App 适配层透传；片段兜底固定 `unknown`，不得把片段/估算档宣称为精确真实档。
