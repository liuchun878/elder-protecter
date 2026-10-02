#!/usr/bin/env bash
#
# push-stage.sh —— 把一个开发阶段"保存到 GitHub"
#
# 用法:
#   bash scripts/push-stage.sh <tag> "<验收声明>"
#
# 例:
#   bash scripts/push-stage.sh p2-happy-path "场景1 端到端可跑：到点→送药→取走→日志，验收脚本 5 步全过"
#
# 它做三件事：校验 → 打 annotated tag → 推送当前分支与 tags。
# 校验：工作区干净、tag 不重复、origin 已配置、当前不在 detached HEAD。
#
set -euo pipefail

TAG="${1:-}"
MSG="${2:-}"

usage() {
  echo '用法: bash scripts/push-stage.sh <tag> "<验收声明>"' >&2
  echo '例:   bash scripts/push-stage.sh p2-happy-path "场景1 端到端可跑"' >&2
}

if [[ -z "$TAG" || -z "$MSG" ]]; then
  usage
  exit 2
fi

# 在仓库根目录执行，脚本可从任意位置调用
cd "$(git rev-parse --show-toplevel)"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"

if [[ "$BRANCH" == "HEAD" ]]; then
  echo "当前处于 detached HEAD，先切回分支再打阶段 tag。" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "工作区不干净，先提交再保存阶段：" >&2
  git status --short >&2
  exit 1
fi

if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  echo "tag $TAG 已存在。换一个阶段名，或先删除：git tag -d $TAG" >&2
  exit 1
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  echo "还没配置 origin。先执行：" >&2
  echo "  git remote add origin https://github.com/liuchun878/medbot-sim.git" >&2
  exit 1
fi

echo "阶段: $TAG"
echo "分支: $BRANCH"
echo "声明: $MSG"
echo

git tag -a "$TAG" -m "$MSG"
echo "已打 annotated tag: $TAG"

git push origin "$BRANCH"
git push origin --tags

echo
echo "阶段 $TAG 已保存到 GitHub。"
echo "别忘了：该阶段的 CHANGELOG.md 与 README 进度表也应已提交。"
