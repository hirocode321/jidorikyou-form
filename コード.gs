/**
 * ============================================================
 * 自撮り狂 作品データ入稿システム ＆ SNS QRコード自動作成 バックエンド (コード.gs)
 * 【複数イベント同時稼働・イベント別専用URL・QRコード一括作成対応版】
 * ============================================================
 *
 * 【運用アカウント】jidorikyou@gmail.com
 *
 * 【フォルダ構成（各イベントごと）】
 * 📁 {イベント名} 作品データフォルダ
 *  ├── 📁 写真                      ← 入稿された作品データ「{アカウント名}.jpg」を保存
 *  │    └── 📁 _旧データ（差し替え前） ← 再入稿時の差し替え前データを自動退避
 *  ├── 📁 QRコード                  ← 「{アカウント名}_X.png」「{アカウント名}_Instagram.png」を保存
 *  └── 📊 {イベント名} 入稿ログ       ← 入稿履歴・入稿状況一覧・SNS QRコード一覧を自動記録
 *
 * 【特徴・安全設計】
 * 1. 本番の「入信届（回答）」スプレッドシート（大阪・東京・名古屋など）は100%「読み取り専用」です。
 *    文字の書き込みやタブ追加は一切行いません。
 * 2. 1行目の見出しから「アカウント名（D列）」「X（E列）」「Instagram（F列）」を自動検出し、
 *    本名・住所・電話番号・メールアドレスの列は絶対に読み込まない安全ロックを搭載しています。
 * 3. QRコード一括作成機能にはトークン認証（設定シート内で自動管理）を設け、第三者からの不正実行を防止します。
 */

// GitHub Pagesの公開ベースURL（設定シートのD列にLINEオプチャ配布用URLを自動表示するために使用）
const FRONTEND_BASE_URL = 'https://hirocode321.github.io/jidorikyou-form/';

// マイドライブ直下に作成されるイベント管理・設定ファイル名
const CONFIG_SPREADSHEET_NAME = '⚙️自撮り狂_入稿システム設定';

// 初期登録するイベント一覧（※すでに設定シートが存在する場合は既存の行がそのまま維持されます）
const INITIAL_EVENTS = [
  {
    eventId: '2027osaka',
    eventName: '自撮り狂2027大阪',
    spreadsheetUrl: ''
  },
  {
    eventId: '2027tokyo',
    eventName: '自撮り狂2027東京',
    spreadsheetUrl: ''
  }
];

// 読み取り元のシート名（見つからない場合は一番左のシートを自動で読み取ります）
const SOURCE_SHEET_NAME = 'フォームの回答 1';

// デフォルトの列番号（0始まり：D列=3, E列=4, F列=5）
const DEFAULT_ACCOUNT_COL_INDEX = 3;
const DEFAULT_X_COL_INDEX = 4;
const DEFAULT_INSTAGRAM_COL_INDEX = 5;

// 各サブフォルダ名
const PHOTO_FOLDER_NAME = '写真';
const QR_FOLDER_NAME = 'QRコード';
const ARCHIVE_FOLDER_NAME = '_旧データ（差し替え前）';

// 入稿ログシートの見出し
const LOG_HEADERS = ['日時', '出展者名（アカウント名）', '区分(新規/再入稿)', '保存ファイル名', '容量(MB)', '解像度(px)', 'ドライブURL'];

// バリデーション基準値（3.00 MB = 3 * 1024 * 1024 bytes）
const MIN_FILE_SIZE_BYTES = 3 * 1024 * 1024;
// 上限 15 MB（GASの受信上限・Base64膨張・同時入稿時の安定性のため）
const MAX_FILE_SIZE_MB = 15;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

/**
 * セットアップ関数：
 * Apps Scriptエディタ上で「setup」を選択して「▷ 実行」を押すと、
 * 設定シートの更新と、全イベント分のGoogleドライブフォルダ（📁 写真 / 📁 QRコード）・入稿ログシートを一括準備します。
 */
function setup() {
  const configInfo = ensureAndLoadAllEvents_();
  const events = configInfo.events;

  Logger.log('====================================');
  Logger.log('⚙️ イベント設定シートURL: ' + configInfo.configSheetUrl);
  Logger.log('🔑 管理者トークン: ' + configInfo.adminToken);
  Logger.log('====================================');

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const mainFolder = getOrCreateMainFolder_(ev.mainFolderName);

    // 「📁 写真」フォルダと、その中の「📁 _旧データ（差し替え前）」を作成
    const photoFolder = getOrCreateSubFolder_(mainFolder, PHOTO_FOLDER_NAME);
    getOrCreateSubFolder_(photoFolder, ARCHIVE_FOLDER_NAME);

    // 旧仕様でメインフォルダ直下に空の「_旧データ（差し替え前）」が残っていた場合はゴミ箱へ整理
    cleanupLegacyArchiveFolderInRoot_(mainFolder);

    // 「📁 QRコード」フォルダを作成
    const qrFolder = getOrCreateSubFolder_(mainFolder, QR_FOLDER_NAME);

    // 「📊 入稿ログ」スプレッドシートを作成
    const logSs = getOrCreateLogSpreadsheet_(mainFolder, ev.logSpreadsheetName);
    const exhibitors = getExhibitorListFromSource_(ev.sourceSpreadsheet);

    // 設定シートのE列に「📁 写真」フォルダURL、G列に「📁 QRコード」フォルダURLを記録
    configInfo.sheet.getRange(ev.rowNumber, 5).setValue(photoFolder.getUrl());
    configInfo.sheet.getRange(ev.rowNumber, 7).setValue(qrFolder.getUrl());

    Logger.log(`📌 [${ev.eventId}] ${ev.eventName}（出展者数: ${exhibitors.length}名）`);
    Logger.log(`   LINEオプチャ配布用URL: ${FRONTEND_BASE_URL}?event=${ev.eventId}`);
    Logger.log(`   📁 会場親フォルダ: ${mainFolder.getUrl()}`);
    Logger.log(`   📁 写真フォルダ: ${photoFolder.getUrl()}`);
    Logger.log(`   📁 QRコードフォルダ: ${qrFolder.getUrl()}`);
    Logger.log(`   📊 入稿ログシート: ${logSs.getUrl()}`);
  }

  Logger.log('=== 全イベントのセットアップが完了しました！ ===');
}

/**
 * 手動実行用関数：
 * Apps Scriptエディタ上で「generateQrCodes」を選択して「▷ 実行」を押した場合も、
 * 全イベントのSNS QRコード（{アカウント名}_X.png / {アカウント名}_Instagram.png）を一括作成します。
 */
function generateQrCodes() {
  const configInfo = ensureAndLoadAllEvents_();
  const events = configInfo.events;

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const summary = generateEventQrCodes_(ev, configInfo.sheet, false);
    Logger.log(
      `✅ [${ev.eventName}] QR作成完了: 新規作成 ${summary.createdCount}件 / スキップ(作成済) ${summary.skippedCount}件 / フォルダ: ${summary.qrFolderUrl}`
    );
  }
}

