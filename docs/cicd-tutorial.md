# pi-web CI/CD 手把手教程

> 这份文档记录本仓库 CI/CD 流水线的完整搭建过程：每个阶段的原理、每段配置的作用、
> 一次性准备工作（Secrets / 服务器）和排错手册。流水线文件带中文注释，配合本文食用。

## 0. 全景图：这套流水线长什么样

```
开发者 git push / 开 PR
        │
        ▼
┌─ ci.yml（高频、只读）────────────────────────────┐
│  test-server ─┐                                  │
│               ├─ 并行跑单测 ──► build 汇总构建    │
│  test-web ────┘                                  │
└──────────────────────────────────────────────────┘
        │ 质量门禁绿了，代码合入 main
        ▼
开发者 git tag v0.1.0 && git push --tags
        │
        ▼
┌─ release.yml（低频、有写权限、动生产）───────────┐
│  image job：npm build → docker build → 推 GHCR   │
│      │                                           │
│      ▼ needs                                     │
│  deploy job：SSH 到服务器 pull + up -d + 健康检查 │
└──────────────────────────────────────────────────┘
        │
        ▼
Aliyun 服务器：ghcr.io/javon753951/pi-web:v0.1.0 运行中
```

一句话总结分工：**CI 管「每次改动」保质量，tag 管「发布」，流水线管「把发布变成一条命令」**。

| 文件 | 角色 |
|---|---|
| `.github/workflows/ci.yml` | push main / PR 触发：双端测试 + 构建 |
| `.github/workflows/release.yml` | 打 `v*` tag 触发：镜像发布 + 自动部署 |
| `docker/docker-compose.prod.yml` | 服务器侧编排：拉镜像而非本地构建 |
| `.dockerignore` | 瘦身 build context（提速 + 防止本地数据进镜像） |
| 根 `package.json` 的 `test` 脚本 | `npm test --workspaces --if-present`，本地一条命令跑双端 |

## 1. 预备概念（5 分钟版）

- **CI（持续集成）**：每次 push 都自动「编译 + 测试」，问题在合入前暴露，而不是上线后。
- **CD（持续交付/部署）**：验证通过的代码自动打成制品（这里是 Docker 镜像）并送到运行环境。
- **GitHub Actions 模型**，对照配置文件理解：
  - **workflow**：一个 `.github/workflows/*.yml` 文件；
  - **on**：触发器，push / pull_request / push tags / 手动 workflow_dispatch……
  - **job**：一组步骤，默认各 job 在**独立虚拟机（runner）**上并行跑，`needs` 声明依赖；
  - **step**：要么是 shell 命令（`run`），要么是市场里可复用的动作（`uses`）；
  - **GITHUB_TOKEN**：每次运行临时发放的仓库令牌，用 `permissions:` 收窄它的权限；
  - **Secrets**：加密的环境配置（服务器 IP、SSH 私钥），仓库 Settings 里配置，日志里自动打码；
  - **Environment**：给部署 job 挂一个「环境」标签，之后可加审批人等人工门禁。

## 2. 阶段一：CI 质量门禁（ci.yml）

触发与防浪费：

```yaml
on:
  push:
    branches: [main]   # 只有 main 的 push 跑，其他分支的 push 不烧配额
  pull_request:        # 任何 PR 都跑，合并前给你亮红灯/绿灯
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true   # 同分支连推多个 commit：取消旧的，只跑最新
```

测试拆成 `test-server` / `test-web` 两个**并行 job**：互相独立，谁挂了在 Checks 页一眼定位；
`build` job 用 `needs: [test-server, test-web]` 等 both 绿了才构建——测试不过不浪费构建时间。

两个关键提速点：
1. `actions/setup-node` 的 `cache: npm`——按 `package-lock.json` 哈希缓存 `~/.npm`，
   依赖不变时 `npm ci` 从缓存恢复，快一个量级；
2. `npm ci` 而非 `npm install`——严格按 lockfile 装，lockfile 与 package.json 不同步直接报错。

**本地验证**（推之前先在本地确认这些能过，CI 只是复现它们）：

```bash
npm test          # 双端单测（server 49 + web 12）
npm run build     # server tsc + web vite
```

