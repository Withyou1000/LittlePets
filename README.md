# LittlePets

一个偏治愈风格的桌面宠物原型，视觉参考项目根目录里的 [DESIGN.md](D:\LittlePets\DESIGN.md)。

## 资源目录

项目现在直接使用仓库内的 `pets/` 目录，不再依赖外部的 `C:\Users\Jane\.codex\pets`。

当前内置宠物：

```text
.\pets\baiheyan
.\pets\dimo
```

每只宠物目录至少包含：

```text
pet.json
spritesheet.webp
```

`pet.json` 里的 `spritesheetPath` 决定实际加载的雪碧图文件。

## 运行

```bash
npm install
npm start
```

如果 Electron 下载较慢，可以使用镜像：

```powershell
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
npm install
npm start
```

## 当前功能

- 启动后后台运行，并创建系统托盘图标
- 点击托盘图标打开 LittlePets 设置界面
- 透明无边框悬浮桌宠窗口
- 默认置顶，可在设置界面切换
- 默认贴近桌面右下角，支持拖动移动并保存位置
- 默认使用 `baiheyan` 的 `spritesheet.webp` 播放动画
- 可在设置界面选择 `.\pets` 目录下的宠物
- 右键宠物打开设置
- 每隔一段时间自动显示鼓励或安慰文字

## 设计方向

- 主参考：`DESIGN.md` 的 Figma 风格
- 产品气质：治愈、轻松、低打扰
- 交互策略：轻动效、轻反馈、少打扰
