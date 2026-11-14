# 临时审计交接单

> **用途**：本文件是一次只读审计与压测的执行结果交接，供另一个账号复核与修复。
> **性质**：临时文档，修复完成后可直接删除。
> **生成方式**：全部结论来自实际执行，未修改任何产品代码。

---

## 0. 元信息

| 项 | 值 |
|---|---|
| 生成时间 | 2026-11-14 |
| 音源仓 | `lx-music-source`，master，HEAD `4f47868`，`@version 8.13.1` |
| App 仓 | `lx-music-mobile`，master，HEAD `7fec038e`，`v1.9.2-b118`，versionCode 277 |
| 执行方式 | 只读执行计划中的测试入口，不修复、不改代码 |
| 判定口径 | 只认 `✗` 标记与非零退出码，日志中的"失败明细"业务文本不计为断言失败 |

**总账**

| 仓库 | 可执行套件 | 通过 | 失败 | 退出码 |
|---|---|---|---|---|
| 音源 | 40 入口 | 468 | 1 | 1 个入口 rc=1 |
| App | 22 个 `check_*.js` | 322 | 0 | 全 rc=0 |
| 音源压测 | 3 套（stress-test / round3 / round4） | 159 | 0 | 全 rc=0 |

App 另有 `tsc --noEmit` rc=0（0 error）、`eslint .` rc=0（0 error / 0 warning）。

---

## 1. 问题清单

### P1（中高）App 错误码文案覆盖 11/16，5 个码直接把英文常量显示给用户

**现象**

音源侧共 16 个错误码，App 侧中文文案表只命中 11 个。播放失败时，未命中的码会走 `FAIL_CODE_ZH[code] || code` 兜底，用户看到的是裸英文常量。

**证据链**

1. 源侧错误码定义：`repos/lx-music-source/src/legacy.js:129`，`const ERROR_CODES = { ... }`，共 16 个键。

   ```
   NETWORK_TIMEOUT, NETWORK_ERROR, PARAM_ERROR, RATE_LIMIT, SERVER_ERROR,
   NOT_FOUND, MISMATCH, CONFIG_ERROR, LINK_EXPIRED, PREVIEW_FRAGMENT,
   NOT_AUDIO, STREAM_PLAYLIST, TRUNCATED_MEDIA, BAD_ENVELOPE, CONTRACT_ERROR, CANCELED
   ```

2. **关键错配**：`ERROR_CODES.MISMATCH` 的**值是字符串** `'SONG_MISMATCH'`，不是 `'MISMATCH'`。源侧抛出点在 `src/legacy.js:3098`：

   ```js
   throw new Error(`${ERROR_CODES.MISMATCH}: 酷我官方匹配结果与目标歌曲不符`);
   ```

   实际抛出的 message 是 `SONG_MISMATCH: ...`，正则 `^([A-Z_]+)` 取到的 code 也是 `SONG_MISMATCH`。

3. App 侧文案表：`src/core/music/utils.ts:721`，`FAIL_CODE_ZH` 共 15 个键，其中写的是 `MISMATCH`，**没有** `SONG_MISMATCH`。

4. 兜底逻辑：`src/core/music/utils.ts:747`，`const zh = FAIL_CODE_ZH[code] || code`。

**实测结果（逐个码验证 16 次）**

| 错误码 | 用户看到 |
|---|---|
| NETWORK_TIMEOUT | 请求超时 |
| NETWORK_ERROR | 网络错误 |
| PARAM_ERROR | 请求参数错误 |
| RATE_LIMIT | 请求过于频繁，请稍后再试 |
| SERVER_ERROR | 音源服务异常 |
| NOT_FOUND | 歌曲不可用 |
| CONFIG_ERROR | 音源配置错误 |
| LINK_EXPIRED | 音源链接已失效 |
| PREVIEW_FRAGMENT | 仅提供试听片段 |
| NOT_AUDIO | 返回的不是有效音频 |
| STREAM_PLAYLIST | 返回的是播放列表，播放器不支持 |
| **SONG_MISMATCH** | **兜底显示 `SONG_MISMATCH`** |
| **TRUNCATED_MEDIA** | **兜底显示 `TRUNCATED_MEDIA`** |
| **BAD_ENVELOPE** | **兜底显示 `BAD_ENVELOPE`** |
| **CONTRACT_ERROR** | **兜底显示 `CONTRACT_ERROR`** |
| **CANCELED** | **兜底显示 `CANCELED`** |

