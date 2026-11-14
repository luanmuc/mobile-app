# 临时审计交接单

> **用途**：只读审计与压测的执行结果交接，供另一个账号复核与修复。
> **性质**：临时文档，修复完成后可直接删除。
> **方法约定**：本单只写"能复现的结论"。凡是靠文件名或目录结构推断出来的覆盖判断，一律不作数；每条都必须能给出文件行号与复现命令。

---

## 0. 元信息与仓库确认

| 项 | 值 |
|---|---|
| 生成时间 | 2026-11-14 |
| 音源仓 | `lx-music-source`（远端 `backend-api`），master，HEAD `4f478683f56a`，`@version 8.13.1` |
| 音源最新提交 | 2026-11-14 00:32，`chore(probe): 每日端点巡检刷新健康表+历史记录+v8.0健康日报` |
| App 仓 | `lx-music-mobile`（远端 `mobile-app`），master，HEAD `98f880203792`，`v1.9.2-b118`，versionCode 277 |
| 仓库新鲜度 | 两仓均已 `git fetch` 并用 GitHub API 直查远端 master，**本地与远端 0 落后 0 领先** |
| 执行方式 | 只读执行，未改任何产品代码 |

**总账**

| 仓库 | 可执行套件 | 通过 | 失败 | 退出码 |
|---|---|---|---|---|
| 音源 | 40 入口 | 468 | 1 | 1 个入口 rc=1 |
| App | 22 个 `check_*.js` | 322 | 0 | 全 rc=0 |
| 音源压测 | 3 套 | 159 | 0 | 全 rc=0 |

App 另有 `tsc --noEmit` rc=0（0 error）、`eslint .` rc=0（0 error / 0 warning）。

---

## 1. 第一轮发现（P1~P5）

### P1（中高）App 错误码文案覆盖 11/16，5 个码直接把英文常量显示给用户

**证据链**

1. 源侧 16 个错误码定义在 `repos/lx-music-source/src/legacy.js:129`。
2. **关键错配**：`ERROR_CODES.MISMATCH` 的值是字符串 `'SONG_MISMATCH'`。抛出点在 `src/legacy.js:3098`：

   ```js
   throw new Error(`${ERROR_CODES.MISMATCH}: 酷我官方匹配结果与目标歌曲不符`);
   ```

   实际 message 是 `SONG_MISMATCH: ...`，正则 `^([A-Z_]+)` 取到的 code 也是 `SONG_MISMATCH`。

3. App 文案表在 `src/core/music/utils.ts:721`，共 15 键，写的是 `MISMATCH`，**没有** `SONG_MISMATCH`。
4. 兜底在 `src/core/music/utils.ts:747`：`const zh = FAIL_CODE_ZH[code] || code`。

**实测：16 码逐一验证，命中 11，缺口 5**

| 缺口码 | 用户看到 |
|---|---|
| `SONG_MISMATCH` | 原样英文码 |
| `TRUNCATED_MEDIA` | 原样英文码 |
| `BAD_ENVELOPE` | 原样英文码 |
| `CONTRACT_ERROR` | 原样英文码 |
| `CANCELED` | 原样英文码 |

命中 11 个：NETWORK_TIMEOUT / NETWORK_ERROR / PARAM_ERROR / RATE_LIMIT / SERVER_ERROR / NOT_FOUND / CONFIG_ERROR / LINK_EXPIRED / PREVIEW_FRAGMENT / NOT_AUDIO / STREAM_PLAYLIST。

**修复点**：`utils.ts:721` 把 `MISMATCH` 改为 `SONG_MISMATCH`，并补另外 4 键。担心历史路径仍抛 `MISMATCH`，可两个键并存指向同一文案。该表是 `Record<string, string>`，加键无编译风险。

### P2（中）下载器把中文状态写进持久化数据

**证据**

`src/core/downloadManager.ts` 有 12 处中文 `statusText` 赋值：

`298 '下载中'` · `325 '下载中'` · `364 '已完成'` · `397 '获取歌曲信息...'` · `406 '非WiFi环境，已暂停'` · `464 '已完成'` · `558 '等待中'` · `594 '等待中'` · `628 '等待中'` · `648 '已暂停'` · `673 '等待中'` · `742 '等待中'`