**体验门禁**：开一个分支改挂一个测试 → push → 发 PR → Checks 全红、merge 被挡；
仓库 Settings → Branches → Add branch protection rule：`main` 勾选
「Require a pull request」与「Require status checks」（选 ci.yml 的三个 job）。

## 3. 阶段二：镜像发布（release.yml 的 image job）

```yaml
on:
  push:
    tags: ['v*']       # 只有 v 开头的 tag 触发；CI 照常跑，发布只认 tag
permissions:
  contents: read       # 最小权限：这次运行只给「读代码 + 推镜像包」
  packages: write
```

**镜像标签策略**（docker/metadata-action 按 git tag `v0.1.0` 自动生成）：

| 镜像 tag | 用途 |
|---|---|
| `0.1.0` / `0.1` / `1` | semver 三段式，方便按大版本锁定 |
| `v0.1.0` | 与 git tag 一一对应，**部署脚本用的就是它**（可精确回滚） |
| `latest` | 常规版本追加；预发布（tag 带 `-`）不更新 latest |

**为什么 CI 里先 `npm run build` 再 docker build？**
现有 `docker/Dockerfile` 是「COPY 预构建产物」的设计（L4 层 COPY server/dist 与 web/dist），
而 dist 在 .gitignore 里、git checkout 后不存在——所以必须在 runner 上先构建，
让 build context 里出现新鲜 dist，buildx 才 COPY 得到。多阶段构建（镜像内自构建）
是进阶改造方向，见第 8 节。

**Docker 层缓存**：`cache-from/to: type=gha` 把镜像层缓存存进 GitHub 缓存。镜像里
apt / pip venv / 全局 npm 那几层几乎不变，命中缓存后每次发布只重建「COPY 产物」之后的层。

**首次发布后必做（一次性）**：GHCR 新包默认**私有**。到 GitHub → 右上头像 →
Your packages → `pi-web` → Package settings → Danger Zone → Change visibility → **Public**。
否则服务器匿名拉取会 401。

## 4. 阶段三：自动部署（release.yml 的 deploy job + 一次性准备）

部署流派选了**服务器拉镜像**：编排文件进 git、CI 只 SSH 过去执行
`pull + up -d + 健康检查`。对比「CI 把文件推给服务器」：不依赖服务器存源码、
幂等可重复、回滚就是换个 tag 再跑一遍。

### 4.1 服务器一次性准备（Ubuntu / Alibaba Cloud Linux 都覆盖）

```bash
# ① 装 Docker（二选一；官方脚本最省事）
curl -fsSL https://get.docker.com | bash              # Ubuntu 通用
# Alibaba Cloud Linux：sudo dnf install -y docker-ce docker-compose-plugin
#   （先配 aliyun 镜像源，参考阿里云官方文档）
sudo systemctl enable --now docker

# ② 准备部署目录（deploy job 也会幂等地创建，这里手动建好更直观）
mkdir -p ~/pi-web/data

# ③ 写 .env 固定 token 与端口（没有 token 就用手机扫过保存的那个）
cat > ~/pi-web/.env <<'EOF'
PI_WEB_TOKEN=你的token
PI_WEB_PORT=8787
PI_WEB_IMAGE_TAG=latest
EOF

# ④ 部署专用 SSH 密钥（在【本地】生成，别复用日常密钥）
ssh-keygen -t ed25519 -C "pi-web-deploy" -f deploy_key   # 生成 deploy_key / deploy_key.pub
# 把公钥追加到服务器：
cat deploy_key.pub | ssh 用户名@服务器IP 'mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys'
# 本地验证免密可登录：
ssh -i deploy_key 用户名@服务器IP 'docker --version'

# ⑤ 云安全组放行：入方向 TCP 8787（服务）——22 端口确认仅对需要的 IP 开放
# ⑥ 首次部署后进容器完成 pi 登录（auth.json 存在 pi-agent 卷里，之后部署不丢）
ssh 用户名@服务器IP
docker exec -it pi-web pi   # 按提示登录/粘贴 API key
```

### 4.2 GitHub Secrets 配置（仓库 → Settings → Secrets and variables → Actions）