**复现命令**

```bash
cd repos/lx-music-mobile
node -e "
const fs=require('fs');
const src=fs.readFileSync('src/core/music/utils.ts','utf8');
const blk=src.match(/const FAIL_CODE_ZH[\s\S]*?\n\}/)[0];
const tbl={};for(const m of blk.matchAll(/\n  ([A-Z_]+): '([^']*)'/g))tbl[m[1]]=m[2];
const codes=['NETWORK_TIMEOUT','NETWORK_ERROR','PARAM_ERROR','RATE_LIMIT','SERVER_ERROR','NOT_FOUND','SONG_MISMATCH','CONFIG_ERROR','LINK_EXPIRED','PREVIEW_FRAGMENT','NOT_AUDIO','STREAM_PLAYLIST','TRUNCATED_MEDIA','BAD_ENVELOPE','CONTRACT_ERROR','CANCELED'];
let ok=0,miss=[];
for(const c of codes){ tbl[c]?ok++:(miss.push(c));
  console.log(tbl[c]?'✓':'✗', c, '→', tbl[c]||('兜底英文码 '+c)); }
console.log('命中 '+ok+'/16，缺口 '+miss.length+': '+miss.join(', '));
"
```

**影响**

4 个 v8.11/v8.13 新增的交付真实性码（`TRUNCATED_MEDIA` / `BAD_ENVELOPE` / `CONTRACT_ERROR` / `CANCELED`）与 1 个歌名匹配码（`SONG_MISMATCH`）在播放失败时对用户不可读。这几个码恰好是新增链路最容易触发的一批。

**修复点**

- `src/core/music/utils.ts:721` 的 `FAIL_CODE_ZH`：把键 `MISMATCH` 改为 `SONG_MISMATCH`；补 `TRUNCATED_MEDIA`、`BAD_ENVELOPE`、`CONTRACT_ERROR`、`CANCELED` 四键。
- 若担心历史路径仍会抛 `MISMATCH`，可同时保留 `MISMATCH` 与 `SONG_MISMATCH` 两个键指向同一文案，成本最低。
- 该表是 `Record<string, string>`，不受类型约束，加键无编译风险。
- 修完再跑上面的复现命令，应得到 `命中 16/16，缺口 0`。

---

### P2（中）下载器把中文状态写进持久化数据

**现象**

下载任务对象里同时存在 `statusText`（中文硬编码）与 `statusKey`（i18n 键）。持久化时整个 list 一起写盘，中文随数据入库。

**证据链**

1. 12 处中文 `statusText` 赋值，均在 `src/core/downloadManager.ts`：

   | 行 | 文本 |
   |---|---|
   | 298 | `'下载中'` |
   | 325 | `'下载中'` |
   | 364 | `'已完成'` |
   | 397 | `'获取歌曲信息...'`（此行同时有 `statusKey: 'dl_status_fetching'`） |
   | 406 | `'非WiFi环境，已暂停'` |
   | 464 | `'已完成'` |
   | 558 | `'等待中'` |
   | 594 | `'等待中'` |
   | 628 | `'等待中'` |
   | 648 | `'已暂停'` |
   | 673 | `'等待中'` |
   | 742 | `'等待中'` |

2. 落盘点：`src/core/downloadManager.ts:30`

   ```js
   void saveData(DOWNLOAD_STORAGE_KEY, downloadState.list)
   ```

   `DOWNLOAD_STORAGE_KEY` 定义在 `src/core/downloadManager.ts:15`。整条 list 序列化，`statusText` 的中文一起进存储。

3. 显示层补救：`src/screens/Home/Views/Download/index.tsx:53` 判断 `if (item.statusKey)` 后走 i18n；`default` 分支回落 `item.statusText`（同文件 63 行）。

