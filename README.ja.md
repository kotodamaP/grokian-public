# Grokian

**[English (README.md)](README.md) | [中文 (README.zh.md)](README.zh.md) | 日本語**

Grokianは、[Claudian](https://github.com/YishenTu/claudian) をベースにした
Grok搭載のObsidian向け執筆アシスタントです。

本プロジェクトは、Claudianのサイドバー・チャットとインライン編集のアーキテクチャから始まり、
ローカルのGrok CLIランタイム向けに、主に小説執筆用途に再設計されています。

## 現在の状態

このリポジトリはObsidian Desktop向けの独立した派生プラグインで、プラグインIDは
`grokian` です。既存のClaudianを保持したまま、別プラグインとして併用できます。

Grokian v0.1はGrok専用です。上流のClaudian、OpenCode、Codexのコードは、
派生実装時の参照として残ることがありますが、現時点での公開対象機能やリリース要件
としては扱っていません。

## 免責事項

Grokianは個人的な趣味開発によるプロジェクトであり、現状有姿で提供されます。
インストールおよび利用は自己責任でお願いします。

本プロジェクトの利用によって発生したデータ損失、vault の不具合、予期しない
動作、その他の問題について、作者は責任を負いかねます。

重要な Obsidian vault や原稿で利用する前に、バックアップを取り、まずは検証用
vault で動作確認を行ってください。

## バージョン

現在の公開バージョンは `v0.1.0` です。

Grokian は `package.json` の `version` をプロジェクトの正本とし、
`manifest.json` の Obsidian プラグイン向けバージョンは、リリース前に同期します。

## 目標

- ObsidianのサイドバーにGrokianのチャットUIを埋め込む
- 選択テキストのリライト支援と下書きの続き生成をサポート
- 原稿は通常のMarkdownとして管理
- プロジェクト用のメタ情報、候補文、セッション情報を `.grokian/` に保存
- ローカルのGrok CLIを実行レイヤーとして使用

## v0.1の非対象

- Obsidianのモバイル対応
- クラウドバックエンドの提供
- ユーザー向け機能としてClaudian、OpenCode、Codexプロバイダーを公開対象として扱うこと
- シークレット、トークン、Cookie、OAuth関連情報の保管
- 環境変数やPathの自動変更

## 開発手順

```bash
git clone https://github.com/kotodamaP/grokian-public.git
cd grokian-public
npm install
npm run build
```

### ビルド成果物について

`main.js` と `styles.css` はビルド成果物であり、通常はGit管理されません。
`npm run build` を省略してインストール可能状態が必要な場合は、以下のリリース配布手順を使ってください。

## Obsidianへのソースインストール

ソース版から構築して既存のVaultへ配置する場合:

```bash
npm run install:obsidian -- --vault "<path-to-vault>"
```

インストーラーは `manifest.json`、`main.js`、`styles.css` のみを
`<path-to-vault>/.obsidian/plugins/grokian/` にコピーします。
異なるプラグインIDのフォルダにはインストールせず、既存Claudianを上書きしません。

## リリース配布によるインストール

手動インストールはGitHub Releaseの最新アセットを使ってください。

1. 以下を含むリリースアーカイブをダウンロード:
   - `manifest.json`
   - `main.js`
   - `styles.css`
2. `<path-to-vault>/.obsidian/plugins/grokian/` に展開
3. Obsidianの**コミュニティプラグイン**でGrokianを有効化

リリース配布を公開する場合は、このリポジトリから `manifest.json`、
`main.js`、`styles.css` を含むアーカイブとして公開してください。

## クレジット

GrokianはYishen Tu氏のClaudianをベースにしており、MITライセンスの条件を引き継ぎます。
ライセンス本文は `LICENSE`、プロジェクト説明は `GROKIAN.md` を参照してください。