/**
 * APIエンドポイント 1: doGet(e)
 * 1) ?action=generate_qr の場合：トークン認証の上、該当イベントのSNS QRコードを一括生成してJSONで結果を返却
 * 2) ?event=2027osaka の場合：フロントエンド用に出展者名簿と入稿状況をJSONで返却
 * 3) パラメータなしの場合：登録されている全イベントの一覧をJSONで返却
 */
function doGet(e) {
  try {
    const action = e && e.parameter && e.parameter.action ? String(e.parameter.action).trim() : '';
    const requestedEventId = e && e.parameter && e.parameter.event ? String(e.parameter.event).trim() : '';
    const token = e && e.parameter && e.parameter.token ? String(e.parameter.token).trim() : '';
    const overwriteFlag = e && e.parameter && e.parameter.overwrite === '1';

    const configInfo = ensureAndLoadAllEvents_({ light: true });
    const events = configInfo.events;

    // ============================================================
    // 管理用アクション：QRコード一括作成リクエスト
    // ============================================================
    if (action === 'generate_qr') {
      // 簡易トークン認証
      if (!configInfo.adminToken || token !== configInfo.adminToken) {
        return createJsonResponse_({
          success: false,
          message: '認証エラー：無効な管理者トークンです。設定シート内の最新リンクからアクセスしてください。'
        });
      }
      return handleQrGenerationRequest_(events, configInfo.sheet, requestedEventId, overwriteFlag);
    }

    const eventSummaries = events.map(function(ev) {
      return {
        eventId: ev.eventId,
        eventName: ev.eventName,
        pageTitle: `${ev.eventName} 作品データ入稿システム`
      };
    });

    // イベントIDが指定されていない場合（会場選択トップ画面用）
    if (!requestedEventId) {
      return createJsonResponse_({
        success: true,
        needsEventSelection: true,
        events: eventSummaries
      });
    }

    const targetEvent = findEventById_(events, requestedEventId);
    if (!targetEvent) {
      return createJsonResponse_({
        success: false,
        needsEventSelection: true,
        events: eventSummaries,
        message: `指定されたイベントID「${requestedEventId}」が見つかりません。`
      });
    }

    const exhibitors = getExhibitorListFromSource_(targetEvent.sourceSpreadsheet);
    const submittedExhibitors = getSubmittedExhibitorList_(targetEvent.mainFolderName);

    return createJsonResponse_({
      success: true,
      eventId: targetEvent.eventId,
      eventName: targetEvent.eventName,
      pageTitle: `${targetEvent.eventName} 作品データ入稿システム`,
      folderName: `${targetEvent.mainFolderName} / ${PHOTO_FOLDER_NAME}`,
      exhibitors: exhibitors,
      submittedExhibitors: submittedExhibitors,
      events: eventSummaries
    });
  } catch (err) {
    return createJsonResponse_({
      success: false,
      message: '出展者名簿の取得に失敗しました: ' + err.message
    });
  }
}