落盘点 `:30`：`void saveData(DOWNLOAD_STORAGE_KEY, downloadState.list)`，整个 list 序列化（KEY 定义在 `:15`），中文随之入库。

显示层补救：`src/screens/Home/Views/Download/index.tsx:53` 判断 `if (item.statusKey)` 走 i18n，`default` 回落 `statusText`。

**影响**：切换语言后历史任务仍显示中文；持久化数据被中文污染。新增任务因有 `statusKey` 正常，问题只在历史任务与数据层暴露。

**修复点**：落盘前剥离 `statusText`（只存 `statusKey`），或改为显示时惰性计算；12 处赋值收敛到一个翻译函数。

### P3（低，但会让音源 CI 红）计划文档引用了 16 个不存在的测试文件

`test/audit/f-repo.js` 的 V7 项判红，`rc=1`，汇总 `51 通过 / 1 失败`。这是音源仓唯一失败项。

缺失文件：`stress-soak`、`stress-fault-inject`、`stress-cancel-storm`、`stress-race-interleave`、`stress-health-machine`、`stress-persist-roundtrip`、`stress-envelope`、`bench-eligibility`、`stress-config-hot`、`stress-cache-avalanche`、`stress-action-matrix`、`stress-singlepoint-fail`、`stress-error-code-bubble`、`stress-state-transition`、`stress-version-degrade`、`stress-observability`（均位于 `test/` 下）。

**根因**：这些路径来自 `docs/STRESS_PLAN_v8.13.1.md` 的规划文件名，脚本未落地，但文档按"已存在路径"格式书写。

**修复点**：二选一 —— 文档改成非路径形态（如"规划套件：soak"），或先建 16 个空壳入口（各带一条断言）。

### P4（阻塞）音源变异测试 22 个变异体全部未执行

```
Error: Cannot find module 'esbuild'
Require stack: /tmp/lx-mutation-repo/scripts/build-source.js
汇总：0 killed / 0 survived，killed 率 0%
```

**根因**：音源仓当前没有 `node_modules`，缺 esbuild。变异测试在 `/tmp/lx-mutation-repo` 重建 `lx-source.js` 依赖它，缺依赖则 22 个变异体全部在构建阶段抛错。

**`0 killed / 0 survived` 不是"变异体都存活"，是根本没执行，必须记 blocked。**

**修复点**：`cd repos/lx-music-source && npm i` 后重跑 `node test/mutation/run.js --full --strict`。出现 survived 说明是真缺口，应补测试而非放宽变异体。

### P5 账面修正（非产品缺陷）

| 项 | 计划账面 | 实测 |
|---|---|---|
| App 错误码覆盖 | 12/16 | **11/16** |
| App 4 主状态可达 state/reason 对 | 11 | **12** |
| App 压测条数 | 271（旧文档只统计 13 套 214） | **322** |
| 音源测试入口 | 44 入口 / 506 条 | 40 入口实跑 / 468 通过 |
| 音源压测套件 | 7 层 18 套 | 3 套可跑 / 159 条 |
| 音源中文字面量 | 127 处 | **319 行**（口径不同：行数 vs 字符串计数） |

---

## 2. 第二轮发现（N1~N4）

### N1（中）错误提示的国际化断裂

比 P1 更深一层：P1 是"5 个码没有中文"，N1 是"**整张表都不跟随语言**"。

**证据链**

1. `src/core/music/utils.ts:721` 的 `FAIL_CODE_ZH` 所有值都是硬编码简体中文（`'请求超时'`、`'网络错误'`…），不是 i18n key。
2. `src/core/music/utils.ts:739` 的 `formatPlayError` 返回 `` `${zh}：${trim(rest)}` ``（见 `:757` 与 `:759`），其中 `rest` 就是源侧 message 冒号后的内容。
3. 源侧有 **69 处** `throw new Error(\`${CODE}: 中文说明\`)`，中文说明会作为 `rest` 直接上屏。

**结论**：App 支持 zh-cn / en-us / zh-tw 三语（各 904 键），但**播放失败提示在任何语言下都是简体中文**。zh-tw 用户还会看到简体字形。

