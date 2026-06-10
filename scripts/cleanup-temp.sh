#!/bin/bash
# 临时目录清理脚本
# 保留最新一个增量包作为回滚参考，删除其余旧包
# 用法：bash scripts/cleanup-temp.sh [--force]

set -e
cd "$(dirname "$0")/.." || exit 1

TEMP_DIR="临时"
FORCE_MODE=false

if [ "$1" = "--force" ]; then
  FORCE_MODE=true
fi

if [ ! -d "$TEMP_DIR" ]; then
  echo "✅ 临时目录不存在，无需清理"
  exit 0
fi

# 统计当前大小
TOTAL_SIZE=$(du -sh "$TEMP_DIR" 2>/dev/null | cut -f1)
echo "📊 临时目录当前大小：${TOTAL_SIZE}"

# 列出增量包（按时间排序，最新在前）
PATCH_DIRS=$(ls -1dt "$TEMP_DIR"/starcoin-incremental-patch-* 2>/dev/null || true)
SERVER_DIRS=$(ls -1dt "$TEMP_DIR"/starcoin-server-* 2>/dev/null || true)

PATCH_COUNT=$(echo "$PATCH_DIRS" | grep -c . || true)
SERVER_COUNT=$(echo "$SERVER_DIRS" | grep -c . || true)

echo "📦 增量包数量：${PATCH_COUNT} 个"
echo "📦 服务器包数量：${SERVER_COUNT} 个"

if [ "$FORCE_MODE" = true ]; then
  # 强制模式：删除除最新增量包外的所有包
  echo "$PATCH_DIRS" | tail -n +2 | while read -r dir; do
    if [ -n "$dir" ] && [ -d "$dir" ]; then
      echo "🗑️  删除旧增量包：$dir"
      rm -rf "$dir"
    fi
  done
  echo "$SERVER_DIRS" | while read -r dir; do
    if [ -n "$dir" ] && [ -d "$dir" ]; then
      echo "🗑️  删除服务器包：$dir"
      rm -rf "$dir"
    fi
  done
else
  echo ""
  echo "⚠️  预览模式（使用 --force 参数执行实际删除）"
  echo "将保留最新 1 个增量包，删除其余："
  echo "$PATCH_DIRS" | tail -n +2 | while read -r dir; do
    [ -n "$dir" ] && echo "  → $dir"
  done
  echo "将删除所有服务器包："
  echo "$SERVER_DIRS" | while read -r dir; do
    [ -n "$dir" ] && echo "  → $dir"
  done
fi

REMAINING_SIZE=$(du -sh "$TEMP_DIR" 2>/dev/null | cut -f1)
echo ""
echo "📊 清理后大小：${REMAINING_SIZE}"
echo "✅ 清理完成"
