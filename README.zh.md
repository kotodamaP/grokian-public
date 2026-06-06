# Grokian

**[English (README.md)](README.md) | [日本語 (README.ja.md)](README.ja.md) | 中文**

Grokian 是一款基于 [Claudian](https://github.com/YishenTu/claudian) 的 Obsidian 写作辅助插件，采用 Grok 提供能力。

本项目基于 Claudian 的侧边栏聊天与内联编辑架构，面向小说写作场景，重构为本地 Grok CLI 运行时版本。

## 当前状态

这个仓库是 Obsidian Desktop 的独立分支插件，插件 ID 为 `grokian`，因此可与现有的 Claudian 共存，不会占用 `claudian` 插件文件夹。

Grokian v0.1 目前为 Grok-only。上游中的 Claudian、OpenCode、Codex 代码可能仍会作为参考脚手架保留，但不会作为当前面向用户的功能或发布要求。

## 免责声明

Grokian 是个人业余开发项目，以“按现状”提供，不作任何明示或默示担保。
请在自担风险的前提下安装和使用。

因使用本项目导致的数据丢失、vault 问题、异常行为或其他故障，作者概不负责。

在重要 Obsidian vault 或正文作品中使用前，请先备份，并先在独立的测试 vault 中验证。

## 版本

当前公开版本：`v0.1.0`

Grokian 以 `package.json` 的 `version` 作为版本正本，发布前会将其同步到
`manifest.json` 的 Obsidian 插件版本字段。

## 目标

- 在 Obsidian 中嵌入 Grokian 的侧边栏聊天界面
- 支持选中文本改写与草稿续写
- 将作品保持为普通 Markdown
- 将项目元信息、生成候选文本与会话信息保存在 `.grokian/`
- 使用本地 Grok CLI 作为执行层

## v0.1 非目标

- Obsidian 移动端支持
- 托管云后端
- 将 Claudian、OpenCode、Codex 作为用户面向的 Grokian 功能发布或维护
- 存储 Secret、Token、Cookie 或 OAuth 相关认证信息
- 自动修改 Path 或环境变量

## 开发步骤

```bash
git clone https://github.com/kotodamaP/grokian-public.git
cd grokian-public
npm install
npm run build
```

### 构建产物说明

`main.js` 与 `styles.css` 是构建产物，默认不在 Git 中跟踪。
如果跳过 `npm run build` 但需要可安装包，请使用下方 Release 分发流程。

## Obsidian 源码安装

从源码目录构建后，将插件复制到现有 vault：

```bash
npm run install:obsidian -- --vault "<path-to-vault>"
```

安装器仅会复制 `manifest.json`、`main.js`、`styles.css` 到
`<path-to-vault>/.obsidian/plugins/grokian/`，不会覆盖不同插件 ID 的目录。

## Release 安装

手动安装请使用最新 GitHub Release 资源。

1. 下载包含以下文件的发布归档包：
   - `manifest.json`
   - `main.js`
   - `styles.css`
2. 解压到 `<path-to-vault>/.obsidian/plugins/grokian/`
3. 在 Obsidian 的 **Community plugins** 中启用 Grokian

如需发布 Release 产物，请将包含 `manifest.json`、`main.js`、`styles.css`
的归档文件从本仓库发布。

## 致谢

Grokian 基于 Yishen Tu 的 Claudian 开发，并继承 MIT 许可条款。
许可文本见 `LICENSE`，项目说明见 `GROKIAN.md`。
