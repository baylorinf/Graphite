// Keep the explanatory copy separate from the live command registry. New commands are listed even
// before they have a handbook entry. Group and location identifiers are shared with handbook-actions.
export const GROUPS = ['files', 'writing', 'reading', 'coding', 'review', 'ai', 'settings', 'plugins', 'guides'];
export const PLACES = ['palette', 'tree', 'editor', 'source', 'pdf', 'review', 'graph', 'settings', 'sidebar', 'attachment', 'tabs', 'help', 'topbar'];
export const REQUIREMENTS = ['note', 'pdfNote', 'desktop', 'update', 'history', 'ai', 'plugin', 'review'];

// Order: English, French, Spanish, Japanese, Korean, Simplified Chinese, Traditional Chinese.
const languages = ['en', 'fr', 'es', 'ja', 'ko', 'zh-CN', 'zh-TW'];
const interfaceText = {
  title: ['Feature handbook', 'Manuel des fonctionnalités', 'Manual de funciones', '機能ガイド', '기능 안내서', '功能手册', '功能手冊'],
  search: ['Search the handbook', 'Rechercher dans le manuel', 'Buscar en el manual', 'ガイド内を検索', '안내서 검색', '搜索功能手册', '搜尋功能手冊'],
  placeholder: ['Search a feature, location or shortcut…', 'Fonction, emplacement ou raccourci…', 'Función, ubicación o atajo…', '機能・場所・ショートカットを検索…', '기능, 위치 또는 단축키 검색…', '搜索功能、操作位置或快捷键…', '搜尋功能、操作位置或快速鍵…'],
  all: ['All topics', 'Tous les thèmes', 'Todos los temas', 'すべて', '전체', '全部主题', '全部主題'],
  topics: ['Topics', 'Thèmes', 'Temas', 'トピック', '주제', '学习任务', '學習任務'],
  results: ['Results', 'Résultats', 'Resultados', '検索結果', '결과', '条目', '項目'],
  none: ['No matching features. Try a shorter search or another topic.', 'Aucun résultat. Essayez un mot plus court ou un autre thème.', 'No hay resultados. Prueba con menos palabras u otro tema.', '一致する機能がありません。短い語句や別のトピックで検索してください。', '일치하는 기능이 없습니다. 더 짧은 검색어나 다른 주제를 선택하세요.', '没有找到相关功能。可以缩短关键词，或选择其他主题。', '沒有找到相關功能。可以縮短關鍵字，或選擇其他主題。'],
  reset: ['Show all features', 'Afficher toutes les fonctions', 'Mostrar todas las funciones', 'すべての機能を表示', '모든 기능 보기', '查看全部功能', '查看全部功能'],
  section: ['Read section', 'Lire la section', 'Leer sección', 'この節を読む', '해당 절 읽기', '阅读这一节', '閱讀這一節'],
};
const groups = {
  en: ['Find and organize', 'Write and link notes', 'Read course materials', 'Write code', 'Practice and review', 'Study with AI', 'Configure Graphite', 'Plugin commands', 'Guides and references'],
  fr: ['Rechercher et classer', 'Écrire et relier les notes', 'Lire les cours', 'Écrire du code', 'Pratiquer et réviser', 'Étudier avec l’IA', 'Configurer Graphite', 'Commandes des plugins', 'Guides et références'],
  es: ['Buscar y organizar', 'Escribir y enlazar notas', 'Leer material del curso', 'Escribir código', 'Practicar y repasar', 'Estudiar con IA', 'Configurar Graphite', 'Comandos de complementos', 'Guías y referencias'],
  ja: ['検索と整理', 'ノートの作成とリンク', '教材を読む', 'コードを書く', '練習と復習', 'AI で学ぶ', 'Graphite の設定', 'プラグインのコマンド', 'ガイドと早見表'],
  ko: ['검색과 정리', '노트 작성과 연결', '강의 자료 읽기', '코드 작성', '연습과 복습', 'AI와 학습', 'Graphite 설정', '플러그인 명령', '가이드와 참고 자료'],
  'zh-CN': ['查找与整理', '写笔记与链接', '阅读课程资料', '编写代码', '练习与复习', '用 AI 学习', '配置 Graphite', '插件命令', '指南与速查表'],
  'zh-TW': ['尋找與整理', '寫筆記與連結', '閱讀課程資料', '撰寫程式碼', '練習與複習', '用 AI 學習', '設定 Graphite', '外掛指令', '指南與速查表'],
};
const places = {
  en: ['Command palette', 'File tree', 'Note editor', 'Code editor', 'PDF viewer', 'Review', 'Graph view', 'Settings', 'Sidebar', 'Attachment viewer', 'Tab bar', 'Help', 'Top bar'],
  fr: ['Palette de commandes', 'Arborescence', 'Éditeur de notes', 'Éditeur de code', 'Lecteur PDF', 'Révision', 'Graphe', 'Réglages', 'Barre latérale', 'Aperçu des pièces jointes', 'Barre d’onglets', 'Aide', 'Barre supérieure'],
  es: ['Paleta de comandos', 'Árbol de archivos', 'Editor de notas', 'Editor de código', 'Visor PDF', 'Repaso', 'Grafo', 'Ajustes', 'Barra lateral', 'Visor de adjuntos', 'Barra de pestañas', 'Ayuda', 'Barra superior'],
  ja: ['コマンドパレット', 'ファイルツリー', 'ノートエディター', 'コードエディター', 'PDF ビューアー', '復習', 'グラフ', '設定', 'サイドバー', '添付ファイル', 'タブバー', 'ヘルプ', '上部ツールバー'],
  ko: ['명령 팔레트', '파일 트리', '노트 편집기', '코드 편집기', 'PDF 뷰어', '복습', '그래프', '설정', '사이드바', '첨부 파일 뷰어', '탭 표시줄', '도움말', '상단 도구 모음'],
  'zh-CN': ['命令面板', '文件树', '笔记编辑器', '代码编辑器', 'PDF 阅读器', '复习页', '关系图谱', '设置', '侧边栏', '附件预览', '标签栏', '帮助', '顶部工具栏'],
  'zh-TW': ['指令面板', '檔案樹', '筆記編輯器', '程式碼編輯器', 'PDF 閱讀器', '複習頁', '關係圖譜', '設定', '側邊欄', '附件預覽', '分頁列', '說明', '上方工具列'],
};
const requirements = {
  en: ['Open a Markdown note.', 'Open a PDF or a Markdown note.', 'Desktop app.', 'An update must be available.', 'Requires a previous or next location.', 'Choose an available AI in Settings → AI.', 'Enable the plugin in Settings.', 'Requires questions due for review.'],
  fr: ['Ouvrez une note Markdown.', 'Ouvrez un PDF ou une note Markdown.', 'Application de bureau.', 'Une mise à jour doit être disponible.', 'Un emplacement précédent ou suivant est nécessaire.', 'Choisissez une IA disponible dans Réglages → IA.', 'Activez le plugin dans les réglages.', 'Des questions doivent être à réviser.'],
  es: ['Abre una nota Markdown.', 'Abre un PDF o una nota Markdown.', 'Aplicación de escritorio.', 'Debe haber una actualización disponible.', 'Requiere una ubicación anterior o siguiente.', 'Elige una IA disponible en Ajustes → IA.', 'Activa el complemento en Ajustes.', 'Debe haber preguntas pendientes de repaso.'],
  ja: ['Markdown ノートを開きます。', 'PDF または Markdown ノートを開きます。', 'デスクトップ版で使えます。', '更新が利用可能なときに使えます。', '前後の履歴が必要です。', '設定 → AI で利用できる AI を選びます。', '設定でプラグインを有効にします。', '復習期限を迎えた問題が必要です。'],
  ko: ['Markdown 노트를 여세요.', 'PDF 또는 Markdown 노트를 여세요.', '데스크톱 앱에서 사용할 수 있습니다.', '업데이트가 있어야 합니다.', '이전 또는 다음 방문 위치가 필요합니다.', '설정 → AI에서 사용 가능한 AI를 선택하세요.', '설정에서 플러그인을 켜세요.', '복습할 문제가 필요합니다.'],
  'zh-CN': ['先打开一篇 Markdown 笔记。', '先打开一份 PDF 或一篇 Markdown 笔记。', '在桌面版使用。', '检测到可用更新时出现。', '需要先有相应的浏览历史。', '先在设置 → AI 选择可用的 AI。', '先在设置中启用对应插件。', '需要有待复习的题目。'],
  'zh-TW': ['先開啟一篇 Markdown 筆記。', '先開啟 PDF 或 Markdown 筆記。', '適用於桌面版。', '有可用更新時顯示。', '需要有對應的瀏覽紀錄。', '先在設定 → AI 選擇可用的 AI。', '先在設定中啟用對應的外掛。', '需要有待複習的題目。'],
};

