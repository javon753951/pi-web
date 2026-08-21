# pi-web 多租户 MVP 规格说明书（Spec）

> 版本：v0.2（已定稿） · 日期：2026-02 · 状态：待开发
> 关联文档：`README.md`（现状）、`docs/backend-decision.md`（架构决策）、`docs/getting-started.md`（入门指南）、`docs/tech-stack.md`（**锁定技术栈，本版新增**）
> v0.2 变更：登录鉴权改为 **JWT**；入口增加 **Nginx 反向代理**；权限规则按用户决策修订；全前端错误文案统一中文；原待确认问题全部定稿（见第 7 节决策记录）。

---

## 0. 目标用户与核心价值

### 0.1 MVP 定义（一句话）

**把现有单用户演示版（pi-web demo）演进为一个"多租户、多用户、可管理"的最小可用平台：每个用户有自己的身份和数据，租户之间严格隔离，资源受配额与准入控制，一切关键操作可审计、可观测。**

### 0.2 目标用户（两类）

| 角色 | 是谁 | 用 MVP 做什么 |
|---|---|---|
| **平台管理员（admin）** | 平台的运营者，1 个起 | 创建租户与用户、分配配额、**管控技能市场目录**、配置 MCP 服务器、查看日志/指标/审计 |
| **租户成员（member）** | 各租户内的终端用户，如某团队开发者 | 登录后创建会话、与 Agent 对话、上传文件、**在目录内自主安装/卸载技能**、**配置自己的模型 API Key**——全部在自己数据边界内 |

### 0.3 核心价值

1. **可共享**：每人一个账号，团队/客户共用一个平台而互不可见；
2. **可信**：每个请求校验"你是谁、属于哪个租户、资源是不是你的"；文件按租户分目录，双保险；
3. **可控**：并发限额、磁盘配额、空闲回收、限速——多用户下机器不被吃垮；
4. **可追溯**：审计 + 结构化日志 + 指标，出了问题查得清；
5. **可演进**：日志/指标/审计按行业标准格式输出（pino JSON / Prometheus 文本 / trace_id 预埋），为统一监控平台（Langfuse + vLLM + Docker）零返工铺路；
6. **可维护**：全栈复用成熟开源组件（见 `docs/tech-stack.md`），不重复造轮子。

---

## 1. 功能范围

### 1.1 范围内（MVP 做）

**A. 身份与访问控制（新增）**
- 租户（tenant）、用户（user）两层模型 + JWT 鉴权；
- 登录：用户名 + 密码（argon2id 哈希存储，`@node-rs/argon2`）；
- **JWT 方案**（`@fastify/jwt`，HS256）：
  - 访问令牌（Access JWT）：有效期 15 分钟，载荷 `{sub: userId, tid: tenantId, role, jti}`，以 **httpOnly + SameSite=Lax Cookie** 下发，**绝不进 localStorage / URL**；
  - 刷新令牌（Refresh Token）：32 字节随机串，仅存 SHA-256 哈希于 `auth_sessions` 表，有效期 7 天，httpOnly Cookie（path 限定 `/api/auth`），**每次刷新即轮换**（rotate）；登出/重置密码/停用用户 = 吊销对应 refresh 行（撤销即时生效，access 至多 15 分钟内自然失效）；
  - 鉴权中间件：校验 JWT → 绑定 `{userId, tenantId, role}` 到请求上下文；
- **资源归属校验**：所有会话/工作区接口先校验资源归属；
- 角色模型两级：`admin`（平台级）与 `member`。

**B. 会话与现有功能（保留并改造）**
- 现有全部会话功能不变：创建/删除/重启、流式对话、Abort、文件上传（256MB/文件）、工作区文件树、产物追踪、打包下载、崩溃检测与"重新拉起"、浏览器通知、模型/思考级别切换；
- 会话数据挂租户/用户归属；列表/工作区按归属过滤；
- **新增"停止会话"按钮**：显式停止进程释放内存（不删工作区；记录保留，可重新拉起）。

**C. 权限规则（本版定稿）**

