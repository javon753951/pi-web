# Pi Web

单用户自用的 Pi Agent Web 服务：React 三栏前端 + Node 网关 + **每会话一个 `pi --mode rpc` 子进程**。

```
浏览器 (React 19 + Vite + Tailwind 4)
   │  REST + WebSocket (Bearer token)
   ▼
Fastify 网关 (:8787) ──── SQLite 元数据 (node:sqlite)
   │  会话管理 / 崩溃检测 / 产物追踪 / 技能广场 / MCP 桥接
   ▼
pi --mode rpc 子进程 × N （每会话一个，cwd = data/workspaces/<会话ID>/）
```

## 快速开始

### 本机模式

```bash
npm install
npm run dev        # 网关 :8787 + vite :5188（推荐开发）
# 或生产模式：
npm run build
npm start          # 网关托管 web/dist :8787
```

打开 http://127.0.0.1:8787 （dev 模式为 http://127.0.0.1:5188）。

### Docker 模式

```bash
npm run build
cd docker && docker compose up -d --build
# 打开 http://127.0.0.1:8787
# 带办公全家桶（+LibreOffice，文档转 PDF）：
# docker build --build-arg WITH_OFFICE=1 -t pi-web-office -f docker/Dockerfile .. && docker compose up -d
```

镜像内置办公依赖（agent 开箱即用，不用现场装包）：Python venv（`/opt/py`，pandas/openpyxl/python-docx/python-pptx/pypdf/pdfplumber/matplotlib/bs4/lxml 等，清华 pip 源）、pandoc、poppler、zip/jq、**中文字体（fonts-noto-cjk，画图/转 PDF 不出豆腐块）**；`WITH_OFFICE=1` 追加 LibreOffice headless（`soffice --headless --convert-to pdf`）。venv 不受 Debian PEP 668 限制，agent 运行中仍可 `pip install` 临时包。

## 鉴权

- 首次启动自动生成 token 存 `data/.token`，也可用环境变量 `PI_WEB_TOKEN` 覆盖。
- 生产模式网关把 token 注入到所服务的 index.html；dev 模式由 vite 插件注入（读取同一份 `.token`）。
- 所有 `/api/*` 与 `/ws` 需要 `Authorization: Bearer <token>`（WS 也接受 `?token=` 查询参数）。
- 单用户设计：token 不落浏览器存储（除手动保存）。**请勿暴露到公网**。

## 配置（环境变量）

| 变量 | 默认 | 说明 |
|---|---|---|
| `PI_WEB_PORT` | 8787 | 网关端口 |
| `PI_WEB_PUBLIC_PORT` | 同 `PI_WEB_PORT` | 二维码/局域网链接对外公布的端口（dev 模式自动指向 vite :5188；docker 可设宿主映射端口） |
| `PI_WEB_HOST` | 127.0.0.1 | 监听地址（局域网扫码访问需 `0.0.0.0`，docker 已默认） |
| `PI_WEB_DATA` | `<项目根>/data` | 数据目录（sessions/workspaces/mcp/pi-web.db） |
| `PI_WEB_TOKEN` | 自动生成 | Bearer token |
| `PI_CLI_PATH` | 自动探测 | pi CLI 路径（`~/.pi/agent/npm/.../cli.js` → PATH `pi`） |
| `PI_AGENT_DIR` | `~/.pi/agent` | pi 用户配置目录（auth.json/settings.json/扩展） |

## 功能

