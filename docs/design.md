# 技术方案：dsh-workbuddy-expert —— 专家文件夹 + 会话内软切换的 DSH 插件

> 状态：**已定稿**（grilling 拷问轮共识清单 #1–#10 全部拍板），待实施
> 前身：`expert-role-design.md`（软切换核心设计，本文档吸收并修订）+ `dsh-workbuddy-market`（退役，其 scanner/指纹/市场页代码平移进本插件）
> 2026-09 拷问轮要点：全接管 wb-market（#1）、无召唤（#2）、导出副本数据模型（#3/#4）、分级信任（#6）、三相交付（#7）

## 0. 定位

`dsh-workbuddy-expert` 是 DSH 里"专家"概念的**唯一载体**：专家是一个独立文件夹（角色描述 + skills + 可选脚本），可以

1. **手写**放进发现根（项目级 / 用户级），或
2. 从 **WorkBuddy 源目录安装导出**（市场页，P2 相）—— importer 把扫描卡落成同格式的文件夹副本。

会话侧只有一种消费方式：**软切换**——同一会话保留全部历史，`/expert <name>` 整组替换角色描述与 skills，在下一个模型请求边界生效。**没有 preset 开场，没有召唤**。

### 与前身的关系

| | dsh-workbuddy-market（退役） | dsh-workbuddy-expert（本插件） |
|---|---|---|
| 专家载体 | `wb-<id>` agent preset | `<experts-root>/<id>/` 文件夹 |
| 生效方式 | preset 开场（仅空会话） | **软切换**（任意时刻，保留历史） |
| 召唤工具 | `workbuddy_*` 两件 | **无**（决策 #2） |
| 内容位置 | preset 目录拷贝 | `~/.dsh/experts/` 导出副本（源数据仍留 WorkBuddy 目录） |
| 平移资产 | — | scanner（CRLF #14 / 模板转义 #6 / 元数据链 #12/#19/#22）、逐文件指纹（#5/#20）、市场页 client、settings 机制 |
| 废弃物 | preset.yml 改写、persona 锚定 patch、skills 锚定 patch、召唤/防递归、孤儿清单 | — |

退役时序：本插件 P2（importer + 市场页）交付后，wb-market 从 profile 移除；存量 `wb-*` preset **不自动迁移**（决策 #5），README 给清理指引（`agentPresets.remove('wb-<id>')` 或删目录；不删也无害，只是没有更新源）。

## 1. 专家文件夹布局（手写与导出同格式）

```
<experts-root>/video-editor/
├── expert.yml            # 必需：元数据清单
├── role.md               # 必需：角色描述（system prompt section 正文）
├── skills/               # 可选：该专家专属 skill
│   └── cut-video/
│       └── SKILL.md      # 正文以 ./scripts/... 相对引用脚本
├── scripts/              # 可选：可执行脚本与素材
│   └── burn-subtitle.sh
└── agent.cordis.yml      # 可选：工具行等组装补充（P2）
```

### expert.yml schema

```yaml
id: video-editor              # 与文件夹同名，kebab-case
display_name: 视频剪辑专家
description: 负责短视频剪辑、字幕烧录与导出
order: 100                    # 选择器排序
trust_scripts: false          # project rank 执行脚本的显式声明（见 §5）
tools:                        # 可选：工具白名单（空 = 不限制）
  allow: [bash, fs, read, edit, glob, grep]
invocation:                   # 目录可见性，默认模型+用户
  model_invocable: true
  user_invocable: true
```

校验规则：`id` 匹配 `^[a-z0-9]+(?:-[a-z0-9]+)*$`；`role.md` 必须存在；`skills/*/SKILL.md` 遵循 dsh skill 约定。清单损坏的专家在选择器中列为 broken 并给出原因（对齐 agent-presets 的 broken 名单行约定），不静默隐藏。

**文本清洗（继承 wb-market 实证教训，决策 #9）**：role.md / SKILL.md 是插值输入——非注册 `{{…}}` 组必须拆括号转义（`{{` → `{ {`，注册变量白名单 model/cwd/provider 数据化），CRLF 行尾统一 strip `\r`。导出路径由 importer 在落盘时完成清洗（scanner 现成逻辑平移）；手写路径在 registry 首次读取时做同一处理。不清洗的后果已实证：含代码示例大括号的 persona 让会话启动直接抛错，CRLF 文件静默走降级路径。

### 发现根（对齐 dsh skill 的 rank 约定）