| 能力 | admin | member | 说明 |
|---|---|---|---|
| 技能市场目录管理（上架/下架/精选） | ✅ | ❌ | 目录即"可用技能白名单" |
| **安装/卸载技能** | ✅ | ✅ | 成员**仅限目录内已上架技能**，安装作用于**本人 agent home**（不影响他人） |
| MCP 服务器配置 | ✅ | ❌ | 全局配置，影响所有会话 |
| **模型 API Key 配置** | ✅ | ✅ | 成员写入**本人 agent home** 的 auth.json |
| 租户/用户/配额管理 | ✅ | ❌ | |
| 审计/日志/指标查看 | ✅ | ❌ | |
| 会话/工作区操作 | ✅ | ✅ | 各自仅限本人资源 |

**D. 数据隔离（新增）**
- 每租户独立数据目录：`data/tenants/<tenantId>/`（内含每用户 agent home、工作区、会话记录）；
- 每用户独立 agent home：`data/tenants/<tid>/users/<uid>/agent/`，作为该用户会话子进程的 `PI_AGENT_DIR`；
- 子进程环境变量**白名单化**：不再全量透传 `process.env`；
- **技能安装按用户隔离**（`pi install` 的 cwd/agent dir 指向本人 agent home），目录管控兜底"装什么"。

**E. 资源治理（新增）**
- **准入控制**：每用户并发会话上限（默认 3）、平台总并发上限，超限返回 429；
- **空闲回收**：会话无活动超 15 分钟自动停止进程；再次访问自动拉起（记录与文件无损）；
- **磁盘配额**：每租户工作区+日志合计默认 5GB，超限拒绝写入并中文提示；
- **限速**：登录、创建会话、WS 连接等接口限速（`@fastify/rate-limit`）。

**F. 审计（新增）**
- 事件：登录/登出/失败登录、会话创建/删除、技能安装/卸载、目录上/下架、密钥写入、MCP 变更、配额变更、租户/用户管理操作；
- 双写：`audit_log` 表 + 日志文件；仅 admin 可查。

**G. 日志与监控模块（新增，P0）**
- 结构化日志：**pino**（Fastify 内置 logger）+ **pino-roll** 按天轮转（`data/logs/gateway-*.jsonl`）；网关访问日志、会话生命周期、引擎 stderr 持久化（`data/logs/sessions/<id>.log`）；
- 指标：**prom-client**（Prometheus 官方 Node 客户端）——会话数/启动耗时/崩溃率/每会话内存采样（`/proc/<pid>/status` VmRSS，30s；Windows 跳过）；暴露 `GET /metrics`（Prometheus 文本，仅内网）；
- 日志行统一携带 `traceId`（网关侧生成）与 `tenantId/userId/sessionId`；全链路脱敏（token/apiKey/password）；
- 管理员专属"监控"页：日志流（过滤/下载）、指标面板、审计查询。

**H. 管理功能（新增）**
- 租户/用户/配额管理、重置密码、用户启停；
- 技能市场目录管理（上架/下架）；
- MCP 服务器管理、监控页。

**I. 网络入口（新增）**
- **Nginx 反向代理**为对外唯一入口：TLS 终止（HTTPS）、托管前端静态产物（`web/dist`）、`/api/*` 与 `/ws` 反代到网关（WebSocket Upgrade 透传）、`client_max_body_size 256m`；
- 网关仅监听内网（不发布端口）；`/metrics` 不对外暴露；
- 详见 `docs/tech-stack.md` 的 Nginx 配置草图。

**J. 统一中文报错（新增，全端规范）**
- 后端所有接口的错误响应 `error`/`message` 字段一律中文（含 Fastify 默认错误重写）；校验错误给出"哪一项、为什么"的中文说明；
- 前端所有错误提示（含网络异常、WS 断线、登录失败、上传失败）走统一中文文案模块；未知错误兜底文案："服务暂时不可用，请稍后重试"。

### 1.2 范围外（明确不做）

