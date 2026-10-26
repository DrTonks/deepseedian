# DSH 0.2.1 / Deepseedian 0.7.4 验收

验证日期：2026-10-26。插件 ID 保持 `deepsidian`，最低 Obsidian 版本保持 `1.13.7`，Node.js 要求保持 `24+`。

## 升级目标与修复

npm 默认 `latest` 为 `0.2.1-rc.2`，`next` 为 `0.2.1-rc.3`。本次本机从 `0.2.0-rc.2` 升至默认通道的 `0.2.1-rc.2`；不把 `next` 作为默认安装目标。doctor 检查的七个关键组件版本一致。旧完整安装已备份，用户配置和凭据未修改。

新版 sdk-minimal 不再只有原来的工具组合。三个子代理分别审查接口、配置和测试覆盖，发现并修复了以下问题：

- **工具范围变化**：新增 `tool-fs`（默认启用读图片）与 `tool-working-directory`。旧插件只禁用了 shell，记忆整理请求因此意外包含两个工具。未修复的三文件安装测试实际失败：预期零工具，实际两个。0.7.4 显式禁用这两个条目，笔记访问继续经过现有 Obsidian 工具。
- **重复附件服务**：禁用新版自带的 `attachment-local`，保留插件注入的附件服务，兼容历史运行时。
- **新增自动行为**：禁用 `compaction-basic` 与 `image-offload`，避免仅升级运行时便引入自动摘要调用或旧图片卸载。保留 SDK server 必需的 `working-directory` 服务，只关闭其工具。

会话、分支、图片传入与流式接口兼容，不需要重写 bridge。默认工具变化说明升级 DSH 时应同时安装本次插件修复；旧插件配合新 DSH 的整理器工具隔离不满足原有约定。

上游凭据读取顺序调整为存储文件、启动环境、项目 `.env`、home `.env`。同时设置多个来源时，应在 DSH 中确认实际选用的账户；本次没有迁移或覆盖凭据。新默认自动压缩能力留待独立设计和验收，本次不将它作为插件功能开放。

## 自动检查

| 项目 | 结果 |
| --- | --- |
| `npm run check` | 160 项离线测试通过，无跳过；类型检查、构建通过 |
| 官方 ESLint | 0 errors、530 warnings；既有警告仍需逐步改进 |
| `npm run test:integration` | 19 项通过，无跳过 |
| `npm run package:release` | 生成 main.js、manifest.json、styles.css 三个安装文件 |

集成测试使用真实 DSH 和本地模拟供应商。三文件安装测试在首次连接与重连时精确断言前台十个既有工具，整理器始终零工具；覆盖图片传入、取消、补全隔离、工具失败恢复与记忆权限。升级用例分别使用旧版真实安装：0.1.5 覆盖 Chat Completions 文本历史迁移，0.1.6、0.1.7、0.2.0 覆盖工具结果、旧分支、新建分支、两次重启后的父子隔离且不重复执行历史工具。

```sh
DSH_LEGACY_PACKAGE_ROOT=/path/to/dsh-0.1.5-rc.2 \
DSH_PREVIOUS_PACKAGE_ROOT=/path/to/dsh-0.1.6-alpha.2 \
DSH_BASELINE_PACKAGE_ROOT=/path/to/dsh-0.1.7-rc.2 \
DSH_020_PACKAGE_ROOT=/path/to/dsh-0.2.0-rc.2 \
npm run test:integration
```

缺少对应安装时历史用例会跳过。GitHub 普通 push 只运行三平台离线检查；手动触发的 runtime 作业使用真实 DSH 与模拟供应商，不使用私人凭据，未提供历史安装时仍会跳过这些迁移案例。远程结果以发布提交对应的 Actions 记录为准。

## 真实付费供应商

使用既有 `deepseek-official / deepseek-flash`，只发送合成资料：

- 聊天实际调用一次 `obsidian_context` 并完成流式回答；记忆整理正例产生有原文证据的提案，虚构角色反例返回空数组，不写入真实记忆。
- 六轮分支测试通过，父会话和分支在独立更新及重启后保留各自标记。
- 补全 holdout 八例：五个候选、三次空结果，零错误、零超时，全部有用量记录。暖请求 P50 963 ms、P95 1,942 ms；不含 267 ms 的进程冷启动。
- Codex 逐项复核：五个候选在这些样例中可用，三次弃答分别避开无依据测量、错误算术和错误栈定义。英文空格案例本次补入 ` unnecessary`，没有重复后文；不能据此保证其他输出质量或宣称此前问题永久消失。

原始报告仍保留未人工签收状态，另附 Codex 复核结果。真实调用成功不等于所有模型回答可靠。

## macOS 原生界面

在独立验收库、Obsidian `1.14.4` 中安装本次 `0.7.4` 三文件构建并重载：

1. 自动发现 DSH `0.2.1-rc.2`，旧分支（4）的标题、来源和消息恢复。
2. 真实续聊复述原行动卡的自检问题，回答“我是理解了，还是只记住了原句？”。界面报告输入 3,660、输出 10 tokens、缓存读取 3%。
3. 手动补全在“缓存可以加快重复读取，因为它能”后显示灰字“减少对底层存储的重复访问”；Tab 接受，单步撤销恢复原文。
4. 恢复原有关闭的补全设置。五篇原有 Markdown 文件哈希不变，十个聊天均保留，仅验收分支追加一问一答，历史消息前缀不变。

用户博客工作区未修改。此轮原生 UI 只覆盖 macOS，不代表 Windows/Linux 原生界面或所有第三方插件组合均已验收。

## 证据与发布边界

原始日志在 Git 忽略的 `.runs/` 下，不随安装包发布：

- `dsh-021-before-compat.log`：修复前零工具断言失败。
- `dsh-021-check.log`、`dsh-021-integration.log`、`dsh-021-doctor.json`、`dsh-021-package.log`。
- `live-2026-10-26T11-23-12.448Z/`、`live-fork-AncGhD/report.json`。
- `live-completion-aXgdtm/report.json` 与 `manual-review.json`。
- `dsh-021-native-before/`、`dsh-021-native-result.json`。

GitHub 发布、社区发现新版本、社区审核完成是不同状态；以各自远程页面为准，不把本地测试通过当作社区审核通过。