| Rank | 来源 | 根 | 默认可执行 scripts/ |
|---|---|---|---|
| 100 | project | `<projectRoot>/.agents/experts` | ❌（需 expert.yml `trust_scripts: true` + 首次组装 UI 提示） |
| 200 | user | `<dshHome>/experts` | ✅（手写/市场安装动作即信任表态） |

- 同名专家按 rank 取胜，项目级覆盖用户级；market 导出物一律落 user rank。
- Chokidar 监视增删（复用 dsh-skill-filesystem 的 watcher 模式），新增专家无需重启即出现在选择器。
- 追加根仅经挂载配置（见 §2），必须显式 `trust: user`；追加根的可执行性跟随其 trust 声明。

## 2. 插件架构（单一包，两个模块）

```
dsh-workbuddy-expert/
├── src/index.ts        # 插件入口：Config、inject 编排、ctx.experts 服务
├── src/registry.ts     # 专家注册表：文件夹扫描 + watcher + 代际 re-stamp
├── src/compose.ts      # 会话组装：role section + skills 注册/注销 + restrict
├── src/switch.ts       # /expert 切换命令与切换事务
├── src/types.ts        # client-safe 协议载荷
├── src/importer/       # P2：WorkBuddy 扫描 → 导出 → 可更新检测
│   ├── scanner.js      # 平移 wb-market scanner（含清洗）
│   ├── catalog.js      # 指纹缓存（逐文件 (path, mtimeMs, size)，#5/#20）
│   ├── presets.js      # install/update/uninstall = 导出/重导/删文件夹
│   └── routes.js       # /dsh-workbuddy-expert/api/*
├── client/client.js    # P1 切换选择器 + P2 市场页
└── scripts/smoke.mjs
```

不采用 seam 拆分：registry 与 importer 虽是两模块，但 importer 只是 registry 的一个数据来源（写文件夹），不对外发布独立服务（官方准则"不要预防性拆分"）。服务命名 `ctx.experts`。

### 挂载配置

```yaml
- name: '@deepseek-ai/dsh-workbuddy-expert'
  config:
    roots:
      - path: ~/company-experts   # 可选追加根
        trust: user               # 必须显式声明
```

## 3. 会话创建流程

```
用户在输入框打开专家选择器（P1；P0 阶段无选择器，默认裸 base）
  → ctx.experts.list()（含 broken 行与原因）
  → 选择结果作为创建草稿暂存于前端（session 尚不存在，事件无处落）
  → 创建 agent：ctx.agents.create({ sessionId, agentOptions, preset: 'standard', expert: <id> })
  → compose(session, expert)（§5）
  → agent.followup(首条用户消息)
  → expert/selected 事件追加
```

**创建前暂存是 UI 契约的一部分**（评审缺口补齐）：选择动作发生在 session 存在之前，由前端把 expert id 随创建参数传入，host 侧创建后立即 compose 并落事件——冷会话不存在"已选未生效"状态。

未选专家创建的会话：无组合，裸 base 组装（与现状一致）。

## 4. 会话中切换流程

```
用户执行 /expert <name>（ctx.commands 注册，无需模型轮次）或 UI 选择器（P1）
  → switch(sessionId, nextExpert)（串行化：同一会话同时只允许一个切换事务）
  → 逆序 dispose 当前组合：
      c. tools.restrict disposer
      b. 各 skill disposer（provider 标签 'expert:<id>'）
      a. role section disposer（id: 'expert-role'）
  → compose(session, nextExpert)
  → agent.inject("已从专家 X 切换为 Y；后续按新角色与 skill 工作")
  → expert/selected 事件追加（先事件后组合提交，对齐 agent-presets 先例）
```

生效时点：不打断进行中的轮次。systemPrompt 按请求重新渲染，skill 目录由 dsh-tool-skill 在下一步骤前 digest 对比后以 `agent.inject()` 替换，工具 schema 随 tools/change 重组装——三者天然汇合于下一个模型请求边界。同名冲突：整组替换 + 注册前先 dispose，规避同层先到先得告警路径。

## 5. compose：作用域与信任执行

```
compose(session, expert)：
  a. agent scope 内 ctx.systemPrompt.section() 注册角色段
     （正文 = role.md 清洗后内容 + 一行元提示，经 XML 转义与长度上限）
  b. agent scope 内 ctx.skills.register() 逐个注册 skills/<name>
  c. 若 expert.yml 声明 tools.allow → agent scope 内 ctx.tools.restrict({ allow })
  d. scripts 执行门控（决策 #6）：
     - user rank 根 / trust: user 追加根 → 允许
     - project rank 且 trust_scripts 未声明 → skills 照常注册，但 SKILL.md 引用的
       scripts/ 调用在执行层拒绝 + 会话内提示"该专家来自项目仓库，未声明信任脚本"；
       首次组装时 UI 提示一次
     - project rank 且 trust_scripts: true → 允许 + 首次组装 UI 提示
```