**修复点**：把 `FAIL_CODE_ZH` 改成 `code → i18n key` 映射（如 `code → 'player_error_not_found'`），在 `formatPlayError` 里走 `global.i18n.t(...)`；源侧 `rest` 不再上屏，只保留错误码 + 可选的源名/音质。若必须保留源侧说明，需源侧改成错误码枚举而非中文长句。

### N2（中高）16 个模块零逻辑断言，且本轮被改过，合计约 3200 行

**方法**（不用文件名猜）：① 22 个 `check_*.js` 的源码里是否出现该模块路径字符串；② 该模块是否在 b89 之后的 118 个提交里被改过。两个条件同时成立才算真空白。

`src/core` + `config` + `utils` + `plugins` 共 135 个模块，111 个无任何逻辑断言；叠加"被改过"筛出 **16 个**：

| 行数 | 提交数 | 模块 |
|---|---|---|
| 923 | 1 | `src/core/downloadManager.ts` |
| 720 | 1 | `src/core/player/player.ts` |
| 330 | 1 | `src/plugins/player/utils.ts` |
| 286 | 2 | `src/plugins/player/service.ts` |
| 198 | 1 | `src/plugins/player/hook.ts` |
| 153 | 1 | `src/core/player/playCount.ts` |
| 137 | 1 | `src/config/setting.ts` |
| 133 | 1 | `src/core/desktopLyric.ts` |
| 119 | 1 | `src/core/version.ts` |
| 114 | 2 | `src/utils/nativeModules/userApi.ts` |
| 89 | 1 | `src/core/music/index.ts` |
| 83 | 3 | `src/config/globalData.ts` |
| 82 | 1 | `src/core/music/download.ts` |
| 81 | 1 | `src/utils/officialVersion.ts` |
| 54 | 1 | `src/core/apiSource.ts` |
| 51 | 1 | `src/core/officialVersion.ts` |

两点需单独看：**下载器 923 行**是最重的空白；**播放器四件套**（`player.ts` 720 + `utils` 330 + `service` 286 + `hook` 198）合计 **1534 行**零断言。

口径说明：这些模块受 `check_ts_syntax` 的语法覆盖（526 文件 0 错），缺的是**行为断言**。

**修复点**：优先给 `downloadManager`（重试/磁盘/状态机/迁移）与 `plugins/player/hook.ts`（播放器状态订阅）写 check 脚本；其余按改动敏感度排。

### N3（低，潜伏）`setProgress` 的分母写错

`src/store/player/action.ts:74`

```js
state.progress.progress = totalTime ? state.progress.nowPlayTime / currentTime : 0
```

上一行刚把 `nowPlayTime = currentTime`，所以非零时 `progress` 恒等于 **1**。同族的两个函数分母都正确：

- `setMaxplayTime`（`:64`）：`nowPlayTime / time` ✓
- `setNowPlayTime`（`:55`）：`time / maxPlayTime` ✓

**为什么现在没暴露**：唯一调用点是 `src/core/player/playInfo.ts:127` 的 `setProgress(0, 0)`，`totalTime=0` 走 else 分支得 0。

**修复点**：分母改成 `totalTime`。当前无用户可见影响，但一旦有人用它驱动进度条就会满格。

### N4（指标）音源真实行覆盖率 56.9%

用 `NODE_V8_COVERAGE` 跑 40 个审计入口（不含压测），对产物 `lx-source.js` 计算：

| 口径 | 已执行 / 可执行 | 覆盖率 |
|---|---|---|
| 40 个审计入口 | 3028 / 5322 | **56.9%** |
| 仅 `stress-round4` | 2466 / 5322 | 46.3% |
| 审计 + 压测合并 | 3028 / 5322 | 56.9% |

**2294 行可执行代码在全部可跑测试下一次都没执行过**，且未执行行分散在全程（2500-2999 段最密，377 行），不是集中在某个死代码区。

注意：App 侧无法采集模块级覆盖率 —— 脚本用 `typescript.transpileModule` + `new Function` 执行，V8 认不到模块边界。

