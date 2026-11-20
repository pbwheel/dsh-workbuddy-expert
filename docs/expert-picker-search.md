# 专家选择器模糊搜索技术方案

> 状态：**已实施（P0–P2，2026-11-20）**
> 日期：2026-11-20
> 范围：`dsh-workbuddy-expert` 会话输入框旁「专家」下拉选择器（`conversation.input.left`）的前端模糊搜索。不改宿主 API、不改注册表/切换事务、不改市场页搜索。
> 前置阅读：[`docs/design.md`](./design.md) §8、[`client/client.js`](../client/client.js) 的 `ExpertSelector` 组件段

---

## 0. 一句话方案

在现有 `ExpertSelector` 弹出层顶部增加一个受控搜索框，对已经一次性拉取到前端的专家卡做「文本归一化 + 多字段加权 + 多 token AND + 相关度排序」的模糊匹配；搜索完全在浏览器内完成，不新增接口、不落盘、不改变选中专家后的切换/暂存语义。

---

## 1. 背景与现状

### 1.1 当前交互

`client/client.js` 的 `ExpertSelector` 挂在 `conversation.input.left`，是一个底部弹出的专家列表：

- 点击输入框旁的专家胶囊 → 向上弹出 `.wbe-menu`（320px 宽，`max-height: 320px`，整块菜单滚动）；
- 列表项显示头像、`displayName`、灰色 `id`、两行 `description`；损坏专家带 ⚠ 徽标与原因，且不可点击；
- 当前专家带 ✓ 标记；选中即 POST `/api/switch`（有会话）或暂存为创建草稿（无会话）；
- 列表数据来自一次 `GET /api/experts[?sessionId=…]`，payload 里已经是**全量**专家卡。

### 1.2 痛点

- 专家数量少则十几个、多则几十个；菜单只有 320px 高，纯滚动查找成本高；
- 专家名称/描述以中文为主，`id` 以英文 kebab-case 为主，用户可能记得其中任意一个，但当前只能按配置顺序逐条找；
- 名称相近的专家（如「AI 视频脚本创作专家」「AI 图像提示词专家」）在长列表中难以快速区分。

### 1.3 现有数据形状（`GET /api/experts` 单卡）

| 字段 | 类型 | 示例 | 搜索用途 |
|---|---|---|---|
| `id` | string | `ai-humanizer` | 英文 id、目录名，必搜 |
| `displayName` | string | `AI 痕迹消除专家` | 主名称，权重最高 |
| `description` | string | `识别 24 种 AI 写作模式…` | 职责描述，辅助搜索 |
| `skills` | `{name,...}[]` | `[{name:'cut-video'}]` | 技能名，低权重补充 |
| `order` | number | `10` | 无查询时的原始排序 |
| `broken` | string? | `expert.yml missing` | 损坏行仍可被搜到并展示原因 |
| `avatarUrl` | string? | `dsh-workbuddy-expert/api/expert-avatar?id=…` | 不参与搜索 |

> 注：选择器卡来自 `src/registry.js`，只有 `displayName` / `description`，没有市场卡的 `zhName` / `zhDescription`；匹配器会防御式兼容这两个字段，便于未来 payload 扩展。

### 1.4 工程约束

- **零构建**：`client/client.js` 是手写 bundle，运行时只通过注入的 `require('react')` 取 React；不能引入 fuse.js 等第三方搜索库。
- **单文件内聚**：bundle 不能 `require` 本地模块（`require` 是宿主外部模块解析器）；新的纯函数只能放在 `client/client.js` 内，通过 `module.exports` 暴露给 smoke。
- **React 能力有限**：宿主 Client 只承诺 `React.createElement` / `useState` / `useEffect`（现有代码还用了 `useRef`，smoke stub 支持）；实现不要依赖 `useMemo` / `useDeferredValue` / `useId`。
- **弹层空间**：菜单位于输入框上方，尺寸必须克制；搜索行不能挤掉列表的可视高度。
- **安全**：专家名称/描述来自本地专家文件夹，属于未信任文本；搜索只做字符串比较，渲染继续走 React 文本节点，禁止 `dangerouslySetInnerHTML`，禁止用用户输入构造正则。

---

## 2. 目标与非目标

### 2.1 目标

1. 打开专家下拉后，顶部出现搜索框并自动聚焦；
2. 输入中文、英文、id 片段均能实时过滤，支持「模糊」匹配而不只是前缀匹配；
3. 键盘可完整操作（上下选择、回车确认、Esc 清除/关闭），且中文输入法组合期间不会误选；
4. 搜索只影响列表展示，不影响原有切换事务、暂存草稿、broken 行语义；
5. 不新增网络请求、不写 localStorage/sessionStorage、不增加可感知延迟。