/**
 * APIエンドポイント 2: doPost(e)
 * フロントエンドからPOSTされたBase64画像データと eventId を受け取り、
 * 該当イベントの「📁 写真」フォルダへ「{アカウント名}.jpg」として保存・入稿ログ記録を行います。
 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  let tempFile = null;
  try {
    // ※重い処理（受信・デコード・検証・Driveへの保存）はロックの外で並列実行し、
    //   ファイル名の確定とログ記録の一瞬だけロックを取得する（同時入稿の詰まり防止）。
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error('送信データが空です。');
    }

    const payload = JSON.parse(e.postData.contents);
    const requestedEventId = String(payload.eventId || '').trim();
    const exhibitorName = String(payload.exhibitorName || '').trim();
    const rawBase64 = String(payload.base64Data || '');
    const isResubmitFlag = Boolean(payload.isResubmit);
    const originalFileName = String(payload.originalFileName || '');
    const mimeType = String(payload.mimeType || 'image/jpeg');
    const requestId = String(payload.requestId || '').replace(/[^A-Za-z0-9_-]/g, '').substring(0, 64);

    // 同一リクエストの再送（クライアント自動リトライ）で処理済みなら、保存せず前回の結果を返す
    const cachedResult = getCachedResult_(requestId);
    if (cachedResult) {
      return createJsonResponse_(cachedResult);
    }

    if (!requestedEventId) {
      throw new Error('イベントIDが指定されていません。専用URLからアクセスしてください。');
    }
    if (!exhibitorName) {
      throw new Error('出展者名（アカウント名）が選択されていません。');
    }

    const cleanBase64 = rawBase64.replace(/^data:[^;]+;base64,/, '');
    if (!cleanBase64) {
      throw new Error('画像データが含まれていません。');
    }
    // デコード前に巨大データを早期拒否（Base64は元サイズの約4/3）
    if (cleanBase64.length > Math.ceil(MAX_FILE_SIZE_BYTES / 3) * 4 + 16) {
      throw new Error(`データ容量エラー：${MAX_FILE_SIZE_MB} MB以下のデータのみ入稿可能です。`);
    }

    const configInfo = ensureAndLoadAllEvents_({ light: true });
    const targetEvent = findEventById_(configInfo.events, requestedEventId);
    if (!targetEvent) {
      throw new Error(`指定されたイベント（${requestedEventId}）が見つかりません。`);
    }

    const decodedBytes = Utilities.base64Decode(cleanBase64);
    const byteLength = decodedBytes.length;
    const sizeMB = (byteLength / (1024 * 1024)).toFixed(2);

    // ============================================================
    // 1. サーバー側バリデーション（JPEG・3MB以上・縦構図・名簿存在確認）
    // ============================================================
    const validExhibitors = getExhibitorListFromSource_(targetEvent.sourceSpreadsheet);
    if (validExhibitors.indexOf(exhibitorName) === -1) {
      throw new Error(`選択された出展者名「${exhibitorName}」は「${targetEvent.eventName}」の名簿に存在しません。`);
    }

    const isJpegMagic =
      byteLength > 3 &&
      (decodedBytes[0] & 0xff) === 0xff &&
      (decodedBytes[1] & 0xff) === 0xd8;
    const isJpegMime = mimeType === 'image/jpeg' || /\.(jpe?g)$/i.test(originalFileName);
    if (!isJpegMagic || !isJpegMime) {
      throw new Error('データ形式エラー：JPEG（.jpg / .jpeg）形式の画像のみ入稿可能です。');
    }

    if (byteLength < MIN_FILE_SIZE_BYTES) {
      throw new Error(`データ容量エラー：3.00 MB以上のデータが必要です（受信サイズ: ${sizeMB} MB）。`);
    }
    if (byteLength > MAX_FILE_SIZE_BYTES) {
      throw new Error(`データ容量エラー：${MAX_FILE_SIZE_MB} MB以下のデータのみ入稿可能です（受信サイズ: ${sizeMB} MB）。JPEG書き出し時の画質設定を少し下げてください。`);
    }

    // 解像度はブラウザ表示と同じ基準（EXIFの回転情報を反映した向き）で判定する
    const dimensions = extractJpegDimensions_(decodedBytes);
    let width = dimensions ? dimensions.width : Number(payload.width || 0);
    let height = dimensions ? dimensions.height : Number(payload.height || 0);
    if (dimensions) {
      const orientation = extractJpegOrientation_(decodedBytes);
      if (orientation >= 5 && orientation <= 8) {
        const swap = width;
        width = height;
        height = swap;
      }
    }

    if (!width || !height || width >= height) {
      throw new Error(`構図エラー：縦構図（横px < 縦px）の写真のみ入稿可能です（検出解像度: ${width}×${height} px）。`);
    }

    // ============================================================
    // 2. 該当イベントの「📁 写真」フォルダ取得・作成
    // ============================================================
    const mainFolder = getOrCreateMainFolder_(targetEvent.mainFolderName);
    const photoFolder = getOrCreateSubFolder_(mainFolder, PHOTO_FOLDER_NAME);
    const archiveFolder = getOrCreateSubFolder_(photoFolder, ARCHIVE_FOLDER_NAME);

    // 入稿ログシートの取得・準備もロックの外で済ませる（ロック内は追記のみにして占有時間を短縮）
    const logSheets = prepareLogSheets_(getOrCreateLogSpreadsheet_(mainFolder, targetEvent.logSpreadsheetName));

    // ファイル名に使えない禁止記号を安全な文字に変換
    const safeFileBaseName = sanitizeFileName_(exhibitorName);
    const targetFileName = `${safeFileBaseName}.jpg`;

    // ============================================================
    // 3. 【ロック外】重いアップロード保存：一時ファイルとして「_旧データ」フォルダへ保存
    //    （他の入稿者をブロックしない。確定はロック内で名前変更＋移動のみ）
    // ============================================================
    const tempName = `__tmp_${Utilities.getUuid().replace(/-/g, '')}.jpg`;
    const blob = Utilities.newBlob(decodedBytes, 'image/jpeg', tempName);
    tempFile = archiveFolder.createFile(blob);

    // ============================================================
    // 4. 【ロック内・短時間】既存確認 → 旧ファイル退避 → 確定 → ログ記録
    // ============================================================
    lock.waitLock(30000);

    // ロック待ちの間に同一リクエストが処理済みになっていないか再確認
    const cachedInLock = getCachedResult_(requestId);
    if (cachedInLock) {
      tempFile.setTrashed(true);
      tempFile = null;
      return createJsonResponse_(cachedInLock);
    }

    const existingFilesIter = photoFolder.getFilesByName(targetFileName);
    const hasExistingFile = existingFilesIter.hasNext();

    // 誤選択による上書き防止ストッパー
    if (hasExistingFile && !isResubmitFlag) {
      throw new Error(
        `「${exhibitorName}」さんの作品データはすでに入稿されています。ご本人がデータを差し替える場合は、STEP 3の「差し替え（再入稿）データとして提出する」にチェックを入れて再度入稿してください。（※他の方の名前を誤って選択していないかご確認ください）`
      );
    }

    const now = new Date();
    const stampForArchive = Utilities.formatDate(now, 'Asia/Tokyo', 'MMdd_HHmm');
    let submissionType = '新規入稿';

    if (hasExistingFile) {
      submissionType = '再入稿';
      while (existingFilesIter.hasNext()) {
        const oldFile = existingFilesIter.next();
        const archivedName = `【旧_${stampForArchive}】${safeFileBaseName}.jpg`;
        oldFile.setName(archivedName);
        oldFile.moveTo(archiveFolder);
      }
    }

    tempFile.setName(targetFileName);
    tempFile.moveTo(photoFolder);
    const savedFile = tempFile;
    tempFile = null;
    const fileUrl = savedFile.getUrl();

    // 入稿ログスプレッドシートへの記録（元の入信届シートには一切触れない）
    const logTimestamp = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
    const resolutionText = `${width}×${height}`;

    // ファイルは確定済みなので、ログ記録に失敗しても入稿自体は成功として返す
    // （失敗扱いにすると、出展者の再送が「すでに入稿されています」で詰まるため）
    let logWarning = '';
    try {
      recordToLogSpreadsheet_(
        logSheets,
        validExhibitors,
        {
          timestamp: logTimestamp,
          exhibitorName: exhibitorName,
          submissionType: submissionType,
          savedFileName: targetFileName,
          sizeMB: Number(sizeMB),
          resolution: resolutionText,
          fileUrl: fileUrl
        }
      );
    } catch (logErr) {
      logWarning = '入稿ログへの記録に失敗しました: ' + String((logErr && logErr.message) || logErr);
      console.error(logWarning + ` (出展者: ${exhibitorName} / ${targetFileName})`);
    }

    const successResult = {
      success: true,
      eventId: targetEvent.eventId,
      eventName: targetEvent.eventName,
      exhibitorName: exhibitorName,
      submissionType: submissionType,
      savedFileName: targetFileName,
      folderName: `${targetEvent.mainFolderName} / ${PHOTO_FOLDER_NAME}`,
      fileUrl: fileUrl,
      timestamp: logTimestamp,
      logWarning: logWarning
    };
    setCachedResult_(requestId, successResult);
    return createJsonResponse_(successResult);
  } catch (err) {
    // ロックを取れなかった場合などはクライアント側で自動再送させる
    const msg = String((err && err.message) || '');
    const isBusy = /Lock timeout|Could not obtain lock/i.test(msg) || /同時に実行/.test(msg);
    return createJsonResponse_({
      success: false,
      retryable: isBusy,
      message: isBusy
        ? 'サーバーが混雑しています。しばらくしてから自動で再送します。'
        : (msg || 'サーバー処理中にエラーが発生しました。')
    });
  } finally {
    // 失敗時に残った一時ファイルを片付ける
    if (tempFile) {
      try { tempFile.setTrashed(true); } catch (ignore) {}
    }
    if (lock.hasLock()) {
      lock.releaseLock();
    }
  }
}

/**
 * 入稿リクエストIDごとの処理結果キャッシュ（クライアント自動リトライ時の二重保存防止）
 */
