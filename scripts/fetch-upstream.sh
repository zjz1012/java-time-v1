#!/bin/bash
# 拉取并校验 J2ME 内核的上游源码。
#
# 版本被钉死在下面的 PIN 上 —— 不使用「最新 master」。上游客厅代码在
# 2018 年之后没有动过，改动会直接让 scripts/fixup-upstream.py 的规则失配，
# 这一点由脚本的退出码拦住。
#
# 用法：
#   bash scripts/fetch-upstream.sh          # 首次拉取 / 校验现有副本
#   VENDOR_DIR=/path bash scripts/fetch-upstream.sh   # 指定落点

set -euo pipefail

PIN="46ee3e78a4fd9c3f09026cc5cbdcf76e94b7a398"
UPSTREAM="https://github.com/mozilla/pluotsorbet.git"

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
DEST="${VENDOR_DIR:-$ROOT/vendor/pluotsorbet}"

echo "== 目标：$DEST"
echo "== 钉定 commit：$PIN"

if [ -d "$DEST/.git" ]; then
  echo "== 已存在，切换并校验"
  git -C "$DEST" fetch --all --quiet || true
  git -C "$DEST" checkout --quiet "$PIN"
else
  mkdir -p "$(dirname "$DEST")"
  git clone --quiet "$UPSTREAM" "$DEST"
  git -C "$DEST" checkout --quiet "$PIN"
fi

# Boehm GC 是 git submodule，缺了 native.js 编不出来
git -C "$DEST" submodule update --init --recursive --quiet

ACTUAL="$(git -C "$DEST" rev-parse HEAD)"
if [ "$ACTUAL" != "$PIN" ]; then
  echo "!! commit 不符：期望 $PIN，实际 $ACTUAL" >&2
  exit 1
fi

BOEHM="$(git -C "$DEST/vm/native/Boehm.js" rev-parse HEAD 2>/dev/null || echo 'MISSING')"
echo "== 主仓库 commit 校验通过"
echo "== Boehm.js submodule：$BOEHM"

if [ "$BOEHM" != "712978aea8b6a30bee949d78275aafb0e8cbc887" ]; then
  echo "!! Boehm.js submodule commit 与登记不符（docs/provenance/SOURCES.md §1.2）" >&2
  exit 1
fi

echo "== 完成。下一步：bash scripts/build-kernel.sh"
echo "   注意：还需本机具备 emsdk 2.0.34、JDK、Python 3，见 scripts/README.md"