**修复点**：这是覆盖现状陈述，不是缺陷。要提升覆盖，按 N2 的 16 个模块优先补断言。

---

## 3. 已验证不成立的方向（避免重复挖）

以下都是原思路怀疑过、但打开代码核对后**不是缺陷**的：

| 怀疑 | 实测 | 结论 |
|---|---|---|
| 错误被吞没 | `legacy.js:1841`（base64 解析）、`:1910`（形态判定）、`:4977`（JSON 解析）三处 `catch` 返回 null/{}，每处都有注释说明交给既有降级 | 有意设计 |
| 定时器泄漏 | 源侧 `setInterval/setTimeout` 8 个、`clear*` 8 个；App 实际 8 个 `setInterval` 调用、7 个 `clearInterval`，`hook.ts` 3 个都前置 `clearItv()`，`playCount.ts` 是 `if (timer) return` 单例守卫 | 不成立 |
| `applyAdmission` 读-判-写竞态 | `legacy.js:4447` 注释明确"判据与记账分离"，`applyAdmission`（`:2505`）只按 verdict 落账、不做裁决 | 不成立 |
| 跨仓字段错配 | `src/core/init/userApi/index.ts:392-411` 的 export/restore 是 `info: state` 原样透传，App 不重组字段 | 不成立 |
| 跨仓时间单位（ms vs s） | 源内部统一 `timeoutMs`/`latencyMs`/`ttlMs`；导出行字段 `totalTime`/`probeTime` 带 Time 但 App 不解释其语义，只透传回源 | 不成立 |
| 敏感值硬编码 | 产物 `lx-source.js` 里 `apiKey`/`signSalt`/`CARD_KEY` 出现 **0** 次 | 不成立 |
| 设置项定义了没消费 | `src/config/defaultSetting.ts` 75 个键，**0 个未被消费** | 不成立 |
| 新增 action 零覆盖 | `exportHealthState` / `restoreHealthState` / `reportPlayback` 各被 1 个脚本引用，`trend` 被 5 个、`healthEvents` 被 3 个；音源侧 export/restore 各被 3 个测试引用 | 不成立 |

---

## 4. 已通过项（复核时不必重复审）

### 音源仓

`npm test`（19 脚本）190 通过 / 0 失败；补充入口 21 个 278 通过（仅 f-repo V7 失败）；压测 `stress-test` 12、`stress-round3` 14、`stress-round4` 133，合计 159 全绿；`q-quickjs-real` 真 QuickJS 引擎 3 通过。

静态：重复函数 0（148 个）、只定义不使用常量 0（162 个）、`debugger` 0、每个错误码至少被用一次 16/16、未使用 `let` 0、导出面 27 项、加载 10 ms（阈值 50）、重载 3 次堆增长 1.9 MB（阈值 20）、最大单文件 312 KB、不应入库文件 0、`USER_CONFIG` 49 键全消费。

平台链（按 `chain` 实算，`active` 10 + `probation` 2 = 12 源；`probation` 是对象不是数组）：wy 5、tx 2、kw 7、**kg 1**、**mg 1**（kg/mg 单点均为 `suyinKuwo`）。

版本注释：`@version 8.13.1`，`src/legacy.js` 有 29 处 `v8.14` 注释，属预埋标记。

### App 仓（22 脚本 322 条，全 0 失败）

健康诊断 54 / 51 / 23 / 14，配置契约 25，播放预算 20，播放归属 19，源健康持久化 17，日志目录 15，源契约 14，UI 映射 11，事件流水线 10，状态重构 10，平台标签 9，持久化 v2 9，异常 v2 8，状态 v2 7，媒体体 6；`check_ts_syntax` 526 文件 0 错；`check_docs_consistency` 20 文档无过时引用；`check_source_ci_gate` 与离线版均通过。

静态：三语各 904 键，双向差集全 0，死键 0（704 直接引用 + 200 动态拼接，如 `health_cfg_label_${key}` 103 个）；13 个音源 action 双向差集 0（另有 9 个 case 属事件/日志类：init/response/request/cancelRequest/showUpdateAlert/log/info/error/warn）；`as any` 22、`@ts-ignore` 0。

