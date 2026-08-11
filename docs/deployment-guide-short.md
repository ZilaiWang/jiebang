# 🚀 KnowBalance 网页部署说明（精简版）

> 给队友照着做的版本：不讲废话，按步骤来就能打开网页、配置 API、检查 Docker。

---

## ✅ 一、最终要打开的网页

启动成功后，浏览器打开：

```text
http://127.0.0.1:4175/
```

如果要给同一局域网的人访问，用你的电脑 IP：

```text
http://你的电脑IP:4175/
```

---

## 🧩 二、项目有两个服务

| 服务 | 端口 | 作用 |
|---|---:|---|
| 前端网页 | 4175 | 你看到的 KnowBalance 页面 |
| 主 Agent 后端 | 8787 | API 设置、Docker 检测、多 Agent 调度 |

平时只打开网页：

```text
http://127.0.0.1:4175/
```

后端检查地址：

```text
http://127.0.0.1:8787/health
```

---

## 🛠️ 三、队友电脑先装这 3 个东西

### 1. Bun

官网：

```text
https://bun.sh/
```

检查：

```bash
bun --version
```

能看到版本号就行。

### 2. Docker Desktop

官网：

```text
https://www.docker.com/products/docker-desktop/
```

安装后一定要打开 Docker Desktop，等它启动完成。

检查：

```bash
docker info
```

能输出信息 = Docker 已运行。

### 3. 自己的大模型 API Key

推荐示例：

| 项 | 填什么 |
|---|---|
| endpoint | `https://api.deepseek.com/chat/completions` |
| model_id | `deepseek-chat` |
| API Key | 填自己的 Key |

⚠️ 每个人用自己的 Key，不要互相传。

---

## 📁 四、项目文件夹怎么放

推荐放到：

```text
D:\KnowBalance
```

不要放在：

```text
压缩包里面
微信临时目录
OneDrive 自动同步目录
路径特别长的目录
```

进入项目根目录后，应该能看到：

```text
package.json
src
scripts
docker
启动KnowBalance.bat
```

看不到 `package.json` 就是进错目录了。

---

## ▶️ 五、最简单启动：双击 bat

在项目根目录双击：

```text
启动KnowBalance.bat
```

它会自动做：

```text
检查 Docker
安装依赖
启动主 Agent
启动前端网页
显示访问地址
```

启动完成后打开：

```text
http://127.0.0.1:4175/
```

---

## 🔑 六、首页 API 设置怎么填

打开网页后，点右上角：

```text
API设置
```

填写：

| 输入框 | 示例 |
|---|---|
| 兼容接口地址 | `https://api.deepseek.com/chat/completions` |
| 模型 ID | `deepseek-chat` |
| API Key | 你自己的 Key |

然后点：

```text
保存并启用
```

保存成功后，右上角会显示模型名，例如：

```text
deepseek-chat
```

---

## 🐳 七、Docker 怎么检查

在网页右上角点：

```text
API设置
```

弹窗里会显示 Docker 状态。

如果显示未就绪，点：

```text
🔧 一键配置 Docker
```

它会检查：

```text
Docker 命令是否存在
Docker 引擎是否运行
代码沙箱镜像是否可用
```

也可以手动打开：

```text
http://127.0.0.1:8787/orchestrator/docker-setup
```

看到：

```json
"ready": true
```

就说明 Docker 可以用了。

---

## 🧪 八、怎么确认真的启动成功

### 1. 前端检查

打开：

```text
http://127.0.0.1:4175/
```

能看到首页 = 前端成功。

### 2. 后端检查

打开：

```text
http://127.0.0.1:8787/health
```

看到：

```json
"status": "ok"
```

= 主 Agent 成功。

### 3. API 设置检查

打开：

```text
http://127.0.0.1:8787/orchestrator/provider-config
```

看到：

```json
"configured": true
```

= API 已配置。

### 4. Docker 检查

打开：

```text
http://127.0.0.1:8787/orchestrator/docker-setup
```

看到：

```json
"ready": true
```

= Docker 已就绪。

---

## 🧯 九、常见问题

### 1. 网页打不开

先确认前端是否启动。手动启动：

```bash
bun run role-d:v2:dev -- --host 127.0.0.1 --port 4175
```

### 2. 主 Agent 请求失败

先检查：

```text
http://127.0.0.1:8787/health
```

打不开就手动启动后端：

```bash
bun --env-file=.env.role-c.local scripts/learning-orchestrator-api.ts --host=127.0.0.1 --port=8787 --data-root=.tmp/integrated-orchestrator
```

### 3. API 显示未配置

回网页：

```text
API设置 → 填 endpoint / model_id / API Key → 保存并启用
```

再查：

```text
http://127.0.0.1:8787/orchestrator/provider-config
```

### 4. Docker 未就绪

先打开 Docker Desktop，再点网页里的：

```text
🔧 一键配置 Docker
```

或手动运行：

```bash
bun run docker:role-c:build
```

### 5. 出现 code-lab / C 门禁 blocked

如果看到类似：

```text
code-lab Draft 未通过可信门禁
```

这不等于网页坏了，也不等于 API 设置坏了。

意思是：

```text
C 生成的代码题没有通过可信安全/隐藏测试
```

这时把终端最后 20 行日志发给负责人，不要改 D 前端，不要伪造数据。

---

## 🔒 十、不要打包这些文件

不要发给别人：

```text
.tmp/
node_modules/
dist/
.env.role-c.local
```

尤其不要发：

```text
.tmp/integrated-orchestrator/provider-config.json
.tmp/integrated-orchestrator-fixed/provider-config.json
```

这些文件可能包含自己的 API Key。

---

## ⚡ 十一、给队友的 10 步超短版

```text
1. 安装 Bun
2. 安装 Docker Desktop
3. 打开 Docker Desktop，等它启动好
4. 解压项目到 D:\KnowBalance
5. 双击 启动KnowBalance.bat
6. 打开 http://127.0.0.1:4175/
7. 点右上角 API设置
8. 填 endpoint / model_id / 自己的 API Key
9. 点 保存并启用
10. Docker 未就绪就点“一键配置 Docker”
```

---

## ✅ 当前本机验证结果

| 检查项 | 结果 |
|---|---|
| 前端首页 | 200 |
| 主 Agent health | 200 |
| API 配置接口 | 200，已配置 |
| Docker 检测 | ready: true |
| API Key 返回前端 | 不返回 |

一句话：

```text
4175 看网页，8787 查后端；API 在首页右上角配，Docker 在 API 设置弹窗里看。
```
