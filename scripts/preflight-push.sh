#!/usr/bin/env bash
# 推送前本地全量校验（等价 CI release.yml 的 lint + checks job）
# 用法：bash scripts/preflight-push.sh [--skip-checks]
set -o pipefail
FAIL=0
T0=$(date +%s)

step() {
  local name="$1"; shift
  local s=$(date +%s)
  if "$@" >/tmp/af_step.log 2>&1; then
    echo "✅ $name（$(( $(date +%s) - s ))s）"
  else
    echo "❌ $name（$(( $(date +%s) - s ))s）"
    tail -20 /tmp/af_step.log | sed 's/^/     /'
    FAIL=1
  fi
}

echo "===== 推送前全量校验（mobile-app）====="

# 1) lint job：ESLint 全仓（必须整仓，不是只跑改动文件）
step "ESLint 全仓" node node_modules/eslint/bin/eslint.js . --ext .js,.jsx,.ts,.tsx

# 2) checks job：TypeScript
step "tsc --noEmit" node node_modules/typescript/bin/tsc --noEmit

# 3) 跨仓版本闸门：文档「豆包定制 vX」必须 == 音源仓 master 的 @version
SRC_FILE=${LX_SOURCE_FILE:-../backend-api/lx-source.js}
if [ -f "$SRC_FILE" ]; then
  SRC_VER=$(grep -o "@version [0-9.]*" "$SRC_FILE" | head -1 | awk '{print $2}')
  DOC_VER=$(grep -o "豆包定制 v[0-9.]*" docs/MUSIC_SOURCE_GUIDE.md | head -1 | sed 's/豆包定制 v//')
  if [ -n "$SRC_VER" ] && [ "$SRC_VER" = "$DOC_VER" ]; then
    echo "✅ 跨仓版本闸门（$SRC_VER）"
  else
    echo "❌ 跨仓版本闸门：文档 ${DOC_VER:-未找到} ≠ 音源 ${SRC_VER:-未找到}"
    FAIL=1
  fi
else
  echo "⏭  跨仓版本闸门（跳过：未找到 $SRC_FILE）"
fi

# 4) checks job：全部 check_*.js（新增脚本自动纳入）
if [ "${1:-}" != "--skip-checks" ]; then
  export LX_SOURCE_ROOT=${LX_SOURCE_ROOT:-../backend-api}
  export LX_REQUIRE_SOURCE=1
  N=0; PASS=0
  for f in scripts/check_*.js; do
    case "$f" in
      # 这两个依赖 GitHub API / Actions 页面 / 本地离线源仓，CI 里在 android job 用 token 跑
      *check_source_ci_gate.js|*check_source_ci_gate_offline.js) echo "⏭  跳过 $(basename "$f")（API/离线专用，见下方等价校验）"; continue ;;
    esac
    N=$((N+1))
    if node "$f" >/tmp/af_chk.log 2>&1; then PASS=$((PASS+1)); else
      echo "❌ $(basename "$f")"; tail -8 /tmp/af_chk.log | sed 's/^/     /'; FAIL=1
    fi
  done
  echo "✅ 门禁脚本 $PASS/$N 通过"
fi

# 4b) 源仓 CI 闸门（等价 check_source_ci_gate.js，这里用已登录的 gh 规避匿名 API 限流）
if command -v gh >/dev/null 2>&1; then
  SRC_CONC=$(gh api "repos/luanmuc/backend-api/actions/runs?branch=master&per_page=1" -q '.workflow_runs[0] | .status + "|" + (.conclusion // "none") + "|" + .head_sha[0:8]' 2>/dev/null)
  case "$SRC_CONC" in
    completed\|success*) echo "✅ 源仓 CI 闸门（${SRC_CONC}）" ;;
    completed\|*) echo "❌ 源仓 CI 闸门（音源仓最新 run 非 success：${SRC_CONC}）"; FAIL=1 ;;
    in_progress*|queued*|requested*|"") echo "⏭  源仓 CI 闸门（音源仓最新 run 未完成：${SRC_CONC:-读取失败}）" ;;
    *) echo "❌ 源仓 CI 闸门（异常：${SRC_CONC}）"; FAIL=1 ;;
  esac
else
  echo "⏭  源仓 CI 闸门（跳过：未安装 gh）"
fi

# 5) 文档一致性（App 也有 docs-audit 工作流）
if [ -f scripts/docs-audit.js ]; then step "docs-audit" node scripts/docs-audit.js --dry-run; fi

TOTAL=$(( $(date +%s) - T0 ))
if [ "$FAIL" = "0" ]; then echo ""; echo "✅ 推送前校验通过，${TOTAL}s"; exit 0; fi
echo ""; echo "❌ 推送前校验失败，${TOTAL}s —— 修完再推"; exit 1