### 2.2 非目标

- **不做拼音转写**：不引入拼音字典。中文按汉字子串/顺序匹配，英文 id 可搜；未来若需要，只需在 `searchFieldsOf()` 的 haystack 里追加拼音字段，匹配器无需改动。
- **不做编辑距离纠错**（如把 `humnaizer` 纠正为 `humanizer`）：v1 只做子串/前缀/顺序子序列，避免误召回；如需再做，作为 P2 的可选 tier。
- **不改市场页搜索**：`MarketPage` 的 `filterExperts` 继续使用现有简单子串匹配，避免改动其 chip 计数与分组逻辑。
- **不改 `/expert` 命令**：命令行的专家列表不在此次范围。
- **不新增搜索历史、收藏、排序偏好**：每次打开重置查询。

---

## 3. 方案选型

| 方案 | 做法 | 优点 | 缺点 | 结论 |
|---|---|---|---|---|
| A. 服务端搜索 | `/api/experts?q=…` 在 registry 层过滤 | 服务端可扩展 | 每次击键一次网络请求；registry 需要重扫/缓存键扩展；与「一次全量卡片」现状不符 | ❌ |
| B. 原生 `<input list>` + `<datalist>` | 浏览器原生自动完成 | 代码少 | 无法渲染头像/描述/broken/当前标记；样式不可控；不同 Electron/浏览器表现不一致 | ❌ |
| C. 自绘组合框（combobox） | 在现有 `.wbe-menu` 内加输入框 + 客户端匹配 | 完全可控、零依赖、零请求；与现有弹层/主题一致 | 需要自己实现键盘与 ARIA | ✅ **采用** |
| D. 引入 fuse.js | 第三方模糊搜索库 | 算法成熟 | 违背零构建/零依赖；bundle 体积与供应链风险 | ❌ |

**决策：C。** 专家卡总量在几十到几百量级，客户端 O(n) 过滤完全够用；保留现有弹层、样式命名空间与切换逻辑，改动面最小。

---

## 4. 交互设计

### 4.1 布局

```
┌─ 选择专家 ─────────────────── 3 / 24 ─┐
│ [ 搜索专家（名称 / 描述 / ID）      × ] │
├───────────────────────────────────────┤
│ [头像] AI 痕迹消除专家   ai-humanizer   │
│        识别 24 种 AI 写作模式，…        │
│ [头像] AI 视频脚本创作专家  ai-video…   │
│        根据主题生成完整视频脚本，…      │
│ …                                       │
├───────────────────────────────────────┤
│ 选择即在下一个模型请求边界切换，会话历史保留 │
└───────────────────────────────────────┘
```

- 标题行保留「选择专家」，右侧增加 `匹配数 / 总数` 的等宽数字统计（无查询时只显示总数）；
- 搜索行固定在标题下方，不随列表滚动；
- 列表区域独立滚动（`.wbe-list`），移除行/底部说明固定在菜单底部；
- 菜单宽度从 `320px` 调整为 `340px`，`max-height` 从 `320px` 调整为 `min(420px, 60vh)`，给搜索行留出空间的同时避免在输入框上方过高。

### 4.2 状态机

```text
closed ──点击胶囊──▶ open(query='', activeId=null, 搜索框聚焦)
open ──输入──▶ open(query=q, activeId=首个可选匹配项)
open ──ArrowDown / ArrowUp / Home / End──▶ open(activeId=相邻可选匹配项)
open ──Enter / 点击选项──▶ closed + 执行 pick(expert)
open ──Escape（query 非空）──▶ open(query='', activeId=null)
open ──Escape（query 为空）/ 点击外部 / Tab──▶ closed + 焦点回到胶囊
open ──切换事务开始──▶ closed（原有 pick 逻辑关闭菜单）
```

- **每次打开重置查询**：避免上次关闭时的过滤条件让用户误以为专家消失；关闭（选中/取消/点外部）也清空查询。
- **查询为空时**保持原有 `order, id` 顺序，不重排；
- **查询非空时**按相关度排序（见 §5.5），相关度相同回退到原始顺序，尊重专家配置的 `order`。

### 4.3 键盘

| 按键 | 行为 |
|---|---|
| `ArrowDown` | 激活下一个**可选**匹配项（跳过 broken 与 busy）；到底后回到第一项 |
| `ArrowUp` | 激活上一个可选匹配项；到顶后回到最后一项 |
| `Home` / `End` | 激活第一个 / 最后一个可选匹配项 |
| `Enter` | 当前有 `activeId` 且非输入法组合状态时，执行 `pick()`；`preventDefault` |
| `Escape` | 组合输入中：交给输入法处理；否则 query 非空 → 只清空查询并保持菜单；query 为空 → 关闭并聚焦胶囊 |
| `Tab` | 关闭菜单，让焦点自然移出 |
| 其他 | 交给输入框默认行为 |