function getCachedResult_(requestId) {
  if (!requestId) return null;
  try {
    const raw = CacheService.getScriptCache().get('submit_' + requestId);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

function setCachedResult_(requestId, result) {
  if (!requestId) return;
  try {
    CacheService.getScriptCache().put('submit_' + requestId, JSON.stringify(result), 21600);
  } catch (err) {
    // キャッシュ失敗は入稿自体に影響させない
  }
}

/**
 * 「⚙️自撮り狂_入稿システム設定」スプレッドシートを準備し、登録されている全イベント情報を読み込む
 * ※既存の行は消さずに、F列（QRコード作成ボタン）とG列（QRコード保存フォルダURL）を自動補完します。
 */
function ensureAndLoadAllEvents_(opts) {
  // light=true：入稿・名簿取得など高頻度のリクエスト用。設定シートの見出し・列幅・数式の書き込みを省いて高速化する
  // （初回や見出し不一致のときは自動的に通常モードで初期化する）
  const light = Boolean(opts && opts.light);
  const root = DriveApp.getRootFolder();
  const files = root.getFilesByName(CONFIG_SPREADSHEET_NAME);
  let configSs;

  if (files.hasNext()) {
    configSs = SpreadsheetApp.openById(files.next().getId());
  } else {
    configSs = SpreadsheetApp.create(CONFIG_SPREADSHEET_NAME);
  }

  // 管理者トークンの取得・自動生成（ScriptPropertiesを利用して永続化）
  const props = PropertiesService.getScriptProperties();
  let adminToken = props.getProperty('ADMIN_TOKEN');
  if (!adminToken) {
    adminToken = Utilities.getUuid().replace(/-/g, '').substring(0, 16);
    props.setProperty('ADMIN_TOKEN', adminToken);
  }

  const sheet = configSs.getSheets()[0];
  if (sheet.getName() !== 'イベント一覧設定') {
    sheet.setName('イベント一覧設定');
  }

  const cellA1 = String(sheet.getRange('A1').getValue() || '').trim();
  const skipWrites = light && cellA1 === 'イベントID（半角英数）';
  if (cellA1 !== 'イベントID（半角英数）') {
    sheet.clear();
    sheet.getRange('A1:G1').setValues([[
      'イベントID（半角英数）',
      'イベント名（空欄ならシート名から自動取得）',
      '入信届スプレッドシートURL',
      'LINEオプチャ配布用URL（自動生成）',
      '📁 写真フォルダURL',
      'QRコード一括作成ボタン（クリックで実行）',
      '📁 QRコードフォルダURL'
    ]]);
    sheet.getRange('A1:G1').setFontWeight('bold').setBackground('#e0e7ff');
    sheet.setFrozenRows(1);

    const initRows = [];
    for (let i = 0; i < INITIAL_EVENTS.length; i++) {
      const item = INITIAL_EVENTS[i];
      const rowNum = i + 2;
      initRows.push([
        item.eventId,
        item.eventName,
        item.spreadsheetUrl,
        `="${FRONTEND_BASE_URL}?event=" & A${rowNum}`,
        '',
        `=HYPERLINK("${FRONTEND_BASE_URL}?admin=qr&event=" & A${rowNum} & "&token=${adminToken}", "🔲 QRコードを一括作成")`,
        ''
      ]);
    }
    if (initRows.length > 0) {
      sheet.getRange(2, 1, initRows.length, 7).setValues(initRows);
    }
  } else if (!skipWrites) {
    // 既存シートがある場合、見出しを最新化（既存データは保持）
    sheet.getRange('A1:G1').setValues([[
      'イベントID（半角英数）',
      'イベント名（空欄ならシート名から自動取得）',
      '入信届スプレッドシートURL',
      'LINEオプチャ配布用URL（自動生成）',
      '📁 写真フォルダURL',
      'QRコード一括作成ボタン（クリックで実行）',
      '📁 QRコードフォルダURL'
    ]]);
    sheet.getRange('A1:G1').setFontWeight('bold').setBackground('#e0e7ff');
  }

  if (!skipWrites) {
    sheet.setColumnWidth(1, 150);
    sheet.setColumnWidth(2, 210);
    sheet.setColumnWidth(3, 380);
    sheet.setColumnWidth(4, 380);
    sheet.setColumnWidth(5, 320);
    sheet.setColumnWidth(6, 260);
    sheet.setColumnWidth(7, 320);
  }

  const lastRow = sheet.getLastRow();
  const events = [];

  if (lastRow >= 2) {
    const rows = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
    const formulas = sheet.getRange(2, 1, lastRow - 1, 7).getFormulas();

    for (let r = 0; r < rows.length; r++) {
      const rowNumber = r + 2;
      const eventId = String(rows[r][0] || '').trim();
      const manualName = String(rows[r][1] || '').trim();
      const rawUrl = String(rows[r][2] || '').trim();
      const colDVal = String(rows[r][3] || '').trim();
      const colFFormula = String(formulas[r][5] || '').trim();

      if (!eventId || !rawUrl) continue;

      if (!skipWrites) {
        // D列（LINEオプチャ配布用URL）が空なら自動数式をセット
        if (!colDVal) {
          sheet.getRange(rowNumber, 4).setFormula(`="${FRONTEND_BASE_URL}?event=" & A${rowNumber}`);
        }

        // F列（🔲 QRコードを一括作成ボタン）をトークン付きGitHub Pages URLに更新
        const targetFormula = `=HYPERLINK("${FRONTEND_BASE_URL}?admin=qr&event=" & A${rowNumber} & "&token=${adminToken}", "🔲 QRコードを一括作成")`;
        if (!colFFormula || colFFormula !== targetFormula) {
          sheet.getRange(rowNumber, 6).setFormula(targetFormula);
        }
      }

      const spreadsheetId = extractSpreadsheetId_(rawUrl);
      if (!spreadsheetId) continue;

      // 入信届スプレッドシートは実際に使うイベントの分だけ開く（遅延オープン）
      let sourceSs = null;
      const openSource = function() {
        if (!sourceSs) sourceSs = SpreadsheetApp.openById(spreadsheetId);
        return sourceSs;
      };

      let eventName = manualName;
      if (!eventName) {
        eventName = cleanEventNameFromTitle_(openSource().getName());
        sheet.getRange(rowNumber, 2).setValue(eventName);
      }

      events.push({
        rowNumber: rowNumber,
        eventId: eventId,
        eventName: eventName,
        get sourceSpreadsheet() { return openSource(); },
        mainFolderName: `${eventName} 作品データフォルダ`,
        logSpreadsheetName: `${eventName} 入稿ログ`
      });
    }
  }

  return {
    configSheetUrl: configSs.getUrl(),
    sheet: sheet,
    events: events,
    adminToken: adminToken
  };
}

/**
 * ============================================================
 * SNS（X / Instagram）QRコード一括作成ロジック
 * ============================================================
 */

/**
 * 設定シートの「🔲 QRコードを一括作成」リンクをクリックした際の処理＆結果返却
 */
function handleQrGenerationRequest_(events, configSheet, requestedEventId, overwriteFlag) {
  try {
    const targetEvents = [];
    if (requestedEventId) {
      const ev = findEventById_(events, requestedEventId);
      if (!ev) {
        throw new Error(`指定されたイベントID「${requestedEventId}」が設定シートに見つかりません。`);
      }
      targetEvents.push(ev);
    } else {
      for (let i = 0; i < events.length; i++) {
        targetEvents.push(events[i]);
      }
    }

    const results = [];
    for (let i = 0; i < targetEvents.length; i++) {
      results.push(generateEventQrCodes_(targetEvents[i], configSheet, overwriteFlag));
    }

    return createJsonResponse_({
      success: true,
      results: results
    });
  } catch (err) {
    return createJsonResponse_({
      success: false,
      message: err.message || String(err)
    });
  }
}

/**
 * 1イベント分の出展者SNS（X / Instagram）を読み取り、
 * 「📁 {イベント名} 作品データフォルダ / 📁 QRコード」内に
 * 「{アカウント名}_X.png」「{アカウント名}_Instagram.png」を作成・保存する
 */
function generateEventQrCodes_(ev, configSheet, overwriteFlag) {
  const mainFolder = getOrCreateMainFolder_(ev.mainFolderName);
  const photoFolder = getOrCreateSubFolder_(mainFolder, PHOTO_FOLDER_NAME);
  getOrCreateSubFolder_(photoFolder, ARCHIVE_FOLDER_NAME);
  const qrFolder = getOrCreateSubFolder_(mainFolder, QR_FOLDER_NAME);

  // 設定シートのE列（写真フォルダURL）・G列（QRコードフォルダURL）を記録
  if (configSheet && ev.rowNumber) {
    configSheet.getRange(ev.rowNumber, 5).setValue(photoFolder.getUrl());
    configSheet.getRange(ev.rowNumber, 7).setValue(qrFolder.getUrl());
  }

  // 既存のQRコードファイル一覧を取得（重複作成防止・高速化）
  const existingFileMap = {};
  const existingIter = qrFolder.getFiles();
  while (existingIter.hasNext()) {
    const f = existingIter.next();
    existingFileMap[f.getName()] = f;
  }

  // 入信届スプレッドシートから【読み取り専用】で D列(アカウント名)・E列(X)・F列(Instagram) を取得
  const snsList = getExhibitorSnsListFromSource_(ev.sourceSpreadsheet);

  let createdCount = 0;
  let skippedCount = 0;
  const itemLogs = [];

  for (let i = 0; i < snsList.length; i++) {
    const item = snsList[i];
    const safeBaseName = sanitizeFileName_(item.accountName);

    let xStatus = '未登録（空欄）';
    let xFileUrl = '';
    if (item.xUrl) {
      const xFileName = `${safeBaseName}_X.png`;
      if (existingFileMap[xFileName] && !overwriteFlag) {
        xStatus = '作成済（スキップ）';
        xFileUrl = existingFileMap[xFileName].getUrl();
        skippedCount++;
      } else {
        const oldFile = existingFileMap[xFileName];
        const xBlob = fetchQrCodePngBlob_(item.xUrl, xFileName);
        const savedX = qrFolder.createFile(xBlob);
        existingFileMap[xFileName] = savedX;
        // 上書き時は新しいファイルの保存に成功してから旧ファイルを削除
        if (oldFile && overwriteFlag) {
          oldFile.setTrashed(true);
        }
        xStatus = overwriteFlag ? '再作成（上書き）' : '新規作成';
        xFileUrl = savedX.getUrl();
        createdCount++;
      }
    }

    let igStatus = '未登録（空欄）';
    let igFileUrl = '';
    if (item.instagramUrl) {
      const igFileName = `${safeBaseName}_Instagram.png`;
      if (existingFileMap[igFileName] && !overwriteFlag) {
        igStatus = '作成済（スキップ）';
        igFileUrl = existingFileMap[igFileName].getUrl();
        skippedCount++;
      } else {
        const oldFile = existingFileMap[igFileName];
        const igBlob = fetchQrCodePngBlob_(item.instagramUrl, igFileName);
        const savedIg = qrFolder.createFile(igBlob);
        existingFileMap[igFileName] = savedIg;
        // 上書き時は新しいファイルの保存に成功してから旧ファイルを削除
        if (oldFile && overwriteFlag) {
          oldFile.setTrashed(true);
        }
        igStatus = overwriteFlag ? '再作成（上書き）' : '新規作成';
        igFileUrl = savedIg.getUrl();
        createdCount++;
      }
    }

    itemLogs.push({
      accountName: item.accountName,
      xHandle: item.xHandle,
      xUrl: item.xUrl,
      xFileName: item.xUrl ? `${safeBaseName}_X.png` : '-',
      xStatus: xStatus,
      xFileUrl: xFileUrl,
      instagramHandle: item.instagramHandle,
      instagramUrl: item.instagramUrl,
      igFileName: item.instagramUrl ? `${safeBaseName}_Instagram.png` : '-',
      igStatus: igStatus,
      igFileUrl: igFileUrl
    });
  }

  // 入稿ログスプレッドシートにも「SNS・QRコード一覧」シートを記録
  recordQrListToLogSpreadsheet_(mainFolder, ev.logSpreadsheetName, itemLogs);

  return {
    eventId: ev.eventId,
    eventName: ev.eventName,
    qrFolderName: `${ev.mainFolderName} / ${QR_FOLDER_NAME}`,
    qrFolderUrl: qrFolder.getUrl(),
    totalExhibitors: snsList.length,
    createdCount: createdCount,
    skippedCount: skippedCount,
    items: itemLogs
  };
}

/**
 * 【読み取り専用】入信届スプレッドシートから「アカウント名」「X」「Instagram」を取得
 * ※本名・住所・電話番号・メールアドレスの列は絶対に読み取りません
 */
function getExhibitorSnsListFromSource_(ss) {
  let sheet = ss.getSheetByName(SOURCE_SHEET_NAME);
  if (!sheet) {
    sheet = ss.getSheets()[0];
  }
  if (!sheet) {
    throw new Error('入信届スプレッドシート内にシートが見つかりません。');
  }

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) {
    return [];
  }

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const accountColIdx = detectAccountColumnIndex_(headers);
  const xColIdx = detectXColumnIndex_(headers);
  const igColIdx = detectInstagramColumnIndex_(headers);

  const numRows = lastRow - 1;
  const accountVals = sheet.getRange(2, accountColIdx + 1, numRows, 1).getValues();
  const xVals = xColIdx >= 0 && xColIdx < lastCol ? sheet.getRange(2, xColIdx + 1, numRows, 1).getValues() : null;
  const igVals = igColIdx >= 0 && igColIdx < lastCol ? sheet.getRange(2, igColIdx + 1, numRows, 1).getValues() : null;

  const map = {};

  for (let r = 0; r < numRows; r++) {
    const accountName = String(accountVals[r][0] || '').trim();
    if (!accountName) continue;

    const rawX = xVals ? String(xVals[r][0] || '').trim() : '';
    const rawIg = igVals ? String(igVals[r][0] || '').trim() : '';

    const parsedX = parseSnsInput_(rawX, 'X');
    const parsedIg = parseSnsInput_(rawIg, 'Instagram');

    if (!map[accountName]) {
      map[accountName] = {
        accountName: accountName,
        xHandle: parsedX.handle,
        xUrl: parsedX.url,
        instagramHandle: parsedIg.handle,
        instagramUrl: parsedIg.url
      };
    } else {
      if (parsedX.url) {
        map[accountName].xHandle = parsedX.handle;
        map[accountName].xUrl = parsedX.url;
      }
      if (parsedIg.url) {
        map[accountName].instagramHandle = parsedIg.handle;
        map[accountName].instagramUrl = parsedIg.url;
      }
    }
  }

  const keys = Object.keys(map);
  keys.sort(function(a, b) {
    return a.localeCompare(b, 'ja');
  });

  return keys.map(function(k) {
    return map[k];
  });
}

/**
 * 1行目の見出しから「X（旧Twitter）アカウント」列を自動検出（デフォルトはE列＝4）
 */
function detectXColumnIndex_(headers) {
  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i] || '').trim();
    if (/本名|住所|郵便|電話|メール|Email|タイムスタンプ/i.test(h)) continue;
    if (/\bX\b|Xアカウント|Twitter|旧Twitter|X[\s　（(]/i.test(h)) {
      return i;
    }
  }
  return DEFAULT_X_COL_INDEX;
}

