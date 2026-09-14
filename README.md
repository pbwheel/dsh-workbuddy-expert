# dsh-workbuddy-expert

**DSH 专家文件夹：手写专家目录 + 会话内软切换 + WorkBuddy 专家市场**

[English](README.en.md) · [设计文档](docs/design.md) · [LICENSE](LICENSE)

## 它是什么

一个 DSH（DeepSeek Harness）Web 插件，是 DSH 里"专家"概念的**唯一载体**：

1. **专家文件夹**——专家是一个独立目录（`expert.yml` + `role.md` + 可选 `skills/`、`scripts/`），手写放进发现根即被识别；
2. **软切换**——任意会话、任意时刻 `/expert <name>` 整组替换角色描述与 skills，保留全部历史，在下一个模型请求边界生效；**没有 preset 开场，没有召唤**；
3. **WorkBuddy 市场**（设置 → WorkBuddy 专家）——运行时只读扫描本地 WorkBuddy 专家目录（默认 `~/.workbuddy/plugins/marketplaces/experts/plugins`），卡片浏览/搜索/分类，行内安装（= 导出成同格式专家文件夹到 `~/.dsh/experts/`）、更新（就地重导）、卸载（删文件夹）。

## 快速开始（手写一个专家）

```sh
mkdir -p ~/.dsh/experts/video-editor/skills/cut-video
```

`~/.dsh/experts/video-editor/expert.yml`：

```yaml
id: video-editor
display_name: 视频剪辑专家
description: 负责短视频剪辑、字幕烧录与导出
order: 100
trust_scripts: false
```

`~/.dsh/experts/video-editor/role.md`：角色描述正文（作为 system prompt 角色段）。

可选 `skills/cut-video/SKILL.md`：遵循 dsh skill 约定；可选 `scripts/` 放可执行脚本与素材，由 SKILL.md 以 `./scripts/...` 相对引用。

然后在任意会话里：

```
/expert                # 列出全部专家（含 broken 行与原因）
/expert video-editor   # 软切换；保留历史，下一请求边界生效
```

新增/删除专家文件夹无需重启——发现根有 watcher，选择器（输入框区域 + 创建会话入口）自动刷新。

## 发现根与信任模型

| Rank | 来源 | 根 | 默认可执行 scripts/ |
|---|---|---|---|
| 100 | project | `<projectRoot>/.agents/experts` | ❌（需 `trust_scripts: true`，首次组装有 UI 提示） |
| 200 | user | `~/.dsh/experts`（`DSH_HOME` 可改） | ✅（手写/市场安装动作即信任表态） |

- 同名专家按 rank 取胜：项目级覆盖用户级；市场导出物一律落 user rank。
- **user rank 根的专家可直接执行 scripts/**；**project rank 默认拒绝**——skills 照常注册，但脚本调用在执行层被拒并提示"该专家来自项目仓库，未声明信任脚本"；expert.yml 声明 `trust_scripts: true` 才放行。
- 追加根仅经挂载配置，必须显式 `trust: user`：

```yaml
- name: '@deepseek-ai/dsh-workbuddy-expert'
  config:
    roots:
      - path: ~/company-experts
        trust: user
```

## 安装本插件

```sh
git clone <本仓库地址>
cd dsh-workbuddy-expert
dsh plugin --profile web add .
dsh --profile web --dump-config
```

配置输出应出现 `dsh-workbuddy-expert`。然后**重启 `dsh web`**（bundles 列表只在启动时读）并**强刷浏览器**。零构建、零运行时依赖。

## WorkBuddy 市场页

设置 → WorkBuddy 专家：

- **源路径**：顶栏可改（宿主 settings 命名空间 `workbuddy-expert` 的 `sourcePath`，`~` 原串存储使用时展开；允许保存不存在路径，页面黄条提示，路径就绪自动恢复）；「刷新」强制重扫，平时靠逐文件指纹自动重扫。
- **安装 = 导出**：扫描卡 → `~/.dsh/experts/<id>/`（expert.yml + 清洗后 role.md + skills 整树），指纹清单落 `.expert-source.json`。
- **更新**：源有变时卡片亮 updatable，更新 = 就地重导；清单丢失/损坏 → broken + "清单缺失，请卸载重装"。
- **卸载**：删整个专家文件夹。
- **孤儿区**：换过源后，装自别的源的专家单列"已安装但不在当前源"，只呈列不阻塞。
- HTTP 路由前缀 `/dsh-workbuddy-expert`（`/api/state|avatar|config|refresh|install|update|uninstall`）：同源 POST、4 KiB 上限、安装互斥单飞、`no-store`（avatar `max-age=60`）；只读 WorkBuddy 目录，绝不写它，零数据外发。

## 配置

- `sourcePath`：见上，市场页顶栏或 settings 直接改。
- `roots`：可选追加发现根，必须显式 `trust: user`（见上例）。
- `dshHome`：覆盖 DSH home 解析（默认 `$DSH_HOME` 或 `~/.dsh`）。

## 退役与迁移：dsh-workbuddy-market

本插件已**全覆盖并取代** [dsh-workbuddy-market](../dsh-workbuddy-market)（其 scanner/指纹/市场页代码平移进本插件）。wb-market 已退役，请从 profile 移除：

```sh
dsh plugin --profile web remove dsh-workbuddy-market
```

存量迁移口径：

- **`wb-*` preset 不会被自动迁移**（设计决策 #5）。旧 preset 清理二选一：
  - 让宿主执行 `agentPresets.remove('wb-<id>')`；
  - 或直接删目录：`rm -rf ~/.dsh/.agent-presets/wb-<id>/`。
- **不删也无害**——它们只是没有更新源，不再收到任何维护。
- 想继续用某位专家？在新市场页重新**安装**（导出）一次即可，之后走本插件的安装/更新/卸载链路。
- 旧版"召唤"（`workbuddy_experts` / `summon_workbuddy_expert` 两工具）**不设继任**——设计上以软切换取代：`/expert <name>` 任意时刻切换、保留会话历史。

## 开发

```sh
node scripts/smoke.mjs            # 契约/清洗/注册表/切换冒烟，零依赖
node scripts/smoke-client.mjs     # client 侧
node scripts/smoke-importer.mjs   # importer/市场路由
node scripts/smoke-install.mjs    # 安装=导出链路
```

改完 host（`src/`）或 `package.json` 需重启 `dsh web`；只改 `client/client.js` 刷新页面即可。设计与决策记录见 [docs/design.md](docs/design.md)。

## License

MIT
