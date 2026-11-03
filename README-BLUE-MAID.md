# 五角色 · DeskLLMPet 独立版

基于 [isKage/desk-llm-pet](https://github.com/isKage/desk-llm-pet) 的五角色版本，保留上游 MIT 许可。无需 DSH、Steam、Node.js 或 Python 即可运行便携包。

## 启动

完整解压 `DeskLLMPet-BlueMaid-v1.1.0-characters.zip`，双击其中的 `启动桌宠.cmd` 或 `DeskLLMPet-BlueMaid.exe`。请保留同目录的全部文件和 `resources` 文件夹。

可选角色：蓝鲸女仆、金发战斧、橙发花语、紫发星猫、白发龙姬。名称为方便区分外观的昵称。

- 右键桌宠 → 设置 → 宠物设置 → 桌宠角色：选择后立即切换。
- 托盘图标 → 右键 → 切换角色：也可直接选择。
- 下次启动会记住选择；切换共用原来的 API 配置和聊天历史。每个角色的动画选择分别保存。

- 单击桌宠：摸头反应。
- 按住左键拖动：提起反应，松手回到待机。
- 双击桌宠：查询 DeepSeek API 余额，展示总余额、充值余额、赠金和可用状态。
- 右键 → AI 对话：打开聊天窗口，支持流式回复、停止生成、多会话和本地历史。
- 右键 → 设置：配置 Key、模型、大小、透明度和余额查询间隔。
- 托盘图标：显示/隐藏、查询余额、聊天、设置和退出。

这是独立桌宠程序，五个角色各自包含待机、摸头和提起三组动作。没有启用开机自动运行。

## 首次填写 DeepSeek Key

1. 右键桌宠 → 设置 → API 配置。
2. API 地址保留 `https://api.deepseek.com`，填写你自己的 DeepSeek API Key。余额查询地址可留空。
3. 保存配置。
4. AI 对话页中的单独 Key 和地址保持空白，即复用上一步配置；默认模型为 `deepseek-flash`，也可填写你账户当前可用的模型名。
5. 双击桌宠查询余额，右键 → AI 对话开始聊天。

没有 Key 时，桌宠动画与拖拽仍可使用；聊天和余额会显示缺少配置，不会制造金额。安装包本身不携带账户 Key 或聊天数据；本机升级会读取原配置目录。

余额是 DeepSeek API 账户的货币余额；聊天窗口不提供订阅套餐额度、其他平台余额或账户全局 Token 用量统计。

## 配置位置与 Key

配置和聊天历史保存于 `%APPDATA%\DeskLLMPet-BlueMaid`，沿用已交付的蓝发女仆修复版配置目录，与上游 DeskLLMPet 的目录分开。退出后该目录中的设置会保留。新增角色不需要重新填写 Key；自定义 AI 提示词也会保留。

主「API 配置」里的 Key 使用 Electron safeStorage/Windows 账户保护后写盘。已经在本机用无效测试 Key 验证了加密、解密及通过真实 IPC 调用本地模拟接口；没有使用真实账户 Key。

上游聊天插件还支持单独填写另一个 Key，该独立字段仍由插件以普通本地设置保存。建议保持该字段空白，复用主 API 配置；主 Key 的保护不覆盖这个单独字段。

## 本版动画

五个角色共 15 组动画，每组 12 张画稿；本次为四个新角色新增 144 张画稿，加上已有蓝鲸女仆共 180 张。采用每组固定比例和锚点，不把每个姿态分别放大到同一高度。待机和摸头对齐脚底，提起对齐头部。透明 WebM 的 50fps 时间轴包含正常持帧，不代表每秒有 50 张不同手绘姿态。

播放器在下一段解码完成后再用双缓冲切换，保留上一段画面，减少加载空白。修复了快速提起后松手可能停留在提起动画的竞态。生成画稿仍有少量帧间细节差异，实际动作的流畅观感仍待你体验。

Windows 版修复了“角色看不见、窗口却能交互”的置顶层级问题：Electron 28 的 `floating` 路径会把窗口排到任务栏之后，本机上因此被其他应用盖住。桌宠、气泡、菜单统一采用已实测可见的 `screen-saver` 层级。透明度改为画面层 CSS opacity，保留原有数值；Windows 保留软件渲染以减少本机丢帧。已通过实际窗口截图确认：修复层级后，GPU 与软件渲染两种方式下角色在 60% 透明度时均可见；右键菜单也可见并可操作。

## 已完成的验证

- 项目自检：34 项通过。
- DeepSeek 客户端：26 项本地 HTTP / 存储包装回归通过，含 401、无效响应、超时、流式分块及取消。
- 双缓冲播放器、自动余额提示、透明度、窗口层级、切换竞态和同角色恢复播放：16 项回归通过。
- 角色注册、配置保留、动画池隔离与菜单选择：7 项回归通过。
- 五角色真实 Electron 集成：34 项通过，包含 15 段透明视频、动作播放、快速切换、同角色恢复播放、进程重启后选择持久化、无效角色回退及旧配置/聊天记录保留；测试未访问真实账户。
- 真实 Electron 页面：15 项窗口/桥接/菜单/设置检查通过。
- 蓝发女仆集成：真实 Chromium 透明视频解码、播放推进、摸头回待机、合成拖放、原生 safeStorage、余额 IPC 和流式聊天 UI/历史保存通过。

播放计数只反映本机短时测试，不能推断所有机器和持续运行都零丢帧，也不能证明窗口实际显示。早期 `verification/release-performance-comparison.json` 仅记录播放计数，其“可见”判断不足，后续已补用 computer-use 实际窗口截图验证显示与右键操作。聊天、余额测试使用本地模拟服务；**真实 DeepSeek 网络、真实余额和真实模型回复尚需你填写 Key 后验证**。合成拖放测试也不代替真人鼠标与多屏体验。

测试报告位于源码目录 `verification/`，`chat-local-mock.png` 中的回复明确来自模拟服务。没有把测试金额当成真实余额。测试使用独立临时配置目录，不覆盖正式配置。测试启动器将输出写入文件，并为脱离终端的 Windows GUI 处理日志管道关闭，修复本次遇到的 EPIPE 测试弹窗。

## 源码与重建

上游版本：`1.1.0`，提交 `ae433e3cc2eafaa52a7a869ca2c13a3be2ac53bd`。具体来源见 `UPSTREAM.json`。自定义代码及上游代码按随附 `LICENSE` 使用；用户提供的角色图片不因此自动获得软件代码许可证。

源码工作区保留原图、PNG 帧、时间表与内置 image_gen 的完整提示词：`character-source/`。四个新角色的每份原始生成图位于 `character-source/characters/<角色ID>/raw/`，最终 WebM 位于 `assets/characters/<角色ID>/`。完整生成提示词为 `character-source/CHARACTER-GENERATION-PROMPTS.txt` 和 `character-source/CHARACTER-CARRY-PROMPTS.txt`。新增素材重建用 `tools/pack-character.mjs --character <角色ID> --encode`；原蓝鲸女仆仍用 `tools/pack-blue-maid.mjs`；便携包打包脚本是 `tools/package-portable.cjs`。所需 Node、sharp、FFmpeg 和 Electron 的路径可由脚本参数或环境变量指定。现成便携包不需要这些开发工具。

复测命令（源码目录，需要安装开发依赖）：

```text
node scripts/self-check.js
node scripts/test-deepseek.js
node scripts/test-video-player.js
node scripts/test-characters.js
node scripts/check-characters.js
node scripts/run-electron-check.cjs smoke-renderer.js
node scripts/run-electron-check.cjs check-blue-maid.js
```

运行真实版本用 `electron .`；不要把测试脚本作为日常启动入口。