| 不做的事 | 归属 |
|---|---|
| 每会话 OS 级沙箱（sidecar 容器 / bwrap） | 二期 M3 |
| 记忆层（mem0 类长期记忆） | 远期 |
| 统一监控平台（Langfuse + vLLM + Docker 聚合界面） | 远期 P1–P3 |
| 计费、发票、用量定价 | 远期 |
| SSO / OIDC / 第三方登录 | 远期（MVP 账号密码 + JWT） |
| K8s / 多实例水平扩展 | 远期（JWT 预留 ES256 升级路径） |
| 自助注册门户 | 远期（管理员手动创建） |
| i18n 多语言 | 远期（MVP 仅中文） |
| LLM token 用量与成本统计 | 远期（Langfuse 职责） |
| 局域网扫码访问 | **移除**（token-in-URL 有泄露风险，二期重设计） |

---

## 2. 用户流程

### 2.1 管理员：首次启动引导（P0）

1. 部署时设置环境变量 `PI_WEB_ADMIN_USER` / `PI_WEB_ADMIN_PASSWORD` 创建初始 admin；**未设置时管理接口整体禁用**（安全默认）；
2. admin 登录（失败 5 次锁定 15 分钟，记录审计）→ 创建第一个租户（名称 + 配额）→ 创建用户（用户名 + 初始密码）；
3. 在技能市场目录中上架可用技能；配置 MCP 服务器（如需要）；
4. 把账号发给成员，完成。

### 2.2 管理员：日常管理

1. 登录 → 管理页：租户配额调整、用户启停/重置密码、审计查询；
2. 技能目录：上架/下架技能（下架后成员不可再新装）；
3. 设置页：MCP 服务器维护；
4. 监控页：日志流、指标面板、异常会话 stderr。

### 2.3 成员：核心使用流程

1. **登录**：用户名密码 → 获得 access/refresh 双 Cookie → 进入会话列表（只见自己的）；access 过期由前端静默调 `/api/auth/refresh` 续期；
2. **配置密钥**（首次可选）：设置页填自己的模型 API Key（写入本人 agent home，重启会话生效）；
3. **装技能**（可选）：技能广场只显示**目录内已上架**技能，点安装（装进本人 agent home，重启会话生效），可随时卸载；
4. **新建会话**：点"新建会话" → "启动中…"（5~15s）→ "运行中"；超并发上限 → 中文提示"会话数已达上限（3），请先停止或删除其他会话"；
5. **对话/文件/产物**：与现版一致；超配额 → 中文提示"存储空间不足，请联系管理员"；
6. **停止/空闲回收/崩溃恢复/删除**：空闲 15 分钟自动停止（状态"已停止"，再点击自动拉起）；崩溃条目悬停"重新拉起"；删除两次确认。

### 2.4 跨角色边界流程（安全负例，验收必测）

- 用户 A 访问用户 B 的会话 → 404/403（中文提示），日志留痕；
- 成员安装**目录外**技能 → 拒绝（"该技能未在市场中上架"）；
- 成员调用 MCP 配置 / 租户管理 / 审计接口 → 403（中文提示）；
- 未设置 admin 环境变量时，管理接口全部禁用。

---

## 3. 核心模块

### 3.1 模块总览（服务端）

```
server/src/
  auth/                       # 新增：JWT 签发/校验、refresh 轮换、登录限速（@fastify/jwt|cookie|rate-limit）
    login.ts  middleware.ts  #   argon2id 校验、Cookie 下发、请求上下文绑定 {userId, tenantId, role}
  tenancy.ts                  # 新增：租户/用户 CRUD、配额计算、数据目录解析、admin 种子
  audit.ts                    # 新增：审计事件双写
  logging/                    # 新增：日志监控模块（P0）
    logger.ts                 #   pino + pino-roll 按天轮转 + 脱敏 + 异步队列
    metrics.ts                #   prom-client 注册表（自定义指标 + Node 默认指标）
    proc-stats.ts             #   每会话内存采样（Linux 专用，Windows 跳过）
  governance.ts               # 新增：准入控制、空闲回收调度、配额检查
  marketplace/
    catalog.ts                # 改造：目录 = marketplace_allowlist 表，admin 上/下架
    installer.ts              # 改造：安装目标指向本人 agent home；成员校验目录白名单
  session-manager.ts          # 改造：归属校验、空闲计时、stderr 落盘、启动耗时埋点
  rpc-bridge.ts               # 改造：环境变量白名单、PI_AGENT_DIR 按用户注入
  config.ts                   # 改造：多租户数据目录、admin 种子、JWT 密钥（data/.jwt-secret 或 PI_WEB_JWT_SECRET）
  auth.ts（原）               # 替换为 JWT 中间件；废除单 token 与 token 注入 HTML/URL
  db.ts                       # 改造：新增 tenants/users/auth_sessions/audit_log/marketplace_allowlist 表
  api/
    rest.ts                   # 改造：归属过滤；新增 auth/admin/monitor 接口；中文错误统一
    ws.ts                     # 改造：preValidation 校验 JWT（同源 Cookie 自动携带）+ 准入控制；协议不变
```