/**
 * 1行目の見出しから「Instagramアカウント」列を自動検出（デフォルトはF列＝5）
 */
function detectInstagramColumnIndex_(headers) {
  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i] || '').trim();
    if (/本名|住所|郵便|電話|メール|Email|タイムスタンプ/i.test(h)) continue;
    if (/Instagram|インスタ/i.test(h)) {
      return i;
    }
  }
  return DEFAULT_INSTAGRAM_COL_INDEX;
}

/**
 * 入力されたSNSアカウント文字列（@付き、空白入り、URLごと入力、「なし」等）を綺麗に整形してURLへ変換
 */
function parseSnsInput_(rawInput, platform) {
  if (!rawInput) {
    return { handle: '', url: '' };
  }

  // 半角・全角スペースをすべて除去（例: "jff cocon" -> "jffcocon", "Tmk522 " -> "Tmk522"）
  let cleaned = String(rawInput).replace(/[\s　]+/g, '');

  // 「なし」「特になし」「ー」「-」などの無効入力を除外
  if (!cleaned || /^(なし|無し|特になし|特に無し|未登録|未定|アカウントなし|ー|-|―|none|null|nothing)$/i.test(cleaned)) {
    return { handle: '', url: '' };
  }

  // すでにURL形式で入力されている場合はドメイン部分とクエリパラメータ（?...）を除去してID部分を取り出す
  cleaned = cleaned
    .replace(/^https?:\/\/(www\.)?(x\.com|twitter\.com|instagram\.com)\//i, '')
    .replace(/\?.*$/, '')
    .replace(/\/+$/, '')
    .replace(/^[@＠]+/, '');

  if (!cleaned) {
    return { handle: '', url: '' };
  }

  if (platform === 'X') {
    return {
      handle: '@' + cleaned,
      url: 'https://x.com/' + encodeURIComponent(cleaned)
    };
  } else {
    return {
      handle: '@' + cleaned,
      url: 'https://www.instagram.com/' + encodeURIComponent(cleaned)
    };
  }
}

/**
 * 指定されたURLの高解像度QRコード画像（600×600px PNG）を生成してBlobとして返す
 */
function fetchQrCodePngBlob_(targetUrl, fileName) {
  const primaryApi =
    'https://quickchart.io/qr?size=600&margin=2&ecLevel=M&format=png&text=' +
    encodeURIComponent(targetUrl);
  const fallbackApi =
    'https://api.qrserver.com/v1/create-qr-code/?size=600x600&margin=20&ecc=M&format=png&data=' +
    encodeURIComponent(targetUrl);

  try {
    const resp = UrlFetchApp.fetch(primaryApi, { muteHttpExceptions: true });
    if (resp.getResponseCode() === 200) {
      return resp.getBlob().setName(fileName).setContentType('image/png');
    }
  } catch (e) {
    // プライマリAPI失敗時はフォールバックへ
  }

  const respFallback = UrlFetchApp.fetch(fallbackApi, { muteHttpExceptions: true });
  if (respFallback.getResponseCode() === 200) {
    return respFallback.getBlob().setName(fileName).setContentType('image/png');
  }

  throw new Error(`QRコード画像の生成に失敗しました（対象URL: ${targetUrl}）`);
}

/**
 * 入稿ログスプレッドシート内に「SNS・QRコード一覧」タブを作成・更新する
 */
function recordQrListToLogSpreadsheet_(mainFolder, logSpreadsheetName, itemLogs) {
  const logSs = getOrCreateLogSpreadsheet_(mainFolder, logSpreadsheetName);
  let qrSheet = logSs.getSheetByName('SNS・QRコード一覧');
  if (!qrSheet) {
    qrSheet = logSs.insertSheet('SNS・QRコード一覧');
  }

  const rows = [[
    '出展者名（アカウント名）',
    'Xアカウント',
    'X URL',
    'X QRファイル名',
    'X QRステータス',
    'X QRドライブURL',
    'Instagramアカウント',
    'Instagram URL',
    'Instagram QRファイル名',
    'Instagram QRステータス',
    'Instagram QRドライブURL'
  ]];

  for (let i = 0; i < itemLogs.length; i++) {
    const it = itemLogs[i];
    rows.push([
      it.accountName,
      it.xHandle || '',
      it.xUrl || '',
      it.xFileName,
      it.xStatus,
      it.xFileUrl || '',
      it.instagramHandle || '',
      it.instagramUrl || '',
      it.igFileName,
      it.igStatus,
      it.igFileUrl || ''
    ]);
  }

  qrSheet.clearContents();
  qrSheet.getRange(1, 1, rows.length, 11).setValues(rows);
  qrSheet.getRange(1, 1, 1, 11).setFontWeight('bold').setBackground('#e0e7ff');
  qrSheet.setFrozenRows(1);
}

/**
 * イベントID（大文字小文字無視）で対象イベントを検索
 */
function findEventById_(events, eventId) {
  const target = String(eventId || '').trim().toLowerCase();
  for (let i = 0; i < events.length; i++) {
    if (events[i].eventId.toLowerCase() === target) {
      return events[i];
    }
  }
  return null;
}

/**
 * スプレッドシートのタイトル（例:「自撮り狂2027東京　入信届」（回答））から綺麗なイベント名を抽出
 */
function cleanEventNameFromTitle_(rawTitle) {
  let cleaned = String(rawTitle || '')
    .replace(/[「」『』]/g, '')
    .replace(/[\s　]*入信届.*$/, '')
    .replace(/[\s　]*[（(]回答[)）].*$/, '')
    .trim();
  return cleaned || String(rawTitle || '').trim();
}

/**
 * スプレッドシートのURLまたはID文字列からIDを抽出
 */
function extractSpreadsheetId_(urlOrId) {
  const str = String(urlOrId || '').trim();
  if (!str) return '';
  const match = str.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match && match[1]) {
    return match[1];
  }
  return str;
}

