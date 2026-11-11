# 发布 SOP（Release SOP）

本仓库采用 **push 即发版** 的云编译模式：任何对 `master` 的推送（`publish/**`、`npm-version-info/**`、`README.md`、`docs/**` 除外——CI paths-ignore）都会触发 GitHub Actions 自动编译并发布新版本。

## 一、版本号规则（必读）

| 项 | 值 | 说明 |
|---|---|---|
| `package.json` 的 `version` | **与底座同步（当前 `1.9.2`）** | 底座（官方原版）升版时随 merge 同步 bump；日常构建由 CI 注入构建号，**禁止手改** |
| 发布版本名 | `1.9.2-bN` | `N` = **底座版本内构建序号**，由 `publish/build-state.json` 状态文件驱动；底座升版后从 `b1` 重新计数（如 `1.9.1-b79` → `1.9.2-b1`） |
| `versionCode` | `build-state.json` 持续递增 | 每次构建 +1（持续递增，当前值见 publish/build-state.json），`android/app/build.gradle` 从环境变量读取；保证老用户可覆盖安装 |
| Release tag | `v1.9.2-bN` | 每次构建唯一，prerelease 标记 |
| 内置音源 | 每次构建自动拉取 | 来自 `luanmuc/backend-api` 最新版（`?ref=master`），与代码解耦；**仓库不内置音源副本**，由构建生成 `assets/builtin_source.js` |

> 版本号体系（v1.9.2 起）：`bN` 只在底座版本内递增，底座升版即重置回 `b1`；`versionCode` 永远持续递增，不与 `bN` 绑定。状态文件 `publish/build-state.json` 记录 `baseVersion` / `build` / `versionCode`，CI 每次构建读取并回写（见下）。禁止手改 version 与状态文件——要发版只需 push 代码。

## 二、发布流程（CI 自动执行）

```
push master（paths-ignore: publish/**、npm-version-info/**、README.md、docs/**）
  └─ Job Android
      ├─ 拉最新内置音源（GitHub Contents API ?ref=master → 生成 assets/builtin_source.js，>50KB + @name 校验；仓库不内置副本）
      ├─ TypeScript 类型检查（`tsc --noEmit` 0 error，`.github/workflows/release.yml`）：与语法检查互补，失败即停在构建前
      ├─ ESLint 全仓检查（0 error / 0 warning，`.github/workflows/release.yml`）：格式/类型断言/空值语义等静态约束，失败即停在构建前
      ├─ 音源标签/配置/语法契约门禁（9+24+519，`.github/workflows/release.yml`）：`sourcePlatform` 全链路透传 / 配置键表 / TS 语法；失败即停在构建前
      ├─ 健康诊断契约门禁（39 条，`.github/workflows/release.yml`）：预加载 action 白名单/分发 case/traceId/本地日志/聚合脱敏；失败即停在构建前
      ├─ Compute build number：读 publish/build-state.json → baseVersion 与 package.json version 不同则重置 build=0 → build+1、versionCode+1 → 回写状态文件，输出 outputs.build / outputs.versionCode
      ├─ 注入 APP_VERSION_NAME=1.9.2-b<build>、versionCode=<versionCode>、buildNumber.ts
      └─ ./gradlew assembleRelease → 5 个 ABI APK → upload-artifact
  └─ Job Release（needs: Android）
      ├─ 生成发布说明（scripts/gen_change_log.py：git log 自动生成本次变更 + APK MD5）
      ├─ softprops/action-gh-release：创建 tag v1.9.2-b<build>，上传 APK
      ├─ 更新 publish/version.json（版本+描述+最近历史）
      ├─ 更新并发布 npm 版本信息包（luanmuc-lx-music-version-info）
      └─ 提交 version.json + build-state.json + npm-version-info/package.json + README.md（底座 bN 同步）回 master（不再触发构建）
```

## 三、发布前测试清单（改动核心代码时必做）

> 健康契约与音源标签/配置/语法契约、全仓 `tsc --noEmit`、全仓 `eslint` 由 `.github/workflows/release.yml` 在 `Setup Env` 后自动阻塞；压力测试 14 条不在发版阻塞链，挂 `.github/workflows/health-stress.yml`（每周一 UTC 周日 18:45 / 手动 dispatch）。