- **输入法（IME）保护**：`onKeyDown` 同时检查 `event.nativeEvent.isComposing` 与组件内的 `composingRef`；组合期间按 Enter 只确认候选词，绝不触发专家切换。
- **查询变化时**：`activeId` 自动落到第一个可选匹配项，用户输入完直接按 Enter 即可选中最相关专家；清空查询后 `activeId=null`，避免回车误选。
- **滚动跟随**：`activeId` 变化时对对应选项执行 `scrollIntoView({ block: 'nearest' })`，DOM 不可用时静默跳过。

### 4.4 鼠标

- 点击胶囊切换开关；打开时搜索框自动聚焦；
- 悬停选项设置 `activeId`（视觉高亮），点击执行 `pick()`；
- 搜索框右侧 `×` 只在 query 非空时出现，点击清空并保持输入框焦点；
- 点击菜单外的判定沿用现有 `pointerInsideSelectorUi()`：`.wbe-menu` / `.wbe-wrap` 内的 pointerdown 不关闭菜单，搜索框与滚动条不会误触关闭。

### 4.5 空态、加载与错误

| 状态 | 展示 |
|---|---|
| `experts === null` 且无错误 | 保持现有加载中表现（列表为空，不显示「无专家」）；搜索框可输入，数据到达后立即生效 |
| 请求失败 | 菜单顶部保留现有 `.wbe-notice`（错误 + 重试），搜索框仍可用；重试成功后自动过滤 |
| 全表为空（`cards.length === 0`） | 显示现有 `emptyMenu`（「暂无可用专家」） |
| 有专家但查询无匹配 | 显示 `searchNoMatch`（「没有匹配的专家」）+ `searchNoMatchHint`（「换个关键词，或清除搜索」）+ 「清除搜索」按钮 |
| 只有 broken 行匹配 | 照常渲染 broken 行（禁用 + 原因），不额外隐藏；若全部不可选，Enter 无动作 |

### 4.6 文案（zh / en）

| key | zh | en |
|---|---|---|
| `searchPlaceholder` | 搜索专家（名称 / 描述 / ID） | Search experts by name, description, or ID |
| `searchAria` | 搜索专家 | Search experts |
| `searchClear` | 清除搜索 | Clear search |
| `searchNoMatch` | 没有匹配的专家 | No matching experts |
| `searchNoMatchHint` | 换个关键词，或清除搜索 | Try another keyword, or clear the search |
| `searchResults` | 匹配 {n} 位专家 | {n} experts match |
| `matchCount` | {shown} / {total} | {shown} / {total} |

> 文案统一走现有 `DICTS` / `t()`；不新增 locale 文件。

---

## 5. 模糊匹配算法

### 5.1 文本归一化

```js
function normalizeSearchText (value) {
  var text = typeof value === 'string' ? value : ''
  if (typeof text.normalize === 'function') {
    text = text.normalize('NFKD')          // 全角→半角，兼容字符拆分
  }
  return text
    .replace(/[\u0300-\u036f]/g, '')       // 去除拉丁重音
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}
```

效果：

- `ＡＩ` → `ai`（全角转半角）
- `Café` → `cafe`
- `Video_Editor` → `video_editor`（下划线保留，由分词器按词边界处理）
- 中文不变；大小写不敏感。

### 5.2 查询分词

```js
function queryTokensOf (query) {
  var normalized = normalizeSearchText(query)
  if (normalized === '') return []
  return normalized
    .split(/[\s,;:，；：、]+/)   // 空白 + 中英文标点
    .filter(Boolean)
    .slice(0, 8)                // 上限 8 个 token，防极端输入
}
```

- 多 token 之间是 **AND** 语义：每个 token 都必须命中某个字段；
- 搜索框 `maxLength=100`，超出部分由 DOM 限制；
- 纯空白查询等价于空查询，不触发过滤。

### 5.3 搜索字段与权重

| 字段 | 权重 | 说明 |
|---|---|---|
| `displayName`（含 `zhName` 兼容） | 10 | 用户最可能记得的名字 |
| `id` | 7 | 例如 `ai-video-script`，英文搜索主通道 |
| `description`（含 `zhDescription` 兼容） | 3 | 职责描述，辅助召回 |
| `skills[].name` | 1 | 技能名，低权重补充 |

