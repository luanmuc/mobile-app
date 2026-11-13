#!/usr/bin/env bash
# 音源健康真机验收（G2）
# 用法：
#   bash scripts/health_device_acceptance.sh --dry-run
#   bash scripts/health_device_acceptance.sh <apk路径>
# 退出码：0=检查/安装启动成功；3=缺少 adb、设备或 APK（外部条件阻塞，不是代码失败）
set -u

PKG="com.luanmuc.lxmusic"
APK="${1:-android/app/build/outputs/apk/release/app-universal-release.apk}"
DRY_RUN=0
if [ "${1:-}" = "--dry-run" ]; then DRY_RUN=1; APK="${2:-$APK}"; fi

if ! command -v adb >/dev/null 2>&1; then
  echo "G2 blocked: 未找到 adb。请在本机安装 platform-tools，或设置 ANDROID_HOME 后把 adb 加入 PATH。" >&2
  exit 3
fi
if ! adb devices | awk 'NR>1 && $2=="device" {found=1} END {exit !found}'; then
  echo "G2 blocked: 没有处于 device 状态的真机。请连接 K80 Pro/K40 Pro 并开启 USB 调试。" >&2
  adb devices >&2
  exit 3
fi
if [ "$DRY_RUN" -eq 0 ] && [ ! -f "$APK" ]; then
  echo "G2 blocked: APK 不存在：$APK" >&2
  exit 3
fi

echo "设备：$(adb devices | awk 'NR>1 && $2=="device" {print $1; exit}')"
echo "包名：$PKG"

if [ "$DRY_RUN" -eq 0 ]; then
  adb install -r "$APK"
  adb shell am force-stop "$PKG"
  adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null
  sleep 5
  adb shell dumpsys activity activities | grep -E "mResumedActivity|topResumedActivity" | head -2
fi

cat <<'CHECKLIST'
验收步骤（必须逐项记录结果）：
1. 设置 → 音源健康：看到 4 主状态（正常/异常/已摘除/休眠）及 reason。
2. 关闭一个源再开启：userEnabled 与 offReason 必须同步变化，重启 App 后保持。
3. 手动探测：行内先只读，结果返回后弹确认；取消不得落账，确认后才写 controls/health。
4. 播放一首歌并成功出声；回到健康页刷新，应看到该源成功样本增长。
5. 播放失败/取消：不得记为播放失败，除非 App 明确回传失败。
6. 杀进程重启：健康状态、手动关闭、autoOff 短 TTL 均按预期恢复。
7. 导出诊断包：只含本机 JSONL，不包含歌名/URL 等敏感字段。

导出本机健康日志：
  adb shell run-as com.luanmuc.lxmusic sh -c 'ls -l files | grep source_health'
  adb exec-out run-as com.luanmuc.lxmusic cat files/source_health_YYYYMMDD.jsonl > /tmp/source_health.jsonl
CHECKLIST

echo "G2 脚本侧准备完成；真机 UI 结果需人工按清单记录。"