- **一切注册落在 agent scope 层**：只进入该会话的 scope 链，不影响兄弟会话。
- **自动清理兜底**：所有 disposer 都是 Cordis effect——会话结束或插件卸载自动撤销。
- **代际保持**：registry 每次组装前 re-stamp（mtime+size）；运行中会话保持其启动代际存活，文件夹被删/改只影响选择器与下次切换（保留式复制可欺骗 mtime 的 exotic 情况，市场页手动刷新兜底——wb-market #5 口径）。

## 6. 会话记录

- 新增 `expert/selected` 会话事件：创建与每次切换后追加。
- `ctx.sessionProjections` 注册 `expertState` 单元，UI 从 `stateOf()` 读当前专家。
- 冷会话（未激活 Agent）经 Remote `ctx.remote.experts` 查询记录的专家。

## 7. WorkBuddy importer（P2 相）

需求三要素平移自 wb-market：运行时读用户目录（默认 `~/.workbuddy/plugins/marketplaces/experts/plugins`）、目录可改、可手动刷新重扫。

- **scanner**：wb-market `src/scanner.js` 整体平移——plugin.json 首选元数据（#12）、zhName 职能名优先链（#19/#22）、CRLF 全链路容错（#14）、模板转义（#6）、skills 全量照搬（#15）、跨插件同名 first-wins（#16）、团队卡拆分与头像匹配（#13）。
- **安装 = 导出**：扫描卡 → `~/.dsh/experts/<id>/`（expert.yml（id/display_name=zhName/description/order）+ role.md（清洗后 persona）+ skills/ 整树）。指纹清单落 `.expert-source.json`：`{ sourcePath, pluginDir, agentFile, fingerprint, importedAt }`。产物 owner-only（0o600/0o700，对齐 roster 收紧姿态）。
- **可更新检测**（决策 #4 保留）：`/api/state` 对每个已导出专家比对当前扫描 fingerprint → `updatable` 标；更新 = 就地重导（重写 role.md + skills 目录同步增删覆盖 + 刷新清单）；manifest 丢失/损坏 → broken + "清单缺失，请卸载重装"。
- **换源孤儿**：`~/.dsh/experts/` 里有清单但当前扫描表无对应 → `orphans` 返回，不阻塞不自动删。
- **卸载**：删整个专家文件夹。
- **settings**：ns `workbuddy-expert`，`{ sourcePath }`，`~` 原串存储使用时展开；允许保存不存在路径（黄条提示）。
- **路由**：前缀 `/dsh-workbuddy-expert`，同源 POST、4KiB 上限、安装互斥单飞、`no-store`；avatar 路由流式读 + max-age=60 + 目录穿越防护——全部照搬 wb-market 安全约定。

## 8. Client

- **P1 切换选择器**（`conversation.input` 区域 + 创建时入口）：专家卡（display_name/description/broken 徽标），选中即触发切换事务；正在切换时禁用并显示目标专家。Slot 契约实施时经 Inspect 查询确认。
- **P2 市场页**（`settings.section`「WorkBuddy 专家」）：wb-market 市场页平移——源路径编辑/黄条/刷新、卡片网格（头像/badge/updatable/broken/orphans）、行内安装/更新/卸载确认、搜索与分类 chip（#23 口径）。交互文案从"安装成 preset"改为"安装专家"。
- 工程形态照抄 wb-market：手写 `window.__ModuleLoader__.load` bundle、零构建、React.createElement 无 JSX、主题 token、`<style data-plugin>` 随卸载清理、zh/en 字典。

## 9. 边界与风险

| 场景 | 行为 |
|---|---|
| 切换时轮次进行中 | 事务排队，轮次边界后应用；不中断流式输出 |
| 进行中调用了旧专家 skill | 工具执行照常完成，结果留在会话历史 |
| 专家文件夹被删（运行中会话） | 代际保持，会话继续；下次切换/新建才暴露 broken |
| 压缩隐藏 skill 目录消息 | dsh-tool-skill 已有重建逻辑，无需额外处理 |
| skills/ 为空 | 仅注册 role section，目录收到显式空替换 |
| role.md 含未注册 `{{…}}` 组 / CRLF | registry/importer 清洗（§1），清洗失败 broken 不静默 |
| project rank 专家引用未信任脚本 | 执行层拒绝 + 提示（§5.d） |
| 与 preset 的叠加 | 会话以任意 preset 开场后 `/expert` 均可切换；role section 与 preset persona 可能共存，切换时提示一句"原 preset 角色描述仍在场"（软切换不触碰 preset 层） |
| wb-market 尚未退役的共存期 | 两者无共享命名域（无召唤工具、无共同路由），仅市场页语义重叠，P2 切换后移除 wb-market |