每个字段先截断到 2048 字符再 `normalizeSearchText()`（描述可能很长；截断只影响搜索，不影响展示）。

> 不搜索 `roleText`（role.md 正文）：它可能包含大段提示词，对选择没有帮助，且会放大每次击键的匹配开销；选择器展示的也仅是名称/描述/id。

### 5.4 匹配层级（tier）

对单个 `token` 与单个字段文本：

| tier | 条件 | 系数 |
|---|---|---|
| `exact` | `text === token` | 1.00 |
| `prefix` | `text.startsWith(token)` | 0.80 |
| `wordPrefix` | 按词边界切分后，某个词以 token 开头（如 `video` 命中 `ai-video-script`） | 0.65 |
| `substring` | `text.includes(token)` | 0.50 |
| `subsequence` | 字符按顺序出现，且首尾跨度 ≤ token 长度 × 3（密度 ≥ 33%） | 0.20 × (token.length / span) |

规则：

- `token.length < 2` 时只做 exact/prefix/wordPrefix/substring，不做 subsequence（避免单字符过度召回）；
- 词边界：`/[^a-z0-9\u3400-\u9fff]+/` 切分；中文连续串视为一个词，主要靠 substring/subsequence；
- 不使用 `new RegExp(userInput)`，所有匹配都是字符串 API，避免 ReDoS 与转义问题；
- 空格容忍：直接匹配失败后，先试「去掉空格的字段/查询」的 exact/prefix/wordPrefix/substring 层（命中系数 ×0.95，如 `AI视频` 可命中 `AI 视频脚本创作专家`）；紧凑层也不命中时才回退到顺序子序列；
- 顺序子序列只用于「补充召回」，分数显著低于子串，不会压过正常匹配。

### 5.5 打分与排序

```text
tokenScore(token) = max over fields ( tierCoefficient × fieldWeight )
baseScore         = Σ tokenScore(token)           // 所有 token 必须命中，否则 null
phraseBonus       = displayName 包含完整归一化查询 ? +2 : 0
total             = baseScore + phraseBonus
```

- 查询为空：返回原数组（`order, id` 顺序）；
- 查询非空：`total` 降序；相同分数按原数组下标升序（即原 `order, id` 顺序）；
- 不修改原始 `cards` 数组，返回新数组；
- broken 行参与匹配与排序，但保持禁用，不出现在可选焦点中。

示例（按得分从高到低）：

| 查询 | 命中字段 | tier / 得分 | 结果 |
|---|---|---|---|
| `视频` | `displayName = "AI 视频脚本创作专家"` | wordPrefix：0.65×10=6.5 | 该专家排在「视频」仅出现在描述里的卡之前 |
| `writer` | `id = "writer"` | exact：1.0×7=7 | 精确 id 命中 |
| `ai-humanizer` | `id = "ai-humanizer"` | exact：7 | id 完整命中 |
| `负责 文字` | `description = "负责文字"` | 两个 token 均 exact：1.0×3×2=6 | 描述多词 AND |
| `视频专家` | `displayName = "AI 视频脚本创作专家"` | subsequence：0.2×(4/10)=0.08，×10=0.8 | 中文顺序模糊匹配 |
| `aivs` | `id = "ai-video-script"` | subsequence：约 0.2×(4/10)=0.08，×7≈0.56 | 英文缩写补召回 |
| `不存在` | — | null | 空结果 |

### 5.6 核心伪代码

```js
function searchExpertCards (experts, query) {
  var list = Array.isArray(experts) ? experts : []
  var normalized = normalizeSearchText(query)
  if (normalized === '') {
    return list.slice()
  }
  var tokens = queryTokensOf(normalized)
  if (tokens.length === 0) return list.slice()

  var scored = []
  for (var i = 0; i < list.length; i++) {
    var expert = list[i]
    if (expert === null || typeof expert !== 'object') continue
    var score = matchScoreOf(expert, tokens, normalized)
    if (score !== null) scored.push({ expert: expert, score: score, index: i })
  }
  scored.sort(function (a, b) {
    return (b.score - a.score) || (a.index - b.index)
  })
  return scored.map(function (entry) { return entry.expert })
}

function matchScoreOf (expert, tokens, normalizedQuery) {
  var fields = searchFieldsOf(expert) // [{ text, weight } …]
  var total = 0
  for (var t = 0; t < tokens.length; t++) {
    var best = 0
    for (var f = 0; f < fields.length; f++) {
      var coefficient = matchTierOf(fields[f].text, tokens[t])
      if (coefficient !== null) {
        var value = coefficient * fields[f].weight
        if (value > best) best = value
      }
    }
    if (best === 0) return null // 该 token 没有任何字段命中
    total += best
  }
  if (fields[0].text.indexOf(normalizedQuery) !== -1) total += 2 // 名称短语加成
  return total
}
```

