/**
 * ============================================================
 * 自撮り狂 作品データ入稿システム バックエンド (コード.gs)
 * 【複数イベント同時稼働 ＆ イベント別専用URL対応版】
 * ============================================================
 *
 * 【運用アカウント】jidorikyou@gmail.com
 *
 * 【特徴・安全設計】
 * 1. 本番の「入信届（回答）」スプレッドシート（名古屋・大阪・東京など）は100%「読み取り専用」です。
 *    文字の書き込みやタブ追加は一切行いません。
 * 2. 1行目の見出しから「アカウント名」列を自動検出し、本名・住所・電話番号・メールアドレスの列は
 *    絶対に読み込まない安全ロックを搭載しています。
 * 3. jidorikyou@gmail.com のマイドライブ直下に「⚙️自撮り狂_入稿システム設定」シートを自動作成します。
 *    今後イベントが増えても、この設定シートに行を追加するだけで、
 *    ・LINEオプチャ配布用URL（?event=〇〇）の自動生成
 *    ・「📁 〇〇 作品データフォルダ」の自動作成
 *    ・「📊 〇〇 入稿ログ」の自動作成
 *    がすべてコード変更なしで完結します！
 */

// GitHub Pagesの公開ベースURL（設定シートのD列にLINEオプチャ配布用URLを自動表示するために使用）
const FRONTEND_BASE_URL = 'https://hirocode321.github.io/jidorikyou-form/';

// マイドライブ直下に作成されるイベント管理・設定ファイル名
const CONFIG_SPREADSHEET_NAME = '⚙️自撮り狂_入稿システム設定';

// 初期登録するイベント一覧（※実際のURLは非公開の「⚙️自撮り狂_入稿システム設定」シートで管理します）
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

// デフォルトのアカウント名列（D列 = 0始まりで3）
const DEFAULT_ACCOUNT_COL_INDEX = 3;

// 差し替え前の旧データ退避フォルダ名
const ARCHIVE_FOLDER_NAME = '_旧データ（差し替え前）';

// バリデーション基準値（3.00 MB = 3 * 1024 * 1024 bytes）
const MIN_FILE_SIZE_BYTES = 3 * 1024 * 1024;

/**
 * セットアップ関数：
 * Apps Scriptエディタ上で「setup」を選択して「▷ 実行」を押すと、
 * 設定シートの更新と、全イベント分のGoogleドライブフォルダ・入稿ログシートを一括作成します。
 */
function setup() {
  const configInfo = ensureAndLoadAllEvents_();
  const events = configInfo.events;

  Logger.log('====================================');
  Logger.log('⚙️ イベント設定シートURL: ' + configInfo.configSheetUrl);
  Logger.log('====================================');

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const mainFolder = getOrCreateMainFolder_(ev.mainFolderName);
    getOrCreateSubFolder_(mainFolder, ARCHIVE_FOLDER_NAME);
    const logSs = getOrCreateLogSpreadsheet_(mainFolder, ev.logSpreadsheetName);
    const exhibitors = getExhibitorListFromSource_(ev.sourceSpreadsheet);

    // 設定シートのE列に作品保存フォルダURLを記録
    configInfo.sheet.getRange(ev.rowNumber, 5).setValue(mainFolder.getUrl());

    Logger.log(`📌 [${ev.eventId}] ${ev.eventName}（出展者数: ${exhibitors.length}名）`);
    Logger.log(`   LINEオプチャ配布用URL: ${FRONTEND_BASE_URL}?event=${ev.eventId}`);
    Logger.log(`   📁 作品データフォルダ: ${mainFolder.getUrl()}`);
    Logger.log(`   📊 入稿ログシート: ${logSs.getUrl()}`);
  }

  Logger.log('=== 全イベントのセットアップが完了しました！ ===');
}

/**
 * APIエンドポイント 1: doGet(e)
 * ?event=2027osaka 等のパラメータを受け取り、該当イベントの名簿と入稿状況を返します。
 * パラメータがない場合は登録されている全イベントの一覧を返します。
 */
