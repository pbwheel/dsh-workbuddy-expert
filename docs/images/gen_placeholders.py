#!/usr/bin/env python3
"""Generate placeholder images for README. Replace with real screenshots later."""
from PIL import Image, ImageDraw, ImageFont

W, H = 1280, 720
BG = (247, 248, 250)
FG = (44, 44, 41)
MUTED = (95, 94, 90)
ACCENT = (15, 110, 86)
BADGE_BG = (250, 238, 218)
BADGE_FG = (133, 79, 11)

FONT_PATH = "/System/Library/Fonts/Hiragino Sans GB.ttc"

_fcache = {}

def font(size):
    if size not in _fcache:
        _fcache[size] = ImageFont.truetype(FONT_PATH, size)
    return _fcache[size]

def dashed_rect(d, box, dash=14, gap=10, width=2, color=(178, 182, 188)):
    x0, y0, x1, y1 = box
    def line_seg(ax, ay, bx, by):
        d.line([(ax, ay), (bx, by)], fill=color, width=width)
    def dashed_h(y, x_from, x_to):
        x = x_from
        while x < x_to:
            line_seg(x, y, min(x + dash, x_to), y)
            x += dash + gap
    def dashed_v(x, y_from, y_to):
        y = y_from
        while y < y_to:
            line_seg(x, y, x, min(y + dash, y_to))
            y += dash + gap
    dashed_h(y0, x0, x1)
    dashed_h(y1, x0, x1)
    dashed_v(x0, y0, y1)
    dashed_v(x1, y0, y1)

def center_text(d, y, text, f, fill):
    w = d.textlength(text, font=f)
    d.text(((W - w) / 2, y), text, font=f, fill=fill)

def make_placeholder(path, fname, title, purpose, bullets):
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    dashed_rect(d, (28, 28, W - 28, H - 28))
    d.rectangle([48, 48, 240, 84], fill=BADGE_BG)
    t = "PLACEHOLDER"
    d.text((48 + (192 - d.textlength(t, font=font(19))) / 2, 56), t, font=font(19), fill=BADGE_FG)
    t = fname
    d.text((48 + (W - 96 - d.textlength(t, font=font(20))) / 2, 56), t, font=font(20), fill=MUTED)

    center_text(d, 150, title, font(44), FG)
    center_text(d, 224, purpose, font(26), MUTED)

    d.line([(W / 2 - 60, 290), (W / 2 + 60, 290)], fill=(178, 182, 188), width=2)

    y = 330
    for b in bullets:
        t = "\u25b8  " + b
        w = d.textlength(t, font=font(24))
        d.text(((W - w) / 2, y), t, font=font(24), fill=FG)
        y += 52

    center_text(d, H - 92, "拍摄后以同名文件覆盖本占位图（docs/images/）", font(20), MUTED)
    img.save(path)
    print("wrote", path)

def make_hero_gif(path):
    frames = []
    fw, fh = 640, 360
    steps = [
        ("① WorkBuddy 专家中心 · 点「召唤」落盘", 1),
        ("② 市场页 · 卡片 hover 点「安装」", 2),
        ("③ 会话 · 输入框胶囊选择专家", 3),
        ("④ 下一条消息 · 新角色 + 新 skill 生效", 4),
    ]
    for text, active in steps:
        img = Image.new("RGB", (fw, fh), BG)
        d = ImageDraw.Draw(img)
        dashed_rect(d, (16, 16, fw - 16, fh - 16), dash=10, gap=8, width=2)
        d.rectangle([32, 32, 200, 60], fill=BADGE_BG)
        t = "DEMO GIF"
        d.text((32 + (168 - d.textlength(t, font=font(16))) / 2, 38), t, font=font(16), fill=BADGE_FG)
        cx = fw / 2
        r_on, r_off = (29, 158, 116), (205, 207, 201)
        for i in range(4):
            color = r_on if (i + 1) == active else r_off
            x = cx - 84 + i * 56
            d.ellipse([x - 9, 118, x + 9, 136], fill=color)
            if i < 3:
                d.line([x + 13, 127, x + 43, 127], fill=(205, 207, 201), width=3)
        w = d.textlength(text, font=font(22))
        d.text(((fw - w) / 2, 180), text, font=font(22), fill=FG)
        t2 = "录屏替换 · ≤15s · ≤2MB"
        w2 = d.textlength(t2, font=font(17))
        d.text(((fw - w2) / 2, 250), t2, font=font(17), fill=MUTED)
        frames.append(img)
    frames[0].save(path, save_all=True, append_images=frames[1:], duration=1100, loop=0)
    print("wrote", path)

if __name__ == "__main__":
    make_placeholder(
        "market.png", "market.png",
        "专家市场（设置 → WorkBuddy 专家）",
        "卡片浏览 / 搜索 / 分类 · 安装 = 导出",
        [
            "卡片网格 + 搜索框 + 分类筛选",
            "至少一张卡片处于 hover 态：右上角浮现「安装」按钮",
            "一张已安装卡片（显示 卸载/更新）+ 一张 updatable 更新徽标",
            "顶栏露出源路径（可脱敏为 ~/.workbuddy/...）",
            "浅色主题 · 统一窗口宽度",
        ],
    )
    make_placeholder(
        "picker.png", "picker.png",
        "会话选择器（输入框旁专家胶囊）",
        "带头像的专家列表 · 选中即软切换",
        [
            "胶囊展开态：头像 + 名称 + 描述的专家列表",
            "当前选中项高亮",
            "若能复现：一条 broken 记录带原因（证明不静默隐藏）",
            "同帧露出创建会话入口更佳（冷会话即选即生效）",
            "浅色主题 · 与 market.png 同窗口宽度",
        ],
    )
    make_placeholder(
        "switch-trace.png", "switch-trace.png",
        "切换后会话轨迹",
        "保留全部历史 · expert/selected 事件 · 新 skill 生效",
        [
            "同一会话内：切换前的历史消息仍然可见",
            "expert/selected 事件行（或注入的切换提示）",
            "切换后模型输出中出现新专家专属 skill 的调用记录",
            "本地路径 / 私有专家名请替换为演示数据",
        ],
    )
    make_hero_gif("hero-demo.gif")