**复现方式**

新建一个下载任务 → 进入下载列表 → 从存储导出 `downloadList` 键，观察每条记录的 `statusText` 字段是否为中文。无需修改代码即可观察。

```bash
cd repos/lx-music-mobile
grep -nE "statusText: '[^']*'" src/core/downloadManager.ts
grep -n "void saveData(DOWNLOAD_STORAGE_KEY" src/core/downloadManager.ts
```

**影响**

- 切换语言（zh-cn / en-us / zh-tw）后，历史任务的显示语言不会跟随，回落到中文。
- 持久化数据被中文污染，与三语 i18n 体系不一致。
- 新增任务因有 `statusKey` 显示正常，问题只在历史任务与数据层暴露，容易漏测。

**修复点**

- 落盘前剥离 `statusText`，或改为落盘只存 `statusKey`，显示时再翻译；也可把 `statusText` 改为惰性计算（getter），不进入序列化字段。
- 12 处赋值可统一收敛到 `statusKey` + 一处翻译函数，避免新增状态时再漏。
- 修复后三语切换下历史任务应跟随语言变化。

---

### P3（低，但会让音源 CI 红）音源计划文档引用了 16 个不存在的测试文件

**现象**

音源仓 `test/audit/f-repo.js` 的 V7 项判定失败，`rc=1`，汇总 `51 通过 / 1 失败`。这是音源仓本次唯一的失败项。

**证据**

失败项原文：

```
✗ [V7] 文档引用的 60 个测试文件全部存在 — test/stress-soak.js,
test/stress-fault-inject.js, test/stress-cancel-storm.js,
test/stress-race-interleave.js, test/stress-health-machine.js,
test/stress-persist-roundtrip.js, test/stress-envelope.js,
test/bench-eligibility.js, test/stress-config-hot.js,
test/stress-cache-avalanche.js, test/stress-action-matrix.js,
test/stress-singlepoint-fail.js, test/stress-error-code-bubble.js,
test/stress-state-transition.js, test/stress-version-degrade.js,
test/stress-observability.js
```

**根因**

这 16 个路径来自 `docs/STRESS_PLAN_v8.13.1.md` 里按规划写下的文件名。规划中的测试脚本尚未落地，但文档按"已存在路径"的格式书写，`f-repo` 的规则是"文档提到的测试文件必须真实存在"，于是判红。

**复现**

```bash
cd repos/lx-music-source
node test/audit/f-repo.js; echo "EXIT=$?"
```

**影响**

音源仓文档一致性入口 rc=1。如果 CI 里挂了这条，会阻断流水线。与产品代码无关。

**修复点**

二选一：

- 在 `docs/STRESS_PLAN_v8.13.1.md` 里把这些文件名改成非路径形态（例如"规划套件：soak"而不写 `test/stress-soak.js`），V7 就不会再去校验它们是否存在；
- 或者先把这 16 个入口建出来（空壳脚本带一条断言即可），让文档与仓库一致。

两种都能消红，选一个即可。

---

### P4（阻塞）音源变异测试 22 个变异体全部未执行

**现象**

```bash
cd repos/lx-music-source
node test/mutation/run.js --full --strict
```

输出：

```
Error: Cannot find module 'esbuild'
Require stack: /tmp/lx-mutation-repo/scripts/build-source.js
汇总：0 killed / 0 survived，killed 率 0%
```

**根因**

音源仓当前**没有 `node_modules`**：

```bash
ls -d repos/lx-music-source/node_modules       # 不存在
ls -d repos/lx-music-source/node_modules/esbuild  # 不存在
```

而变异测试要把仓库复制到 `/tmp/lx-mutation-repo` 后重建 `lx-source.js`，重建脚本 `scripts/build-source.js` 依赖 esbuild。依赖缺失时 22 个变异体全部在构建阶段抛错，一条断言都没跑到。

**这是 blocked，不是 passed。** `0 killed / 0 survived` 不代表变异体都存活，而是根本没执行。

**影响**

变异测试对当前 HEAD 的有效覆盖为 0。这一项在审计计划 D11 里属"必须通过"类，现在不能计入通过。