- **三栏布局**：左栏会话历史（搜索/删除/崩溃后重新拉起）；中栏流式 Chat（markdown、思考折叠、工具卡片、模型/思考级别选择、Abort）；右栏工作区文件树（懒加载、忽略 node_modules、预览/下载）与「产物」追踪（write/edit 工具实时入库）。
- **文件进出**：Composer 支持📎按钮 / 拖拽 / 剪贴板粘贴上传到会话工作区（`.zip` 自动解包，中文文件名兼容 GBK；同名自动改名防覆盖）；文件树悬停勾选多项「打包下载」zip；产物页一键打包全部产物。
- **浏览器通知**：状态条 🔔 开启后，页面切到后台时——任务完成 / 会话崩溃 / Agent 等待审批——系统通知提醒，点击跳回对应会话。
- **局域网访问**：状态条二维码弹层展示本机局域网地址（链接自带 token），手机/平板扫码即用；`npm run dev` 下二维码指向 vite :5188、`npm start`/docker 指向网关 :8787。监听在 127.0.0.1 时弹层会直接提示：需设 `PI_WEB_HOST=0.0.0.0` 并放行 Windows 防火墙端口（docker 模式默认可达）。已过滤虚拟网卡（vEthernet/WSL/VMware 等）并把主网卡地址排在最前。
- **技能广场**：已安装扫描（extensions/skills/npm 包）、内置精选目录、npm registry 搜索（按 `pi` 字段过滤，走系统代理）、`pi install/remove` 流式日志执行。
- **MCP 桥接**：`extensions/mcp-bridge.ts` 零依赖 stdio 桥（手写 JSON-RPC 2.0，inputSchema→TypeBox），配置存 SQLite → 生成 `data/mcp/mcp-bridge-config.json` → 会话启动时附加加载。SSE/HTTP transport 为后续路线。
- **模型/密钥**：读取 `~/.pi/agent/models-store.json` 与 `auth.json`；设置页可直接写入新密钥（重启会话生效）。

## 目录结构

```
server/          Node 22+ TS 网关（Fastify 5，node:sqlite）
  src/
    rpc-bridge.ts       pi 子进程 JSONL 桥（LF 帧解析、进程树 kill）
    session-manager.ts  会话生命周期（create/restart/stop/崩溃检测/重启恢复）
    workspace.ts        工作区文件树/预览/下载（路径穿越校验）
    transfer.ts         上传落盘 / zip 解包（GBK 名）/ 多选打包下载
    artifacts.ts        write/edit 工具产物追踪
    marketplace/        目录 / npm 搜索 / 安装器
    mcp/                MCP 配置生成
    api/rest.ts ws.ts   REST + WS 协议
web/             React 19 前端（三栏布局，shadcn 风格组件）
extensions/      mcp-bridge.ts（pi 扩展，随会话加载）
docker/          Dockerfile + docker-compose.yml
docs/            backend-decision.md（架构决策：引擎不叠加、记忆层独立、mem0 接入预留）
```

## WS 协议摘要

- 上行：RPC 命令对象直传（`prompt`/`abort`/`set_model`/`get_messages`…）、`{type:"sync"}`、`{type:"ui_response",...}`
- 下行：`{type:"event", event}`（pi 事件透传）、`{type:"response",...}`、`{type:"lifecycle", status}`、`{type:"artifact", artifact}`、`{type:"ui_request", request}`、`{type:"sync", session, state, messages, artifacts}`
- 客户端断线重连后发 `sync` 取快照。

## 测试

```bash
npm test          # vitest 单测（JSONL 帧解析/路径穿越/生命周期/DB/产物…）
npm run smoke     # 真实 pi --mode rpc 集成冒烟（需本机装有 pi，无 API key）
```

## 安全边界与路线图

- 每会话独立工作区目录 + 网关路径校验；**pi 子进程在宿主机上无 OS 级隔离**（可读宿主文件）。公网部署请置于可信网络/反代后。
- 已装扩展与 API key 写入全局 `~/.pi/agent`（单用户设计，README 明示风险）。
- P1：记忆层（参考 mem0 架构：长短期记忆 + RAG，见 `docs/backend-decision.md`）。
- P2：每会话 OS 级沙箱（sidecar 容器，工具层走 `docker exec`）；会话闲置休眠；工作区文件编辑。

## 排错

- 会话启动即崩溃：查看左栏会话条目下的 stderr 尾部（多为扩展加载失败，如 `omp-wechat` 依赖缺失 —— 在技能广场「已安装」中确认或 `pi remove` 移除后重启会话）。
- 广场搜索失败：检查宿主机代理（网关通过 `HTTP_PROXY`/`HTTPS_PROXY` 环境变量走代理；docker 模式见 compose 注释）。
