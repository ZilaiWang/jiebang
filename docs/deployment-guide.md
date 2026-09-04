# KnowBalance 网页部署说明（给队友看的最新版）

> 目标：队友拿到项目文件夹后，能在自己电脑上启动 KnowBalance 网页，配置 Docker，并接入自己的大模型 API。

---

## 1. 最终要打开哪个网页？

启动成功后，在浏览器打开：

```text
http://127.0.0.1:4175/
```

如果你想让同一局域网的别人访问你的电脑，需要用你的电脑 IP：

```text
http://你的电脑IP:4175/
```

例如：

```text
http://192.168.1.23:4175/
```

---

## 2. 这个项目启动后有两个服务

| 服务 | 默认端口 | 作用 |
|---|---:|---|
| 前端网页 | 4175 | 用户看到和操作的网页 |
| 主 Agent 后端 | 8787 | 负责诊断、调用 A/B/C、保存 API 设置、检测 Docker |

也就是说：

```text
网页地址：http://127.0.0.1:4175/
后端健康检查：http://127.0.0.1:8787/health
```

你平时只需要打开网页地址。

---

## 3. 队友电脑需要提前安装什么？

### 必装 1：Bun

Bun 用来安装依赖、启动前端和后端。

官网：

```text
https://bun.sh/
```

安装后，打开终端运行：

```bash
bun --version
```

能看到版本号就说明装好了。

---

### 必装 2：Docker Desktop

Docker 用来运行 C 代码题的安全沙箱。

官网：

```text
https://www.docker.com/products/docker-desktop/
```

安装后必须打开 Docker Desktop，等它完全启动。

检查命令：

```bash
docker info
```

如果能输出 Docker 信息，说明 Docker 引擎已启动。

如果提示 daemon / engine 没运行，就先打开 Docker Desktop，等 1-2 分钟再试。

---

### 必装 3：自己的大模型 API Key

每个人用自己的 API Key，不要用别人的。

推荐 DeepSeek：

| 项 | 示例 |
|---|---|
| 接口地址 | `https://api.deepseek.com/chat/completions` |
| 模型 ID | `deepseek-chat` |
| API Key | 填自己的 Key |

也可以用其他 OpenAI-compatible 接口，只要是 `/chat/completions` 格式即可。

---

## 4. 收到项目文件夹后怎么放？

建议放在 D 盘简单路径，例如：

```text
D:\KnowBalance
```

不要放在：

```text
微信临时目录
压缩包里面
OneDrive 自动同步目录
路径特别长的中文目录
```

虽然项目能处理部分中文路径，但为了队友部署少出错，推荐简单路径。

进入项目根目录后，应能看到这些文件/文件夹：

```text
package.json
src
scripts
docker
启动KnowBalance.bat
docs
```

如果看不到 `package.json`，说明你进错目录了。

---

## 5. 最简单启动方式：双击启动脚本

在项目根目录双击：

```text
启动KnowBalance.bat
```

它会自动做这些事：

1. 检查 Docker 是否运行；
2. 如果 Docker 已运行，检查/构建 C 代码沙箱镜像；
3. 检查 `node_modules`；
4. 如果没安装依赖，自动运行 `bun install`；
5. 启动主 Agent 后端；
6. 启动前端网页；
7. 等服务可访问后提示网页地址。

启动完成后，终端会显示：

```text
启动完成！
本机访问：http://127.0.0.1:4175/
局域网访问：http://你的IP:4175/
```

然后打开：

```text
http://127.0.0.1:4175/
```

---

## 6. 第一次打开网页后要做什么？

进入首页后，先看右上角：

```text
API设置
```

点击它，填写三项：

| 字段 | 怎么填 |
|---|---|
| 兼容接口地址 | 例如 `https://api.deepseek.com/chat/completions` |
| 模型 ID | 例如 `deepseek-chat` |
| API Key | 填自己的 API Key |

然后点击：

```text
保存并启用
```

保存成功后，右上角按钮会显示模型名，例如：

```text
deepseek-chat
```

---

## 7. API Key 会不会泄露？

正常不会。

API Key 只会保存到你自己电脑的本地运行目录：

```text
# 如果双击 启动KnowBalance.bat 启动
.tmp/integrated-orchestrator-fixed/provider-config.json

# 如果用手动命令启动
.tmp/integrated-orchestrator/provider-config.json
```