**修复点**

```bash
cd repos/lx-music-source
npm i            # 或仅装构建依赖 esbuild
node test/mutation/run.js --full --strict
```

装好依赖后重跑，应得到接近历史上"21 killed / 0 survived"的结果；若出现 survived，说明变异体找到的断言缺口是真实缺口，需要补测试而不是放宽变异体。

---

### P5（账面修正，非产品缺陷）计划文档中的数字与实测不一致

修复时若引用计划文档的数字，请以本表为准。

| 项 | 计划账面 | 实测 | 差异原因 |
|---|---|---|---|
| App 错误码覆盖 | 12/16 | **11/16** | `MISMATCH` vs `SONG_MISMATCH` 键名错配，此前未识别 |
| App 4 主状态可达 state/reason 对 | 11 | **12** | 漏算 `resolveDead → paused/RESOLVE_FAILED` 一支 |
| App 压测条数 | 271（旧 STRESS_PLAN 只统计 13 套 214） | **322** | 实跑 22 个脚本，覆盖高于账面 |
| 音源测试入口 | 44 入口 / 506 条 | 40 入口实跑 / 468 通过 | 账面含未建脚本，实跑只认存在文件 |
| 音源压测套件 | 7 层 18 套 | 3 套可跑 / 159 条 | 其余 15 套未落地为脚本 |
| 音源中文字面量 | 127 处 | **319 行** | 口径不同：字符串计数 vs 含中文的行数 |

---

## 2. 已通过项（供复核时对照，不必重复审）

### 2.1 音源仓

| 项 | 实测 |
|---|---|
| `npm test`（19 脚本） | 190 通过 / 0 失败，rc=0 |
| 补充入口（21 个） | 278 通过 / 1 失败（仅 f-repo V7，见 P3） |
| 压测 `stress-test` | 12 通过 / 0 失败 |
| 压测 `stress-round3` | 14 通过 / 0 失败 |
| 压测 `stress-round4` | 133 通过 / 0 失败 |
| 真 QuickJS 引擎（`q-quickjs-real`） | 3 通过 / 0 失败 |
| 重复函数定义 | 0（共 148 个函数） |
| 只定义不使用的一次性常量 | 0（共 162 个） |
| `debugger` 语句 | 0 |
| 每个错误码至少被使用一次 | 16/16 |
| 只声明不使用的 `let` | 0 |
| 导出面 | 27 项 |
| 模块加载耗时 | 10 ms（阈值 50 ms） |
| 重复加载 3 次堆增长 | 1.9 MB（阈值 20 MB） |
| 最大单文件 | 312 KB |
| 不应入库文件 | 0 |
| `USER_CONFIG` 键 | 49 个，0 个仅定义未消费 |
| `v8.14` 注释 vs 实际版本 | 29 处注释（`legacy.js`）/ 7 处（产物），实际 `@version 8.13.1`，属预埋注释 |

**平台链矩阵**（按 `chain` 实算，`active` 10 + `probation` 2 = 12 源；注意 `probation` 是对象不是数组）

| 平台 | 链源数 | 链路 |
|---|---|---|
| wy | 5 | #3 suyin163 → #4 wyOuter → #5 ikun → #6 suyinKuwo → #8 huibq |
| tx | 2 | #1 suyinKuwo → #2 juheTx |
| kw | 7 | #1 suyinKuwo → #2 xinghaiBackend → #4 helloworldKw → #5 kuwoOfficial → #6 changqingVip → #7 ikun → #8 huibq |
| **kg** | **1** | #1 suyinKuwo（单点，无备胎） |
| **mg** | **1** | #1 suyinKuwo（单点，无备胎） |

kg / mg 单点属现状事实，是否需要补链由产品侧决定，本单只做记录。

### 2.2 App 仓