function doGet(e) {
  try {
    const requestedEventId = e && e.parameter && e.parameter.event ? String(e.parameter.event).trim() : '';
    const configInfo = ensureAndLoadAllEvents_();
    const events = configInfo.events;

    const eventSummaries = events.map(function(ev) {
      return {
        eventId: ev.eventId,
        eventName: ev.eventName,
        pageTitle: `${ev.eventName} 作品データ入稿システム`
      };
    });

    // イベントIDが指定されていない場合（または一覧取得時）
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
      folderName: targetEvent.mainFolderName,
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
 * 該当イベントのフォルダへ「{アカウント名}.jpg」として保存・入稿ログ記録を行います。
 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);

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

    const configInfo = ensureAndLoadAllEvents_();
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

    const dimensions = extractJpegDimensions_(decodedBytes);
    const width = dimensions ? dimensions.width : Number(payload.width || 0);
    const height = dimensions ? dimensions.height : Number(payload.height || 0);

    if (!width || !height || width >= height) {
      throw new Error(`構図エラー：縦構図（横px < 縦px）の写真のみ入稿可能です（検出解像度: ${width}×${height} px）。`);
    }

    // ============================================================
    // 2. 該当イベントの保存先フォルダ取得・作成（サブフォルダなし・1フォルダ集約）
    // ============================================================
    const mainFolder = getOrCreateMainFolder_(targetEvent.mainFolderName);
    const archiveFolder = getOrCreateSubFolder_(mainFolder, ARCHIVE_FOLDER_NAME);

    // ファイル名に使えない禁止記号を安全な文字に変換
    const safeFileBaseName = sanitizeFileName_(exhibitorName);
    const targetFileName = `${safeFileBaseName}.jpg`;
    const existingFilesIter = mainFolder.getFilesByName(targetFileName);
    const hasExistingFile = existingFilesIter.hasNext();

    // 誤選択による上書き防止ストッパー
    if (hasExistingFile && !isResubmitFlag) {
      throw new Error(
        `「${exhibitorName}」さんの作品データはすでに入稿されています。ご本人がデータを差し替える場合は、STEP 3の「差し替え（再入稿）データとして提出する」にチェックを入れて再度入稿してください。（※他の方の名前を誤って選択していないかご確認ください）`
      );
    }

    // ============================================================
    // 3. 旧ファイルの退避＆最新「{アカウント名}.jpg」の保存
    // ============================================================
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

    const blob = Utilities.newBlob(decodedBytes, 'image/jpeg', targetFileName);
    const savedFile = mainFolder.createFile(blob);
    const fileUrl = savedFile.getUrl();

    // ============================================================
    // 4. 入稿ログスプレッドシートへの記録（元の入信届シートには一切触れない）
    // ============================================================
    const logTimestamp = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
    const resolutionText = `${width}×${height}`;

    recordToLogSpreadsheet_(
      mainFolder,
      targetEvent.logSpreadsheetName,
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

    return createJsonResponse_({
      success: true,
      eventId: targetEvent.eventId,
      eventName: targetEvent.eventName,
      exhibitorName: exhibitorName,
      submissionType: submissionType,
      savedFileName: targetFileName,
      folderName: targetEvent.mainFolderName,
      fileUrl: fileUrl,
      timestamp: logTimestamp
    });
  } catch (err) {
    return createJsonResponse_({
      success: false,
      message: err.message || 'サーバー処理中にエラーが発生しました。'
    });
  } finally {
    if (lock.hasLock()) {
      lock.releaseLock();
    }
  }
}

/**
 * 「⚙️自撮り狂_入稿システム設定」スプレッドシートを準備し、登録されている全イベント情報を読み込む
 */
