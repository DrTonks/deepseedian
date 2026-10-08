# DSH 0.2.0 兼容验收

验证日期：2026-10-08。本机从 DSH `0.1.7-rc.2` 升级至 npm `latest` 指向的 `0.2.0-rc.2`。本次兼容修改作为 `0.7.3` 发布，插件 ID 保持 `deepsidian`。以下真实供应商与原生界面检查完成于调整插件版本号之前；发布构建另行检查版本一致性及三文件安装。

## 升级与兼容结论

- `npm run doctor` 确认 dsh、sdk-minimal、sdk-jsonrpc-server、agent-loop、tools、llm-deepseek、session-persistence-jsonl 七个关键包均为 `0.2.0-rc.2`。
- macOS arm64，Node.js `26.6.0`，Obsidian `1.13.7`。现有 DSH 配置和凭证保持不变，插件仍可自动发现 Node.js 与 DSH。
- 升级前保留了完整的旧 DSH 安装，用于迁移回归。npm 12 默认阻止安装脚本，对本次运行依赖使用一次性包名白名单重建；没有修改全局的脚本放行配置。
- 三个子代理分别审查运行时接口、配置和供应商适配、测试覆盖。未发现需要改写插件桥接层的接口变化；补充了 `0.1.7-rc.2` 历史会话迁移和宿主工具失败后的恢复测试。
- 本次将插件内的已验证基线与安装文档更新为 `0.2.0-rc.2`。既有 `0.1.7` 配置格式分界保持不变，不能因升级基线而移动迁移判断条件。

验证时 npm 的 `latest`、`next` 均指向 `0.2.0-rc.2`，`alpha` 指向 `0.2.1-alpha.1`。插件当前更新提示会比较所有发布标签，因此可能显示后者；本次未安装或验收 alpha 版本。

## 自动检查

| 检查 | 结果 |
| --- | --- |
| `npm run check` | 160 项测试通过，无跳过；类型检查和构建通过 |
| ESLint | 0 errors、530 warnings；既有警告未全部清理 |
| `npm run test:integration` | 18 项通过，无跳过；完整安装及原生依赖重建后再次通过 |

集成测试使用真实 DSH 和本地模拟供应商，覆盖标准三文件安装、流式输出、取消、工具、记忆权限、网络工具、补全、会话恢复和分支隔离。新增工具失败用例确认：异常以对应 `tool_use_id` 的错误结果交给模型，当前回答能够结束，同一会话下一轮仍可成功调用工具。

历史迁移分别使用 `0.1.5-rc.2`、`0.1.6-alpha.2`、`0.1.7-rc.2` 的真实安装创建会话，再由新版恢复。其中 `0.1.5` 验证 Chat Completions 文本历史迁移至 Messages；`0.1.6` 和 `0.1.7` 另检查历史工具结果、已有分支、新建分支及两次重启后的父子会话隔离。复现时需提供历史安装路径，否则相应用例会跳过：

```bash
DSH_LEGACY_PACKAGE_ROOT=/path/to/dsh-0.1.5-rc.2 \
DSH_PREVIOUS_PACKAGE_ROOT=/path/to/dsh-0.1.6-alpha.2 \
DSH_BASELINE_PACKAGE_ROOT=/path/to/dsh-0.1.7-rc.2 \
npm run test:integration
```

## 真实供应商

使用已有的付费 `deepseek-official / deepseek-flash` 配置；请求内容为合成验收材料，没有发送私人文章。

- `npm run live:fork`：六轮真实请求通过，父会话与分支分别更新不同标记，重启后各自保留正确内容。
- `npm run live`：真实笔记上下文工具调用与流式回答完成；该聊天出现一次重试后成功。记忆整理正例生成有逐字证据的提案，虚构人物反例返回空提案；没有自动写入记忆。
- `npm run live:completion -- --suite=holdout`：8 次调用，5 个候选、3 次空结果，0 错误、0 超时，全部有用量记录。暖请求 P50 为 778 ms、P95 为 1,429 ms，不含冷启动。

Codex 逐项复核补全拼接结果：4 个候选可用；缺少测量依据、错误算术前提、错误栈定义的 3 次弃答符合预期。另有 1 个英文候选存在用词冗余：`The cache avoids` 与后文 ` repeated disk reads.` 之间插入 ` redundant`，形成 `redundant repeated`。这是仍需改进的候选质量问题，不能把“请求完成”视为全部回答质量合格。

## macOS 原生界面

在既有独立验收库中完成以下检查：

1. 保留已发布的 `0.7.2` 插件文件，升级全局 DSH 后重载。既有分支（4）的标题、来源与消息正常恢复；真实续聊回答“我是理解了，还是只记住了原句？”，符合继承的行动卡。界面显示输入 3,318、输出 24 tokens、缓存读取 85%。
2. 将本次本地构建的三个插件文件装入同一验收库并重载，设置页显示 `DSH 0.2.0-rc.2`。
3. 新建合成笔记，以“缓存可以加快重复读取，因为它能”为前文，手动请求产生灰字“减少对底层存储的访问次数”。Tab 接受后正文正确，单次撤销恢复原文。
4. 测试结束后恢复手动补全原有的关闭设置。既有四篇 Markdown 笔记的 SHA-256 均未变化；十个聊天仍在，仅测试分支追加一问一答，原有消息前缀和其他聊天保持不变。

本次没有修改用户博客工作区。原生 UI 验收只覆盖 macOS；上述本地验收未运行 Windows/Linux CI，也未覆盖所有主题、输入法或第三方补全插件。既有 `0.7.2` 已能连接新版 DSH，因此这次升级未发现要求立即替换社区安装包的兼容性故障。

## 本地证据

原始日志保存在 Git 忽略的 `.runs/`，不作为发行附件：

- `dsh-020-check.log`、`dsh-020-integration-final.log`、`dsh-020-doctor.json`
- `dsh-020-install.log`、`dsh-020-native-dependencies.log`
- `live-fork-6BEMBz/report.json`
- `live-completion-2h7Kj3/report.json` 和 `manual-review.json`（Codex 复核，非用户人工签收）
- `live-2026-10-08T02-30-47.512Z/` 中的聊天与记忆整理报告
- `dsh-020-native-before/` 中的升级前插件、聊天数据及笔记哈希

这些记录仅代表本轮环境与样例，不能保证任意后续 DSH 版本或模型输出的质量。

## 0.7.3 发布构建检查

版本文件调整为 `0.7.3` 后重新执行 `npm run check`（160 项通过）及完整历史环境下的 `npm run test:integration`（18 项通过、无跳过），并执行 `npm run package:release`。三文件安装由此次集成测试覆盖。源 manifest、发行 manifest、package.json、package-lock.json 与 versions.json 保持一致，最低 Obsidian 版本仍为 `1.13.7`。

本地发布日志为 `.runs/release-073-check.log`、`.runs/release-073-integration.log` 与 `.runs/release-073-package.log`。GitHub CI 与社区审核应以对应发布提交的远程状态为准。

| 发行文件 | SHA-256 |
| --- | --- |
| `main.js` | `8e747e52fb909f520afa7fdfc5f023441ec06f2cb69876e8351b943178361ad4` |
| `manifest.json` | `3c3f9a2cc778896b96b520b3c2c760a8f1aad32db45657f24d81b7fe13b1d57d` |
| `styles.css` | `cffb60d0b40675b4a7754659458a4beec8f6ce065977fbb898054a7204c1ccae` |