| 脚本 | 断言 | 失败 |
|---|---|---|
| check_health_diagnostics | 54 | 0 |
| check_health_diagnostics_deep | 51 | 0 |
| check_source_config_contract | 25 | 0 |
| check_health_diagnostics_view | 23 | 0 |
| check_playback_budget | 20 | 0 |
| check_playback_ownership_runtime | 19 | 0 |
| check_source_health_persistence | 17 | 0 |
| check_log_directory | 15 | 0 |
| check_health_diagnostics_stress | 14 | 0 |
| check_source_contract | 14 | 0 |
| check_health_ui_mapping | 11 | 0 |
| check_health_event_pipeline | 10 | 0 |
| check_health_status_refactor | 10 | 0 |
| check_source_platform_label | 9 | 0 |
| check_health_persistence_v2 | 9 | 0 |
| check_health_anomaly_v2 | 8 | 0 |
| check_health_state_v2 | 7 | 0 |
| check_media_body | 6 | 0 |
| check_ts_syntax | 526 文件 0 错 | 0 |
| check_docs_consistency | 20 文档无过时引用 | 0 |
| check_source_ci_gate | 通过（基于绿提交 `a25cd8a`） | 0 |
| check_source_ci_gate_offline | 通过 | 0 |
| **合计** | **322** | **0** |

| 静态项 | 结果 |
|---|---|
| 三语键数 | zh-cn / en-us / zh-tw 各 904 |
| 双向差集 | `zh-cn↔en-us` 0/0，`zh-cn↔zh-tw` 0/0 |
| 死键 | 0（704 直接引用 + 200 动态拼接） |
| 动态拼接族 | `health_cfg_label_${key}` 103、`list_sort_modal_by_${id}`、`health_config_err_${map[code]}` 5 等 |
| 13 个音源 action 双向差集 | 0 |
| 非 action 的 case | 9 个（init/response/request/cancelRequest/showUpdateAlert/log/info/error/warn，事件与日志类） |
| `as any` | 22 处 |
| `@ts-ignore` | 0 处 |

**4 主状态全枚举**（用 TypeScript 转译真实 `src/core/healthStatus.ts` 后枚举 3072 组合）

- 状态分布：available 38 / degraded 26 / paused 1984 / off 1024
- 4 个主状态**全部可达**，可达 state/reason 对共 **12 个**，异常 0
- 优先级实测：
  - `USER_OFF` + `playDead` → `off/USER_OFF`（关闭权威优先）
  - `resolveDead` + `playDead` → `paused/PLAYBACK_FAILED`（playDead 先生效）
  - `resolveDead` + 未采样 → `paused/RESOLVE_FAILED`（在 `src/core/healthStatus.ts:74`，早于 `!sampled`）
  - `DEGRADED` 需 `successRate === 0 && healthScore < 0` 同时成立（`:79`）；`hs=0` 或 `sr=0.01` 均落 `ELIGIBLE`

12 个可达对：

```
available/ELIGIBLE          available/PENDING_SAMPLE
degraded/RATE_LIMITED       degraded/QUALITY_OPEN
degraded/QUALITY_HALF_OPEN  degraded/DEGRADED
paused/AUTO_OFF_PROBE       paused/SOURCE_SLEEPING
paused/PLAYBACK_FAILED      paused/RESOLVE_FAILED
off/USER_OFF                off/DEFAULT_OFF
```

复现脚本见附录 A。

---

## 3. 未执行 / 无法执行的项

1. **音源变异测试 22 体**：缺 esbuild，见 P4。
2. **音源压测计划中另外 15 套**：`test/stress-soak.js`、`stress-fault-inject`、`stress-cancel-storm`、`stress-race-interleave`、`stress-health-machine`、`stress-persist-roundtrip`、`stress-envelope`、`bench-eligibility`、`stress-config-hot`、`stress-cache-avalanche`、`stress-action-matrix`、`stress-singlepoint-fail`、`stress-error-code-bubble`、`stress-state-transition`、`stress-version-degrade`、`stress-observability` —— 文件在仓库中不存在，无法执行（同 P3）。
3. **App 计划中新增套件 E19 / E21 / E22**：计划里是待建脚本，仓库无对应 `check_*.js`，未执行。已用等价手段覆盖的：E14（4 主状态全枚举，3072 组合）、E15（16 错误码逐一实测）、E16（三语矩阵 904×3 双向差集）。

