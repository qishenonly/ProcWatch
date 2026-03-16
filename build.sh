#!/bin/bash

# ProcWatch 构建脚本
# 用法: ./build.sh [version] [platform]
# version: 版本号，如 1.1.0（可选，不传则使用当前版本）
# platform: darwin-amd64, darwin-arm64, windows, all

set -e

# 项目根目录
PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_ROOT"

# 从 wails.json 获取当前版本
get_current_version() {
    grep -o '"productVersion": *"[^"]*"' wails.json | head -1 | sed 's/.*: *"\([^"]*\)".*/\1/'
}

# 更新所有版本号
update_version() {
    local new_version=$1
    local current_version=$(get_current_version)

    echo ""
    echo "🔄 更新版本号: $current_version -> $new_version"
    echo ""

    # 1. 更新 wails.json
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s/\"productVersion\": *\"[^\"]*\"/\"productVersion\": \"$new_version\"/" wails.json
    else
        sed -i "s/\"productVersion\": *\"[^\"]*\"/\"productVersion\": \"$new_version\"/" wails.json
    fi
    echo "✅ 已更新 wails.json"

    # 2. 更新 app.go 中的 AppVersion 默认值
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s/AppVersion = \"[^\"]*\"/AppVersion = \"$new_version\"/" app.go
    else
        sed -i "s/AppVersion = \"[^\"]*\"/AppVersion = \"$new_version\"/" app.go
    fi
    echo "✅ 已更新 app.go"

    # 3. 更新 frontend/package.json
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s/\"version\": *\"[^\"]*\"/\"version\": \"$new_version\"/" frontend/package.json
    else
        sed -i "s/\"version\": *\"[^\"]*\"/\"version\": \"$new_version\"/" frontend/package.json
    fi
    echo "✅ 已更新 frontend/package.json"

    # 4. 更新 README.md 中的版本号
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # 更新更新日志中的版本号标题
        sed -i '' "s/### v[0-9]*\.[0-9]*\.[0-9]*/### v$new_version/" README.md
    else
        sed -i "s/### v[0-9]*\.[0-9]*\.[0-9]*/### v$new_version/" README.md
    fi
    echo "✅ 已更新 README.md"

    echo ""
    echo "🎉 版本号已全部更新为 $new_version"
}

