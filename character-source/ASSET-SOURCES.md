# 五角色视觉素材来源

本页记录本仓库五个桌宠形象的参考图、生产画稿与播放文件之间的对应关系。角色名称是本项目采用的外观昵称，不是对原作角色身份或背景的认定。

五张 JPEG 参考图均由用户在本次项目对话中提供。十五张生产 PNG sheet 使用内置 `image_gen`，参考对应人物形象生成；后续动作也使用已接受的待机 sheet 作为画风与比例参考。原参考图的作者和独立图像授权信息未在本次提供的材料中注明，本页不作补充推断。

| 外观昵称 / ID | 用户提供的原始参考图 |
| --- | --- |
| 蓝发女仆 / `blue-maid` | [50635.jpg](reference/50635.jpg) |
| 金发战斧 / `blonde-reaper` | [50628.jpg](characters/blonde-reaper/reference/1-50628.jpg) |
| 橙发花语 / `orange-mage` | [50629.jpg](characters/orange-mage/reference/2-50629.jpg) |
| 紫发星猫 / `violet-cat` | [50630.jpg](characters/violet-cat/reference/3-50630.jpg) |
| 白发龙姬 / `white-dragon` | [50634.jpg](characters/white-dragon/reference/4-50634.jpg) |

每个形象包含待机、摸头、拖拽悬空三组动作，每组生产 sheet 为四列三行的十二格画稿。蓝发女仆三组共 36 格，后续四个形象十二组共 144 格，合计 **十五张生产 sheet、180 格源画稿、十五个最终 WebM**。视频时间轴通过持帧重复显示这些画稿；编码帧率不等于每秒新增画稿数。技术打包没有生成中间姿态，也没有加入 crossfade 补帧。

| 形象 | 生产 PNG sheet：待机 / 摸头 / 悬空 | 最终 WebM：待机 / 摸头 / 悬空 |
| --- | --- | --- |
| 蓝发女仆 | [待机](raw/idle-v2.png) · [摸头](raw/click-v1.png) · [悬空](raw/carry-v1.png) | [待机](../assets/animations/idle/蓝发女仆-待机.webm) · [摸头](../assets/animations/click/蓝发女仆-摸头.webm) · [悬空](../assets/animations/click/蓝发女仆-拖拽悬空.webm) |
| 金发战斧 | [待机](characters/blonde-reaper/raw/idle.png) · [摸头](characters/blonde-reaper/raw/click.png) · [悬空](characters/blonde-reaper/raw/carry.png) | [待机](../assets/characters/blonde-reaper/idle/金发战斧-待机.webm) · [摸头](../assets/characters/blonde-reaper/click/金发战斧-摸头.webm) · [悬空](../assets/characters/blonde-reaper/click/金发战斧-拖拽悬空.webm) |
| 橙发花语 | [待机](characters/orange-mage/raw/idle.png) · [摸头](characters/orange-mage/raw/click.png) · [悬空](characters/orange-mage/raw/carry.png) | [待机](../assets/characters/orange-mage/idle/橙发花语-待机.webm) · [摸头](../assets/characters/orange-mage/click/橙发花语-摸头.webm) · [悬空](../assets/characters/orange-mage/click/橙发花语-拖拽悬空.webm) |
| 紫发星猫 | [待机](characters/violet-cat/raw/idle.png) · [摸头](characters/violet-cat/raw/click.png) · [悬空](characters/violet-cat/raw/carry.png) | [待机](../assets/characters/violet-cat/idle/紫发星猫-待机.webm) · [摸头](../assets/characters/violet-cat/click/紫发星猫-摸头.webm) · [悬空](../assets/characters/violet-cat/click/紫发星猫-拖拽悬空.webm) |
| 白发龙姬 | [待机](characters/white-dragon/raw/idle.png) · [摸头](characters/white-dragon/raw/click.png) · [悬空](characters/white-dragon/raw/carry.png) | [待机](../assets/characters/white-dragon/idle/白发龙姬-待机.webm) · [摸头](../assets/characters/white-dragon/click/白发龙姬-摸头.webm) · [悬空](../assets/characters/white-dragon/click/白发龙姬-拖拽悬空.webm) |

蓝发女仆使用修订后的 `raw/idle-v2.png` 作为生产待机图。先前鞋底触及源图边缘的 `idle-v1.png` 已弃用，不属于上述十五张生产 sheet，也不随本仓库提交。

完整生成提示词和索引：

- [蓝发女仆提示词](GENERATION-PROMPTS.txt)
- [新增四角色待机与摸头提示词](CHARACTER-GENERATION-PROMPTS.txt)
- [新增四角色拖拽悬空提示词](CHARACTER-CARRY-PROMPTS.txt)
- [新增角色原图、sheet 与 manifest 索引](CHARACTER-ASSETS.json)
- [新增四角色技术打包汇总](characters/packaging-summary.json)
- [蓝发女仆 manifest](manifest.json)、[金发战斧 manifest](characters/blonde-reaper/manifest.json)、[橙发花语 manifest](characters/orange-mage/manifest.json)、[紫发星猫 manifest](characters/violet-cat/manifest.json)、[白发龙姬 manifest](characters/white-dragon/manifest.json)

源图被技术切片为 512×512 透明 PNG。每个动作使用一个固定等比倍率，站立动作按脚部锚点对齐，拖拽悬空动作按头部锚点对齐；保留原始透明度及自然姿态高度变化。随后使用 FFmpeg 编码带透明通道的 VP9 WebM。具体倍率、边界、逐帧时间及文件校验值见对应 `pack-plan.json` 和 `manifest.json`。

派生 `frames/`、`audits/`、contact sheet 和临时时间轴文件未存入 Git，可从仓库保留的生产 sheet 和计划重建。在仓库根目录安装脚本所需的 Node.js、`sharp` 与 FFmpeg 后运行：

```sh
node tools/pack-blue-maid.mjs --encode
node tools/pack-character.mjs --character blonde-reaper --encode
node tools/pack-character.mjs --character orange-mage --encode
node tools/pack-character.mjs --character violet-cat --encode
node tools/pack-character.mjs --character white-dragon --encode
```

相关工具为 [pack-blue-maid.mjs](../tools/pack-blue-maid.mjs) 与 [pack-character.mjs](../tools/pack-character.mjs)。保存生产 sheet 可以重建已采用的画稿；仅凭提示词重新生成图片，不保证获得相同像素。

软件代码按仓库 [MIT LICENSE](../LICENSE) 使用，并保留上游 [isKage/desk-llm-pet](https://github.com/isKage/desk-llm-pet) 的归属，具体版本见 [UPSTREAM.json](../UPSTREAM.json)。用户提供的原始角色图片，以及据此制作的视觉素材，不因与软件共同发布而自动获得软件代码的 MIT 授权。本页记录来源与处理过程，不替原画作者或角色权利人作出授权声明。