---

## 4. 附：复现环境与脚本

### 附录 A：4 主状态全枚举

```bash
cd repos/lx-music-mobile
cat > /tmp/enum_hs.js <<'EOF'
const fs=require('fs'),path=require('path'),Module=require('module');
const ts=require(path.resolve('node_modules/typescript'));
const file=path.resolve('src/core/healthStatus.ts');
const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const m=new Module(file);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));
m._compile(js,file);
const {classifyHealthMainState}=m.exports;
const offReasons=[undefined,'USER_OFF','DEFAULT_OFF','AUTO_OFF_PROBE','SLEEPING','PLAY_DEAD'];
const bools=[false,true];let n=0;const states={available:0,degraded:0,paused:0,off:0};const pairs=new Set();
for(const offReason of offReasons)for(const autoOff of bools)for(const playDead of bools)
for(const resolveDead of bools)for(const sampled of bools)for(const rateLimited of bools)
for(const state of [undefined,'closed','open','half-open'])
for(const successRate of [0,0.3])for(const healthScore of [-1,0.6]){
  n++;const r=classifyHealthMainState({offReason,autoOff,playDead,resolveDead,rateLimitActive:rateLimited,rateLimited,state,successRate,healthScore},sampled);
  states[r.state]++;pairs.add(r.state+'/'+r.reason);
}
console.log('组合:',n,JSON.stringify(states),'可达对:',pairs.size);
console.log([...pairs].sort().join('  '));
EOF
node /tmp/enum_hs.js
```

### 附录 B：三语矩阵与死键

```bash
cd repos/lx-music-mobile
node -e "
const fs=require('fs');
const L=['zh-cn','en-us','zh-tw'];const d={};
for(const l of L)d[l]=JSON.parse(fs.readFileSync('src/lang/'+l+'.json','utf8'));
const a=new Set(Object.keys(d['zh-cn'])),b=new Set(Object.keys(d['en-us'])),c=new Set(Object.keys(d['zh-tw']));
const diff=(x,y)=>[...x].filter(k=>!y.has(k));
console.log('键数',L.map(l=>l+'='+Object.keys(d[l]).length).join(' '));
console.log('zh↔en',diff(a,b).length,diff(b,a).length,'zh↔tw',diff(a,c).length,diff(c,a).length);
const files=[];const walk=p=>{for(const f of fs.readdirSync(p)){const q=p+'/'+f;const s=fs.statSync(q);if(s.isDirectory())walk(q);else if(/\.(ts|tsx|js)$/.test(f))files.push(q)}};
walk('src');const blob=files.map(f=>fs.readFileSync(f,'utf8')).join('\n');
let un=[...a].filter(k=>!blob.includes(k));console.log('静态未命中:',un.length);
"
```

未命中的 200 个需人工确认是否为动态拼接族；本次已逐族核对，均为拼接引用，无真死键。

### 附录 C：音源全量入口

```bash
cd repos/lx-music-source
npm test                                   # 19 脚本 / 190 通过
node test/stress-test.js                   # 12 通过
node test/stress-round3.js                 # 14 通过
node test/stress-round4.js                 # 133 通过
node test/audit/f-repo.js; echo "EXIT=\$?" # 51 通过 / 1 失败（P3）
node test/mutation/run.js --full --strict  # blocked（P4）
```

---

## 5. 修复顺序建议

1. **P4** 先装依赖恢复变异测试能力（否则后续改动没有变异覆盖）。
2. **P1** 改文案表，加 5 键并修正 `MISMATCH`→`SONG_MISMATCH`，成本最低收益最直接。
3. **P2** 收敛下载器中文落盘，涉及持久化格式，改动范围最大，放第三步。
4. **P3** 文档措辞或补空壳脚本，收尾消红。

每步修完请跑对应仓库的自检入口，确保不引入新的红：

```bash
cd repos/lx-music-source && node scripts/docs-audit.js && npm test
cd repos/lx-music-mobile && node scripts/check_docs_consistency.js && node scripts/check_ts_syntax.js
```

---

*本文件为临时交接文档，修复完成后可删除。*
