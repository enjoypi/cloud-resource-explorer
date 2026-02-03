
#!/bin/bash

# 简化版启动脚本
if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
  cat << EOF
云资源采集工具 - 简化版

用法: ./collect.sh [选项]

常用选项:
  无参数        采集所有资源（使用 config.yaml 配置）
  -f            强制刷新，忽略缓存
  -c <types>    指定资源类型（如: compute,storage）
  -p <profile>  指定 Profile（如: dev）
  --count       仅统计数量
  --search <q>  搜索资源
  --audit       IAM 安全审计
  -h            显示帮助

示例:
  ./collect.sh                  # 采集所有资源
  ./collect.sh -f               # 强制刷新
  ./collect.sh -c compute       # 只采集计算资源
  ./collect.sh -p dev           # 只采集 dev profile
  ./collect.sh --search 10.0.   # 按 IP 搜索

详细帮助: pnpm start --help
EOF
  exit 0
fi

# 转换简化参数为完整参数
ARGS=()
FORCE_REFRESH=false
COUNT_ONLY=false
SEARCH=""
AUDIT=false

while [ $# -gt 0 ]; do
  case "$1" in
    -f)
      FORCE_REFRESH=true
      ;;
    -c)
      shift
      ARGS+=("--type" "$1")
      ;;
    -p)
      shift
      if echo "$1" | grep -q "aliyun"; then
        ARGS+=("--aliyun-profile" "$1")
      else
        ARGS+=("--aws-profile" "$1")
      fi
      ;;
    --count)
      COUNT_ONLY=true
      ;;
    --search)
      shift
      SEARCH="$1"
      ;;
    --audit)
      AUDIT=true
      ;;
    *)
      echo "未知参数: $1"
      echo "使用 -h 查看帮助"
      exit 1
      ;;
  esac
  shift
done

# 构建最终命令
FINAL_ARGS=()
if [ "$FORCE_REFRESH" = true ]; then
  FINAL_ARGS+=("-f")
fi
if [ "$COUNT_ONLY" = true ]; then
  FINAL_ARGS+=("--count-only")
fi
if [ -n "$SEARCH" ]; then
  FINAL_ARGS+=("--search" "$SEARCH")
fi
if [ "$AUDIT" = true ]; then
  FINAL_ARGS+=("--iam-audit")
fi
FINAL_ARGS+=("${ARGS[@]}")

# 执行
cd "$(dirname "$0")" && pnpm start "${FINAL_ARGS[@]}"

