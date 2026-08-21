# 后端方向决策：记忆/检索优先，引擎不叠加

> 调研日期：2026-02 · 调研对象：`deepagents` (npm v1.12.4) / LangGraph.js / pi 扩展 API（源码级核实）

## 0. 一句话结论

**不给 pi 套 deepagent。** pi 本身就是完整的 agent harness；deepagents 是另一个 harness，二者是**二选一或按任务分**的关系，不是叠加关系。真正的缺口不在引擎，而在**跨会话长期记忆 + 语义检索（RAG）**这一层。方案：**引擎保持 pi，记忆/检索独立成 pi-web 网关内的一层服务，通过 pi 扩展消费**。deepagents 保留为"第二引擎"的退出通道（引擎抽象层预留），共享同一套记忆服务。

---

## 1. 调研事实（源码级核实）

### 1.1 deepagents 是什么

- `deepagents` v1.12.4（MIT，github.com/langchain-ai/deepagentsjs），自述 "batteries-included agent harness"。
- 返回一个编译好的 **LangGraph 图**：支持 streaming、checkpointer、store。
- peer deps：`langchain ^1.5`、`@langchain/core`、`@langchain/langgraph ^1.4`、`@langchain/langgraph-checkpoint`、`langgraph-sdk`、`langsmith`。
- `createDeepAgent()` 参数（agent.ts 源码）：`model`（默认 anthropic:claude-sonnet-4-6，字符串可解析）、`tools`、`systemPrompt`、`middleware`、`subagents`、`checkpointer`（短期）、`store`（长期）、`backend`（沙箱）、`permissions`（文件系统权限）、`memory`（AGENTS.md 记忆源列表）、`skills`、`interruptOn`（人工介入）、`streamTransformers`。
- 内置工具：`ls / read_file / write_file / edit_file / glob / grep / execute`（文件系统中间件）+ `task`（子代理，隔离上下文）+ `write_todos`（规划）。自定义工具名与内置冲突会直接抛错。
- 内置中间件（middleware/ 目录）：`fs`、`subagents`、`summarization`（上下文压缩）、`memory`（AGENTS.md 注入）、`agent-memory`（已废弃）、`hitl`、`cache`、`async_subagents`、`skills`。
- 长期记忆现状：**文件型** —— `~/.deepagents/{agent}/AGENTS.md`（用户级）+ `{项目根}/.deepagents/AGENTS.md`（项目级），注入 system prompt。**不是向量/语义记忆**。语义记忆需自行接 `store` + 向量实现。
- 沙箱抽象：`BaseSandbox` / `BackendProtocolV2`，接口极小：`execute / ls / read / readRaw / write / edit / grep / glob / delete / uploadFiles / downloadFiles`。官方后端：`@langchain/node-vfs`（虚拟 FS）、`@langchain/quickjs`（WASM JS REPL）、`@langchain/deno`、`@langchain/modal`、`@langchain/daytona`（后两者为云端沙箱，走 HTTP）。**JS 生态无官方 Docker 后端**（Python 侧有 docker 相关实现可参考）。
- MCP：`@langchain/mcp-adapters` v1.1.3 存在，MCP 工具可作普通工具传入。
- 另有 `deepagents-acp`：ACP（Agent Client Protocol）服务器，供 Zed/JetBrains 等 IDE 接入。

### 1.2 记忆/检索生态（LangChain 侧）

- 短期记忆：`@langchain/langgraph-checkpoint` 的 `BaseCheckpointSaver`（SqliteSaver 等），按 thread 存对话状态。
- 长期记忆：`BaseStore`（命名空间 key-value），`store.search()` 可做语义搜索（取决于 store 实现）。
- RAG 全家桶：`langchain`（loaders/splitters/retrievers）+ `@langchain/community`（vectorstores）+ 嵌入模型。
- 嵌入：DeepSeek 官方 API **无 embeddings 端点**；本地方案 `@huggingface/transformers`（v4.2.0，ONNX 运行时，bge-small-zh 等模型离线可用）。

### 1.3 pi 侧已核实的能力（决定"记忆层放哪"）

RPC 协议（pi-main 源码 `rpc-types.ts` / `rpc-mode.ts`）：
- 短期记忆已有内置：`set_auto_compaction` / `compact`（自动压缩长上下文）+ `set_auto_retry`。
- 会话即 JSONL 文件（`<session-id>.jsonl`），可索引、可摘要 → **情景记忆的原料**。
- `--append-system-prompt` 可注入静态记忆；动态注入靠扩展。

