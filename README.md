# DeskLLMPet Characters

五角色独立桌宠，支持透明动画、摸头与拖拽、流式 AI 对话和 DeepSeek API 账户余额查询。基于 [isKage/desk-llm-pet](https://github.com/isKage/desk-llm-pet) 修改，提供 **Windows x64 便携版**与公开源码。

[下载 Windows ZIP](https://github.com/958639806/deskllmpet-characters/releases/download/v1.1.0-characters/DeskLLMPet-BlueMaid-v1.1.0-characters.zip) · [版本说明与校验值](https://github.com/958639806/deskllmpet-characters/releases/tag/v1.1.0-characters) · [详细使用指南](README-BLUE-MAID.md)

| 蓝鲸女仆 | 金发战斧 | 橙发花语 | 紫发星猫 | 白发龙姬 |
| --- | --- | --- | --- | --- |
| <img src="docs/characters/blue-maid.png" width="144" alt="蓝鲸女仆"> | <img src="docs/characters/blonde-reaper.png" width="144" alt="金发战斧"> | <img src="docs/characters/orange-mage.png" width="144" alt="橙发花语"> | <img src="docs/characters/violet-cat.png" width="144" alt="紫发星猫"> | <img src="docs/characters/white-dragon.png" width="144" alt="白发龙姬"> |

每个角色包含待机、摸头、拖拽悬空三组透明 WebM 动画，共 15 个动作文件。角色名称是区分外观的昵称。

## 开始使用

1. 下载 ZIP 并完整解压，运行 `启动桌宠.cmd` 或 `DeskLLMPet-BlueMaid.exe`。保留同目录的全部文件与 `resources` 文件夹。
2. 右键桌宠 → **设置 → 宠物设置 → 桌宠角色**，选择后立即切换；也可以右键托盘图标 → **切换角色**。
3. 下次启动会记住角色。不同角色分别保存动画选择，共用已有 API 配置与聊天历史。

便携版不需要安装 Node.js、Python、Steam 或 DSH。没有 API Key 时仍可使用动画、摸头、拖拽和角色切换。

| 操作 | 功能 |
| --- | --- |
| 单击角色 | 播放摸头反应 |
| 按住左键拖动 | 提起并移动，松手回到待机 |
| 双击角色 | 查询 DeepSeek API 余额；关闭余额功能后显示自定义语句 |
| 右键角色 → AI 对话 | 流式聊天、停止生成、多会话与本地历史 |
| 右键角色 → 设置 | 配置 API、模型、角色、大小、透明度与余额查询间隔 |
| 单击托盘图标 | 显示或隐藏桌宠 |

## 配置 DeepSeek

1. 在 **设置 → API 配置** 填写自己的 API Key，API 地址通常为 `https://api.deepseek.com`，余额查询地址留空即可。
2. 保存后，**AI 对话**设置中的单独 Key 与地址保持空白，即复用主配置；模型名按账户可用模型填写。
3. 双击桌宠查余额，右键打开 AI 对话开始聊天。切换外观不会覆盖自己编写的系统提示词。

这里查询的是 **DeepSeek 开放平台 API 账户余额**，不是网页会员、订阅额度或其他服务的套餐额度。主配置 Key 使用系统 `safeStorage` 保护；插件独立 Key 的存储边界见[详细指南](README-BLUE-MAID.md)。发行包不包含账户 Key 或聊天历史。

**真实 DeepSeek 在线对话和余额尚未实测。** 已完成的网络与聊天链路测试使用本地模拟服务，没有使用真实账户 Key。

## 开发与验证

安装 Node.js 和 npm，在仓库根目录运行：

```powershell
npm ci
npm start
```

本机 Windows 验证记录（2026-11-03）：

| 命令 | 结果与范围 |
| --- | --- |
| `node scripts/self-check.js` | 34 项通过：语法、插件与结构自检 |
| `node scripts/test-deepseek.js` | 26 项通过：本地 HTTP、流式解析、取消及存储模拟 |
| `node scripts/test-video-player.js` | 16 项通过：播放切换、恢复、竞态与界面控制模拟 |
| `node scripts/test-characters.js` | 7 项通过：角色注册、持久化、动画池、设置与提示词 |
| `node scripts/check-characters.js` | 34 项通过：真实 Electron、IPC、透明视频解码、动作切换与重启持久化 |

Electron 集成检查创建独立测试配置，不读取实际用户配置；测试结果、配置与日志写入已忽略的 `verification/`。透明桌面显示另经本机 Windows 实际截图检查，不能仅用视频解码结果替代。

Windows 版保留已验证的 `screen-saver` 浮窗级别、CSS 透明度与应用内软件渲染。使用时无需修改系统注册表或显卡设置。本版发行与实际桌面验证范围为 Windows x64。

## 重建动画素材

仓库保留采用的原始图、生成提示词、参考图和裁切计划。`frames/`、`audits/` 等派生文件不进入 Git，可由工具重新生成；重建过程执行裁切、统一缩放、锚点对齐与编码，不生成新姿势。

常规启动不需要 `sharp`。只有重建素材时，才需要可选安装 `sharp@0.35.5`；也可将 `SHARP_MODULE_PATH` 指向已有的 `sharp` 模块。编码另需包含 `libvpx-vp9` 的 FFmpeg 及 ffprobe：加入 `PATH`，或设置 `FFMPEG_PATH`，必要时设置 `FFPROBE_PATH`。

```powershell
# 可选：仅在重建素材时安装
npm install --no-save sharp@0.35.5

# 原蓝鲸女仆
node tools/pack-blue-maid.mjs --encode

# 新增四角色
node tools/pack-character.mjs --character blonde-reaper --encode
node tools/pack-character.mjs --character orange-mage --encode
node tools/pack-character.mjs --character violet-cat --encode
node tools/pack-character.mjs --character white-dragon --encode
```

角色注册位于 `src/shared/characters.js`；蓝鲸女仆动画保留在 `assets/animations/`，其余角色在 `assets/characters/<id>/`。重建参数见 `character-source/pack-plan.json` 和 `character-source/characters/<id>/pack-plan.json`。

## 来源与许可

代码基于 [isKage/desk-llm-pet](https://github.com/isKage/desk-llm-pet)，固定上游提交 [`ae433e3cc2eafaa52a7a869ca2c13a3be2ac53bd`](https://github.com/isKage/desk-llm-pet/commit/ae433e3cc2eafaa52a7a869ca2c13a3be2ac53bd)。保留原作者 **isKage** 的 [MIT 许可证](LICENSE)，修改来源记录见 [UPSTREAM.json](UPSTREAM.json)。打包辅助依赖的许可记录在 [tools/licenses](tools/licenses/)。

角色素材由用户提供的五张参考图与内置图像生成工具产出的衍生图整理而来。参考图、生成图及动画的来源和许可边界单独列于 [character-source/ASSET-SOURCES.md](character-source/ASSET-SOURCES.md)；代码的 MIT 许可不替代该素材说明。