4 主状态全枚举（转译真实 `src/core/healthStatus.ts` 后跑 3072 组合）：available 38 / degraded 26 / paused 1984 / off 1024，四态全可达，可达 state/reason 对 12 个，异常 0。优先级实测：`USER_OFF + playDead → off/USER_OFF`；`resolveDead + playDead → PLAYBACK_FAILED`；`resolveDead + 未采样 → RESOLVE_FAILED`（`healthStatus.ts:74`，早于 `!sampled`）；`DEGRADED` 需 `successRate===0 && healthScore<0` 同时成立（`:79`）。

---

## 5. 未执行项

1. **音源变异测试 22 体**：缺 esbuild，blocked（见 P4）。
2. **音源压测另外 15 套**：文件不存在，无法执行（见 P3）。
3. **App 计划中 E19 / E21 / E22**：为待建脚本，仓库无对应 `check_*.js`。已用等价手段覆盖的是 E14（3072 组合枚举）、E15（16 码逐一实测）、E16（三语 904×3 双向差集）。

---

## 6. 修复顺序建议

1. **P4** 先装依赖，恢复变异测试能力（否则后续改动无变异覆盖）。
2. **P1** 补 5 个键并修正 `MISMATCH → SONG_MISMATCH`，成本最低。
3. **N1** 把文案表改成 i18n key，与 P1 同一处改动，合并做最省。
4. **N3** `setProgress` 分母改 `totalTime`，一行改动。
5. **P2** 下载器中文落盘，涉及持久化格式，改动面最大。
6. **N2** 给 16 个零断言模块补 check 脚本，工作量最大，按 `downloadManager` → 播放器四件套 → 其余排。
7. **P3** 文档措辞或补空壳脚本，收尾消红。

每步修完跑自检：

```bash
cd repos/lx-music-source && node scripts/docs-audit.js && npm test
cd repos/lx-music-mobile && node scripts/check_docs_consistency.js && node scripts/check_ts_syntax.js
```

---

## 7. 附录：复现命令

### A. 错误码 16 码逐一验证

```bash
cd repos/lx-music-mobile
node -e "
const fs=require('fs');
const src=fs.readFileSync('src/core/music/utils.ts','utf8');
const blk=src.match(/const FAIL_CODE_ZH[\s\S]*?\n\}/)[0];
const tbl={};for(const m of blk.matchAll(/\n  ([A-Z_]+): '([^']*)'/g))tbl[m[1]]=m[2];
const codes=['NETWORK_TIMEOUT','NETWORK_ERROR','PARAM_ERROR','RATE_LIMIT','SERVER_ERROR','NOT_FOUND','SONG_MISMATCH','CONFIG_ERROR','LINK_EXPIRED','PREVIEW_FRAGMENT','NOT_AUDIO','STREAM_PLAYLIST','TRUNCATED_MEDIA','BAD_ENVELOPE','CONTRACT_ERROR','CANCELED'];
let ok=0,miss=[];for(const c of codes){tbl[c]?ok++:miss.push(c)}
console.log('命中 '+ok+'/16，缺口 '+miss.length+': '+miss.join(', '));
"
```

### B. 4 主状态全枚举

```bash
cd repos/lx-music-mobile
cat > /tmp/enum_hs.js <<'EOF'
const fs=require('fs'),path=require('path'),Module=require('module');
const ts=require(path.resolve('node_modules/typescript'));
const file=path.resolve('src/core/healthStatus.ts');
const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const m=new Module(file);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));m._compile(js,file);
const {classifyHealthMainState}=m.exports;
const offReasons=[undefined,'USER_OFF','DEFAULT_OFF','AUTO_OFF_PROBE','SLEEPING','PLAY_DEAD'];
const bools=[false,true];let n=0;const st={available:0,degraded:0,paused:0,off:0};const pairs=new Set();
for(const offReason of offReasons)for(const autoOff of bools)for(const playDead of bools)
for(const resolveDead of bools)for(const sampled of bools)for(const rateLimited of bools)
for(const state of [undefined,'closed','open','half-open'])
for(const successRate of [0,0.3])for(const healthScore of [-1,0.6]){
  n++;const r=classifyHealthMainState({offReason,autoOff,playDead,resolveDead,rateLimitActive:rateLimited,rateLimited,state,successRate,healthScore},sampled);
  st[r.state]++;pairs.add(r.state+'/'+r.reason);
}
console.log('组合:',n,JSON.stringify(st),'可达对:',pairs.size);
EOF
node /tmp/enum_hs.js
```