### 3.2 数据模型（DDL 摘要）

```sql
CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  quota_bytes INTEGER NOT NULL DEFAULT 5368709120,      -- 5GB（工作区+日志）
  max_sessions_per_user INTEGER NOT NULL DEFAULT 3,
  created_at INTEGER NOT NULL
);
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,               -- @node-rs/argon2 (argon2id)
  role TEXT NOT NULL DEFAULT 'member',       -- 'admin' | 'member'
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE(tenant_id, username)
);
CREATE TABLE auth_sessions (                  -- refresh token 仓库（吊销/轮换/审计用）
  token_hash TEXT PRIMARY KEY,               -- SHA-256(refresh_token)
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT, user_id TEXT,
  action TEXT NOT NULL, target TEXT, meta TEXT,
  trace_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE marketplace_allowlist (          -- 技能目录（成员可装白名单）
  spec TEXT PRIMARY KEY,                      -- npm:name / github:user/repo
  added_by TEXT, created_at INTEGER NOT NULL
);
-- sessions 表新增列：tenant_id、user_id + 索引 idx_sessions_tenant(tenant_id, user_id)
```

### 3.3 日志与指标模块（P0 细节）

- **日志**：pino 输出 JSON（Loki 兼容）→ pino-roll 按天轮转；stderr 旁路写 `data/logs/sessions/<id>.log`；保留 7 天 / 100MB 上限（可配）；内存环形缓冲 5000 行供 tail 秒回；
- **指标**：prom-client 自定义指标 + `collectDefaultMetrics()`（Node 进程 CPU/内存）；`GET /metrics` 供未来 Prometheus 抓取；
- **脱敏**：pino redact paths（token/apiKey/authorization/password）。

---

## 4. 优先级划分

| 优先级 | 内容 | 里程碑 | 验收要点 |
|---|---|---|---|
| **P0** | JWT 登录/refresh/登出/中间件 + argon2id + 归属校验 | M1 | 双 Cookie 流程可用；吊销后 access ≤15min 失效；用户 A 无法访问用户 B 资源 |
| P0 | 租户/用户管理 + admin 种子（环境变量） | M1 | 未设 admin 时管理接口禁用；建租户建用户可用 |
| P0 | 权限矩阵：目录管控 + 成员自助装技能（本人 agent home）+ MCP admin-only + 密钥自助 | M1 | 目录外安装被拒；成员装技能不影响他人 |
| P0 | 审计双写 + 查询 | M1 | 全部关键操作可查、带 trace_id |
| P0 | 准入控制 + 空闲回收 + 配额 + 限速 | M2 | 429 中文提示；15 分钟回收、秒级拉起无损；配额超限拒绝 |
| P0 | 日志监控模块（pino/pino-roll/prom-client + 监控页） | M1.5 | `/metrics` 可被 Prometheus 抓取；崩溃 stderr 重启后仍可查 |
| P0 | Nginx 反代（TLS/静态/WS）+ 网关内网化 | M1 | 全流量经 Nginx；`/metrics` 对外不可达 |
| P0 | 全端中文报错规范 + 前端文案模块 | 全程 | 无英文错误冒泡到界面 |
| P0 | 停止会话按钮；移除 token 注入 HTML/URL 与扫码功能 | M2 | 停止后内存释放、可重新拉起 |
| P0 | 现有单用户数据迁移：首启导入默认租户（admin 归属） | M1 | 迁移后旧会话可正常打开 |
| **P1** | artifacts 写入批量化（缓解 node:sqlite 同步写） | M2 | 多会话并发无明显卡顿 |
| P1 | 每用户 API token（CLI 接入，存哈希，`Authorization: Bearer` 支持） | M2 | 可签发/吊销 |
| P1 | MCP 桥接迁移官方 SDK（`@modelcontextprotocol/sdk`）调研与评估 | M2 | 调研报告 + 决策 |
| **P2** | 每会话 sidecar 沙箱（M3）、记忆层、统一监控平台、多实例 | 二期/远期 | — |