网页查询配置时，只返回这些公开信息：

```json
{
  "configured": true,
  "provider_mode": "model",
  "endpoint": "https://api.deepseek.com/chat/completions",
  "model_id": "deepseek-chat"
}
```

不会返回：

```text
api_key
```

所以不要把 `.tmp` 文件夹打包发给别人。

---

## 8. Docker 在网页里怎么看？

首页右上角点：

```text
API设置
```

弹窗顶部会显示 Docker 状态。

如果 Docker 正常，会看到类似：

```text
Docker 代码沙箱已就绪
```

如果 Docker 没就绪，会提示原因，并出现：

```text
🔧 一键配置 Docker
```

点击后，系统会调用后端：

```text
POST /orchestrator/docker-setup
```

它会尝试：

1. 检查 Docker 命令是否存在；
2. 检查 Docker 引擎是否运行；
3. 如果镜像不存在，构建代码沙箱镜像。

---

## 9. 如何手动检查 Docker 是否配置成功？

浏览器打开：

```text
http://127.0.0.1:8787/health
```

如果看到：

```json
{
  "status": "ok",
  "service": "learning-orchestrator",
  "docker": {
    "ready": true
  }
}
```

说明 Docker 已经可用。

也可以打开：

```text
http://127.0.0.1:8787/orchestrator/docker-setup
```

如果看到：

```json
{
  "ready": true,
  "steps": [
    "找到 Docker 二进制",
    "Docker 引擎已运行"
  ]
}
```

说明 Docker 检测和配置接口正常。

---

## 10. 如果双击 bat 失败，怎么手动启动？

在项目根目录打开终端。

先安装依赖：

```bash
bun install
```

然后开两个终端。

---

### 终端 1：启动主 Agent

```bash
bun --env-file=.env.role-c.local scripts/learning-orchestrator-api.ts --host=127.0.0.1 --port=8787 --data-root=.tmp/integrated-orchestrator
```

看到类似下面内容，说明后端启动成功：

```json
{
  "service": "learning-orchestrator",
  "status": "listening",
  "url": "http://127.0.0.1:8787"
}
```

---

### 终端 2：启动前端

```bash
bun run role-d:v2:dev -- --host 127.0.0.1 --port 4175
```

看到类似下面内容，说明前端启动成功：

```text
Local: http://127.0.0.1:4175/
```

然后打开：

```text
http://127.0.0.1:4175/
```

---

## 11. 如果想让同一局域网的人访问你的网页

手动启动时，把 host 改成 `0.0.0.0`：

### 主 Agent

```bash
bun --env-file=.env.role-c.local scripts/learning-orchestrator-api.ts --host=0.0.0.0 --port=8787 --data-root=.tmp/integrated-orchestrator
```

### 前端

```bash
bun run role-d:v2:dev -- --host 0.0.0.0 --port 4175
```

然后查你的电脑 IP。

Windows 可以运行：

```bash
ipconfig
```

找到类似：

```text
IPv4 地址 . . . . . . . . . . . . : 192.168.1.23
```

别人访问：

```text
http://192.168.1.23:4175/
```

注意：Windows 防火墙如果拦截，需要允许访问。

---

## 12. 如何确认 API 设置真的保存成功？

浏览器打开：

```text
http://127.0.0.1:8787/orchestrator/provider-config
```

看到类似：

```json
{
  "configured": true,
  "provider_mode": "model",
  "endpoint": "https://api.deepseek.com/chat/completions",
  "model_id": "deepseek-chat"
}
```

说明 API 设置已保存。

如果：

```json
"configured": false
```

说明还没保存成功，需要回网页右上角重新点：

```text
API设置 → 填写三项 → 保存并启用
```

---

## 13. 如何确认前端和后端都启动了？

### 检查前端

打开：

```text
http://127.0.0.1:4175/
```

能看到 KnowBalance 首页，就是前端启动成功。

### 检查后端

打开：

```text
http://127.0.0.1:8787/health
```

看到：

```json
"status": "ok"
```

就是主 Agent 后端启动成功。

---

## 14. 常见问题和解决办法

### 问题 1：网页打不开

先检查前端有没有启动。

如果没有，重新运行：