### C. 音源真实行覆盖率

```bash
cd repos/lx-music-source
rm -rf /tmp/cov_src && mkdir -p /tmp/cov_src
for f in test/audit/*.js test/*.js; do
  case $(basename $f) in stress-test.js|stress-round3.js|stress-round4.js|lx-source-smoke-test.js) continue;; esac
  NODE_V8_COVERAGE=/tmp/cov_src node "$f" > /dev/null 2>&1
done
node -e "
const fs=require('fs'),path=require('path');const ranges=[];
for(const f of fs.readdirSync('/tmp/cov_src')){const d=JSON.parse(fs.readFileSync('/tmp/cov_src/'+f,'utf8'));
for(const r of d.result){if(!/lx-source\.js\$/.test(r.url))continue;for(const fn of r.functions)for(const g of fn.ranges)ranges.push(g)}}
ranges.sort((a,b)=>a.startOffset-b.startOffset);
const src=fs.readFileSync('lx-source.js','utf8'),lines=src.split('\n');
let off=0;const lo=[];for(const l of lines){lo.push([off,off+l.length-1]);off+=l.length+1}
const exe=o=>{let b=null;for(const r of ranges){if(r.startOffset>o)break;if(o<r.endOffset&&(!b||(r.endOffset-r.startOffset)<(b.endOffset-b.startOffset)))b=r}return b?b.count>0:false};
let e=0,c=0;for(let i=0;i<lines.length;i++){const t=lines[i].trim();if(!t||t.startsWith('//'))continue;e++;if(exe(Math.floor((lo[i][0]+lo[i][1])/2)))c++}
console.log('覆盖:',c+'/'+e,'=',(c/e*100).toFixed(1)+'%');
"
```

### D. 模块零断言 + 本轮改过 的交叉筛选

```bash
cd repos/lx-music-mobile
node -e "
const fs=require('fs'),cp=require('child_process');
const files=fs.readdirSync('scripts').filter(f=>f.startsWith('check_')&&f.endsWith('.js'));
const txt={};for(const f of files)txt[f]=fs.readFileSync('scripts/'+f,'utf8');
const core=[];const walk=p=>{for(const f of fs.readdirSync(p)){const q=p+'/'+f;if(fs.statSync(q).isDirectory())walk(q);else if(/\.(ts|tsx)\$/.test(f))core.push(q)}};
walk('src/core');walk('src/config');walk('src/utils');walk('src/plugins');
const unc=core.filter(p=>{const b=p.replace(/\.(ts|tsx)\$/,'').replace('src/','');return !files.some(f=>txt[f].includes(b))});
const changed=new Set(cp.execSync('git log --name-only --pretty=format: 64cc4749..HEAD',{maxBuffer:1e8}).toString().split('\n').filter(Boolean));
const hot=unc.filter(p=>changed.has(p));
console.log('零断言:',unc.length,' 其中本轮改过:',hot.length);
hot.sort((a,b)=>fs.statSync(b).size-fs.statSync(a).size).slice(0,16).forEach(p=>console.log('  '+p));
"
```

### E. 全量入口自检

```bash
cd repos/lx-music-source
npm test                                    # 19 脚本 / 190 通过
node test/stress-test.js                    # 12
node test/stress-round3.js                  # 14
node test/stress-round4.js                  # 133
node test/audit/f-repo.js; echo "EXIT=\$?"  # 51 通过 / 1 失败（P3）
node test/mutation/run.js --full --strict   # blocked（P4）

cd ../lx-music-mobile
for f in scripts/check_*.js; do node "$f" > /dev/null 2>&1 || echo "FAIL $f"; done
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js . --ext .js,.jsx,.ts,.tsx
```

---

*本文件为临时交接文档，修复完成后可删除。*