function ensureAndLoadAllEvents_() {
  const root = DriveApp.getRootFolder();
  const files = root.getFilesByName(CONFIG_SPREADSHEET_NAME);
  let configSs;

  if (files.hasNext()) {
    configSs = SpreadsheetApp.openById(files.next().getId());
  } else {
    configSs = SpreadsheetApp.create(CONFIG_SPREADSHEET_NAME);
  }

  const sheet = configSs.getSheets()[0];
  sheet.setName('イベント一覧設定');

  // もし旧フォーマット（A2が「① 入信届スプレッドシートURL」等）または空シートなら、複数イベント一覧表フォーマットに初期化
  const cellA1 = String(sheet.getRange('A1').getValue() || '').trim();
  if (cellA1 !== 'イベントID（半角英数）') {
    sheet.clear();
    sheet.getRange('A1:E1').setValues([[
      'イベントID（半角英数）',
      'イベント名（空欄ならシート名から自動取得）',
      '入信届スプレッドシートURL',
      'LINEオプチャ配布用URL（自動生成）',
      '作品保存フォルダURL'
    ]]);
    sheet.getRange('A1:E1').setFontWeight('bold').setBackground('#e0e7ff');
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
        ''
      ]);
    }
    sheet.getRange(2, 1, initRows.length, 5).setValues(initRows);
    sheet.setColumnWidth(1, 160);
    sheet.setColumnWidth(2, 220);
    sheet.setColumnWidth(3, 420);
    sheet.setColumnWidth(4, 420);
    sheet.setColumnWidth(5, 360);
  }

  const lastRow = sheet.getLastRow();
  const events = [];

  if (lastRow >= 2) {
    const rows = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
    for (let r = 0; r < rows.length; r++) {
      const rowNumber = r + 2;
      const eventId = String(rows[r][0] || '').trim();
      const manualName = String(rows[r][1] || '').trim();
      const rawUrl = String(rows[r][2] || '').trim();
      const formulaCol = String(rows[r][3] || '').trim();

      if (!eventId || !rawUrl) continue;

      // D列（LINEオプチャ配布用URL）が空なら自動数式をセット
      if (!formulaCol) {
        sheet.getRange(rowNumber, 4).setFormula(`="${FRONTEND_BASE_URL}?event=" & A${rowNumber}`);
      }

      const spreadsheetId = extractSpreadsheetId_(rawUrl);
      if (!spreadsheetId) continue;

      const sourceSpreadsheet = SpreadsheetApp.openById(spreadsheetId);
      const rawTitle = sourceSpreadsheet.getName();

      let eventName = manualName;
      if (!eventName) {
        eventName = cleanEventNameFromTitle_(rawTitle);
        sheet.getRange(rowNumber, 2).setValue(eventName);
      }

      events.push({
        rowNumber: rowNumber,
        eventId: eventId,
        eventName: eventName,
        sourceSpreadsheet: sourceSpreadsheet,
        mainFolderName: `${eventName} 作品データフォルダ`,
        logSpreadsheetName: `${eventName} 入稿ログ`
      });
    }
  }

  return {
    configSheetUrl: configSs.getUrl(),
    sheet: sheet,
    events: events
  };
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
    // 「アカウント名」または「出展者名」（ただしXアカウント・Instagramアカウントは除く）
    if ((h.indexOf('アカウント名') !== -1 || h.indexOf('出展者名') !== -1) && !/X|Twitter|Instagram|インスタ/i.test(h)) {
      return i;
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
 * 作品データ保存フォルダ内にすでに「{アカウント名}.jpg」が存在する出展者一覧を取得
 */
function getSubmittedExhibitorList_(mainFolderName) {
  const root = DriveApp.getRootFolder();
  const folderIter = root.getFoldersByName(mainFolderName);
  if (!folderIter.hasNext()) {
    return [];
  }

  const mainFolder = folderIter.next();
  const filesIter = mainFolder.getFiles();
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
 * 入稿ログの追記 ＆ 入稿状況一覧シートの最新化
 */
function recordToLogSpreadsheet_(mainFolder, logSpreadsheetName, allExhibitors, entry) {
  const logSs = getOrCreateLogSpreadsheet_(mainFolder, logSpreadsheetName);

  let logSheet = logSs.getSheetByName('入稿ログ');
  if (!logSheet) {
    logSheet = logSs.insertSheet('入稿ログ');
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
  }

  logSheet.appendRow([
    entry.timestamp,
    entry.exhibitorName,
    entry.submissionType,
    entry.savedFileName,
    entry.sizeMB,
    entry.resolution,
    entry.fileUrl
  ]);

  let statusSheet = logSs.getSheetByName('入稿状況一覧');
  if (!statusSheet) {
    statusSheet = logSs.insertSheet('入稿状況一覧');
  }

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

  const outputRows = [
    [
      '出展者名（アカウント名）',
      '入稿ステータス',
      '最終入稿日時',
      '保存ファイル名',
      '容量(MB)',
      '解像度(px)',
      '最新ファイルURL'
    ]
  ];

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