/**
 * ファイル名に使用できない禁止文字を安全な文字に置換
 */
function sanitizeFileName_(name) {
  return String(name || '')
    .trim()
    .replace(/[\/\\:*?"<>|]/g, '_');
}

/**
 * JSONレスポンス生成ヘルパー（CORS対応）
 */
function createJsonResponse_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * 1行目の見出しから「アカウント名」列を自動検出（個人情報列は絶対読まない安全ロック付き）
 */
function detectAccountColumnIndex_(headers) {
  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i] || '').trim();
    // 個人情報列（本名・住所・電話・メール・タイムスタンプ）は除外
    if (/本名|住所|郵便|電話|メール|Email|タイムスタンプ/i.test(h)) {
      continue;
    }
    // 「アカウント名」または「出展者名」（ただしSNSアカウント列は除く）
    if (h.indexOf('アカウント名') !== -1 || h.indexOf('出展者名') !== -1) {
      if (!/\bX\b|Twitter|Instagram|インスタ/i.test(h)) {
        return i;
      }
    }
  }
  return DEFAULT_ACCOUNT_COL_INDEX;
}

/**
 * 【読み取り専用】入信届スプレッドシートからアカウント名一覧を取得（空欄・重複除外、五十音順ソート）
 * ※本番シートへの書き込み命令は一切含みません
 */