# 验证版本号格式
validate_version() {
    local version=$1
    if [[ ! $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        echo "❌ 错误: 版本号格式不正确，应为 x.x.x 格式（如 1.1.0）"
        exit 1
    fi
}

VERSION=$(get_current_version)
if [ -z "$VERSION" ]; then
    VERSION="1.0.0"
fi

BUILD_TIME=$(date +"%Y-%m-%d_%H:%M:%S")
GIT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

# ldflags 用于注入版本信息
# 注意：BuildTime 用下划线替代空格，避免参数解析问题
LDFLAGS="-X main.AppVersion=${VERSION} -X main.BuildTime=${BUILD_TIME} -X main.GitCommit=${GIT_COMMIT}"

echo "=========================================="
echo "  ProcWatch Build Script v${VERSION}"
echo "  Build Time: ${BUILD_TIME}"
echo "  Git Commit: ${GIT_COMMIT}"
echo "=========================================="
echo ""

# 清理旧的构建文件
clean_build() {
    echo "🧹 清理构建目录..."
    rm -rf build/bin/*
}

# 构建 macOS amd64
build_darwin_amd64() {
    echo ""
    echo "📦 构建 macOS (Intel) amd64..."
    wails build -platform darwin/amd64 -clean -ldflags "${LDFLAGS}"
    if [ $? -eq 0 ]; then
        echo "✅ macOS amd64 构建成功"
        # 创建 DMG
        create_dmg "darwin-amd64"
    else
        echo "❌ macOS amd64 构建失败"
        return 1
    fi
}

# 构建 macOS arm64
build_darwin_arm64() {
    echo ""
    echo "📦 构建 macOS (Apple Silicon) arm64..."
    wails build -platform darwin/arm64 -clean -ldflags "${LDFLAGS}"
    if [ $? -eq 0 ]; then
        echo "✅ macOS arm64 构建成功"
        # 创建 DMG
        create_dmg "darwin-arm64"
    else
        echo "❌ macOS arm64 构建失败"
        return 1
    fi
}

# 构建 Windows
build_windows() {
    echo ""
    echo "📦 构建 Windows amd64..."
    wails build -platform windows/amd64 -clean -ldflags "${LDFLAGS}"
    if [ $? -eq 0 ]; then
        echo "✅ Windows 构建成功"
        # 创建 ZIP
        cd build/bin
        zip -r "ProcWatch-${VERSION}-windows-amd64.zip" ProcWatch.exe
        cd ../..
        echo "📄 已创建: build/bin/ProcWatch-${VERSION}-windows-amd64.zip"
    else
        echo "❌ Windows 构建失败"
        return 1
    fi
}

# 创建 DMG (仅 macOS)
create_dmg() {
    local arch=$1
    local app_name="ProcWatch"
    local dmg_name="ProcWatch-${VERSION}-${arch}.dmg"
    local tmp_dmg="build/tmp_dmg"

    echo "💿 创建 DMG 安装包..."

    # 创建临时目录
    rm -rf "$tmp_dmg"
    mkdir -p "$tmp_dmg"

    # 复制 app
    cp -r "build/bin/${app_name}.app" "$tmp_dmg/"

    # 创建 Applications 快捷方式
    ln -sf /Applications "$tmp_dmg/Applications"

    # 创建 DMG
    hdiutil create -volname "$app_name" \
        -srcfolder "$tmp_dmg" \
        -ov -format UDZO \
        "build/bin/${dmg_name}"

    # 清理
    rm -rf "$tmp_dmg"

    echo "📄 已创建: build/bin/${dmg_name}"
}

# 显示帮助
show_help() {
    echo "用法: ./build.sh [版本号] [平台]"
    echo ""
    echo "参数:"
    echo "  版本号          可选，格式为 x.x.x（如 1.1.0）"
    echo "                 如果提供，将自动更新所有版本号后再构建"
    echo ""
    echo "  平台            darwin-amd64   构建 macOS Intel 版本"
    echo "                 darwin-arm64   构建 macOS Apple Silicon 版本"
    echo "                 darwin         构建 macOS 通用版本 (amd64 + arm64)"
    echo "                 windows        构建 Windows 版本"
    echo "                 all            构建所有平台版本（默认）"
    echo ""
    echo "特殊命令:"
    echo "  clean           清理构建目录"
    echo "  version         显示当前版本号"
    echo "  help            显示此帮助信息"
    echo ""
    echo "示例:"
    echo "  ./build.sh                    # 使用当前版本构建所有平台"
    echo "  ./build.sh darwin-arm64       # 使用当前版本只构建 macOS arm64"
    echo "  ./build.sh 1.1.0              # 更新版本到 1.1.0 并构建所有平台"
    echo "  ./build.sh 1.1.0 darwin-arm64 # 更新版本到 1.1.0 并构建 macOS arm64"
    echo "  ./build.sh version            # 显示当前版本号"
}

# 解析参数
parse_args() {
    local arg1=$1
    local arg2=$2
    local version_arg=""
    local platform_arg=""

    # 判断第一个参数
    case "$arg1" in
        ""|"darwin-amd64"|"darwin-arm64"|"darwin"|"windows"|"all")
            # 第一个参数是平台或空
            platform_arg=${arg1:-"all"}
            ;;
        "clean"|"help"|"--help"|"-h"|"version")
            # 特殊命令
            platform_arg=$arg1
            ;;
        *)
            # 第一个参数可能是版本号
            if [[ $arg1 =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
                version_arg=$arg1
                platform_arg=${arg2:-"all"}
            else
                echo "❌ 未知参数: $arg1"
                show_help
                exit 1
            fi
            ;;
    esac

    # 如果有版本参数，先更新版本
    if [ -n "$version_arg" ]; then
        validate_version "$version_arg"
        update_version "$version_arg"
        VERSION=$version_arg
        # 重新计算 LDFLAGS
        LDFLAGS="-X main.AppVersion=${VERSION} -X main.BuildTime=${BUILD_TIME} -X main.GitCommit=${GIT_COMMIT}"
    fi

    case "$platform_arg" in
        "darwin-amd64"|"darwin-arm64"|"darwin"|"windows"|"all")
            echo ""
            echo "📦 开始构建，版本: $VERSION，平台: $platform_arg"
            echo ""
            ;;
    esac

    case "$platform_arg" in
        "darwin-amd64")
            clean_build
            build_darwin_amd64
            ;;
        "darwin-arm64")
            clean_build
            build_darwin_arm64
            ;;
        "darwin")
            clean_build
            build_darwin_amd64
            build_darwin_arm64
            ;;
        "windows")
            clean_build
            build_windows
            ;;
        "all")
            clean_build
            build_darwin_amd64
            build_darwin_arm64
            build_windows
            ;;
        "clean")
            clean_build
            echo "✅ 清理完成"
            ;;
        "version")
            echo "当前版本: $(get_current_version)"
            ;;
        "help"|"--help"|"-h")
            show_help
            ;;
    esac
}

# 主函数
main() {
    parse_args "$@"
}

main "$@"