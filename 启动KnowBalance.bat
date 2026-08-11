@echo off
chcp 65001 >nul
title KnowBalance 一键启动

echo ========================================
echo   KnowBalance 多Agent协同学习空间
echo   一键启动脚本
echo ========================================
echo.

:: ── 1. 检查 Docker（不阻断，网页内可一键配置） ──
echo [1/3] 检查 Docker ...
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo   ! Docker 引擎未运行。请启动 Docker Desktop 后，在网页API设置中点击「一键配置 Docker」。
    echo     下载地址：https://www.docker.com/products/docker-desktop/
) else (
    echo   ✓ Docker 已就绪
    :: 有 Docker 就顺便构建镜像
    docker image inspect knowbalance-role-c-python-runner:1.0.0 >nul 2>&1
    if %errorlevel% neq 0 (
        echo   正在构建代码沙箱镜像...
        docker build -t knowbalance-role-c-python-runner:1.0.0 -f docker/role-c-python-runner/Dockerfile docker/role-c-python-runner/ >nul 2>&1
        if %errorlevel% neq 0 echo   ! 镜像构建失败，可在网页API设置中重试
    )
)

:: ── 2. 检查依赖 ──
echo [2/3] 检查依赖 ...
if not exist "node_modules" (
    echo   正在安装依赖（首次启动需约 2 分钟）...
    call bun install
)
echo   ✓ 依赖就绪

:: ── 3. 启动服务 ──
echo [3/3] 启动服务 ...

start "KnowBalance-主Agent" /MIN bun --env-file=.env.role-c.local scripts/learning-orchestrator-api.ts --host=0.0.0.0 --port=8787 --data-root=.tmp/integrated-orchestrator-fixed

echo   等待主 Agent 启动...
:wait_agent
timeout /t 2 /nobreak >nul
curl -s http://127.0.0.1:8787/health >nul 2>&1
if %errorlevel% neq 0 goto wait_agent
echo   ✓ 主 Agent 已启动（http://0.0.0.0:8787）

start "KnowBalance-前端" /MIN bun run role-d:v2:dev -- --host 0.0.0.0 --port 4175

echo   等待前端启动...
:wait_front
timeout /t 2 /nobreak >nul
curl -s http://127.0.0.1:4175/ >nul 2>&1
if %errorlevel% neq 0 goto wait_front

echo.
echo ========================================
echo   启动完成！
echo.
echo   本机访问：http://127.0.0.1:4175/
echo   局域网访问：http://你的IP:4175/
echo.
echo   ① 点右上角「API设置」- 填入模型接口 + Key
echo   ② 若 Docker 未就绪，点击「🔧 一键配置 Docker」
echo   ③ 新建学习计划
echo ========================================
pause >nul
