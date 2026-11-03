# v1.1.0-characters · 五角色独立桌宠

Windows x64 便携版，包含蓝鲸女仆、金发战斧、橙发花语、紫发星猫、白发龙姬。每个角色有待机、摸头与拖拽悬空三组透明动画，共 15 个 WebM。源码随本版本公开。

[下载 Windows ZIP](https://github.com/958639806/deskllmpet-characters/releases/download/v1.1.0-characters/DeskLLMPet-BlueMaid-v1.1.0-characters.zip) · [项目首页](https://github.com/958639806/deskllmpet-characters)

## 使用

完整解压 ZIP，运行 `启动桌宠.cmd` 或 `DeskLLMPet-BlueMaid.exe`；保留同目录全部文件和 `resources` 文件夹。不需要安装 Node.js、Python、Steam 或 DSH。

- **选角色**：右键桌宠 → 设置 → 宠物设置 → 桌宠角色；或右键托盘图标 → 切换角色。
- **互动**：单击摸头，按住左键拖动，松手回待机；下次启动记住选角，角色动画池分别保存。
- **聊天与余额**：主 API 配置填写自己的 DeepSeek Key，AI 对话插件的独立 Key 与地址留空即可复用。双击查询的是 API 账户余额，不是订阅或会员额度。
- 保留已有配置、聊天历史和自定义提示词。发行包不包含账户 Key 或聊天数据。

Windows 浮窗使用已验证的 `screen-saver` 级别、CSS 透明度与应用内软件渲染，无需修改系统注册表或显卡设置。

## 验证范围

本机 Windows 已通过：自检 34 项、DeepSeek 客户端本地模拟测试 26 项、播放器与控制器回归 16 项、角色测试 7 项，以及真实 Electron 五角色集成检查 34 项。集成检查覆盖真实 IPC、透明视频解码、三类动作、快速切换、同角色恢复播放、重启持久化和无效角色回退；桌面可见性另经实际 Windows 截图检查。

**没有使用真实 DeepSeek Key，真实在线聊天与余额接口尚未实测。** 网络测试使用本地模拟服务；实际使用需自行配置账户与可用模型。

## 文件校验

文件：`DeskLLMPet-BlueMaid-v1.1.0-characters.zip`

大小：**121129697 字节**

SHA-256：

```text
f17fa23e4cb7db073dd0c13de9fbca9a2f3110a19ad423214f9e3bf0775e0d53
```

Windows PowerShell 可运行：

```powershell
Get-FileHash .\DeskLLMPet-BlueMaid-v1.1.0-characters.zip -Algorithm SHA256
```

## 来源

代码基于 [isKage/desk-llm-pet](https://github.com/isKage/desk-llm-pet) 的固定提交 [`ae433e3cc2eafaa52a7a869ca2c13a3be2ac53bd`](https://github.com/isKage/desk-llm-pet/commit/ae433e3cc2eafaa52a7a869ca2c13a3be2ac53bd)，保留原作者 isKage 与 MIT 许可。

角色图来自用户给定参考与内置图像生成工具，素材来源与独立许可边界见仓库中的 [ASSET-SOURCES.md](https://github.com/958639806/deskllmpet-characters/blob/main/character-source/ASSET-SOURCES.md)。采用的原图、提示词和重建计划随源码提供，派生帧及审计产物可重建，不进入 Git。详细操作见 [README-BLUE-MAID.md](https://github.com/958639806/deskllmpet-characters/blob/main/README-BLUE-MAID.md)。