### 5.7 复杂度与性能

- 设专家数 `n`、token 数 `t`、字段数 `f`（4）、平均字段长度 `L`（截断 ≤2048）；
- 单次过滤 `O(n × t × f × L)`；典型 `n=100, t=2, L=80`，每次击键远低于 1ms；
- 不引入 debounce（增加输入延迟且无必要）；不在每次渲染重新扫描网络或磁盘；
- 极端 `n=1000, t=8` 仍在毫秒级；若未来专家数量上千，再考虑引入 worker 或索引。

---

## 6. 组件与代码结构

### 6.1 新增纯函数（`client/client.js`）

放在现有「pure derivations」区（`nameOf` 之后），全部导出供 smoke 断言：

```js
function normalizeSearchText (value)              // §5.1
function queryTokensOf (query)                    // §5.2
function searchFieldsOf (expert)                  // §5.3
function matchTierOf (text, token)                // §5.4
function matchScoreOf (expert, tokens, query)     // §5.5
function searchExpertCards (experts, query)       // §5.6，返回排序后的新数组
```

> `searchExpertCards` 保持纯函数、无副作用、不改入参；便于在 `ExpertSelector` 渲染时直接调用，也便于未来市场页复用。

### 6.2 `ExpertSelector` 状态新增

| 状态 | 类型 | 初始值 | 生命周期 |
|---|---|---|---|
| `query` | `string` | `''` | 打开时重置；关闭时清空 |
| `activeId` | `string \| null` | `null` | 查询变化时重置为首个可选匹配；键盘导航更新 |
| `searchRef` | `{current: HTMLInputElement}` | `null` | 打开时 `focus()` |
| `triggerRef` | `{current: HTMLButtonElement}` | `null` | 关闭时焦点归还 |
| `composingRef` | `{current: boolean}` | `false` | `compositionstart/end` 维护，Enter 保护 |

现有 `open`、`data`、`switching`、`staged`、`error` 状态不变。

### 6.3 渲染结构

```jsx
<div className="wbe-wrap">
  <button ref={triggerRef} className="wbe-btn" aria-haspopup="listbox" aria-expanded={open}>…</button>
  {open ? (
    <div className="wbe-menu">
      <div className="wbe-menu-title">
        <span>{t('menuTitle')}</span>
        <span className="wbe-match-count" role="status" aria-live="polite">{shown} / {total}</span>
      </div>
      <div className="wbe-search-row">
        <input
          ref={searchRef}
          className="wbe-search"
          type="text"
          role="combobox"
          aria-label={t('searchAria')}
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls={listboxId}
          aria-activedescendant={activeIndex >= 0 ? optionIdFor(activeIndex) : undefined}
          placeholder={t('searchPlaceholder')}
          maxLength={100}
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={onQueryChange}
          onKeyDown={onSearchKeyDown}
          onCompositionStart={…}
          onCompositionEnd={…}
        />
        {query !== '' ? <button className="wbe-search-clear" aria-label={t('searchClear')} onClick={clearQuery}>×</button> : null}
      </div>
      <div className="wbe-list" id={listboxId} role="listbox" aria-label={t('menuTitle')}>
        {filtered.map((expert) => (
          <div
            key={expert.id}
            id={optionIdFor(index)}
            role="option"
            aria-selected={expert.id === currentExpertId}
            aria-disabled={broken || busy ? 'true' : undefined}
            data-option-id={expert.id}
            data-active={expert.id === activeId ? 'true' : undefined}
            data-current={…}
            className="wbe-item"
            onMouseEnter={…}
            onClick={() => pick(expert)}
          >…</div>
        ))}
        {emptyState}
      </div>
      {errorNotice}
      {removeLane}
      <div className="wbe-foot">…</div>
    </div>
  ) : null}
</div>
```

**兼容点**：原来的 `.wbe-item` 是 `<button>`；为了符合 `combobox + listbox` 的 ARIA 模型，改为 `div role="option"`，不再有原生按钮焦点。键盘交互全部由搜索框承载，点击由 `onClick` 承载。现有 smoke 里按 `type === 'button' && className === 'wbe-item'` 查找的断言需同步改为 `role === 'option'`。`optionIdFor(index)` 使用过滤后的下标生成 option DOM id（重复专家 id 也不会产生重复 DOM id）。

### 6.4 CSS（继续使用 `.wbe-` 命名空间）

新增/调整的关键类（全部使用 `--dsw-alias-*` / 交互 token，不引入字面颜色）：

