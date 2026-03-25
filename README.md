# プロジェクター制御 Webアプリ

スマホやPCから、プロジェクターに繋がった子PCへ**画面・音声・BGMをリアルタイム配信**できるWebアプリです。

---

## どんなアプリ？

```
あなたのスマホ／PC（親）  ───→  サーバー（Render）  ───→  プロジェクター接続PC（子）
     操作・配信元                  シグナリング中継               受信・全画面表示
```

- **画面共有モード** : 親の画面＋システム音声をそのままプロジェクターへ映す
- **BGMモード** : 音楽ファイルをアップロードして、プロジェクター側に流す

---

## ファイル構成

```
/
├── server.js          # サーバー本体
├── package.json       # 依存パッケージ定義
├── public/
│   ├── parent.html    # 親（操作）画面
│   ├── parent.js
│   ├── child.html     # 子（プロジェクター）画面
│   ├── child.js
│   └── style.css
└── uploads/           # BGMファイルの一時保存場所
```

---

## ローカルで動かす（動作確認用）

### 前提条件
- [Node.js](https://nodejs.org/) v18以上がインストールされていること
  - ターミナルで `node -v` と打って `v18.x.x` 以上が表示されればOK

### 手順

```bash
# 1. このリポジトリをクローン（またはZIPダウンロード＆解凍）
git clone https://github.com/あなたのユーザー名/リポジトリ名.git
cd リポジトリ名

# 2. 依存パッケージをインストール
npm install

# 3. サーバーを起動
node server.js
```

起動すると以下が表示されます：

```
Server running on http://localhost:3000
  Parent: http://localhost:3000/parent.html
  Child:  http://localhost:3000/child.html
```

### ブラウザで開く

| 役割 | URL |
|---|---|
| 親（操作側） | http://localhost:3000/parent.html |
| 子（プロジェクター側） | http://localhost:3000/child.html |

> **補足**: ローカルでは画面共有の `getDisplayMedia()` は `localhost` のため HTTPS なしでも動作します。

---

## Renderにデプロイする（インターネット越しに使う）

### Renderとは？
無料で Node.js アプリを公開できるクラウドサービスです。
デプロイすると `https://あなたのアプリ名.onrender.com` というURLが発行されます。

> **無料枠の制限**
> - 15分間アクセスがないとサーバーがスリープします（このアプリは対策済みで、親ページを開いている間は5分ごとに自動でサーバーを起こし続けます）
> - BGMファイルはサーバー再起動時にリセットされます（ディスクが永続化されないため）

---

### ステップ1: GitHubにコードを上げる

Renderはコードを GitHubから直接読み込みます。

1. [github.com](https://github.com) でアカウントを作成（まだの場合）
2. 右上の「**+**」→「**New repository**」で新しいリポジトリを作成
   - リポジトリ名は何でもOK（例: `projector-control`）
   - 「Public」か「Private」どちらでもOK
3. ターミナルで以下を実行：

```bash
git init
git add .
git commit -m "first commit"
git remote add origin https://github.com/あなたのユーザー名/リポジトリ名.git
git branch -M main
git push -u origin main
```

GitHubのリポジトリページを開いて、ファイルが並んでいれば成功です。

---

### ステップ2: Renderのアカウントを作る

1. [render.com](https://render.com) にアクセス
2. 「**Get Started for Free**」をクリック
3. GitHubアカウントでサインイン（「**Continue with GitHub**」を推奨）

---

### ステップ3: Renderに新しいWebサービスを作成する

1. Renderダッシュボードで「**New +**」→「**Web Service**」をクリック

2. 「**Connect a repository**」の画面で、先ほどGitHubに上げたリポジトリを選択
   - 表示されない場合は「**Configure account**」からRenderにGitHubのアクセスを許可する

3. 以下の設定を入力：

   | 項目 | 設定値 |
   |---|---|
   | **Name** | 好きな名前（例: `projector-control`） |
   | **Region** | `Singapore`（日本から近い）など任意 |
   | **Branch** | `main` |
   | **Runtime** | `Node` |
   | **Build Command** | `npm install` |
   | **Start Command** | `node server.js` |
   | **Instance Type** | `Free` |

4. 「**Deploy Web Service**」ボタンをクリック

---

### ステップ4: デプロイ完了を待つ

- デプロイには **2〜5分** かかります
- ログに `Server running on http://localhost:...` と表示されれば成功

発行されたURLを確認します（例）：
```
https://projector-control.onrender.com
```

---

### ステップ5: アプリを使う

| 役割 | URL |
|---|---|
| 親（操作側） | `https://あなたのアプリ名.onrender.com/parent.html` |
| 子（プロジェクター側） | `https://あなたのアプリ名.onrender.com/child.html` |

---

## 使い方

### 基本的な流れ

```
1. 子PC（プロジェクター接続）で child.html を開く → 黒画面で待機
2. 親デバイスで parent.html を開く
3. 画面右上に「子PC: 接続中」と表示されたら準備完了
4. モードを選んで配信開始
```

---

### 画面共有モード

1. 親側で「🖥️ 画面共有モード」タブを選択
2. 「▶ 画面共有開始」をクリック
3. ブラウザの共有ダイアログが開くので、共有したいウィンドウ／画面を選択
   - 音声も流したい場合は「**システムサウンドを共有**」のチェックを入れる
4. 子PC（プロジェクター）に映像が映る
5. 止めたいときは「■ 配信停止」または共有ダイアログの「共有を停止」

---

### BGMモード

1. 親側で「🎵 BGMモード」タブを選択
2. 音楽ファイル（MP3/AAC/FLAC/WAV/OGG/M4A）をドラッグ＆ドロップまたはクリックしてアップロード
3. プレイリストに曲が表示されたら、曲名をクリックまたは「▶」ボタンで再生
4. プロジェクター側に音声が流れ、画面は黒背景になる
5. 音量は🔊スライダーで調整できる

> **注意**: Renderの無料枠ではサーバー再起動のたびにアップロードしたBGMファイルが消えます。使用前に毎回アップロードしてください。

---

## インターネット越しに使うときの補足

家庭用Wi-Fiルーター越しであれば基本的にそのまま動作します。
企業ネットワークや学校のネットワークなど、厳しいファイアウォール環境では接続できない場合があります。その場合はTURNサーバーの追加設定が必要です（詳細は別途）。

---

## トラブルシューティング

### 「子PC: 未接続」のまま変わらない
- 子PC側でブラウザが `child.html` を開いているか確認
- 両方のデバイスが同じURL（Renderのもの）にアクセスしているか確認
- ブラウザをリロードして再接続を試みる

### 画面共有ダイアログが出ない / エラーになる
- `https://` のURLでアクセスしているか確認（ローカルの `localhost` は除く）
- Chrome または Edge の最新版を使用することを推奨

### BGMが子PC側で再生されない
- 子PCのブラウザの音量がミュートになっていないか確認
- ブラウザの自動再生設定でブロックされている場合は、child.html のページを一度クリックすると解除されることがある

### Renderのデプロイが失敗する
- Renderのログを確認（`npm install` や `node server.js` のエラーメッセージを見る）
- `package.json` と `server.js` がリポジトリのルートに存在するか確認