扩展 API（`extensions/types.ts` 逐条核实）：
- `pi.on("input")` → **拦截/变换用户输入**（`transform` action），可注入检索结果。
- `pi.on("before_agent_start")` / `context` → 每次运行前注入记忆上下文。
- `pi.on("session_start")` / `session_shutdown` / `turn_end` / `agent_end` → 生命周期钩子，可自动写摘要。
- `pi.registerTool` / `pi.registerCommand` → remember/recall/forget 工具 + `/记忆` 命令。
- `pi.appendEntry` → 结构化自定义条目持久化进会话文件。
- `--extension <path>` 可附加加载（子进程启动参数已验证）。

---

## 2. 为什么不叠加（harness vs harness）

| 维度 | pi | deepagents | 结论 |
|---|---|---|---|
| agent 循环 | 成熟，编码场景久经考验 | 通用，LangGraph 状态机 | 平手，场景不同 |
| 工具集 | 编码特化（git、diff、权限门） | 通用文件/命令 | pi 胜（我们的场景） |
| 扩展生态 | **已装 6+ 个在用**（plan-mode/subagents/workflows/webui…） | 新生态，需重写 | pi 胜 |
| 短期记忆 | auto-compaction 内置 | checkpointer（更强，可跨进程） | deepagents 略胜，但 pi 够用 |
| 长期记忆 | 无内置，需扩展 | 文件型内置 + store 可扩展 | **都需要自己搭语义层** |
| RAG | 无 | LangChain 原生 | deepagents 胜 |
| 沙箱抽象 | 进程级（workspace 目录） | BackendProtocolV2 可插拔 | 双方都需容器化补强 |
| 风险 | 记忆层自研（可控） | 换引擎 = 生态清零 + 重新验证 | pi 风险更低 |

**关键洞察**：deepagents 唯一实质性增量是"记忆/检索原生"，而它自己的语义记忆也是半成品（内置只有 AGENTS.md 文件记忆）。**把语义记忆做成独立服务，比换引擎更划算 —— 两边都能用。**

---

## 3. 目标架构（记忆层独立，引擎可插拔）

