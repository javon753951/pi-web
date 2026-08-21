# pi-web — 单容器镜像（网关 + 前端产物 + pi CLI + 办公依赖）
# 分层按「变动频率从低到高」排列：改代码不重装办公依赖，吃满构建缓存。
#
# 构建参数：
#   WITH_OFFICE=1  额外安装 LibreOffice headless（docx/xlsx/pptx→pdf 高保真转换，+~600MB）
#                  不装时 pandoc + python 库覆盖 80% 文档场景
FROM node:24-slim

# ------------------------------------------------------------ L1 系统层
# bash/git/ripgrep：pi 的 bash 工具与编码工作流依赖
# python3/venv：agent 数据处理主力；zip/unzip/jq：文件打包与 JSON 处理
# poppler-utils：pdftotext 等 PDF 工具；pandoc：md↔docx 万能转换
# fonts-noto-cjk：中文字体（没有它，matplotlib/PDF 转换中文全是豆腐块）
RUN apt-get update && apt-get install -y --no-install-recommends \
    git bash ripgrep ca-certificates \
    python3 python3-venv python3-pip \
    zip unzip jq poppler-utils pandoc \
    fonts-noto-cjk fontconfig \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -f

# ------------------------------------------------------------ L2 办公层（Python）
# 独立 venv（/opt/py，PATH 前置）：绕开 Debian PEP 668，agent 运行中还能 pip install 临时包
# pip 源固定清华镜像：构建与运行期装包不赌代理在线
RUN python3 -m venv /opt/py \
    && /opt/py/bin/pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple \
        pandas openpyxl python-docx python-pptx \
        pypdf pdfplumber matplotlib \
        beautifulsoup4 lxml html2text requests chardet \
    && ln -s /opt/py/bin/python3 /usr/local/bin/python3 \
    && ln -s /opt/py/bin/pip /usr/local/bin/pip
ENV PATH="/opt/py/bin:${PATH}"

# ------------------------------------------------------------ L3 重组件层（可选）
# LibreOffice headless：soffice --headless --convert-to pdf（文档转换之王）
ARG WITH_OFFICE=0
RUN if [ "$WITH_OFFICE" = "1" ]; then \
        apt-get update && apt-get install -y --no-install-recommends libreoffice --no-install-suggests \
        && rm -rf /var/lib/apt/lists/*; \
    fi

# ------------------------------------------------------------ L4 运行层
# 全局安装 pi（容器内 CLI 路径探测会回退到 PATH 上的 `pi`）
# npm 源固定国内镜像，加速构建与技能安装
RUN npm config set registry https://registry.npmmirror.com \
    && npm install -g @earendil-works/pi-coding-agent

WORKDIR /app

# 依赖（利用层缓存；npm ci 需要 lockfile）
COPY package.json package-lock.json* ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json
RUN npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund

# 构建产物 + 扩展
COPY server/dist server/dist
COPY web/dist web/dist
COPY extensions extensions

ENV NODE_ENV=production \
    PI_WEB_HOST=0.0.0.0 \
    PI_WEB_PORT=8787 \
    PI_WEB_DATA=/app/data \
    PYTHONUNBUFFERED=1

EXPOSE 8787

# 优雅停机：SIGTERM 交给网关做子进程清理
STOPSIGNAL SIGTERM
CMD ["node", "server/dist/index.js"]