function getExhibitorListFromSource_(ss) {
  let sheet = ss.getSheetByName(SOURCE_SHEET_NAME);
  if (!sheet) {
    sheet = ss.getSheets()[0];
  }
  if (!sheet) {
    throw new Error('入信届スプレッドシート内にシートが見つかりません。');
  }

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) {
    return [];
  }

  // 1行目の見出しのみを取得して「アカウント名」列の位置を特定
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const accountColIdx = detectAccountColumnIndex_(headers);

  // 特定した「アカウント名」列（2行目〜最終行）のみを読み取る
  const values = sheet.getRange(2, accountColIdx + 1, lastRow - 1, 1).getValues();
  const uniqueMap = {};

  for (let r = 0; r < values.length; r++) {
    const rawName = String(values[r][0] || '').trim();
    if (rawName) {
      uniqueMap[rawName] = true;
    }
  }

  const names = Object.keys(uniqueMap);
  names.sort(function(a, b) {
    return a.localeCompare(b, 'ja');
  });

  return names;
}

/**
 * 「📁 写真」フォルダ内にすでに「{アカウント名}.jpg」が存在する出展者一覧を取得
 */
function getSubmittedExhibitorList_(mainFolderName) {
  const root = DriveApp.getRootFolder();
  const folderIter = root.getFoldersByName(mainFolderName);
  if (!folderIter.hasNext()) {
    return [];
  }

  const mainFolder = folderIter.next();
  const photoFolderIter = mainFolder.getFoldersByName(PHOTO_FOLDER_NAME);
  if (!photoFolderIter.hasNext()) {
    return [];
  }

  const photoFolder = photoFolderIter.next();
  const filesIter = photoFolder.getFiles();
  const submitted = [];

  while (filesIter.hasNext()) {
    const f = filesIter.next();
    const name = f.getName();
    if (/\.jpg$/i.test(name)) {
      submitted.push(name.replace(/\.jpg$/i, ''));
    }
  }
  return submitted;
}

/**
 * 旧仕様でメインフォルダ直下に空の「_旧データ（差し替え前）」が作られていた場合に自動で片付ける
 */
function cleanupLegacyArchiveFolderInRoot_(mainFolder) {
  const iter = mainFolder.getFoldersByName(ARCHIVE_FOLDER_NAME);
  while (iter.hasNext()) {
    const f = iter.next();
    if (!f.getFiles().hasNext() && !f.getFolders().hasNext()) {
      f.setTrashed(true);
    }
  }
}

/**
 * マイドライブ直下に「{イベント名} 作品データフォルダ」を検索・なければ新規作成
 */
function getOrCreateMainFolder_(mainFolderName) {
  const root = DriveApp.getRootFolder();
  const iter = root.getFoldersByName(mainFolderName);
  if (iter.hasNext()) {
    return iter.next();
  }
  return root.createFolder(mainFolderName);
}

/**
 * サブフォルダを検索・なければ新規作成
 */
function getOrCreateSubFolder_(parentFolder, subFolderName) {
  const iter = parentFolder.getFoldersByName(subFolderName);
  if (iter.hasNext()) {
    return iter.next();
  }
  return parentFolder.createFolder(subFolderName);
}

/**
 * 作品データフォルダ内の「{イベント名} 入稿ログ」スプレッドシートを取得・なければ自動作成
 */
function getOrCreateLogSpreadsheet_(mainFolder, logSpreadsheetName) {
  const files = mainFolder.getFilesByName(logSpreadsheetName);
  if (files.hasNext()) {
    const file = files.next();
    return SpreadsheetApp.openById(file.getId());
  }

  const newSs = SpreadsheetApp.create(logSpreadsheetName);
  const newFile = DriveApp.getFileById(newSs.getId());
  newFile.moveTo(mainFolder);

  const logSheet = newSs.getSheets()[0];
  logSheet.setName('入稿ログ');
  logSheet.appendRow([
    '日時',
    '出展者名（アカウント名）',
    '区分(新規/再入稿)',
    '保存ファイル名',
    '容量(MB)',
    '解像度(px)',
    'ドライブURL'
  ]);
  logSheet.getRange(1, 1, 1, 7).setFontWeight('bold');
  logSheet.setFrozenRows(1);

  const statusSheet = newSs.insertSheet('入稿状況一覧');
  statusSheet.appendRow([
    '出展者名（アカウント名）',
    '入稿ステータス',
    '最終入稿日時',
    '保存ファイル名',
    '容量(MB)',
    '解像度(px)',
    '最新ファイルURL'
  ]);
  statusSheet.getRange(1, 1, 1, 7).setFontWeight('bold');
  statusSheet.setFrozenRows(1);

  return newSs;
}

/**
 * 入稿ログ・入稿状況一覧のシートを取得（なければ作成）。ロックの外で呼び出すこと。
 */
function prepareLogSheets_(logSs) {
  let logSheet = logSs.getSheetByName('入稿ログ');
  if (!logSheet) {
    logSheet = logSs.insertSheet('入稿ログ');
    logSheet.appendRow(LOG_HEADERS);
    logSheet.getRange(1, 1, 1, 7).setFontWeight('bold');
    logSheet.setFrozenRows(1);
  }
  let statusSheet = logSs.getSheetByName('入稿状況一覧');
  if (!statusSheet) {
    statusSheet = logSs.insertSheet('入稿状況一覧');
  }
  return { logSheet: logSheet, statusSheet: statusSheet };
}

/**
 * 入稿ログの追記 ＆ 入稿状況一覧の更新（ロック内で呼ばれるため、通常は「1行追記＋1行更新」だけで済ませる）
 */