> 与 AGENTS.md「实证开发流程」配套：先过 L0-L4 验证链，push 前逐项自查。

1. **类型/语法/lint**：`node node_modules/typescript/bin/tsc --noEmit` 0 error；`node scripts/check_ts_syntax.js` 0 错误（519 个 TS/TSX）；`node node_modules/eslint/bin/eslint.js . --ext .js,.jsx,.ts,.tsx` 0 error / 0 warning
2. **设置迁移**：若改默认值，确认已走迁移机制（见 MERGE_GUIDE），本地清 App 数据模拟老用户验证迁移生效
3. **播放**：URL 刷新不卡死、切换音源、下载列表播放、通知栏歌词/按钮
4. **下载**：并发任务、暂停/恢复、失败自动重试、仅 WiFi 开关、音质降级链、标签写入、下载目录权限
5. **音源**：搜索、播放 URL 可播、音质降级、歌词/封面、健康探测
6. **权限**：Android <10 存储权限引导、11-12 全文件访问引导、≥13 READ_MEDIA_AUDIO
7. **更新**：多源版本检查、`bN` 版本号比较、启动自动更新
8. **回归**：原版核心功能抽查（播放列表/收藏/设置页/榜单）

## 四、发布后验证清单（每次推送后必查）

在 [Actions](https://github.com/luanmuc/mobile-app/actions) 页面确认：

1. ✅ `Android` Job 编译成功（5 个 APK）
2. ✅ `Release` Job 全部步骤绿
3. ✅ 新 Release 已生成：tag `v1.9.2-bN`，发布说明 = 本次真实变更，包含 5 个 APK + MD5
4. ✅ `publish/version.json` 已更新并提交回 master（最新提交为 "chore: 更新版本信息 v1.9.2-bN"），`README.md` 的「当前底座 v1.9.2 至 bN」已同提交更新，且 `publish/build-state.json` 已被回写（baseVersion/build/versionCode 递增）
5. ✅ npm 包 `luanmuc-lx-music-version-info` 版本已发布（若 NPM_TOKEN 失效会有 `::error::` 提示，需更换 secret）
6. ✅ 全部通过后才通知用户

## 五、回滚方法

**场景 A：编译失败（Android Job 红）**

- 若原因在最近的代码改动：`git revert <提交>` 后推送，触发下一次构建
- 若原因在 CI 配置：修复 `.github/workflows/release.yml` 或 `scripts/` 后推送
- 若原因在音源拉取：检查 `luanmuc/backend-api` 仓库最新脚本是否损坏（>50KB + @name 校验失败），修复后重跑

**场景 B：Release 已发但 version.json 未回写（Release Job 部分失败）**

- 手动触发 `workflow_dispatch` 重跑 `Release` Job（无需重新编译，artifacts 可复用）
- 或手动编辑 `publish/version.json` 提交（格式参考历史记录，注意版本号与已发 tag 一致）

**场景 C：发布了错误版本（用户已安装）**

1. `git revert` 出问题的提交，推送触发新构建（底座内 bN+1）
2. 在新版本发布说明中注明"回滚了 X 行为"
3. 无需删除旧 Release（保留审计记录）

## 六、npm 版本信息包机制

- 包名：`luanmuc-lx-music-version-info`（npm registry）
- 用途：App 在线更新检查的版本数据源之一（与 `publish/version.json`、jsdelivr 多源并行，取最高版本）
- 维护：CI 每次构建自动发布（`scripts/publish_npm_info.py`）；仓库内 `npm-version-info/package.json` 由 CI 更新并提交回
- 若发布失败：App 会从其它源获取版本信息，不影响更新；但需尽快更换 GitHub secret `NPM_TOKEN`

## 七、开发侧注意

- 改 **README.md / docs/ 下文档不触发构建**（release.yml paths-ignore）；改 **.github/、.github/workflows** 等会触发构建发版（注：`CUSTOM_CHANGELOG.md` 在 `docs/` 下，属 paths-ignore，改它**不会**触发构建）——这是预期行为，正好让发布说明反映文档变更
- 只更新版本信息（`publish/**`、`npm-version-info/**`，含 `publish/build-state.json`）不会触发构建，不会产生新版本号
- 合并上游（含底座升版）后推送同样走本流程：`package.json` version 随底座 bump，CI 检测到 baseVersion 变化后自动从 `b1` 重新计数
