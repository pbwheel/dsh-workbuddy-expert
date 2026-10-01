<div align="center">

# DSH WorkBuddy Expert

**把 WorkBuddy 专家装进 DSH：专家市场一键导入 · 会话选择器随时切换**

[English](README.en.md) · [功能](#功能) · [安装](#安装插件) · [设计文档](docs/design.md) · [MIT](LICENSE)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![DSH Web Plugin](https://img.shields.io/badge/DSH%20Web-Plugin-0f766e.svg)](#安装插件)
[![零构建](https://img.shields.io/badge/构建-零构建-0f766e.svg)](#开发)

</div>

> DSH WorkBuddy Expert 是社区维护的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）插件，并非 DeepSeek AI 官方产品。

<!-- 演示动图（占位）：召唤 → 安装 → 选择 → 生效，拍摄后同名覆盖 docs/images/hero-demo.gif -->
<img src="docs/images/hero-demo.gif" width="70%" alt="演示：召唤 → 安装 → 选择 → 生效" />

## 它是什么

一个 DSH Web 插件，让你把 [WorkBuddy](https://www.workbuddy.cn/) 专家中心的专家带进 DSH 工作流：

- **专家市场**（设置 → WorkBuddy 专家）——只读扫描本地 WorkBuddy 专家目录，卡片浏览/搜索/分类，一键**安装 / 更新 / 卸载**，导出成标准专家文件夹；
- **会话选择器**——输入框旁的专家胶囊，随时切换当前会话的专家：整组替换角色描述与 skills，**保留全部会话历史**，在下一个模型请求边界生效，不打断进行中的轮次；
- **完整专家体验**——安装的专家自带角色描述、专属 skills 与头像，选择器列表即选即用。

## 专家来源

插件**不联网下载专家**——市场页读取的是 WorkBuddy 桌面端落盘的**本地**专家目录（默认 `~/.workbuddy/plugins/marketplaces/experts/plugins`）。专家必须先在 WorkBuddy 的**专家中心**点击**召唤**，WorkBuddy 才会把该专家下载落盘，之后本插件才能扫描到它：

<!-- WorkBuddy「召唤」按钮截图（占位）：真图拍摄后同名覆盖 docs/images/workbuddy-summon.jpg -->
<img src="docs/images/workbuddy-summon.jpg" width="40%" alt="WorkBuddy 专家中心「召唤」按钮（占位图）" />

一个都没召唤过，市场页就是空列表——回专家中心召唤几个，卡片会自动出现。下文提到的"默认源目录"均指此路径。

## 功能

### 1. WorkBuddy 专家市场（设置 → WorkBuddy 专家）

<img src="docs/images/market.jpg" width="50%" alt="专家市场（占位图）" />

- **只读扫描**本地 WorkBuddy 专家目录（默认路径见「专家来源」），绝不写它，零数据外发；
- 卡片浏览/搜索/分类；操作按钮收在卡片右上角（未装 → 安装，已装 → 卸载/更新）；
- **安装 = 导出**成标准专家文件夹到 `~/.dsh/experts/<id>/`（expert.yml、清洗后 role.md、skills 整树，源卡有 PNG 时含头像），指纹清单落 `.expert-source.json`；
- **更新**：源有变时卡片亮 updatable，更新 = 就地重导；**卸载** = 删整个专家文件夹；

### 2. 会话选择器

<img src="docs/images/picker.jpg" width="50%" alt="会话选择器（占位图）" />

- 输入框旁的专家胶囊展开带头像的专家列表，选中即切换；
- **切换保留全部会话历史**：角色描述与 skills 整组替换，在下一个模型请求边界生效；轮次进行中则排队到边界后应用，不打断流式输出；
- 切换事务串行化：同一会话同时只允许一次切换；
- 一切注册落在 agent scope 层：只影响当前会话，会话结束自动清理；
- 创建新会话时也可先选专家，创建即生效——冷会话不存在"已选未生效"状态；
- 新增/删除专家无需重启——发现根有 watcher，选择器（输入框区域 + 创建会话入口）自动刷新。

### 3. 专家能力随会话生效

<img src="docs/images/switch-trace.jpg" width="50%" alt="切换后会话轨迹（占位图）" />

选中专家后，其能力即挂载到当前会话：

- **角色描述**（role.md）作为 system prompt 角色段注入；
- **专属 skills**（skills/ 整树）随专家注册/注销；
- **工具白名单**（expert.yml `tools.allow`，可选）挂载作用域工具限制，切换时自动解除；
- 清单损坏的专家在选择器中列为 **broken 并给出原因**，不静默隐藏。

## 快速开始

前置条件：

- 宿主二选一：**DeepSeek Harness 桌面端**（Electron App）或终端 `dsh web`。两者使用**不同的 profile**（桌面端 `desktop`、CLI `web`），安装入口也不同——见下节，别装错边；
- 本机已安装 [WorkBuddy](https://www.workbuddy.cn/) 桌面端，且至少**召唤**过一个专家——机制与默认路径见[「专家来源」](#专家来源)；

### 安装插件

两种宿主用**不同的 profile**（桌面端 `~/.dsh/profiles/desktop`，CLI `~/.dsh/profiles/web`），互不相通，装错宿主读不到。桌面端的 `desktop` profile 由 Electron 独占——终端执行 `dsh --profile desktop ...` 会报 `managed exclusively by the Electron application`——所以桌面端用户**不要**照抄下面的 `--profile web` 命令。

**桌面端（DeepSeek Harness App）**——用应用内插件面板安装：

1. 打开侧栏**插件（Plugins）**面板，点**添加插件（Add plugin）**；
2. 输入插件 npm 包名 `dsh-workbuddy-expert`（即官方插件下载说明中"`dsh plugin add` 之后的部分"；也接受 Git 地址 `github:pbwheel/dsh-workbuddy-expert`、tarball 或本地 clone 的绝对路径）；
3. 安装完成后**重启桌面 App**（bundles 列表只在启动时读）。

**终端（`dsh web`）**——一行安装，npm 包名与 Git 地址均可（始终取最新版，无需手动 clone）：

```sh
dsh plugin --profile web add dsh-workbuddy-expert
# 或从 GitHub 安装：
dsh plugin --profile web add github:pbwheel/dsh-workbuddy-expert
```

或手动 clone 后从目录安装：

```sh
git clone --depth 1 https://github.com/pbwheel/dsh-workbuddy-expert.git
cd dsh-workbuddy-expert
dsh plugin --profile web add .
dsh --profile web --dump-config
```

两种方式都装主分支最新版；配置输出应出现 `dsh-workbuddy-expert`。然后**重启 `dsh web`**（bundles 列表只在启动时读）并**强刷浏览器**。零构建；运行时仅依赖宿主自己的 schema 工厂 @deepseek-ai/schemastery（精确固定）。

### 让 Agent 帮你安装

桌面端里，把这段话发给任意 Agent（它会走当前 profile 的应用内插件管理，无需终端）：

```text
请把 DSH 插件 dsh-workbuddy-expert（来源 github:pbwheel/dsh-workbuddy-expert）安装到当前 profile，完成后告诉我如何重启生效并开始使用。
```

终端用户把这段发给能执行本机终端命令的 Agent：

```text
请将 DSH 插件 dsh-workbuddy-expert 从本仓库安装到 web profile：git clone --depth 1 https://github.com/pbwheel/dsh-workbuddy-expert.git 后执行 dsh plugin --profile web add <目录>。安装后执行 dsh --profile web --dump-config，确认配置包含 dsh-workbuddy-expert，并告诉我如何重启 dsh web 和开始使用。
```

### 三步用上 WorkBuddy 专家

1. 打开**设置 → WorkBuddy 专家**（默认源路径见「专家来源」，可在顶栏修改）。**列表为空？** 说明还没召唤过专家——见[「专家来源」](#专家来源)；
2. 在卡片上点**安装**——专家即导出到 `~/.dsh/experts/`；
3. 回到会话，点输入框旁的专家胶囊，选择刚安装的专家，开始对话。

命令行也可以：`/expert` 列出全部专家，`/expert <name>` 切换。

## 配置

| 配置项 | 默认值 | 作用 |
|---|---|---|
| `sourcePath` | `~/.workbuddy/plugins/marketplaces/experts/plugins` | WorkBuddy 源目录；`~` 使用时展开；允许保存暂不存在的路径（页面提示，路径就绪自动恢复） |
| `roots` | — | 可选追加发现根，必须显式 `trust: user` |
| `dshHome` | `$DSH_HOME` 或 `~/.dsh` | 覆盖 DSH home 解析 |

配置走 DSH 0.2 的 **Config 表单模型**：`sourcePath` 保存后经宿主 volatile 链路热生效（不重挂插件）；`roots`/`dshHome` 修改后按 Loader 语义重挂。表单投影与保存链路细节见[设计文档](docs/design.md)。

`sourcePath` 有两个编辑入口，同一份数据，经宿主 volatile 链路自动同步：

- **设置 → WorkBuddy 专家**（市场页顶栏）；
- **插件 → dsh-workbuddy-expert → 配置**（Plugins 页的原生行配置页，含 revision 冲突保护与恢复默认）。

追加根示例：

```yaml
- name: 'dsh-workbuddy-expert'
  config:
    roots:
      - path: ~/company-experts
        trust: user
```

平时靠逐文件指纹自动重扫，「刷新」按钮强制重扫。

## 开发

```sh
node scripts/smoke.mjs                 # 契约/清洗/注册表/切换冒烟
node scripts/smoke-client.mjs          # client 侧
node scripts/smoke-importer.mjs        # importer/市场路由
node scripts/smoke-install.mjs         # 安装=导出链路
node scripts/verify-host-contract.mjs  # 对照真实宿主包验证 Config/volatile 契约
```

依赖仅 `@deepseek-ai/schemastery`（精确固定 `3.18.4`，宿主自己的 schema 工厂）。兼容 DSH `>=0.2.0-rc.2 <0.3.0`（`engines.dsh` 与 `peerDependencies` 同此范围），安装期与启动期均做版本校验；插件清单含本地化文案与图标（`locale/`、`icon.svg`）。

改完 host（`src/`）或 `package.json` 需重启宿主（桌面端重启 App，CLI 重启 `dsh web`）；只改 `client/client.js` 刷新页面即可。

| 模块 | 职责 |
|---|---|
| `src/registry.js` | 专家文件夹扫描、校验、清洗、watcher |
| `src/compose.js` | 会话组装：角色段 + skills + 工具白名单 |
| `src/switch.js` | 切换事务 |
| `src/importer/` | WorkBuddy scanner/指纹/导出/市场路由 |
| `client/client.js` | 选择器 + 市场页 UI |

设计与决策记录见 [docs/design.md](docs/design.md)。

## 许可证

[MIT](LICENSE) © 2026 dsh-workbuddy-expert contributors