---

## 5. 关键接口

### 5.1 认证（新增）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/login` | `{username, password}` → 校验 argon2id → 下发 access/refresh 双 Cookie；失败审计 + 限速（5 次/15 分钟锁定） |
| POST | `/api/auth/refresh` | 校验 refresh 哈希 → **轮换**（旧行删除、发新对） |
| POST | `/api/auth/logout` | 吊销 refresh 行、清 Cookie |
| GET | `/api/auth/me` | 返回 `{id, username, role, tenantId}` |

### 5.2 管理（新增，admin-only）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/api/admin/tenants` | 列表 / 创建租户 |
| PATCH | `/api/admin/tenants/:id` | 配额、并发上限 |
| GET/POST | `/api/admin/tenants/:id/users` | 列表 / 创建用户 |
| PATCH | `/api/admin/users/:id` | 启停、重置密码（吊销其全部 refresh） |
| GET | `/api/admin/audit` | 审计查询 `?userId=&action=&from=&to=` |
| POST/DELETE | `/api/admin/marketplace/catalog` | 技能目录上架 / 下架 |

### 5.3 日志与监控（admin-only + 内网）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/admin/logs` | 日志 tail/下载 `?tail=&level=&sessionId=&day=` |
| GET | `/api/admin/metrics` | 指标快照 JSON |
| GET | `/metrics` | Prometheus 文本（**仅内网，Nginx 不代理**） |

### 5.4 现有接口行为变化

| 接口 | 变化 |
|---|---|
| `GET/POST /api/sessions`、`/api/sessions/:id/*` | 按归属过滤；创建走准入控制 |
| `GET /ws?session=<id>` | preValidation 校验 JWT（Cookie）+ 归属 + 准入；协议不变 |
| `POST /api/settings/auth` | **member 可用**，写入本人 agent home |
| `POST /api/marketplace/install\|remove` | **member 可用**，校验目录白名单，安装到本人 agent home |
| `/api/mcp*` | admin-only（全局配置） |
| `GET /api/workspace/*`、files、download-zip | 归属 + 配额检查 |
| `GET /api/health` | 扩展会话数/配额概览 |

### 5.5 废弃/移除

- 单一全局 token、token 注入 HTML、`?token=` 查询参数、局域网扫码：全部移除（JWT Cookie 取代）。

---

## 6. 技术约束

1. **组件复用优先**：全栈锁定清单见 `docs/tech-stack.md`；**禁止重复造轮子**——凡有成熟官方/主流 SDK 的（JWT、密码哈希、指标、日志、限速、Cookie），一律采用；仅 pi RPC JSONL 桥、会话管理、产物追踪、工作区路径校验等**项目特有协议逻辑**保留自研；
2. **JWT 约束**：HS256 单机起步（密钥 `data/.jwt-secret` 或 `PI_WEB_JWT_SECRET`）；access 15 分钟 + refresh 7 天轮换 + 服务端吊销；**JWT 不落 localStorage、不进 URL**；多实例扩展时切换 ES256（文档化升级路径）；
3. **部署拓扑**：单机 Docker Compose，服务 = `nginx`（对外 80/443）+ `pi-web`（仅内网）；Nginx 做 TLS/静态/反代/WS 透传；
4. **单实例网关**：一个网关 + 一个 SQLite；重启后 `restore()` 恢复（现有机制）；不引入需集群协调的组件；
5. **运行时**：Node ≥ 22.5；开发机 Windows、生产 Docker/Linux 双兼容（原生依赖必须带预编译产物，proc-stats 在 Windows 优雅跳过）；
6. **性能预算**：冷启动 5–15s 可接受；空闲会话重启 < 5s；每会话内存 200–500MB 估算；日志/指标异步不阻塞事件循环；上传 256MB/文件；
7. **隔离边界**：文件 = 每租户目录 + 每用户 agent home；进程 = 环境变量白名单 + 工作区 cwd（非 OS 级沙箱，README 声明信任边界）；子进程不携带平台级密钥；
8. **安全底线**：凭证只存哈希（argon2id / SHA-256）；日志全链路脱敏；审计不可篡改、仅 admin；`/metrics` 仅内网；HTTPS 由 Nginx 终止；
9. **体验规范**：**全部面向用户/前端展示的错误一律中文**（后端错误响应中文 + 前端统一文案模块兜底）；
10. **兼容与迁移**：WS 协议、会话 JSONL、工作区布局向后兼容；首启迁移现有数据进默认租户；`traceId` 预埋（远期统一监控铺垫）；`EngineAdapter` 抽象预留（二期沙箱换轨）。

