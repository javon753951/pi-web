# GitHub 组织 agentscope-ai 仓库全景调研笔记（2026-08-18）

数据来源：官方 GitHub 组织页 https://github.com/orgs/agentscope-ai/repositories?type=all 及组织主页（均注明 "has 22 repositories available"）、各仓库页、releases.atom、PyPI、docs.agentscope.io。star/更新时间为抓取当日快照。

## 一、组织概况
- 组织共 **22 个公开仓库**（官方主页原文确认）。从 agentscope-spark-design 的官方描述（"UI Component Library for Alibaba Cloud Apsara Lab"）可确认其为阿里云飞天实验室团队，非社区猜测。
- 生态主线：主框架（agentscope / java / typescript）＋运行时（runtime 双语言）＋可视化＋记忆（ReMe）＋微调（Trinity-RFT、TuFT）＋个人助理产品线（QwenPaw 系）＋评测（OpenJudge、PawBench）。

## 二、完整仓库清单（按 star 排序，"更新"=最后 push 日期）
1. **QwenPaw** ≈33.9k★ Python 更新2026-08-18：官方描述"Your Personal AI Assistant"，可本机/云部署、接入多聊天应用的私人 AI 助理。组织内 star 第一，极活跃。
2. **agentscope** ≈29k★ Python 更新2026-08-14：主仓库，"Build and run agents you can see, understand and trust"。最新 release **v2.0.6（2026-08-07）**，与 PyPI agentscope 2.0.6（2026-08-07 上传）一致；6 月底以来 v2.0.0→v2.0.6 六连发，节奏很快。
3. **AgentTeams** ≈5.4k★ Go 更新2026-08-17：协作多智能体 OS，基于 Matrix 房间、人机协同任务调度。
4. **agentscope-java** ≈5.1k★ Java 更新2026-08-18：分布式、生产级、长时运行 Agent 的 Java 实现。
5. **ReMe** ≈3.3k★ Python 更新2026-08-18：Agent 记忆管理工具包（"Remember Me, Refine Me"），docs.agentscope.io 官方文档亦提及与 ReMe/Mem0 的记忆集成。
6. **agentscope-runtime** ≈857★ Python 更新2026-06-04：生产级 Agent 运行时：工具沙箱、Agent-as-a-Service API、可扩展部署。
7. **OpenJudge** ≈792★ Python 更新2026-08-03：统一评测与质量奖励框架。
8. **Trinity-RFT** ≈685★ Python 更新2026-08-13：LLM 强化微调（RFT）通用框架。
9. **agentscope-studio** ≈639★ TypeScript 更新2026-06-15：面向开发的可视化工具包（Studio/Dashboard 角色）。
10. **agentscope-spark-design** ≈444★ TypeScript 更新2026-08-11：阿里云飞天实验室 UI 组件库。
11. **agentscope-samples** ≈339★ Python 更新2026-04-10：官方示例集（CLI 到各类用例）。
12. **agentscope-runtime-java** ≈181★ Java 更新2026-05-07：Runtime 的 Java 实现。
13. **skills** ≈120★ Python 更新2026-04-15：AgentScope 生态与 CoPaw 应用技能集。
14. **PawBench** ≈100★ Python 更新2026-08-03：评测 LLM Agent harness 性能的基准。
15. **agentscope-typescript** ≈74★ TypeScript 更新2026-07-24："Born for agent systems"，TS 版框架。
16. **TuFT** ≈65★ Python 更新2026-08-17：多租户 LLM 微调，兼容 Tinker API。
17. **agentscope-bricks** ≈53★ Python 更新2026-01-19：兼容 agentscope/langgraph/autogen 等的生产级组件框架。
18. **DojoZero** ≈48★ Python 更新2026-07-27：在实时体育数据上运行 Agent 并预测赛果的平台。
19. **QwenPaw-Data** ≈31★ Python 更新2026-08-17：企业级数据分析（受控事实/技能库/可控执行）。
20. **docs** ≈8★ MDX 更新2026-08-12：官方文档站源码（docs.agentscope.io）。
21. **agent-identity** ≈3★ Python 更新2026-07-15：Agent 身份协议与服务。
22. **.github** ≈2★ 更新2026-05-26：组织配置档案。

## 三、用户点名仓库核对（均为直接访问 HTTP 状态）
- agentscope ✅；runtime/service ✅（agentscope-runtime + agentscope-runtime-java，无名为 "service" 的仓库）；studio ✅（agentscope-studio，无 "dashboard"）；examples → 无独立 examples 仓库，对应 **agentscope-samples**；memory → 无同名仓库，记忆方向为 **ReMe**；finetuning 相关 → **Trinity-RFT、TuFT**；agentscope-format ❌404、cache ❌404、agent-service ❌404（Agent-as-a-Service 能力已并入 agentscope-runtime，官方描述可证）。

## 四、维护状态分层
- 极活跃（近一周有 push，2026-08 中旬）：QwenPaw、agentscope、agentscope-java、ReMe、AgentTeams、Trinity-RFT、TuFT、QwenPaw-Data、docs。
- 一般活跃（2026 年 4–6 月最后更新）：agentscope-runtime、agentscope-studio、agentscope-runtime-java、skills、agentscope-samples。
- 疏于更新：agentscope-bricks（最后 push 2026-01-19，半年余无更新，疑似停滞——官方未声明停更，属推断）。

## 五、信息可信度备注
- 以上仓库名、描述、star、日期全部来自 GitHub 官方页面直接抓取（官方确认）。
- 【社区/二手】Bing 搜索见中文媒体称 QwenPaw 已迭代 2.0/2.1 版本（如"QwenPaw 2.1 把个人 Agent 做成工作区"等文章），版本节奏未经 GitHub release 页逐一核实。
- 未采用 GitHub REST API（匿名请求被限流）；HTML 页面数据同样来自 github.com 官方域名，可信度等同。
