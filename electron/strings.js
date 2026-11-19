// Text for the desktop app's own dialogs (the rest of the UI is translated in public/i18n.js).
const S = {
  en: {
    chooseTitle: 'Choose your vault',
    chooseMessage: 'Where should Graphite keep your notes?',
    chooseDetail: 'Your notes are plain Markdown files in a folder, called a vault. Open a folder you already have (an Obsidian vault works too), or create a new vault with a few starter notes.',
    openExisting: 'Open an existing folder…', createNew: 'Create a new vault…', cancel: 'Cancel',
    pickFolder: 'Choose your vault folder', newVault: 'Create a new vault', createButton: 'Create vault',
    missing: 'Your vault folder could not be found:\n{path}',
  },
  fr: {
    chooseTitle: 'Choisir votre coffre',
    chooseMessage: 'Où Graphite doit-il conserver vos notes ?',
    chooseDetail: 'Vos notes sont de simples fichiers Markdown dans un dossier, appelé coffre. Ouvrez un dossier existant (un coffre Obsidian fonctionne aussi) ou créez un nouveau coffre avec quelques notes de départ.',
    openExisting: 'Ouvrir un dossier existant…', createNew: 'Créer un nouveau coffre…', cancel: 'Annuler',
    pickFolder: 'Choisir le dossier du coffre', newVault: 'Créer un nouveau coffre', createButton: 'Créer le coffre',
    missing: 'Le dossier de votre coffre est introuvable :\n{path}',
  },
  es: {
    chooseTitle: 'Elige tu bóveda',
    chooseMessage: '¿Dónde debe guardar Graphite tus notas?',
    chooseDetail: 'Tus notas son simples archivos Markdown en una carpeta, llamada bóveda. Abre una carpeta que ya tengas (también sirve una bóveda de Obsidian) o crea una bóveda nueva con algunas notas de inicio.',
    openExisting: 'Abrir una carpeta existente…', createNew: 'Crear una bóveda nueva…', cancel: 'Cancelar',
    pickFolder: 'Elige la carpeta de tu bóveda', newVault: 'Crear una bóveda nueva', createButton: 'Crear bóveda',
    missing: 'No se encuentra la carpeta de tu bóveda:\n{path}',
  },
  ja: {
    chooseTitle: '保管庫を選択',
    chooseMessage: 'Graphite のノートをどこに保存しますか？',
    chooseDetail: 'ノートはフォルダ（保管庫）の中のふつうの Markdown ファイルです。既存のフォルダを開くか（Obsidian の保管庫も使えます）、サンプルノート付きの新しい保管庫を作成してください。',
    openExisting: '既存のフォルダを開く…', createNew: '新しい保管庫を作成…', cancel: 'キャンセル',
    pickFolder: '保管庫のフォルダを選択', newVault: '新しい保管庫を作成', createButton: '保管庫を作成',
    missing: '保管庫のフォルダが見つかりません:\n{path}',
  },
  ko: {
    chooseTitle: '보관함 선택',
    chooseMessage: 'Graphite이 노트를 어디에 저장할까요?',
    chooseDetail: '노트는 폴더(보관함) 안의 평범한 Markdown 파일입니다. 이미 있는 폴더를 열거나(Obsidian 보관함도 됩니다) 시작용 노트가 들어 있는 새 보관함을 만드세요.',
    openExisting: '기존 폴더 열기…', createNew: '새 보관함 만들기…', cancel: '취소',
    pickFolder: '보관함 폴더 선택', newVault: '새 보관함 만들기', createButton: '보관함 만들기',
    missing: '보관함 폴더를 찾을 수 없습니다:\n{path}',
  },
  'zh-CN': {
    chooseTitle: '选择仓库',
    chooseMessage: 'Graphite 应该把笔记保存在哪里？',
    chooseDetail: '你的笔记是文件夹（仓库）中的普通 Markdown 文件。打开一个已有的文件夹（Obsidian 仓库也可以），或新建一个带有入门笔记的仓库。',
    openExisting: '打开已有文件夹…', createNew: '新建仓库…', cancel: '取消',
    pickFolder: '选择仓库文件夹', newVault: '新建仓库', createButton: '创建仓库',
    missing: '找不到仓库文件夹：\n{path}',
  },
  'zh-TW': {
    chooseTitle: '選擇儲存庫',
    chooseMessage: 'Graphite 應該把筆記儲存在哪裡？',
    chooseDetail: '你的筆記是資料夾（儲存庫）中的一般 Markdown 檔案。開啟一個現有的資料夾（Obsidian 儲存庫也可以），或新增一個附有入門筆記的儲存庫。',
    openExisting: '開啟現有資料夾…', createNew: '新增儲存庫…', cancel: '取消',
    pickFolder: '選擇儲存庫資料夾', newVault: '新增儲存庫', createButton: '建立儲存庫',
    missing: '找不到儲存庫資料夾：\n{path}',
  },
};