| 类 | 作用 |
|---|---|
| `.wbe-menu` | `display:flex; flex-direction:column; overflow:hidden; width:340px; max-height:420px; max-height:min(420px, 60vh)`（第二行为现代浏览器覆盖，旧 WebView 回退到 420px） |
| `.wbe-menu-title` | 标题与计数两端对齐；`flex:none` |
| `.wbe-match-count` | `font-family: MONO`，`font-variant-numeric: tabular-nums`，tertiary 颜色 |
| `.wbe-search-row` | `position:relative; flex:none; padding:0 4px 6px` |
| `.wbe-search` | 32px 高、8px 圆角、边框 `border-l2`、背景 `bg-layer-1`、focus 边框 `brand-primary`、placeholder `label-tertiary`，样式数值与市场页 `.wbx-search` 保持一致 |
| `.wbe-search-clear` | 绝对定位在输入框右侧 18×18 的圆形按钮；hover 用 `interactive-bg-hover` |
| `.wbe-list` | `flex:1 1 auto; min-height:0; overflow-y:auto; display:flex; flex-direction:column` |
| `.wbe-item[data-active="true"]` | 与 hover 相同的背景（键盘高亮） |
| `.wbe-empty` | 空态容器；补充 `.wbe-empty-hint` 与 `.wbe-empty-clear` |

现有 `.wbe-menu` 的 `overflow-y: auto` 移到 `.wbe-list`；底部 `.wbe-foot`、`.wbe-remove` 保持固定，不随列表滚走。

### 6.5 可访问性（ARIA）

- 胶囊：`aria-haspopup="listbox"`，`aria-expanded` 表示菜单开合；
- 搜索框：`role="combobox"`、`aria-autocomplete="list"`、`aria-expanded="true"`、`aria-controls=<listbox id>`、`aria-activedescendant=<active option id>`；
- 列表：`role="listbox"`，每个选项 `role="option"`；当前专家 `aria-selected="true"`，broken/busy `aria-disabled="true"`；
- 计数：`role="status"` + `aria-live="polite"`，查询变化时播报「匹配 n 位专家」；
- 关闭后焦点回到胶囊（点击选项后用 `triggerRef.current.focus()`；点击外部关闭不强制抢焦点）；
- 搜索框 `aria-label` 使用完整文案，不依赖 placeholder。

### 6.6 图标与视觉

- 搜索框不强行加放大镜图标，避免引入图标资源；以 placeholder 与聚焦边框表达可输入；
- `×` 清除按钮使用文本字符，`aria-label` 保证可读；
- 菜单背景继续使用 `SOLID_SURFACE`（`--dsw-alias-bg-layer-2` 回退），不改为半透明菜单材质。

---

## 7. 边界与异常

| 场景 | 行为 |
|---|---|
| `experts === null`（首次加载） | 搜索框可输入；列表空；数据到达后按当前 query 过滤 |
| 请求失败 | 显示现有错误条 + 重试；搜索不阻塞；重试成功后自动应用 query |
| 专家表为空 | 显示「暂无可用专家」；搜索框仍显示但输入无结果 |
| 查询无匹配 | 显示「没有匹配的专家」+ 清除按钮；不显示空白菜单 |
| 只有 broken 行匹配 | 渲染 broken 行（禁用 + 原因）；键盘跳过；无可选时 Enter 不动作 |
| query 只有空白 | 等价空查询，展示全部，计数只显示总数 |
| query 超过 100 字符 | `<input maxLength=100>` 截断，匹配器不再额外处理 |
| 输入法组合中按 Enter | 不触发 pick；`compositionend` 后正常过滤 |
| 切换事务进行中 | 胶囊已禁用，菜单不可重开；不存在「搜索中切换」 |
| 菜单高度不足 | `max-height: min(420px, 60vh)`；列表内部滚动，底部说明固定 |
| 多个选择器实例（未来） | listbox/option id 使用实例前缀（模块级计数器），避免 `aria-activedescendant` 串台 |
| 无会话的暂存分支 | 同一组件、同一搜索逻辑；选中后仍走 staged draft，不走网络 |
| 描述含极长文本 | 搜索时截断到 2048 字符；展示仍由现有两行 clamp 控制 |
| `normalize` 不可用（极老 WebView） | `try/catch` 回退到 `toLowerCase()`；不抛异常 |
| 专家 id 重复 | registry 已按 rank 去重；匹配器仍以 id 作为 key，重复时 React 会警告，属于上游数据问题 |

---

## 8. 测试计划

### 8.1 纯函数（`scripts/smoke-client.mjs` 新增 §3b）