function recordToLogSpreadsheet_(sheets, allExhibitors, entry) {
  const logSheet = sheets.logSheet;
  const statusSheet = sheets.statusSheet;

  logSheet.appendRow([
    entry.timestamp,
    entry.exhibitorName,
    entry.submissionType,
    entry.savedFileName,
    entry.sizeMB,
    entry.resolution,
    entry.fileUrl
  ]);

  // 入稿状況一覧：該当出展者の行だけを更新。行が見つからない・名簿の人数が変わった場合のみ全件再構築。
  const statusLastRow = statusSheet.getLastRow();
  const names = statusLastRow >= 2
    ? statusSheet.getRange(2, 1, statusLastRow - 1, 1).getValues().map(function(r) { return String(r[0] || '').trim(); })
    : [];
  const rowIdx = names.indexOf(entry.exhibitorName);

  if (rowIdx >= 0 && names.length === allExhibitors.length) {
    statusSheet.getRange(rowIdx + 2, 1, 1, 7).setValues([[
      entry.exhibitorName,
      `入稿済（${entry.submissionType}）`,
      entry.timestamp,
      entry.savedFileName,
      entry.sizeMB,
      entry.resolution,
      entry.fileUrl
    ]]);
    return;
  }
  rebuildStatusSheet_(logSheet, statusSheet, allExhibitors);
}

/**
 * 入稿状況一覧シートを入稿ログから全件再構築する
 */
function rebuildStatusSheet_(logSheet, statusSheet, allExhibitors) {
  const logLastRow = logSheet.getLastRow();
  const latestMap = {};
  if (logLastRow >= 2) {
    const logRows = logSheet.getRange(2, 1, logLastRow - 1, 7).getValues();
    for (let i = 0; i < logRows.length; i++) {
      const row = logRows[i];
      const name = String(row[1] || '').trim();
      if (name) {
        latestMap[name] = {
          timestamp: row[0],
          type: row[2],
          fileName: row[3],
          sizeMB: row[4],
          resolution: row[5],
          url: row[6]
        };
      }
    }
  }

  const outputRows = [[
    '出展者名（アカウント名）',
    '入稿ステータス',
    '最終入稿日時',
    '保存ファイル名',
    '容量(MB)',
    '解像度(px)',
    '最新ファイルURL'
  ]];

  for (let i = 0; i < allExhibitors.length; i++) {
    const name = allExhibitors[i];
    const info = latestMap[name];
    if (info) {
      outputRows.push([
        name,
        `入稿済（${info.type}）`,
        info.timestamp,
        info.fileName,
        info.sizeMB,
        info.resolution,
        info.url
      ]);
    } else {
      outputRows.push([name, '未入稿', '', '', '', '', '']);
    }
  }

  statusSheet.clearContents();
  statusSheet.getRange(1, 1, outputRows.length, 7).setValues(outputRows);
  statusSheet.getRange(1, 1, 1, 7).setFontWeight('bold');
}

/**
 * 手動実行用：入稿処理が強制終了した際に残った一時ファイル（__tmp_*.jpg）を1時間経過後にゴミ箱へ移す
 */
function cleanupTempFiles() {
  const configInfo = ensureAndLoadAllEvents_();
  const threshold = Date.now() - 60 * 60 * 1000;
  let count = 0;
  for (let i = 0; i < configInfo.events.length; i++) {
    const mainFolder = getOrCreateMainFolder_(configInfo.events[i].mainFolderName);
    const photoFolder = getOrCreateSubFolder_(mainFolder, PHOTO_FOLDER_NAME);
    const archiveFolder = getOrCreateSubFolder_(photoFolder, ARCHIVE_FOLDER_NAME);
    const iter = archiveFolder.getFiles();
    while (iter.hasNext()) {
      const f = iter.next();
      if (/^__tmp_/.test(f.getName()) && f.getDateCreated().getTime() < threshold) {
        f.setTrashed(true);
        count++;
      }
    }
  }
  Logger.log(`一時ファイルを ${count} 件ゴミ箱へ移しました。`);
}

/**
 * JPEGのEXIF Orientation（1〜8）を取得。なければ 1 を返す
 * （5〜8 は90度回転が必要＝ブラウザ表示では縦横が入れ替わる）
 */
function extractJpegOrientation_(bytes) {
  const len = bytes.length;
  let i = 2;
  while (i < len - 4) {
    if ((bytes[i] & 0xff) !== 0xff) {
      i++;
      continue;
    }
    const marker = bytes[i + 1] & 0xff;
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) break; // 画像データ開始以降にEXIFは無い
    const segLen = ((bytes[i + 2] & 0xff) << 8) | (bytes[i + 3] & 0xff);
    if (segLen < 2) break;

    if (marker === 0xe1 && i + 10 < len &&
        (bytes[i + 4] & 0xff) === 0x45 && (bytes[i + 5] & 0xff) === 0x78 &&
        (bytes[i + 6] & 0xff) === 0x69 && (bytes[i + 7] & 0xff) === 0x66) { // "Exif"
      const tiff = i + 10;
      const little = (bytes[tiff] & 0xff) === 0x49; // "II"=リトルエンディアン / "MM"=ビッグ
      const read16 = function(pos) {
        if (pos + 1 >= len) return 0;
        return little
          ? ((bytes[pos + 1] & 0xff) << 8) | (bytes[pos] & 0xff)
          : ((bytes[pos] & 0xff) << 8) | (bytes[pos + 1] & 0xff);
      };
      const read32 = function(pos) {
        return little
          ? (read16(pos + 2) * 65536) + read16(pos)
          : (read16(pos) * 65536) + read16(pos + 2);
      };
      const ifd0 = tiff + read32(tiff + 4);
      const entryCount = read16(ifd0);
      for (let n = 0; n < entryCount && n < 64; n++) {
        const entry = ifd0 + 2 + n * 12;
        if (entry + 12 > len) break;
        if (read16(entry) === 0x0112) {
          const v = read16(entry + 8);
          return v >= 1 && v <= 8 ? v : 1;
        }
      }
      return 1;
    }
    i += 2 + segLen;
  }
  return 1;
}

/**
 * JPEGバイナリのSOFマーカーから実際の画像解像度（横×縦 px）を取得
 */
function extractJpegDimensions_(bytes) {
  const len = bytes.length;
  let i = 2;
  while (i < len - 8) {
    if ((bytes[i] & 0xff) !== 0xff) {
      i++;
      continue;
    }
    const marker = bytes[i + 1] & 0xff;
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      const height = ((bytes[i + 5] & 0xff) << 8) | (bytes[i + 6] & 0xff);
      const width = ((bytes[i + 7] & 0xff) << 8) | (bytes[i + 8] & 0xff);
      return { width: width, height: height };
    }
    const segLen = ((bytes[i + 2] & 0xff) << 8) | (bytes[i + 3] & 0xff);
    if (segLen < 2) break;
    i += 2 + segLen;
  }
  return null;
}
