# README 插图

当前为**占位图**：真图拍摄后以**同名文件覆盖**即可，README（中/英）无需改动。

| 文件 | 内容 | 拍摄要点 |
|---|---|---|
| `hero-demo.gif` | 一镜到底：召唤 → 安装 → 选择 → 生效 | ≤15s、≤2MB（`ffmpeg -i in.mov -vf "fps=12,scale=720:-2" out.gif`） |
| `market.png` | 专家市场页 | hover 态露出安装按钮；含 updatable 徽标与已装态；顶栏源路径脱敏 |
| `picker.png` | 会话选择器展开态 | 头像列表 + 选中高亮；尽量拍到 broken 行与创建会话入口 |
| `switch-trace.png` | 切换后会话轨迹 | 切换前历史仍在 + `expert/selected` 事件 + 新 skill 调用记录；路径与专家名脱敏 |

统一浅色主题、同一窗口宽度。占位图可用 `python3 gen_placeholders.py` 重新生成（仅开发用途，真图入库后本脚本与占位图可移除）。