| 用例 | 断言 |
|---|---|
| 归一化 | `normalizeSearchText('ＡＩ  Video') === 'ai video'` |
| 中文子串 | `searchExpertCards(TABLE, '剪')` 命中「剪辑师」 |
| 描述匹配 | `'负责文字'` 命中 `writer` |
| id 匹配 | `'writer'` 命中 `writer` |
| 多 token AND | `'ai 视频'` 只命中同时包含两者的卡 |
| 顺序模糊（中文） | `'视频专家'` 命中「AI 视频脚本创作专家」 |
| 英文缩写 | `'aivs'` 命中 `ai-video-script` |
| 大小写/全角 | `'ＡＩ'` 与 `'ai'` 结果一致 |
| 空格容忍 | `'AI视频'` 命中带空格的 `AI 视频脚本创作专家` |
| 排名 | `displayName` 命中优先于仅 `description` 命中；同分按原顺序 |
| 空查询 | 返回原数组顺序，且不修改入参 |
| 无匹配 | 返回 `[]` |
| broken 行 | 仍出现在结果中且 `broken` 字段保留 |

### 8.2 组件机（`scripts/smoke-client.mjs` §4a–4f 扩展）

1. 打开菜单 → 渲染 `.wbe-search`；`placeholder` 为中文文案；初始 value 为 `''`；
2. 输入「剪」→ 只渲染一个 `.wbe-item`（editor），其余被过滤；
3. 输入「zzz」→ 渲染 `.wbe-empty`，含「没有匹配的专家」；
4. 点击清除 → 列表恢复全部，输入框 value 变 `''`；
5. `ArrowDown` → 首个可选选项 `data-active="true"`；`Enter` → 触发原有 `POST /api/switch`，请求体不变；
6. broken 行被键盘跳过（焦点落到下一个可用项）；
7. Escape 第一次清空 query、第二次关闭；关闭后触发按钮重新获得焦点（以 stub 记录的 focus 调用为准）；
8. 输入过程中 `script.calls` 的 GET/POST 数量不增加（搜索是纯前端）；
9. 暂存分支（无 session）中搜索 + 选中 → 仍是 staged draft，不发请求；
10. `compositionstart` 后按 Enter → 不触发 pick；`compositionend` 后可正常选择。

### 8.3 视觉/手工验收

- 浅色/深色主题下搜索框边框、placeholder、focus 态、计数、空态均使用主题 token；
- 菜单在 320px 宽窗口、60vh 高度限制下不溢出；
- 30+ 专家列表输入中文/英文均即时过滤；
- 输入法（macOS 拼音、Windows 微软拼音）组合期间不误选；
- 键盘 Tab 从胶囊进入搜索框、Escape 逐级退出符合预期；
- 切换专家后重开菜单，query 已清空、当前专家 ✓ 标记正确。

### 8.4 回归

```sh
node scripts/smoke-client.mjs
node scripts/smoke.mjs
node scripts/smoke-importer.mjs
node scripts/smoke-install.mjs
node scripts/verify-host-contract.mjs
```

`client/client.js` 改动不涉及 host 契约，但需保证五套脚本全绿。

---

## 9. 交付切分

| 阶段 | 内容 | 依赖 | 估算 |
|---|---|---|---|
| P0 匹配器 | `normalizeSearchText` / `queryTokensOf` / `searchFieldsOf` / `matchTierOf` / `searchExpertCards` + smoke §4e | 无 | 0.5 人日 |
| P1 搜索 UI | `ExpertSelector` state、搜索框、过滤、计数、空态、清除、CSS + smoke §4a–4d 扩展 | P0 | 1 人日 |
| P2 键盘与可访问性 | combobox/listbox ARIA、方向键/Home/End/Enter/Escape、IME 保护、焦点归还、视觉验收 | P1 | 0.5 人日 |
| P3 文档 | README「会话选择器」补一句、`docs/design.md` §8 加链接、截图更新（可选） | P1/P2 | 0.25 人日 |

> 建议 P0+P1 先合并（可用搜索，鼠标操作），P2 作为同一 PR 的收尾；P3 随发布提交。

---

## 10. 文件改动清单

| 文件 | 改动 |
|---|---|
| `client/client.js` | `.wbe-*` CSS 新增搜索/列表/空态样式；`DICTS` 新增 7 个 key；§5 纯函数；`ExpertSelector` 状态与渲染改造；`module.exports` 导出纯函数 |
| `scripts/smoke-client.mjs` | 新增 §4e 纯函数用例；扩展 §4a–4d 组件机；更新 `.wbe-item` 查找从 `button` 改为 `role="option"` |
| `README.md` | 「会话选择器」功能说明补「支持名称 / 描述 / ID 模糊搜索」 |
| `README.en.md` | 英文 README 同步补充模糊搜索说明 |
| `docs/design.md` | §8 Client 段落补一句并链接本文 |
| `docs/expert-picker-search.md` | 本文 |

