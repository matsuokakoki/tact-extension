# TACT Extension — 松岡個人用

[Comfortable NU](https://github.com/rozwer/comfortable-NU) を土台にした、名古屋大学TACT向けChrome / Microsoft Edge拡張機能です。

追加した機能は次の3つです。

- **授業資料の差分ダウンロード**：初回に科目の「授業資料」フォルダを指定。以後はその保存先を記憶し、新規・更新資料だけ取得。先生のフォルダ構造を保持します。
- **未完了課題のGoogleカレンダー予定**：現在より先、7日以内の締切、未チェック、TACT上でも未提出の課題を追加。チェック直後に予定を削除し、チェックを外すと対象期間内なら再作成。締切変更には更新で対応します。
- **資料をChatGPTに添付**：資料リンク横の `[ChatGPT]` から、既存のブラウザ版ChatGPTタブに資料を添付し、解説用プロンプトを入力。送信は自分で押します。解説の後に理解度テスト4問と正解・解説を求めます。OpenAI APIは使用しません。

## インストール（Windows / Chrome・Edge）

Node.js 22以降、Git、最新版のChromeまたはMicrosoft Edgeを用意してください。PowerShellで実行できます。

```powershell
git clone https://github.com/matsuokakoki/tact-extension.git
cd tact-extension
npm ci
npm run build:chromium
```

成功時の出力には `compiled successfully` と `Merge manifest: Success` が含まれます。

1. Chromeは `chrome://extensions`、Edgeは `edge://extensions` を開く。
2. 「デベロッパーモード」をオンにする。
3. 「パッケージ化されていない拡張機能を読み込む」から Chromeは **`dist/source/chrome`**、Edgeは **`dist/source/edge`** を選ぶ。
4. TACTと、既に開いているChatGPTタブを再読み込みする。元のComfortable NUは二重動作を避けるため無効化する。

ZIPは `dist/release/tact-extension-chrome-v3.2.2.zip` と `tact-extension-edge-v3.2.2.zip` に生成します。GitHub Actionsの **Chrome-extension / Edge-extension** 成果物からも取得できます。ZIPの場合は展開したフォルダを読み込んでください。


ChromeとEdgeの設定・保存先・取得履歴・カレンダー予定IDは別々です。両方で同じ課題の自動同期をオンにすると予定が重複するため、カレンダー自動同期は普段使う一方でオンにしてください。ChatGPTも操作元と同じブラウザのタブを使用します。Microsoft Edge実機での動作確認は未実施です。

## 授業資料の取得

1. TACTの授業ページでヘッダーの **「資料を取得」** を押す。
2. 資料画面で科目を選ぶ。
3. 初回だけ **「保存先を選ぶ・変更」** を押し、既存の `OneDrive/大学/科目名/授業資料` などを選ぶ。
4. **「資料を取得」** を押す。2回目以降もこのボタンだけで、記憶した保存先へ新規・更新分を取得する。

選んだフォルダの直下に先生の階層を再現します。「授業資料」を二重に作りません。OneDrive内なら通常のOneDriveアプリが同期します。OneDrive APIは不要です。

- フォルダハンドルと取得済み履歴は拡張機能のIndexedDBに保存します。
- 保存先の権限が有効なら、追加のダイアログなしで書き込みます。
- 権限が切れたら **「このフォルダを再許可」**。失敗したら **「保存先を選ぶ・変更」** で選び直してください。
- 保存先を変更・選び直した場合は、履歴をリセットして全件取得します。
- 新規・更新・取得済み・失敗・外部リンク等の件数を表示します。失敗した資料は次回再試行します。
- ローカル資料の自動削除はしません。外部サイト/NUSSへのリンクは一括取得対象外です。
- Windowsで使えない名前は置き換え、同名・大文字小文字だけ違う資料には識別用の文字を付けます。
- ローカルで手動削除したファイルは履歴から判断できません。全取得し直したい場合は同じ保存先を選び直してください。

## Googleカレンダーの初期設定

**松岡個人用のGoogle OAuthクライアントIDは設定済みです。** Google側でCalendar APIの有効化・自分のテストユーザー登録・下記リダイレクトURIの登録を済ませたら、TACTのカレンダーボタンから「Googleでログイン」を押せます。別のGoogle Cloudプロジェクトを使う場合は以下の手順で設定します。 元作者のクライアントIDは流用していません。資料ダウンロード・ChatGPT添付はこの設定なしで使えます。

1. `npm run configure:google -- --id` を実行して拡張機能IDを確認します。現在のキーでのIDは **`eiadkmdoaekdgklaobneflibnmomjlmi`** です。公開キーは同じIDを保つために同梱しています。
2. [Google Cloud Console](https://console.cloud.google.com/)で自分のプロジェクトを作り、Google Calendar APIを有効にします。
3. Google Auth Platformで同意画面を設定し、テストユーザーに自分のGoogleアカウントを追加します。Calendar、userinfo.email、userinfo.profileの権限を設定します。
4. OAuthクライアントの種類 **「ウェブ アプリケーション」** を選び、承認済みリダイレクトURIに **`https://eiadkmdoaekdgklaobneflibnmomjlmi.chromiumapp.org/google`** を登録します。JavaScript生成元の追加は不要です。以前作成した「Chrome拡張機能」クライアントではこの方式を使えないため、ウェブ用を新規作成してください。
5. 得られたクライアントIDを以下に渡します。クライアントシークレットは不要です。

```powershell
npm run configure:google -- YOUR_CLIENT_ID.apps.googleusercontent.com
npm run build:chromium
```

成功時は `Google OAuth設定済み` と表示されます。使用しているブラウザの拡張機能一覧で再読み込みし、TACTも再読み込みしてください。TACTヘッダーのカレンダーボタン → **「Googleでログイン」** を押して認証します。

初期対象は課題のみです。小テストは既存の手動同期画面で選んだ場合に同期します。

- お気に入り一覧に加え、現在開いている授業ページも取得対象になります。対象の授業ページで星ボタンから「再取得」を押すと、課題を実際に取り直して同期します。取得失敗はエラーにし、「取得件数・除外理由を確認」で締切・提出状態・対象件数を確認できます。
- 手動同期では、この拡張が記録した予定IDだけを確認・更新し、Google側で削除された予定は対象期間内なら再作成します。通常の自動同期は変更のない予定へのAPI呼び出しを省きます。
- 右側パネルを開くと、認証済み・自動同期オンの場合に取り込みます。既存の定期同期も使用できます。
- ☑チェック直後は、登録済みの予定IDを指定してDELETEします。Googleカレンダー全体の検索はしません。
- 通信・認証に失敗した場合、チェック状態と予定IDを保持し、エラーを表示します。再認証後、パネルを開くか同期ボタンを押して再試行してください。
- 提出済みタブで手動チェックを外せます。TACT側で提出済みの課題は未提出へ戻しません。
- 作成予定IDを先に保存し、同時実行やサービスワーカー中断による重複を防ぎます。予定IDはGoogleアカウントごとに分離して管理します。
- 別の旧Comfortable NUが過去に作成した予定は引き継ぎ・削除しません。この拡張が記録した予定だけ操作します。
- 拡張機能のデータを消す/アンインストールすると、予定IDも失われます。カレンダーに残った予定は手動削除してください。

Chrome・Edgeとも `identity.launchWebAuthFlow` で認証します。トークンは拡張機能専用のセッションストレージで期限まで再利用し、期限切れ・ブラウザ再起動後は同意済みGoogleセッションを使った非対話更新を試みます。Google側でログインや追加同意が必要な場合は手動ログインが必要です。クライアントシークレットはコードに入れません。ログアウトするとキャッシュを消します。

設定の根拠：[Googleクライアント側OAuth](https://developers.google.com/identity/protocols/oauth2/javascript-implicit-flow)、[Chrome Identity API](https://developer.chrome.com/docs/extensions/reference/api/identity)、[Edge対応API](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/api-support)。

## 資料をChatGPTへ渡す

1. 同じブラウザ・同じプロファイルで [ChatGPT](https://chatgpt.com/) にログインし、入力欄が空の会話を開いておく。
2. TACTの授業資料リンク横の **`[ChatGPT]`** を押す。資料取得画面の資料一覧にも同じボタンがあります。
3. 既存タブに切り替わり、資料添付が開始され、あらかじめ決めたプロンプトが入力されます。
4. **アップロード完了とファイル名を確認し、自分で送信する。**

「資料を取得」の画面にある「ChatGPTに入力するプロンプト」で文章を変更・保存できます。初期文面は、全体像・用語・前提知識・具体例・コードの出力結果を日本語で解説するものです。

複数のChatGPTタブがある場合は、アクティブなタブ、なければ最後に使ったタブを優先します。入力中の文章は上書きしません。タブがなければChatGPTを開き、ログイン/読み込み後の再クリックを案内します。

DOMの変更などで添付欄が見つからない場合は、ChatGPTの「＋」から添付メニューを開いて再試行します。自動入力に失敗した場合は、ChatGPT画面に出る「プロンプトをコピー」ボタンから貼り付けられます。

この拡張はメモリ使用量を抑えるため **1資料32MiBまで** に制限します。これは拡張独自の上限です。それ以上は資料をダウンロードして手動添付してください。ChatGPT自身のファイル形式・アカウント・使用量の制限も適用されます。

操作方式は [RightClickGPT](https://github.com/eimexdev/RightClickGPT) を参考に独立実装しました。外部拡張への依存はありません。ブラウザ版ChatGPTのDOM操作は公式APIではなく、画面変更で動作しなくなる場合があります。

## 開発・検証

```powershell
npm run typecheck
npm test -- --runInBand
npm run build:chromium
npm run test:browser
```

単体テストは7日期限の境界、提出済み除外、直接削除、削除失敗の再試行、再チェック、締切変更、重複防止、アカウント分離、公式Sakaiの再帰データ、名前衝突、差分判定、送信URL制限、共通OAuthのキャッシュ・非対話更新・ログアウト・state/戻り先/権限検証を検証します。

ブラウザテストはChromiumとPlaywrightを使用します。初回は `npm install --no-save playwright` と `npx playwright install chromium` が必要です。模擬のTACT/ChatGPT画面とファイル保存先で動作を確認します。Edge用ビルドはPowerShellで `$env:TACT_TEST_BUILD_BROWSER="edge"` を設定して `npm run test:browser` を実行すると検証できます。これはEdge本体ではなくChromiumでの検証です。

実際のTACTへのログイン、WindowsのOneDrive書き込み、Google OAuth/Calendar、ログイン済みChatGPTへの添付は開発環境では未検証です。最初は1科目・1資料・1課題で確認してください。

## 出典とライセンス

Apache-2.0。元のLICENSEを保持しています。元作者：Kazuki Takeda、Shoji Kajita、rozwer。
基盤は `rozwer/comfortable-NU` のコミット `79f65b651f92584ac25445f9c62f2a854deeff2e`。
個人用追加実装・手順・テストは2026-10-02に作成。公開資料：[Sakai ContentEntityProvider](https://github.com/sakaiproject/sakai/blob/master/content/content-tool/tool/src/java/org/sakaiproject/content/entityproviders/ContentEntityProvider.java)。