| Secret 名 | 值 |
|---|---|
| `DEPLOY_HOST` | 服务器公网 IP |
| `DEPLOY_USER` | SSH 用户名（如 root） |
| `DEPLOY_SSH_PRIVATE_KEY` | `deploy_key` **私钥**全文（含 BEGIN/END 行） |

### 4.3 deploy job 做了什么

1. `mkdir -p ~/pi-web/data`——幂等，首次部署自动建目录；
2. scp 上传 `docker-compose.prod.yml`——编排文件在 git 里更新后，下次发布自动同步到服务器；
3. SSH 执行：`export PI_WEB_IMAGE_TAG=v0.1.0` → `docker compose pull` → `up -d`；
4. 健康检查：`curl http://127.0.0.1:8787/` 每 2 秒一次，最多等 60 秒；
   通过 → 打印容器状态；超时 → 打印最近 50 行日志并让 job 变红。

deploy job 挂了 `environment: production`，之后可在 Settings → Environments → production
加「Required reviewers」，变成需要手动批准才部署——企业流水线的标准门禁。

## 5. 日常发版 SOP

```bash
# main 上的代码已经过 CI 绿灯后：
git tag v0.1.1
git push origin v0.1.1        # 只推 tag；Actions 页看 Release workflow
# 3 个阶段依次变绿：image（构建推送）→ 上传编排 → 部署+健康检查
# 服务器上：docker ps 可见镜像版本变为 v0.1.1
```

## 6. 回滚（为什么坚持用带版本号的 tag 部署）

```bash
ssh 用户名@服务器IP
cd ~/pi-web
PI_WEB_IMAGE_TAG=v0.1.0 docker compose -f docker-compose.prod.yml up -d   # 指回旧版本
```

旧镜像还留在服务器本地，回滚秒级完成、不依赖 CI。注意：不带环境变量裸跑
`up -d` 会解析到 `.env` 里的 `PI_WEB_IMAGE_TAG`（默认 latest），所以**回滚务必带上前缀**。

## 7. 排错手册

| 症状 | 原因与解法 |
|---|---|
| CI 里 `npm ci` 报 lockfile 不同步 | 本地改了 package.json 没 `npm install` 更新 lockfile 就提交了；本地重新 install 后把 lockfile 一起提交 |
| 某个 job 单独红 | Checks 页点开该 job 看日志；双 job 并行的好处就是一眼知道是前端还是后端挂了 |
| 镜像推送 403 | release.yml 的 `permissions` 少了 `packages: write`；或仓库在组织下受包策略限制 |
| 服务器 pull 报 401/denied | GHCR 包还是私有：按第 3 节把可见性改为 Public |
| SSH 步骤报 PERMISSION / auth 失败 | 私钥没贴全（要含 BEGIN/END 两行）；公钥没进服务器 `authorized_keys`；安全组没放行 22 |
| 国内服务器拉 GHCR 很慢/超时 | workflow 已放宽 `command_timeout: 20m`；仍超时可给 dockerd 配代理（`/etc/systemd/system/docker.service.d/proxy.conf` 设 HTTPS_PROXY）或改推阿里云 ACR |
| 健康检查超时但容器在跑 | 看 job 打出的日志：常见是 token/.env 问题或端口没映射；`docker compose logs` 是最直接的线索 |
| 部署成功但浏览器打不开 | 云安全组没放行 8787；或 `PI_WEB_PORT` 映射改过 |
| 打了 tag 但 workflow 没跑 | tag 前缀必须 `v` 开头（`on.push.tags: ['v*']`）；确认 `git push origin <tag>` 推的是 tag 本身 |

## 8. 进阶路线（学完本套再练）

1. **多阶段 Dockerfile**：把 `npm ci && npm run build` 挪进 Dockerfile 的 builder stage，
   彻底消灭「CI 先构建」的顺序依赖；
2. **ESLint 门禁**：加 lint job，代码风格问题也挡在合入前；
3. **Environment 审批**：给 production 环境加 reviewer，发布需点一次 Approve；
4. **Watchtower / 定期巡检**：服务器侧定时比对 latest 与运行版本，漂移即告警；
5. **蓝绿部署**：compose 起两套端口，健康检查通过再切流量，回滚零停机；
6. **矩阵构建**：`strategy.matrix` 让测试同时跑 Node 22/24，提前发现版本兼容问题。