**不改**：`src/` 全部 host 代码、`package.json`、路由、注册表、切换事务、市场页搜索。

---

## 11. 风险与未决

| # | 风险/问题 | 影响 | 处理 |
|---|---|---|---|
| 1 | 用户预期「模糊」包含拼音输入 | 中 | 文档明确非目标；中文 IME 可直接输汉字；英文 id 可搜；未来在 `searchFieldsOf` 追加拼音 haystack 即可 |
| 2 | 顺序子序列召回过多 | 低-中 | 限制 token 长度 ≥2、跨度 ≤3× token 长度，且系数远低于子串；smoke 覆盖反例 |
| 3 | 搜索改变列表顺序导致用户找不到原来的位置 | 低 | 仅 query 非空时按相关度排序；空查询保持 `order, id`；同分按原顺序 |
| 4 | 将 `.wbe-item` 从 button 改为 div 影响现有测试/样式 | 低 | 统一更新 smoke；CSS 的 `.wbe-item` 选择器不变；点击/禁用逻辑保持 |
| 5 | ARIA combobox 实现不完整导致读屏异常 | 中 | 按 §6.5 实现并用 VoiceOver/NVDA 手工抽查；不引入第三方 a11y 库 |
| 6 | React hooks 在宿主旧版本不可用 | 低 | 仅用 `useState` / `useEffect` / `useRef`（现有代码已验证）；不引入 `useMemo` |
| 7 | 搜索框抢焦点影响输入框原有快捷键 | 低 | 搜索框仅在菜单打开时挂载并聚焦；关闭后焦点回到胶囊；Tab 可正常移出 |
| 8 | 专家数量极大时每次击键卡顿 | 低 | 当前量级几十到几百；O(n) 毫秒级；超过 1000 再评估 worker/索引 |
| 9 | 描述中的富文本/HTML 注入 | 低 | 匹配只做字符串；渲染继续 React 文本节点；禁止 `dangerouslySetInnerHTML` |
| 10 | 未来团队专家卡字段扩展（`members` 等） | 低 | 匹配器对缺失字段容错；团队名/成员名可作为后续 `searchFieldsOf` 扩展，不影响现有逻辑 |

---

## 12. 验收标准

- [ ] 打开专家下拉即见搜索框并自动聚焦；
- [ ] 输入中文名称片段、英文 id、描述关键词均能实时过滤；
- [ ] 多关键词（空格分隔）按 AND 命中，结果按相关度排序；
- [ ] 查询为空时列表顺序与现状完全一致；
- [ ] 键盘 ↑/↓/Enter/Esc 可完成选择与退出，输入法组合期间不误选；
- [ ] 无匹配时显示空态与清除入口，不出现空白菜单；
- [ ] broken 专家仍可被搜索到且保持禁用 + 原因展示；
- [ ] 搜索不产生任何网络请求、不写存储；
- [ ] 浅色/深色主题样式与现有宿主控件一致；
- [ ] 现有五套 smoke 全绿，新增搜索用例全绿；
- [ ] 选择专家后的切换/暂存行为与改动前一致（请求体、状态机、错误处理均不变）。

---

## 13. 实施记录（2026-11-20）

- `client/client.js`：已加入 §5 的六个纯函数（`normalizeSearchText` / `queryTokensOf` / `searchFieldsOf` / `matchTierOf` / `matchScoreOf` / `searchExpertCards`）及 `module.exports` 导出、`.wbe-search*` / `.wbe-list` / 空态 CSS、zh/en 文案，以及 `ExpertSelector` 的搜索状态、过滤、匹配计数、清除、键盘导航、IME 保护与 ARIA；
- `scripts/smoke-client.mjs`：新增 §3b（匹配器纯函数）与 §4e/§4f（搜索 UI、键盘、IME、staged 分支）；§4a 补 broken 行键盘跳过，§4e 补 live-session 键盘 Enter→POST，§4f 补关闭后焦点回到触发按钮；原有 `.wbe-item` 断言已从 `<button>` 更新为 `role="option"`；
- 验证：`node scripts/smoke-client.mjs`、`node scripts/smoke.mjs`、`node scripts/smoke-importer.mjs`、`node scripts/smoke-install.mjs` 全绿；`node scripts/verify-host-contract.mjs` 需要本机存在 `/tmp/dsh-refs/dsh/node_modules` 的宿主包提取物，本机当前未提供，未执行（本次改动为 client-only，不涉及 host Config/volatile 契约）。
