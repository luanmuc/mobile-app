# 开发环境搭建（DEV SETUP）

新账号从零跑起本仓库（React Native 0.73 + Android）。

## 一、环境要求

| 依赖 | 版本 | 说明 |
|---|---|---|
| Node.js | 见 `.nvmrc`（18+） | 推荐 nvm 管理 |
| npm | 随 Node | 用 `npm ci`（锁版本） |
| JDK | 17（`microsoft` 发行版） | 与 CI 一致 |
| Android SDK | 平台 36（compileSdk 36）、build-tools | 本地跑 debug 包需要 |
| 真机/模拟器 | Android 5+ | 定制版 compileSdk 36 / targetSdk 29 / minSdk 21 |

## 二、克隆与安装

```bash
git clone <本仓库>
cd mobile-app
npm ci                    # 严格按 package-lock.json 安装（CI 同款）
```

> 不要用 `npm install`：lockfile 差异会导致 CI 与本地不一致。`react-native-track-player` 依赖指向 fork commit，npm ci 会从 GitHub 拉取。

> **升级 fork commit 时（已踩过的坑，b75 复现）**：改完 `package.json` / `package-lock.json` 里的 sha 后，直接 `npm ci` / `npm install` 往往报 "up to date" 而不重装该包，`node_modules/react-native-track-player/lib` 仍是旧产物 → `npx tsc --noEmit` 会报 `TS2353 'quality' does not exist in type 'NowPlayingMetadata'`。固定三步：
> 1. 显式重装目标 sha：`npm install "github:luanmuc/react-native-track-player#<sha>"`（不要只改 lock 就以为装好了）；
> 2. 校验产物：`grep -n "quality?:" node_modules/react-native-track-player/lib/interfaces.d.ts` 必须命中；
> 3. 重跑 `npx tsc --noEmit`，必须 **0 error** 才允许提交（`lib/` 不在仓库里，靠包内 `prepare: npm run build` 生成，所以这一步无法跳过）。

## 三、跑 Debug 包

```bash
# 1. 启动 Metro
npm run dev

# 2. 另开终端，安装并启动（连真机需先开启 USB 调试）
npx react-native run-android
```

- 首次运行前先执行 `npm run start` 的提示（或直接 `npx react-native run-android`）
- 定制版包名 `com.luanmuc.lxmusic`，与原版共存安装

## 四、真机调试

```bash
adb reverse tcp:8081 tcp:8081   # Metro 端口转发
# 摇一摇/`adb shell input keyevent 82` 打开 Dev Menu → Reload / Debug
```

- 日志：`adb logcat | grep ReactNativeJS`
- 自定义源/QuickJS 相关日志：`adb logcat | grep -i "userApi\|quickjs"`

## 五、语法检查（无 node_modules 也可用）

全量 TS/TSX 语法检查（525 个文件），合并上游/提交前必跑：

```bash
node scripts/check_ts_syntax.js
```

> 该脚本用 `typescript` 的 `transpileModule` 逐文件检查语法，不解析类型（无需 node_modules 即可快速发现语法错误）。若没有该脚本，可用：
> ```bash
> npx tsc --noEmit --jsx react-native 2>&1 | head -50
> ```

## 六、常见坑

| 问题 | 处理 |
|---|---|
| `npm ci` 拉取 track-player fork 失败 | 检查网络能否访问 github.com；或改用 `npm ci --prefer-offline` |
| Metro 端口占用 | `lsof -i:8081` 找到进程后 kill，或 `npm run dev -- --port 8082` |
| Android 13 权限弹窗 | 定制版走 READ_MEDIA_AUDIO，无需存储权限 |
| 改了默认值不生效 | 走「设置迁移规则」（见 MERGE_GUIDE），本地测试需清 App 数据模拟老用户 |
| 内置音源不是最新 | 音源由 CI 注入，本地改 `assets/builtin_source.js` 会被下次构建覆盖；本地测试可手动替换该文件 |
| Gradle 下载依赖慢 | 配置阿里云 maven 镜像（android/build.gradle 内 repositories），或重跑 `npx react-native run-android` 断点续传 |

## 七、发布相关

- 本地改完 push 即发版（见 [RELEASE_SOP.md](./RELEASE_SOP.md)）
- 不要手动改 `package.json` 的 version / `android/app/build.gradle` 的 versionCode（CI 注入）