// Right-click menu
const MENU = {
  en: { undo: 'Undo', redo: 'Redo', cut: 'Cut', copy: 'Copy', paste: 'Paste', selectAll: 'Select all', format: 'Format', bold: 'Bold', italic: 'Italic', highlight: 'Highlight', strike: 'Strikethrough', code: 'Code', math: 'Math', wikilink: 'Link to a note', search: 'Search for “{text}”', openLink: 'Open link', copyLink: 'Copy link address', copyImage: 'Copy image', check: 'Check this note for mistakes', quiz: 'Quiz yourself on this note' },
  fr: { undo: 'Annuler', redo: 'Rétablir', cut: 'Couper', copy: 'Copier', paste: 'Coller', selectAll: 'Tout sélectionner', format: 'Mise en forme', bold: 'Gras', italic: 'Italique', highlight: 'Surligner', strike: 'Barré', code: 'Code', math: 'Formule', wikilink: 'Lien vers une note', search: 'Rechercher « {text} »', openLink: 'Ouvrir le lien', copyLink: 'Copier l’adresse du lien', copyImage: 'Copier l’image', check: 'Vérifier les erreurs de cette note', quiz: 'Me tester sur cette note' },
  es: { undo: 'Deshacer', redo: 'Rehacer', cut: 'Cortar', copy: 'Copiar', paste: 'Pegar', selectAll: 'Seleccionar todo', format: 'Formato', bold: 'Negrita', italic: 'Cursiva', highlight: 'Resaltar', strike: 'Tachado', code: 'Código', math: 'Fórmula', wikilink: 'Enlace a una nota', search: 'Buscar «{text}»', openLink: 'Abrir enlace', copyLink: 'Copiar dirección del enlace', copyImage: 'Copiar imagen', check: 'Revisar errores en esta nota', quiz: 'Ponerme a prueba con esta nota' },
  ja: { undo: '元に戻す', redo: 'やり直す', cut: '切り取り', copy: 'コピー', paste: '貼り付け', selectAll: 'すべて選択', format: '書式', bold: '太字', italic: '斜体', highlight: 'ハイライト', strike: '取り消し線', code: 'コード', math: '数式', wikilink: 'ノートへのリンク', search: '「{text}」を検索', openLink: 'リンクを開く', copyLink: 'リンクのアドレスをコピー', copyImage: '画像をコピー', check: 'このノートの誤りをチェック', quiz: 'このノートでクイズ' },
  ko: { undo: '실행 취소', redo: '다시 실행', cut: '잘라내기', copy: '복사', paste: '붙여넣기', selectAll: '모두 선택', format: '서식', bold: '굵게', italic: '기울임', highlight: '강조 표시', strike: '취소선', code: '코드', math: '수식', wikilink: '노트 링크', search: '"{text}" 검색', openLink: '링크 열기', copyLink: '링크 주소 복사', copyImage: '이미지 복사', check: '이 노트의 오류 검사', quiz: '이 노트로 퀴즈' },
  'zh-CN': { undo: '撤销', redo: '重做', cut: '剪切', copy: '复制', paste: '粘贴', selectAll: '全选', format: '格式', bold: '粗体', italic: '斜体', highlight: '高亮', strike: '删除线', code: '代码', math: '公式', wikilink: '链接到笔记', search: '搜索“{text}”', openLink: '打开链接', copyLink: '复制链接地址', copyImage: '复制图片', check: '检查这篇笔记的错误', quiz: '用这篇笔记做测验' },
  'zh-TW': { undo: '復原', redo: '重做', cut: '剪下', copy: '複製', paste: '貼上', selectAll: '全選', format: '格式', bold: '粗體', italic: '斜體', highlight: '螢光標記', strike: '刪除線', code: '程式碼', math: '公式', wikilink: '連結到筆記', search: '搜尋「{text}」', openLink: '開啟連結', copyLink: '複製連結網址', copyImage: '複製圖片', check: '檢查這篇筆記的錯誤', quiz: '用這篇筆記做測驗' },
};
for (const [lang, d] of Object.entries(MENU)) Object.assign(S[lang], d);
// Closing with notes that couldn't be saved.
const UNSAVED = {
  en: { unsavedTitle: 'Unsaved changes', unsavedMessage: '{n} note(s) could not be saved to your vault.', unsavedTimeout: 'Graphite could not confirm that your notes were saved.',
    unsavedDetail: 'Nothing has been lost yet: the newest text is kept as a draft. Try again, save copies to another folder, or close and Graphite will try again next time you open it.',
    unsavedRetry: 'Try again', unsavedSaveCopies: 'Save copies elsewhere…', unsavedQuit: 'Close, keep as drafts', unsavedPickFolder: 'Choose a folder for the copies', unsavedCopyFailed: 'Some copies could not be written.' },
  fr: { unsavedTitle: 'Modifications non enregistrées', unsavedMessage: '{n} note(s) n’ont pas pu être enregistrées dans votre coffre.', unsavedTimeout: 'Graphite n’a pas pu confirmer l’enregistrement de vos notes.',
    unsavedDetail: 'Rien n’est perdu : le texte le plus récent est gardé comme brouillon. Réessayez, enregistrez des copies dans un autre dossier, ou fermez : Graphite réessaiera à la prochaine ouverture.',
    unsavedRetry: 'Réessayer', unsavedSaveCopies: 'Enregistrer des copies ailleurs…', unsavedQuit: 'Fermer, garder les brouillons', unsavedPickFolder: 'Choisir un dossier pour les copies', unsavedCopyFailed: 'Certaines copies n’ont pas pu être écrites.' },
  es: { unsavedTitle: 'Cambios sin guardar', unsavedMessage: 'No se pudieron guardar {n} nota(s) en tu bóveda.', unsavedTimeout: 'Graphite no pudo confirmar que tus notas se guardaran.',
    unsavedDetail: 'Aún no se ha perdido nada: el texto más reciente se guarda como borrador. Reinténtalo, guarda copias en otra carpeta o cierra y Graphite lo reintentará la próxima vez.',
    unsavedRetry: 'Reintentar', unsavedSaveCopies: 'Guardar copias en otro sitio…', unsavedQuit: 'Cerrar y conservar borradores', unsavedPickFolder: 'Elige una carpeta para las copias', unsavedCopyFailed: 'No se pudieron escribir algunas copias.' },
  ja: { unsavedTitle: '未保存の変更', unsavedMessage: '{n} 件のノートを保管庫に保存できませんでした。', unsavedTimeout: 'ノートが保存されたか確認できませんでした。',
    unsavedDetail: 'まだ何も失われていません。最新の文章は下書きとして保持されています。もう一度試すか、別のフォルダにコピーを保存するか、閉じて次回起動時に再試行できます。',
    unsavedRetry: '再試行', unsavedSaveCopies: '別の場所にコピーを保存…', unsavedQuit: '閉じて下書きを保持', unsavedPickFolder: 'コピーの保存先フォルダを選択', unsavedCopyFailed: '一部のコピーを書き込めませんでした。' },
  ko: { unsavedTitle: '저장되지 않은 변경 사항', unsavedMessage: '노트 {n}개를 보관함에 저장하지 못했습니다.', unsavedTimeout: '노트가 저장되었는지 확인하지 못했습니다.',
    unsavedDetail: '아직 잃은 것은 없습니다. 최신 내용은 초안으로 보관됩니다. 다시 시도하거나, 다른 폴더에 사본을 저장하거나, 닫으면 다음에 열 때 다시 시도합니다.',
    unsavedRetry: '다시 시도', unsavedSaveCopies: '다른 곳에 사본 저장…', unsavedQuit: '닫고 초안 유지', unsavedPickFolder: '사본을 저장할 폴더 선택', unsavedCopyFailed: '일부 사본을 쓰지 못했습니다.' },
  'zh-CN': { unsavedTitle: '有未保存的修改', unsavedMessage: '有 {n} 篇笔记未能保存到仓库。', unsavedTimeout: 'Graphite 无法确认笔记已经保存。',
    unsavedDetail: '目前没有丢失任何内容：最新文字已作为草稿保留。可以重试、另存副本到其他文件夹，或直接关闭，下次打开时会自动重试。',
    unsavedRetry: '重试', unsavedSaveCopies: '另存副本到…', unsavedQuit: '关闭并保留草稿', unsavedPickFolder: '选择保存副本的文件夹', unsavedCopyFailed: '部分副本未能写入。' },
  'zh-TW': { unsavedTitle: '有未儲存的修改', unsavedMessage: '有 {n} 篇筆記未能儲存到儲存庫。', unsavedTimeout: 'Graphite 無法確認筆記已經儲存。',
    unsavedDetail: '目前沒有遺失任何內容：最新文字已作為草稿保留。可以重試、另存副本到其他資料夾，或直接關閉，下次開啟時會自動重試。',
    unsavedRetry: '重試', unsavedSaveCopies: '另存副本到…', unsavedQuit: '關閉並保留草稿', unsavedPickFolder: '選擇儲存副本的資料夾', unsavedCopyFailed: '部分副本未能寫入。' },
};
for (const [lang, d] of Object.entries(UNSAVED)) Object.assign(S[lang], d);

// Map a system locale such as "zh-HK" or "fr-CA" to one of our languages.
function pickLang(locale) {
  const l = String(locale || 'en').toLowerCase();
  if (l.startsWith('zh')) return /tw|hk|mo|hant/.test(l) ? 'zh-TW' : 'zh-CN';
  const base = l.split('-')[0];
  return S[base] ? base : 'en';
}

function strings(lang) {
  const d = S[lang] || S.en;
  return (key, vars = {}) => (d[key] ?? S.en[key]).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

module.exports = { strings, pickLang };