---

## 7. 决策记录与新增待确认项

### 7.1 已定稿决策（v0.2 确认，原待确认问题全部关闭）

| # | 问题 | 定稿结果 |
|---|---|---|
| D1 | 租户形态 | 平台内多租户（一套实例多客户） |
| D2 | 注册方式 | 管理员手动创建（无自助注册） |
| D3 | 初始 admin | 环境变量 `PI_WEB_ADMIN_USER/PASSWORD`，未设置则管理接口禁用 |
| D4 | 登录方式 | 用户名密码 + **JWT**（本版用户决策） |
| D5 | 角色模型 | `admin` / `member` 两级；租户管理员放二期 |
| D6 | 治理默认值 | 配额 5GB、每用户并发 3、空闲回收 15 分钟，均可配置 |
| D7 | 配额口径 | 工作区+日志合计；超限拒绝写入并中文提示 |
| D8 | 旧数据迁移 | 首启迁移进默认租户（admin 归属） |
| D9 | 日志保留 | 7 天 / 总量 100MB（可配） |
| D10 | 部署环境 | 单机 Docker Compose（Nginx + 网关） |
| D11 | 界面语言 | 仅中文；**全端错误文案统一中文**（本版用户决策） |
| D12 | 扫码功能 | 移除，二期重设计 |
| D13 | 每用户 API token | P1 可选 |
| D14 | 崩溃 stderr 可见性 | 用户本人可见 |
| D15 | LLM 路线 | 云端 API 为主；自托管 vLLM 未定（影响远期监控平台 P2） |

### 7.2 新增待确认项（开发前需拍板）

| # | 问题 | 建议默认值 |
|---|---|---|
| N1 | Nginx TLS 证书来源：自签 / Let's Encrypt(certbot) / 已有证书？ | 自签（内网）或 certbot（有域名时） |
| N2 | 对外访问入口：IP:端口 还是正式域名？ | 有域名用域名（影响 Cookie SameSite 与证书） |
| N3 | JWT HS256 单机起步接受否（多实例时切 ES256）？ | 接受 |
| N4 | 成员自助安装技能是否设数量/容量上限？ | 不设上限，仅目录管控 |
| N5 | 登录失败锁定参数确认：5 次 / 15 分钟？ | 接受 |
| N6 | 审计日志保留时长（与运行日志分开）？ | 90 天，仅 admin 可查 |

---

## 附：P0 完成定义（验收总览）

- [ ] 登录/refresh/登出全链路可用；refresh 轮换与吊销生效；两用户不同租户在 API 与文件层面互不可见（自动化负例测试）；
- [ ] 权限矩阵逐条验证：成员可装目录内技能（仅本人环境）、不可装目录外、不可配 MCP、可配自己的 API Key；
- [ ] 并发/配额/限速拒绝路径返回 **429/403 + 中文提示** 并留审计；
- [ ] 空闲 15 分钟自动停止；再次访问自动拉起且记录/文件无损；
- [ ] 崩溃 stderr 在网关重启后仍可查；`GET /metrics` 输出合法 Prometheus 文本；
- [ ] 全流量经 Nginx（HTTPS）；网关端口对外不可达；`/metrics` 对外不可达；
- [ ] **界面任何错误路径均为中文文案**（含断网、登录失败、上传失败、429/403）；
- [ ] 现有 demo 数据迁移后旧会话可正常打开；
- [ ] 4GB 内存单机、20 用户（每用户并发 ≤ 3）稳定运行 24h。