```bash
bun run role-d:v2:dev -- --host 127.0.0.1 --port 4175
```

如果提示端口被占用，先关掉旧终端，或者重启电脑。

---

### 问题 2：主 Agent 请求失败

先打开：

```text
http://127.0.0.1:8787/health
```

如果打不开，说明后端没启动。

重新运行：

```bash
bun --env-file=.env.role-c.local scripts/learning-orchestrator-api.ts --host=127.0.0.1 --port=8787 --data-root=.tmp/integrated-orchestrator
```

如果 health 是 200，但页面流程 blocked，那就不是“请求失败”，而是 C 生成或可信门禁没通过，需要看终端日志。

---

### 问题 3：Docker 未就绪

先打开 Docker Desktop。

然后运行：

```bash
docker info
```

如果 Docker 正常，再运行：

```bash
bun run docker:role-c:build
```

或者网页里点：

```text
API设置 → 🔧 一键配置 Docker
```

---

### 问题 4：API Key 保存后还是显示未配置

检查：

```text
http://127.0.0.1:8787/orchestrator/provider-config
```

如果还是：

```json
"configured": false
```

按顺序做：

1. 确认主 Agent 后端在运行；
2. 回网页点 `API设置`；
3. 三项都填完整；
4. 点 `保存并启用`；
5. 刷新网页再看。

---

### 问题 5：模型调用失败

可能原因：

1. API Key 错；
2. 模型额度不足；
3. endpoint 写错；
4. model_id 写错；
5. 当前网络访问不了模型服务。

建议先用 DeepSeek 示例：

```text
endpoint: https://api.deepseek.com/chat/completions
model_id: deepseek-chat
api_key: 你自己的 Key
```

---

### 问题 6：代码题 / C 生成 blocked

如果页面或终端出现类似：

```text
code-lab Draft 未通过可信门禁
role-c.code-lab.secure.execution-repair 未在有限修复次数内通过校验
```

说明：

```text
前端是好的
API 设置是好的
Docker 检测通常也是好的
问题在 C 生成内容没有通过安全/隐藏测试门禁
```

这时不要乱改前端，也不要伪造数据。把终端最后 20 行日志发给负责人。

---

## 15. 不要打包或发送这些文件

不要发送：

```text
.tmp/
node_modules/
dist/
.env.role-c.local
```

尤其不要发送：

```text
.tmp/integrated-orchestrator/provider-config.json
.tmp/integrated-orchestrator-fixed/provider-config.json
```

这些文件可能含有自己的 API Key。

---

## 16. 给队友的超短版步骤

如果队友只想快速跑起来，直接发这段：

```text
1. 安装 Bun：https://bun.sh/
2. 安装 Docker Desktop：https://www.docker.com/products/docker-desktop/
3. 打开 Docker Desktop，等它启动完成
4. 解压项目到 D:\KnowBalance
5. 双击 启动KnowBalance.bat
6. 浏览器打开 http://127.0.0.1:4175/
7. 点右上角 API设置
8. 填 endpoint / model_id / 自己的 API Key
9. 点 保存并启用
10. 如果 Docker 未就绪，点“一键配置 Docker”
11. 新建学习计划开始测试
```

---

## 17. 本机当前验证结果

当前这份说明对应的本机验证结果：

| 检查项 | 结果 |
|---|---|
| 前端首页 | HTTP 200 |
| 主 Agent health | HTTP 200 |
| provider-config | HTTP 200 |
| API Key 不返回前端 | 已验证 |
| Docker health | `ready: true` |
| docker-setup 接口 | `ready: true` |
| provider-config 单测 | 10 pass / 0 fail |
| 前端 build | 通过 |

验证命令：

```bash
curl http://127.0.0.1:8787/health
curl http://127.0.0.1:8787/orchestrator/provider-config
curl -X POST http://127.0.0.1:8787/orchestrator/docker-setup
bun test --isolate tests/provider-config-api.test.ts src/role-d-ui-v2/src/orchestrator-client.test.ts --timeout 60000
bun run role-d:v2:build
```

---

## 18. 最重要的一句话

如果网页打不开，先查 4175。  
如果主 Agent 请求失败，先查 8787。  
如果 C 代码题 blocked，不要改 D 前端，要看 C 的可信门禁日志。