```
┌────────────────────────────── pi-web 网关 (Node, 容器内) ──────────────────────────────┐
│                                                                                        │
│  REST / WS (token)                                                                     │
│   │                                                                                    │
│   ├─ session-manager ──── EngineAdapter ◄──── 预留：DeepAgentEngine（二期可选）         │
│   │        │                └─ PiRpcEngine  (现方案: pi --mode rpc 子进程)              │
│   │        │                       │  --extension memory-extension.ts                  │
│   │        ▼                       ▼                                                   │
│   │  ┌─────────────┐      ┌──────────────────┐         ┌──────────────────┐           │
│   │  │ MemoryService │◄────│ pi 子进程（每会话）│──HTTP──│ 嵌入服务           │           │
│   │  │ (网关内模块)  │      │  + memory 扩展    │        │ transformers.js   │           │
│   │  │              │      └──────────────────┘        │ bge-small-zh（本地）│          │
│   │  │ • SQLite:     │                                 └──────────────────┘           │
│   │  │   memories/   │      ┌──────────────────┐                                      │
│   │  │   session_summaries│  │ 向量检索（SQLite   │                                      │
│   │  │   documents( RAG ) │  │ 精确扫描 / sqlite-vec)│                                    │
│   │  └─────────────┘      └──────────────────┘                                      │
│   └──────────────────────────────────────────────────────────────────────────────    │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

- **引擎层**：`EngineAdapter` 接口（start/stop/send/events/artifacts），本期只有 `PiRpcEngine`。将来若要跑 deepagents（如研究型 agent），实现 `DeepAgentEngine`：把 LangGraph stream 事件映射为现有 WS 事件类型，**前端零改动**。
- **记忆层**：`MemoryService` 是网关内模块，HTTP API（`/api/memory/*`），pi 扩展与未来的 deepagents 引擎都通过它读写 —— 与引擎解耦。
- **嵌入层**：本地 `@huggingface/transformers` 跑 bge-small-zh-v1.5（约 100MB 模型，离线、免费、隐私好）。DeepSeek 无嵌入 API；配置项里留 OpenAI 兼容嵌入端点（SiliconFlow/DashScope 等）作备选。

---

## 4. 记忆分层设计（对齐"长短期记忆"痛点）

| 层 | 是什么 | 载体 | 谁写 | 谁读 |
|---|---|---|---|---|
| L0 短期 | 当前会话上下文 | pi 会话 JSONL + auto-compaction（已有） | pi 内置 | pi 内置 |
| L1 显式长期 | 用户明确写入的事实/偏好/决策 | SQLite `memories` 表（namespace=会话/工作区/全局）+ `MEMORY.md` 同步 | `remember` 工具、`/记忆` 命令、设置页 | `input`/`before_agent_start` 注入 |
| L2 情景记忆 | 历史会话发生了什么（自动摘要） | SQLite `session_summaries` + 原文 JSONL 索引 | `session_shutdown` 钩子自动摘要（LLM 生成） | 用户检索、`recall` 工具、新会话引导 |
| L3 RAG 知识库 | 用户投喂的文档/代码 | SQLite `documents` + 分块 + 向量 | 上传/`ingest` 工具 | `retrieve` 工具（top-k 相似块进上下文） |

- 检索：全部走 `recall(query, {scope})` 统一入口 → 向量相似度（L1/L2/L3 混合 top-k）→ 按 token 预算截断注入。
- 注入点：`pi.on("input")` transform（每次用户消息前检索注入）；备选 `before_agent_start`（若 RPC prompt 不经过 input 钩子，实测二选一，实现时验证）。
- 会话摘要流水线：`session_shutdown` → 取 `get_messages` → LLM 生成 200 字摘要 + 关键决策/文件清单 → 入库 + 向量化。**这是"长期记忆"的核心自动化，比 remember 工具更重要。**

## 5. 向量存储选型

- 主选：**SQLite 存向量 + JS 精确 kNN 扫描**。个人规模（≤2 万块）毫秒级，零原生依赖（与网关 node:sqlite 一致）。
- 备选：`sqlite-vec`（加载扩展，需验证与 node:sqlite 兼容）或 LanceDB。M2 时跑基准再定。

## 6. 沙箱结论（deepagent ↔ docker 通信问题的答案）

- **本期（pi 引擎）**：不引入 deepagent，问题简化为"pi 子进程的边界"：
  - 每会话独立 workspace 目录（已有）+ 路径穿越校验（已有）；
  - 部署即容器：docker-compose 单容器（已有计划），pi 子进程在容器内，天然隔离宿主；
  - 若需 OS 级隔离：后续让 pi 子进程跑进每会话 sidecar 容器（`docker exec` 走工具层，P2）。
- **二期（若上 deepagents）**：它的 `BackendProtocolV2` 只有 6 个核心操作（execute/ls/read/write/upload/download），实现一个 `DockerSandbox` 后端 = `docker exec` + `docker cp`/卷映射，约 200 行，官方无 JS Docker 后端这件事不构成障碍。

## 7. 对实施计划的影响

- M1-M3 不变（网关骨架、pi RPC 引擎、三栏前端）。
- M2 起 `session-manager` 以 `EngineAdapter` 抽象落地（+30 行接口成本），为 DeepAgentEngine 预留。
- M4 并入记忆层（原"生态"里程碑扩展）：
  - `server/src/memory/`（memories/summaries/documents + 向量检索 + 嵌入服务封装）；
  - `extensions/memory-extension.ts`（remember/recall/forget/retrieve 工具 + input 注入 + shutdown 摘要）；
  - 设置页"记忆"标签（查看/删除记忆、投喂文档、摘要历史）。
- M5 验收追加：跨会话记忆用例（会话 A 记住 → 会话 B 自动 recall）。
- 明确的**不做**：本期不引入 deepagents、不引入 LangGraph、不引入外部向量库。

## 8. 更新（2026-02）

- 用户决定：**按原计划执行 pi-web MVP**；记忆层**不在本期实现**，后续**参考 [mem0](https://github.com/mem0ai/mem0)（开源记忆层）**接入。
- 本方案第 3/4/5 节（MemoryService/分层/向量选型）降级为参考资料：届时按 mem0 的架构（提取→评分→存储→检索，图记忆 + 向量 + 键值混合）重设计，网关只保留 `EngineAdapter` 抽象与 `/api/memory/*` 的预留口子。
- 沙箱结论（第 6 节）不变。

## 9. 风险与开放问题

1. RPC 模式下 `input` 事件是否触发（`prompt` 命令走同一管线？）—— M4 第一件事实测；不行则走 `before_agent_start`。
2. transformers.js 首载模型约 100MB/几秒 —— 预热 + 进度提示。
3. 摘要 LLM 用当前会话模型（DeepSeek），成本可忽略。
4. 记忆污染：recall 结果需带来源+时间戳，用户可逐条删除（设置页）。