export function handbookWords(language) {
  const lang = languages.includes(language) ? language : 'en';
  const index = languages.indexOf(lang);
  const named = (keys, values) => Object.fromEntries(keys.map((key, i) => [key, values[i]]));
  return {
    ...Object.fromEntries(Object.entries(interfaceText).map(([key, values]) => [key, values[index]])),
    group: named(GROUPS, groups[lang]), place: named(PLACES, places[lang]), req: named(REQUIREMENTS, requirements[lang])
  };
}

// [student task, entry point, prerequisite, English description, Simplified Chinese description, search terms]
export const COMMAND_HELP = {
  'errata-track': ['reading','pdf','','Track errata for the open PDF','跟踪当前 PDF 的勘误','errata track pdf correction 勘误 跟踪'],
  'errata-sources': ['reading','palette','','Manage errata sources','管理勘误来源','errata sources manage 勘误 来源'],
  'sjtu-canvas': ['reading','tabs','','Sign in with jAccount, pull materials from all courses, read the requirements, and choose vault files to submit to an assignment.', '在新标签页打开交大 Canvas，用 jAccount 登录，一键拉取各门课的课件和作业，阅读课程要求，从笔记库选文件提交。', '上海交通大学 课件 下载 拉取 教学平台 大纲 要求 作业 提交 截止时间 日历 交大 Canvas jAccount deadline calendar subscription assignments syllabus materials upload course sync'],
  'snip-region': ['reading','pdf','','Drag a box around a formula, figure or table anywhere in the window, then ask Graphie with the image, turn it into Markdown with $maths$, file it under a section of a note, mark it Not familiar or Interesting, or make a card.', '框选窗口里任意区域（公式、图、表格），然后带图问 Graphie、转成带 $公式$ 的 Markdown、放进笔记的某个小节、标记不熟悉或有意思，或者制卡。', 'screenshot snip capture region OCR formula maths LaTeX copy broken 截图 框选 截屏 公式 识别 转文字 复制乱码 制卡 不熟悉 有意思'],
  'new-code-file': ['coding','tree','','Create a source file in the vault using an extension such as .cpp or .py.', '在笔记库选定的目录里新建 .cpp、.py 等源文件。', 'C++ Python VS Code VSCode programming IDE 编程 源码 作业'],
  'study-reference': ['reading','topbar','pdfNote','Keep a PDF at its current page beside an editable note.', '固定讲义页码，在旁边的笔记里写题解。', 'split side by side lecture reference 分屏 分栏 并排 讲义 对照'],
  'new-note': ['writing','tree','','Create an editable Markdown file in your vault.', '在笔记库中新建可编辑的 Markdown 文件。', 'create markdown 新建文档'],
  'new-folder': ['files','tree','','Name a folder for a course, week or other set of files.', '建立文件夹，用来按课程或章节整理资料。', 'directory 目录'],
  'quick-switcher': ['files','sidebar','','Type part of a note title and open a match.', '输入部分名称，快速打开相应笔记。', 'quick open jump 快速打开 跳转'],
  'palette': ['files','sidebar','','Find an available command by its name and run it.', '按名称查找当前可以使用的命令并运行。', 'commands action launcher 搜命令 操作'],
  'daily': ['writing','sidebar','','Open today’s dated note or create it in Daily Notes.', '打开当天的日记；首次打开会在 Daily Notes 中创建。', 'journal 日志 日记'],
  'random': ['files','sidebar','','Open a randomly selected note from the vault.', '随机打开库中的一篇笔记。', 'shuffle 随机'],
  'graph': ['files','sidebar','','Explore notes and the links between them on a map.', '在图上查看笔记之间的连接。', 'map network graph 知识图谱 关系网'],
  'local-graph': ['files','graph','note','Show the current note and its neighboring links.', '以当前笔记为中心，查看附近的关联。', 'neighbours local graph 局部 关联'],
  'graph-fit': ['files','graph','','Bring the graph into view after panning or zooming.', '移动或缩放图谱后，让节点重新适应窗口。', 'zoom fit 居中 适应'],
  'search': ['files','sidebar','','Search your notes by text, tag, folder path or file name.', '用正文、标签、目录或文件名查找笔记。', 'find full text tag path file 全文搜索 查找 检索'],
  'toggle-mode': ['writing','topbar','note','Switch between reading and your last editing layout.', '在阅读与上次使用的编辑布局间切换。', 'preview read edit 预览'],
  'mode-source': ['writing','topbar','note','Work directly in the Markdown text of the note.', '直接编辑笔记的 Markdown 原文。', 'source raw 编辑模式 源文'],
  'mode-preview': ['writing','topbar','note','Read the rendered note with formatting, links and formulas.', '阅读排版后的文字、链接和公式。', 'preview 预览'],
  'mode-split': ['writing','topbar','note','See the Markdown text and its rendered preview side by side.', '并排查看同一篇笔记的 Markdown 原文和预览。', 'split live preview 分屏 双栏'],
  'rename': ['files','tree','','Give the open note or source file a new name.', '为当前打开的笔记或代码文件更改名称。', 'rename file 改名'],
  'duplicate': ['files','tree','note','Make a separate copy of the current note.', '在笔记库中创建当前笔记的副本。', 'copy 复制 克隆'],
  'delete': ['files','tree','note','Move the current note to the vault’s .trash folder.', '把当前笔记移入库内的 .trash 文件夹。', 'trash remove 回收站 移除 废纸篓'],
  'insert-date': ['writing','editor','note','Place today’s date at the cursor.', '在光标处插入今天的日期。', 'date 日期'],
  'insert-time': ['writing','editor','note','Insert the current local time in the note.', '在光标处插入当前时间。', 'clock 时间'],
  'insert-table': ['writing','editor','note','Start a Markdown table at the cursor.', '在光标处插入 Markdown 表格模板。', 'table grid 表格'],
  'insert-callout': ['writing','editor','note','Insert a callout block for an aside or reminder.', '在光标处添加提示块，用于旁注或提醒。', 'admonition callout 标注框 提示块'],
  'insert-math': ['writing','editor','note','Insert an empty display-math block ready for LaTeX.', '插入可填写 LaTeX 公式的独立数学块。', 'formula equation katex latex 数学 公式'],
  'language': ['settings','settings','','Choose the language used by menus and built-in help.', '切换菜单和内置帮助的显示语言。', 'locale translation 界面语言 翻译'],
  'check-updates': ['settings','settings','desktop','Check whether a newer app version is available.', '检查是否有可安装的新版本。', 'upgrade 版本 更新'],
  'install-update': ['settings','sidebar','update','Install the available Graphite desktop update.', '安装 Graphite 已检测到的桌面更新。', 'upgrade 升级'],
  'toggle-left': ['settings','sidebar','','Show or hide the sidebar with files, search and tags.', '显示或收起文件、搜索和标签所在的侧栏。', 'explorer navigation 左栏'],
  'toggle-right': ['settings','sidebar','','Show or hide the panel for links and the outline.', '显示或收起链接和大纲所在的右侧栏。', 'inspector right sidebar 右栏'],
  'toggle-theme': ['settings','settings','','Switch between light and dark appearance.', '切换浅色与深色外观。', 'night mode dark mode theme 夜间 暗色 主题'],
  'collapse-all': ['files','tree','','Fold every folder in the file tree.', '收起文件树中的所有目录。', 'collapse fold 折叠'],
  'expand-all': ['files','tree','','Expand every folder in the file tree.', '展开文件树中的所有目录。', 'expand unfold 展开'],
  'reload': ['files','palette','','Read the vault again from disk and refresh its file list.', '重新读取磁盘上的库并刷新文件列表。', 'refresh rescan 刷新 重载'],
  'back': ['files','topbar','history','Return to the previous place in your navigation history.', '返回刚才浏览的位置。', 'previous 后退 返回'],
  'forward': ['files','topbar','history','Revisit the next place after going back.', '后退后重新前往下一个浏览位置。', 'next 前进'],
  'help': ['guides','help','','Open the built-in help pages.', '打开 Graphite 的内置帮助。', 'guide manual handbook 帮助 指南 手册'],
  'feature-handbook': ['guides','help','','Search features by task, name, location or shortcut.', '根据学习任务、名称、入口或快捷键查找功能。', 'feature manual handbook directory 功能目录 功能大全 功能手册'],
  'markdown-cheatsheet': ['guides','help','','Look up Markdown syntax with rendered examples.', '查看 Markdown 语法及其渲染示例。', 'syntax markdown reference 速查 语法'],
  'latex-cheatsheet': ['guides','help','','Look up LaTeX symbols and examples for a formula.', '按符号和示例查找公式所需的 LaTeX 写法。', 'tex math equation 速查 数学 符号'],
  'review': ['review','sidebar','','See today’s review, mistake book and saved PDF cards.', '打开复习页，查看当天复习、错题本和 PDF 卡片。', 'dashboard mistake book flashcards 错题本 卡片'],
  'start-review': ['review','review','review','Start the review session and rate each answer to schedule the next one.', '开始当日复习，答题后评分以安排下次复习。', 'spaced repetition review 间隔重复 到期'],
  'check-note': ['ai','topbar','note','See suggested fixes with reasons, then choose which ones to apply.', '查看对笔记的修改建议和理由，选择要应用的改动。', 'proofread mistakes spelling 校对 检查'],
  'tidy-format': ['ai','topbar','note','Preview changes that make this note match the format of its folder.', '参考同目录笔记的格式，先预览再应用整理建议。', 'format tidy formatting 排版 格式化'],
  'revision-plan': ['ai','review','ai','Choose an exam date, chapters and daily study time to generate a plan.', '选定考试日期、章节和每日学习时间，生成复习计划。', 'schedule study plan exam timetable 备考 规划'],
  'mock-paper': ['ai','review','ai','Generate a practice paper for a course and its selected scope.', '根据课程及选定范围生成模拟试卷。', 'practice test exam mock 模拟题 模拟卷'],
  'exam-analysis': ['ai','review','ai','Analyze a paper or page range and relate its questions to your course notes.', '分析整张试卷或指定页，并把题目与课程笔记联系起来。', 'analyze exam paper OCR 扫描 分析卷子'],
  'find-course-files': ['ai','settings','ai','Look for new files in allowed course folders and review the proposed imports.', '扫描允许读取的课程目录，查看待导入的文件。', 'import deepseek harness agent scan 导入 课件 扫描'],
  'file-inbox': ['ai','settings','ai','Ask the selected assistant to organize captured items into notes.', '使用选定的助手，将收件箱中的摘录整理到笔记。', 'capture inbox deepseek harness 收件箱 归档 摘录'],
  'quiz-note': ['review','topbar','note','Practice questions based on the open note.', '用当前笔记生成的题目进行自测。', 'quiz flashcards recall 自测 问答'],
  'settings': ['settings','sidebar','','Manage your vault, appearance, review, AI and plugins.', '管理笔记库、外观、复习、AI 和插件。', 'preferences options 偏好 配置'],
  'reload-plugins': ['plugins','settings','','Load enabled plugins again, for example after updating their files.', '更新插件文件后，可重新载入已启用的插件。', 'extensions reload 插件 扩展'],
  'summarize-pdf': ['reading','pdf','ai','Turn a PDF (or a page range) into an editable note: points by section, key concepts and formulas, each linking to its page. Also in the file tree’s right-click menu.', '把一份 PDF（或指定页）总结成可编辑笔记：按章节列要点、关键概念和公式，每条都能跳回原页。文件树右键菜单里也有。', 'summary summarize lecture slides chapter notes page link 总结 摘要 讲义 课件 页码 回链'],
  'study-settings': ['settings','settings','','Set course folders, course names, folders to leave out or keep read-only, your study record folder, a few words about you and your languages, once for every AI (Claude Code, DeepSeek Harness, Codex CLI, API models).', '统一设置课程目录、课程名称映射、跳过/只读目录、学习档案位置、个人简介和语言，所有 AI（Claude Code、DeepSeek Harness、Codex CLI、API 模型）共用。', 'study settings profile agent framework Claude Code DeepSeek Harness Codex course folders language read-only 学习设置 多 Agent 框架 执行者 课程目录 只读 语言 简介'],
  'ai-settings': ['ai','settings','','Choose who does each job (Claude Code, DeepSeek Harness, Codex CLI or an API model), see whether each local framework is installed, and add API keys.', '为每项任务选择执行者（Claude Code、DeepSeek Harness、Codex CLI 或 API 模型），查看本地框架是否已安装，并填写 API 密钥。', 'AI settings executor framework DeepSeek Harness Codex Claude Code API key model 执行者 框架 密钥 模型'],
};

