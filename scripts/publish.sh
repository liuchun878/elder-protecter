#!/usr/bin/env bash
#
# publish.sh —— 首次发布到 GitHub：建仓（若不存在）→ 推 main 与 tags
#
# 用法：
#   GITHUB_TOKEN=<你的PAT> bash scripts/publish.sh    # 自动建仓 + 推送（首次用这个）
#   bash scripts/publish.sh                           # 已配好凭据时，只推送
#   OWNER=xxx REPO=yyy bash scripts/publish.sh        # 换仓库时用
#
# 为什么需要 PAT：本机实测没有 gh CLI、没有 SSH key、keychain 里也没有 github 凭据
# （`git credential fill` 失败），所以首次必须显式给一个 token。
#
# PAT 权限：
#   - classic token：勾 repo
#   - fine-grained token：Administration 读+写、Contents 读+写（建仓需要 Administration）
#
# 安全：token 只写进 mktemp 出来的 600 权限配置文件，用 `curl --config` 传入，
#       不出现在命令行参数与 shell 历史里；脚本退出时自动删除该文件。
#
set -euo pipefail

OWNER="${OWNER:-liuchun878}"
REPO="${REPO:-medbot-sim}"
BRANCH="${BRANCH:-main}"
DESC="送药机器人仿真演示（Team4 · Vibe Coding Camp 立项工作坊）"
TOPICS='{"names":["hackathon","threejs","elderly-care","simulation","medication-adherence"]}'

cd "$(git rev-parse --show-toplevel)"

# ── 1. 确保 origin ───────────────────────────────────────────────────────────
if ! git remote get-url origin >/dev/null 2>&1; then
  git remote add origin "https://github.com/${OWNER}/${REPO}.git"
fi
echo "origin = $(git remote get-url origin)"

TOKEN="${GITHUB_TOKEN:-}"
CFG=""
if [ -n "$TOKEN" ]; then
  CFG="$(mktemp "${TMPDIR:-/tmp}/.medbot-curl.XXXXXX")"
  chmod 600 "$CFG"
  {
    printf 'header = "Authorization: Bearer %s"\n' "$TOKEN"
    printf 'header = "Accept: application/vnd.github+json"\n'
    printf 'silent\nshow-error\n'
  } > "$CFG"
  trap 'rm -f "$CFG"' EXIT
fi

api_get()  { curl --config "$CFG" "https://api.github.com/$1"; }
api_post() { curl --config "$CFG" -X POST -d "$2" "https://api.github.com/$1"; }
api_put()  { curl --config "$CFG" -X PUT  -d "$2" "https://api.github.com/$1"; }

# ── 2. 建仓（仅在给了 token 且仓库不存在时）──────────────────────────────────
NEED_PUSH=true
if [ -n "$TOKEN" ]; then
  code="$(api_get "repos/${OWNER}/${REPO}" -o /dev/null -w '%{http_code}' || echo 000)"
  if [ "$code" = "200" ]; then
    echo "仓库已存在：https://github.com/${OWNER}/${REPO}"
  elif [ "$code" = "404" ]; then
    echo "仓库不存在，正在创建 public 仓库 ${OWNER}/${REPO} …"
    api_post "user/repos" "{\"name\":\"${REPO}\",\"private\":false,\"description\":\"${DESC}\",\"has_issues\":true,\"has_wiki\":false,\"auto_init\":false}" >/dev/null
    api_put "repos/${OWNER}/${REPO}/topics" "$TOPICS" >/dev/null 2>&1 || true
    echo "已创建：https://github.com/${OWNER}/${REPO}"
  else
    echo "查询仓库返回 HTTP ${code}：token 可能无 Administration 权限，或网络异常。" >&2
    echo "可以先在网页建好仓库（github.com/new，不要勾 README），再不带 token 重跑本脚本。" >&2
    exit 1
  fi
else
  echo "未提供 GITHUB_TOKEN —— 跳过建仓，直接尝试推送。"
  echo "若报 'Repository not found'，说明仓库还没建：先在 github.com/new 建好（不要勾 README）。"
fi

# ── 3. 推送 main 与 tags ────────────────────────────────────────────────────
echo
echo "推送中…"
if ! git push -u origin "$BRANCH" --tags; then
  echo >&2
  echo "推送失败。两种情况：" >&2
  echo "  a) 认证失败 → 确认用户名是 ${OWNER}、密码填 PAT（不是账号密码）；" >&2
  echo "     只想记住一次：git config --global credential.helper osxkeychain" >&2
  echo "  b) 远端已有内容被拒 → 远端不要用 README 初始化；若已初始化：" >&2
  echo "     git pull --rebase origin ${BRANCH} && git push -u origin ${BRANCH} --tags" >&2
  exit 1
fi

# ── 4. 验证 ─────────────────────────────────────────────────────────────────
echo
echo "远端分支："
git ls-remote --heads origin
echo "远端 tag："
git ls-remote --tags origin | sed 's/^/  /'
echo
echo "✅ 发布完成：https://github.com/${OWNER}/${REPO}"
echo "下一步（队长）：Settings → Collaborators 邀请两位队员（Write），"
echo "然后立刻把 CODEOWNERS 里的 @TODO-R / @TODO-S 换成真实用户名。"