## 10. 交付切分

| 相 | 内容 |
|---|---|
| P0 | registry + expert.yml 校验 + 清洗 + compose（role+skills）+ `/expert` 切换事务 + expert/selected 事件 + 手写专家可用 + smoke |
| P1 | 切换选择器 UI（会话中 + 创建时入口）+ Remote 查询 |
| P2 | WorkBuddy importer（scanner/指纹/导出/更新/市场页/client）+ 从 profile 移除 dsh-workbuddy-market + README 迁移指引 |
| P3 | tools.allow 白名单 restrict、agent.cordis.yml 组装行透传 |

P0 结束即可手写专家 + `/expert` 完整验证软切换链路（零 UI、零 importer，smoke 全覆盖）；每相独立可用。

## 11. 宿主契约核实结果（2026-09，经活运行时 Inspect Provider + 编译产物交叉核实）

| # | 断言 | 结论 |
|---|---|---|
| 1 | `tools.restrict` 分层叠加 | **完全证实**（ticket 10 落地时从 dsh-tools 源码实证）：`restrict({ allow?, deny? })` 作用于 agent scoped context，返回 disposer；空 `allow: []` 在宿主层=全禁（故 registry 把声明为空映射为"不限制"，永不传 `[]`）；未知全局工具名由宿主 loud 校验 |
| 2 | skill digest 空替换 | **分层 scope 证实**：skills 服务自述"Layered registry of skill providers, the host+per-scope shape the tools registry established"，`register(skill): () => void` 返回 disposer。digest/inject 替换机制与空替换路径本地不可见，维持文档断言，#03 smoke 覆盖空 skills 专家用例 |
| 3 | `agent.inject()` 时序 | **未证实**（Agent 对象方法，不在 Service 目录）：维持文档断言，#03 集成验证时观察生效边界，异常则退化为切换后首条消息附加说明 |
| 4 | `ctx.commands` 契约 | **证实**：`commands.register(definition): () => void`（disposer）、`find(agent, name)`、`execute(agent, line, attachments, signal)`——人类命令路径，不经模型轮次。CommandDefinition 字段形不可见：注册代码保持防御式（小函数隔离，#02 已按此实现） |
| 5 | composer Slot 契约 | **证实**（client Slots 拓扑）：`conversation.input.left` / `conversation.input.right`（list，replaceRisk none，注册 id/order/label）、`conversation.composer.dock`、`conversation.input.dock`（list）均可作 #05 切换选择器入口；创建时入口注意：`conversation.hero.agentPreset` 为 single 且已被 preset 控件占用（shadows-shipped-ui），创建时专家选择应挂 composer 侧（composer.bar 含无会话惰态）而非 hero 替换；wb-market 的 inputTriggers `@` 触发源在当前 Slot 树不可见，#05 不依赖它 |

结论：无阻塞项。#1/#3 的残余不确定性由 #03 的集成验证与 smoke 用例兜底，不推迟开工。

## 12. 决策记录（2026-09 grilling 拷问轮，全部拍板）

| # | 议题 | 决策 |
|---|---|---|
| 1 | 定位 | 新插件全接管，wb-market 整体退役；preset 开场废除 |
| 2 | 召唤 | 不保留，只做软切换 |
| 3 | 数据模型 | 安装 = 导出副本到 `~/.dsh/experts/`（非零拷贝直连） |
| 4 | 格式统一 | 导出格式 = 专家文件夹布局，registry 单管道；保留 updatable 检测 |
| 5 | 存量迁移 | 不自动迁移 `wb-*` preset，README 给清理指引 |
| 6 | 信任模型 | user rank 可执行 scripts；project rank 默认拒绝（trust_scripts 声明 + 提示）；追加根显式 trust |
| 7 | UI 与相序 | P0 registry+命令 → P1 选择器 UI → P2 importer+市场页+退役 wb-market |
| 8 | 命名 | 插件 `dsh-workbuddy-expert`；服务 `ctx.experts`；事件 `expert/selected`；路由 `/dsh-workbuddy-expert`；ns `workbuddy-expert` |
| 9 | 继承实证坑 | 模板转义（wb #6）、CRLF strip（wb #14）进 registry/importer 清洗 |
| 10 | 待核实 | §11 五条断言，实施前查源码仓库 |

后续新议题在此追加，保持"议题 → 决策"两列。
