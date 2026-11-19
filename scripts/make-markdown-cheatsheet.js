// Generates public/help/markdown-<lang>.md (the in-app Markdown cheatsheet) for every language.
// Every example is something Graphite actually understands. Examples are shared; labels are translated.
// Run: node scripts/make-markdown-cheatsheet.js
const fs = require('fs');
const path = require('path');

// Section kinds:  inline = table What | Type | Result (rendered live)
//                 code   = table What | Type (things that need other files, e.g. embeds)
//                 block  = each example as code, followed by the rendered result
const SECTIONS = [
  ['text', 'inline', [
    ['bold', '**bold**'], ['boldAlt', '__bold__'], ['italic', '*italic*'], ['italicAlt', '_italic_'],
    ['boldItalic', '***bold and italic***'], ['strike', '~~strikethrough~~'], ['highlight', '==highlight=='],
    ['code', '`code`'], ['escape', '\\*not italic\\*'], ['comment', 'visible %%hidden%% text'],
  ]],
  ['links', 'inline', [
    ['wiki', '[[Note name]]'], ['alias', '[[Note name|shown text]]'], ['heading', '[[Note name#Heading]]'],
    ['sameHeading', '[[#Heading]]'], ['mdlink', '[Obsidian](https://obsidian.md)'], ['mdnote', '[text](Note%20name.md)'],
    ['autolink', '<https://obsidian.md>'], ['bare', 'https://obsidian.md'], ['tag', '#tag'], ['nested', '#project/ideas'],
  ]],
  ['embeds', 'code', [
    ['embedNote', '![[Note name]]'], ['embedHeading', '![[Note name#Heading]]'], ['embedImg', '![[image.png]]'],
    ['embedImgW', '![[image.png|300]]'], ['mdImg', '![description](image.png)'], ['webImg', '![description](https://example.com/picture.png)'],
    ['pdf', '![[document.pdf]]'], ['audio', '![[recording.mp3]]'], ['video', '![[clip.mp4]]'],
  ]],
  ['headings', 'block', [
    [null, '# Heading 1\n## Heading 2\n### Heading 3\n#### Heading 4\n##### Heading 5\n###### Heading 6'],
  ]],
  ['paragraphs', 'block', [
    [null, 'First paragraph.\nThis line starts on a new line.\n\nA second paragraph after an empty line.'],
  ]],
  ['lists', 'block', [
    ['bullets', '- Apples\n- Pears\n* Stars work too\n+ So do pluses'],
    ['numbers', '1. First\n2. Second\n3. Third'],
    ['nestedList', '- Fruit\n  - Apples\n  - Pears\n    1. Conference\n    2. Williams\n- Vegetables'],
    ['tasks', '- [ ] To do\n- [x] Done\n  - [ ] Sub-task'],
  ]],
  ['quotes', 'block', [
    ['quote', '> The best way to have a good idea\n> is to have lots of ideas.'],
    ['nestedQuote', '> Outer quote\n>> Quote inside a quote'],
    ['callout', '> [!note] Title of the callout\n> Text inside the callout.'],
    ['calloutNoTitle', '> [!tip]\n> Without a title, the type is used as the title.'],
    ['foldClosed', '> [!question]- Click to open\n> Hidden until you open it.'],
    ['foldOpen', '> [!example]+ Click to close\n> Shown, but can be folded.'],
    ['calloutTypes', ['note', 'abstract', 'info', 'todo', 'tip', 'success', 'question', 'warning', 'failure', 'danger', 'bug', 'example', 'quote'].map(t => `> [!${t}]`).join('\n\n')],
  ]],
  ['code', 'block', [
    ['codeBlock', '```python\ndef hello(name):\n    return f"Hello, {name}!"\n```'],
    ['codeTilde', '~~~\nTildes work as fences too.\n~~~'],
  ]],
  ['tables', 'block', [
    ['table', '| Name | Age | City |\n| --- | --- | --- |\n| Ana | 31 | Lisbon |\n| Ben | 27 | Oslo |'],
    ['align', '| Left | Centre | Right |\n| :--- | :---: | ---: |\n| a | b | c |\n| longer text | longer text | longer text |'],
  ]],
  ['other', 'block', [
    ['hr', 'Above the line\n\n---\n\nBelow the line'],
    ['mathInline', 'Einstein: $E = mc^2$'],
    ['mathBlock', '$$\n\\int_0^1 x^2\\,dx = \\frac{1}{3}\n$$'],
  ]],
  ['props', 'code', [
    ['props', '---\ntags: [project, ideas]\naliases: [Other name]\nstatus: active\ncreated: 2026-11-08\n---'],
  ]],
  ['html', 'inline', [
    ['underline', '<u>underline</u>'], ['sup', 'x<sup>2</sup>'], ['sub', 'H<sub>2</sub>O'], ['kbd', '<kbd>Ctrl</kbd> + <kbd>C</kbd>'],
    ['br', 'line one<br>line two'], ['color', '<span style="color:#e93147">red text</span>'], ['details', '<details><summary>More</summary>Hidden text</details>'],
  ]],
];

const L = {
  en: {
    title: 'Markdown cheatsheet',
    intro: 'Everything Graphite understands, with what you type and what you get. **Click any code to copy it.** For formulas, see the **LaTeX** tab.',
    what: 'What', type: 'Type', result: 'Result',
    s: { text: 'Text formatting', links: 'Links and tags', embeds: 'Embeds and images', headings: 'Headings', paragraphs: 'Paragraphs and line breaks', lists: 'Lists and tasks', quotes: 'Quotes and callouts', code: 'Code blocks', tables: 'Tables', other: 'Lines and math', props: 'Properties', html: 'HTML' },
    n: {
      text: '`%%…%%` hides text in Read view; it stays visible while editing.',
      links: 'Links to notes that don’t exist yet look faded; clicking one in a note creates it. `#` starts a tag only when it directly touches a word.',
      embeds: 'These show content from other files in your vault, so they aren’t rendered here. Paste or drop an image into the editor to add it to `attachments/` automatically.',
      headings: 'Put a space after the `#` signs. Headings appear in the Outline panel and can be linked with `[[Note#Heading]]`.',
      paragraphs: 'Leave an empty line between paragraphs. A single line break is kept as a line break.',
      lists: 'Indent with **Tab** (or two spaces) to nest. Press **Enter** to continue a list. Tick tasks by clicking them in Read view.',
      quotes: 'Callout types: `note`, `abstract`, `info`, `todo`, `tip`, `success`, `question`, `warning`, `failure`, `danger`, `bug`, `example`, `quote`. Add `-` (folded) or `+` (open) after the type to make it foldable.',
      code: 'Write the language after the opening fence (`python`, `js`, `bash`…).',
      tables: 'Colons in the second row set the alignment. The outer pipes are optional.',
      other: 'Three or more `-`, `*` or `_` on their own line make a horizontal line. All formula commands are in the **LaTeX** tab.',
      props: 'Must be the very first lines of the note. `tags` adds tags; any other `key: value` is shown in the Properties box at the top of the note.',
      html: 'Simple HTML tags work inside notes.',
    },
    l: {
      bold: 'Bold', boldAlt: 'Bold (other way)', italic: 'Italic', italicAlt: 'Italic (other way)', boldItalic: 'Bold and italic', strike: 'Strikethrough',
      highlight: 'Highlight', code: 'Inline code', escape: 'Show a symbol as-is', comment: 'Hidden comment',
      wiki: 'Link to a note', alias: 'Link with other text', heading: 'Link to a heading', sameHeading: 'Heading in this note', mdlink: 'Web link',
      mdnote: 'Markdown link to a note', autolink: 'Web link in < >', bare: 'Plain web address', tag: 'Tag', nested: 'Nested tag',
      embedNote: 'Embed a whole note', embedHeading: 'Embed one section', embedImg: 'Image from the vault', embedImgW: 'Image with a width (px)',
      mdImg: 'Image (Markdown style)', webImg: 'Image from the web', pdf: 'PDF', audio: 'Audio', video: 'Video',
      bullets: 'Bullet list', numbers: 'Numbered list', nestedList: 'Nested list', tasks: 'Task list',
      quote: 'Quote', nestedQuote: 'Quote inside a quote', callout: 'Callout with a title', calloutNoTitle: 'Callout without a title',
      foldClosed: 'Folded callout', foldOpen: 'Foldable callout, open', calloutTypes: 'All callout types',
      codeBlock: 'Code block with a language', codeTilde: 'Code block with tildes', table: 'Table', align: 'Column alignment',
      hr: 'Horizontal line', mathInline: 'Formula in a sentence', mathBlock: 'Formula on its own line', props: 'Properties',
      underline: 'Underline', sup: 'Superscript', sub: 'Subscript', kbd: 'Keyboard keys', br: 'Line break anywhere', color: 'Coloured text', details: 'Click to show more',
    },
  },
  fr: {
    title: 'Aide-mémoire Markdown',
    intro: 'Tout ce que Graphite comprend, avec ce que vous tapez et ce que vous obtenez. **Cliquez sur un code pour le copier.** Pour les formules, voir l’onglet **LaTeX**.',
    what: 'Élément', type: 'Saisie', result: 'Résultat',
    s: { text: 'Mise en forme du texte', links: 'Liens et étiquettes', embeds: 'Intégrations et images', headings: 'Titres', paragraphs: 'Paragraphes et retours à la ligne', lists: 'Listes et tâches', quotes: 'Citations et encadrés', code: 'Blocs de code', tables: 'Tableaux', other: 'Lignes et formules', props: 'Propriétés', html: 'HTML' },
    n: {
      text: '`%%…%%` masque le texte en mode lecture ; il reste visible pendant l’édition.',
      links: 'Les liens vers des notes inexistantes apparaissent estompés ; cliquer dessus dans une note la crée. `#` ne commence une étiquette que s’il touche directement un mot.',
      embeds: 'Ces éléments affichent le contenu d’autres fichiers du coffre ; ils ne sont donc pas rendus ici. Collez ou déposez une image dans l’éditeur pour l’ajouter automatiquement à `attachments/`.',
      headings: 'Mettez une espace après les `#`. Les titres apparaissent dans le Plan et peuvent être liés avec `[[Note#Titre]]`.',
      paragraphs: 'Laissez une ligne vide entre les paragraphes. Un simple retour à la ligne est conservé.',
      lists: 'Indentez avec **Tab** (ou deux espaces) pour imbriquer. **Entrée** continue la liste. Cochez les tâches en cliquant dessus en mode lecture.',
      quotes: 'Types d’encadrés : `note`, `abstract`, `info`, `todo`, `tip`, `success`, `question`, `warning`, `failure`, `danger`, `bug`, `example`, `quote`. Ajoutez `-` (replié) ou `+` (ouvert) après le type pour le rendre repliable.',
      code: 'Écrivez le langage après la barrière d’ouverture (`python`, `js`, `bash`…).',
      tables: 'Les deux-points de la deuxième ligne règlent l’alignement. Les barres extérieures sont facultatives.',
      other: 'Trois `-`, `*` ou `_` ou plus sur une ligne font une ligne horizontale. Toutes les commandes de formules sont dans l’onglet **LaTeX**.',
      props: 'Doivent être les toutes premières lignes de la note. `tags` ajoute des étiquettes ; toute autre paire `clé: valeur` s’affiche dans l’encadré Propriétés en haut de la note.',
      html: 'Les balises HTML simples fonctionnent dans les notes.',
    },
    l: {
      bold: 'Gras', boldAlt: 'Gras (autre façon)', italic: 'Italique', italicAlt: 'Italique (autre façon)', boldItalic: 'Gras et italique', strike: 'Barré',
      highlight: 'Surlignage', code: 'Code en ligne', escape: 'Afficher un symbole tel quel', comment: 'Commentaire masqué',
      wiki: 'Lien vers une note', alias: 'Lien avec un autre texte', heading: 'Lien vers un titre', sameHeading: 'Titre de cette note', mdlink: 'Lien web',
      mdnote: 'Lien Markdown vers une note', autolink: 'Lien web entre < >', bare: 'Adresse web simple', tag: 'Étiquette', nested: 'Étiquette imbriquée',
      embedNote: 'Intégrer une note entière', embedHeading: 'Intégrer une section', embedImg: 'Image du coffre', embedImgW: 'Image avec largeur (px)',
      mdImg: 'Image (style Markdown)', webImg: 'Image du web', pdf: 'PDF', audio: 'Audio', video: 'Vidéo',
      bullets: 'Liste à puces', numbers: 'Liste numérotée', nestedList: 'Liste imbriquée', tasks: 'Liste de tâches',
      quote: 'Citation', nestedQuote: 'Citation dans une citation', callout: 'Encadré avec titre', calloutNoTitle: 'Encadré sans titre',
      foldClosed: 'Encadré replié', foldOpen: 'Encadré repliable, ouvert', calloutTypes: 'Tous les types d’encadrés',
      codeBlock: 'Bloc de code avec langage', codeTilde: 'Bloc de code avec tildes', table: 'Tableau', align: 'Alignement des colonnes',
      hr: 'Ligne horizontale', mathInline: 'Formule dans une phrase', mathBlock: 'Formule sur sa propre ligne', props: 'Propriétés',
      underline: 'Souligné', sup: 'Exposant', sub: 'Indice', kbd: 'Touches du clavier', br: 'Retour à la ligne n’importe où', color: 'Texte en couleur', details: 'Cliquer pour en voir plus',
    },
  },
  es: {
    title: 'Chuleta de Markdown',
    intro: 'Todo lo que Graphite entiende, con lo que escribes y lo que obtienes. **Haz clic en cualquier código para copiarlo.** Para fórmulas, mira la pestaña **LaTeX**.',
    what: 'Qué', type: 'Escribe', result: 'Resultado',
    s: { text: 'Formato de texto', links: 'Enlaces y etiquetas', embeds: 'Insertar notas e imágenes', headings: 'Encabezados', paragraphs: 'Párrafos y saltos de línea', lists: 'Listas y tareas', quotes: 'Citas y bloques destacados', code: 'Bloques de código', tables: 'Tablas', other: 'Líneas y fórmulas', props: 'Propiedades', html: 'HTML' },
    n: {
      text: '`%%…%%` oculta el texto en la vista de lectura; sigue visible al editar.',
      links: 'Los enlaces a notas que aún no existen se ven atenuados; al hacer clic en uno dentro de una nota, se crea. `#` solo empieza una etiqueta si toca directamente una palabra.',
      embeds: 'Muestran contenido de otros archivos de la bóveda, por eso no se ven aquí. Pega o arrastra una imagen al editor para añadirla a `attachments/` automáticamente.',
      headings: 'Pon un espacio después de los `#`. Los encabezados aparecen en el Esquema y se pueden enlazar con `[[Nota#Encabezado]]`.',
      paragraphs: 'Deja una línea vacía entre párrafos. Un salto de línea simple se conserva.',
      lists: 'Sangra con **Tab** (o dos espacios) para anidar. **Intro** continúa la lista. Marca las tareas haciendo clic en la vista de lectura.',
      quotes: 'Tipos de bloque: `note`, `abstract`, `info`, `todo`, `tip`, `success`, `question`, `warning`, `failure`, `danger`, `bug`, `example`, `quote`. Añade `-` (plegado) o `+` (abierto) tras el tipo para hacerlo plegable.',
      code: 'Escribe el lenguaje tras la valla de apertura (`python`, `js`, `bash`…).',
      tables: 'Los dos puntos de la segunda fila fijan la alineación. Las barras exteriores son opcionales.',
      other: 'Tres o más `-`, `*` o `_` en su propia línea forman una línea horizontal. Todos los comandos de fórmulas están en la pestaña **LaTeX**.',
      props: 'Deben ser las primeras líneas de la nota. `tags` añade etiquetas; cualquier otro `clave: valor` aparece en el recuadro de Propiedades arriba de la nota.',
      html: 'Las etiquetas HTML sencillas funcionan dentro de las notas.',
    },
    l: {
      bold: 'Negrita', boldAlt: 'Negrita (otra forma)', italic: 'Cursiva', italicAlt: 'Cursiva (otra forma)', boldItalic: 'Negrita y cursiva', strike: 'Tachado',
      highlight: 'Resaltado', code: 'Código en línea', escape: 'Mostrar un símbolo tal cual', comment: 'Comentario oculto',
      wiki: 'Enlace a una nota', alias: 'Enlace con otro texto', heading: 'Enlace a un encabezado', sameHeading: 'Encabezado de esta nota', mdlink: 'Enlace web',
      mdnote: 'Enlace Markdown a una nota', autolink: 'Enlace web entre < >', bare: 'Dirección web simple', tag: 'Etiqueta', nested: 'Etiqueta anidada',
      embedNote: 'Insertar una nota entera', embedHeading: 'Insertar una sección', embedImg: 'Imagen de la bóveda', embedImgW: 'Imagen con ancho (px)',
      mdImg: 'Imagen (estilo Markdown)', webImg: 'Imagen de la web', pdf: 'PDF', audio: 'Audio', video: 'Vídeo',
      bullets: 'Lista con viñetas', numbers: 'Lista numerada', nestedList: 'Lista anidada', tasks: 'Lista de tareas',
      quote: 'Cita', nestedQuote: 'Cita dentro de una cita', callout: 'Bloque destacado con título', calloutNoTitle: 'Bloque destacado sin título',
      foldClosed: 'Bloque plegado', foldOpen: 'Bloque plegable, abierto', calloutTypes: 'Todos los tipos de bloque',
      codeBlock: 'Bloque de código con lenguaje', codeTilde: 'Bloque de código con virgulillas', table: 'Tabla', align: 'Alineación de columnas',
      hr: 'Línea horizontal', mathInline: 'Fórmula en una frase', mathBlock: 'Fórmula en su propia línea', props: 'Propiedades',
      underline: 'Subrayado', sup: 'Superíndice', sub: 'Subíndice', kbd: 'Teclas', br: 'Salto de línea en cualquier sitio', color: 'Texto en color', details: 'Clic para ver más',
    },
  },
  ja: {
    title: 'Markdown チートシート',
    intro: 'Graphite で使える書き方の一覧です。入力と表示を並べています。**コードをクリックするとコピーできます。** 数式は **LaTeX** タブを見てください。',
    what: '内容', type: '入力', result: '表示',
    s: { text: '文字の装飾', links: 'リンクとタグ', embeds: '埋め込みと画像', headings: '見出し', paragraphs: '段落と改行', lists: 'リストとタスク', quotes: '引用とコールアウト', code: 'コードブロック', tables: '表', other: '区切り線と数式', props: 'プロパティ', html: 'HTML' },
    n: {
      text: '`%%…%%` で囲んだ文字は閲覧ビューで隠れ、編集中だけ見えます。',
      links: 'まだ存在しないノートへのリンクは薄く表示され、ノート内でクリックするとそのノートが作成されます。`#` は単語に直接付いたときだけタグになります。',
      embeds: '保管庫内の別ファイルを表示するため、ここでは表示していません。画像をエディタに貼り付けるかドロップすると、自動的に `attachments/` に追加されます。',
      headings: '`#` のあとにスペースを入れます。見出しはアウトラインに表示され、`[[ノート#見出し]]` でリンクできます。',
      paragraphs: '段落の間は空行を入れます。1回の改行はそのまま改行として表示されます。',
      lists: '**Tab**（またはスペース2つ）で字下げすると入れ子になります。**Enter** でリストが続きます。タスクは閲覧ビューでクリックしてチェックできます。',
      quotes: 'コールアウトの種類：`note`、`abstract`、`info`、`todo`、`tip`、`success`、`question`、`warning`、`failure`、`danger`、`bug`、`example`、`quote`。種類のあとに `-`（閉じた状態）か `+`（開いた状態）を付けると折りたためます。',
      code: '最初の区切りのあとに言語名（`python`、`js`、`bash` など）を書きます。',
      tables: '2行目のコロンで配置を決めます。両端の `|` は省略できます。',
      other: '`-`、`*`、`_` のいずれかを3つ以上並べた行は区切り線になります。数式のコマンドはすべて **LaTeX** タブにあります。',
      props: 'ノートのいちばん最初に書きます。`tags` でタグを追加し、その他の `キー: 値` はノート上部のプロパティ欄に表示されます。',
      html: '簡単な HTML タグはノートの中で使えます。',
    },
    l: {
      bold: '太字', boldAlt: '太字（別の書き方）', italic: '斜体', italicAlt: '斜体（別の書き方）', boldItalic: '太字＋斜体', strike: '取り消し線',
      highlight: 'ハイライト', code: 'インラインコード', escape: '記号をそのまま表示', comment: '非表示のコメント',
      wiki: 'ノートへのリンク', alias: '別の文字で表示するリンク', heading: '見出しへのリンク', sameHeading: '同じノート内の見出し', mdlink: 'Web リンク',
      mdnote: 'Markdown 形式のノートリンク', autolink: '< > で囲んだ Web リンク', bare: 'URL をそのまま', tag: 'タグ', nested: '階層付きタグ',
      embedNote: 'ノート全体を埋め込む', embedHeading: 'セクションを埋め込む', embedImg: '保管庫の画像', embedImgW: '幅を指定した画像（px）',
      mdImg: '画像（Markdown 形式）', webImg: 'Web 上の画像', pdf: 'PDF', audio: '音声', video: '動画',
      bullets: '箇条書き', numbers: '番号付きリスト', nestedList: '入れ子のリスト', tasks: 'タスクリスト',
      quote: '引用', nestedQuote: '引用の中の引用', callout: 'タイトル付きコールアウト', calloutNoTitle: 'タイトルなしのコールアウト',
      foldClosed: '閉じたコールアウト', foldOpen: '開いた折りたたみコールアウト', calloutTypes: 'すべてのコールアウトの種類',
      codeBlock: '言語を指定したコードブロック', codeTilde: 'チルダのコードブロック', table: '表', align: '列の配置',
      hr: '区切り線', mathInline: '文中の数式', mathBlock: '独立した行の数式', props: 'プロパティ',
      underline: '下線', sup: '上付き文字', sub: '下付き文字', kbd: 'キー表示', br: 'どこでも改行', color: '色付きの文字', details: 'クリックで続きを表示',
    },
  },
  ko: {
    title: 'Markdown 치트시트',
    intro: 'Graphite이 이해하는 모든 문법을 입력과 결과로 정리했습니다. **코드를 클릭하면 복사됩니다.** 수식은 **LaTeX** 탭을 보세요.',
    what: '항목', type: '입력', result: '결과',
    s: { text: '글자 서식', links: '링크와 태그', embeds: '삽입과 이미지', headings: '제목', paragraphs: '문단과 줄바꿈', lists: '목록과 할 일', quotes: '인용과 콜아웃', code: '코드 블록', tables: '표', other: '구분선과 수식', props: '속성', html: 'HTML' },
    n: {
      text: '`%%…%%`로 감싼 글자는 읽기 보기에서 숨겨지고, 편집할 때만 보입니다.',
      links: '아직 없는 노트로 가는 링크는 흐리게 보이며, 노트에서 클릭하면 그 노트가 만들어집니다. `#`은 단어에 바로 붙어 있을 때만 태그가 됩니다.',
      embeds: '보관함의 다른 파일 내용을 보여 주므로 여기서는 표시하지 않습니다. 이미지를 편집기에 붙여넣거나 끌어다 놓으면 자동으로 `attachments/`에 추가됩니다.',
      headings: '`#` 뒤에 공백을 넣으세요. 제목은 개요 패널에 나타나고 `[[노트#제목]]`으로 연결할 수 있습니다.',
      paragraphs: '문단 사이에는 빈 줄을 두세요. 한 번의 줄바꿈은 그대로 줄바꿈으로 유지됩니다.',
      lists: '**Tab**(또는 공백 두 개)으로 들여쓰면 중첩됩니다. **Enter**를 누르면 목록이 이어집니다. 할 일은 읽기 보기에서 클릭해 체크합니다.',
      quotes: '콜아웃 종류: `note`, `abstract`, `info`, `todo`, `tip`, `success`, `question`, `warning`, `failure`, `danger`, `bug`, `example`, `quote`. 종류 뒤에 `-`(접힘)나 `+`(펼침)를 붙이면 접을 수 있습니다.',
      code: '여는 울타리 뒤에 언어 이름(`python`, `js`, `bash` 등)을 씁니다.',
      tables: '둘째 줄의 콜론으로 정렬을 정합니다. 양 끝의 `|`는 생략해도 됩니다.',
      other: '`-`, `*`, `_` 중 하나를 세 개 이상 쓴 줄은 구분선이 됩니다. 수식 명령어는 모두 **LaTeX** 탭에 있습니다.',
      props: '노트의 맨 처음에 써야 합니다. `tags`는 태그를 추가하고, 다른 `키: 값`은 노트 위쪽 속성 상자에 표시됩니다.',
      html: '간단한 HTML 태그는 노트 안에서 쓸 수 있습니다.',
    },
    l: {
      bold: '굵게', boldAlt: '굵게(다른 방법)', italic: '기울임', italicAlt: '기울임(다른 방법)', boldItalic: '굵게 + 기울임', strike: '취소선',
      highlight: '강조 표시', code: '인라인 코드', escape: '기호를 그대로 표시', comment: '숨김 주석',
      wiki: '노트 링크', alias: '다른 글자로 보이는 링크', heading: '제목 링크', sameHeading: '이 노트의 제목', mdlink: '웹 링크',
      mdnote: 'Markdown 형식 노트 링크', autolink: '< >로 감싼 웹 링크', bare: '웹 주소 그대로', tag: '태그', nested: '하위 태그',
      embedNote: '노트 전체 삽입', embedHeading: '한 부분만 삽입', embedImg: '보관함의 이미지', embedImgW: '너비를 정한 이미지(px)',
      mdImg: '이미지(Markdown 형식)', webImg: '웹의 이미지', pdf: 'PDF', audio: '오디오', video: '동영상',
      bullets: '글머리 목록', numbers: '번호 목록', nestedList: '중첩 목록', tasks: '할 일 목록',
      quote: '인용', nestedQuote: '인용 안의 인용', callout: '제목 있는 콜아웃', calloutNoTitle: '제목 없는 콜아웃',
      foldClosed: '접힌 콜아웃', foldOpen: '펼쳐진 접이식 콜아웃', calloutTypes: '모든 콜아웃 종류',
      codeBlock: '언어를 지정한 코드 블록', codeTilde: '물결표 코드 블록', table: '표', align: '열 정렬',
      hr: '구분선', mathInline: '문장 속 수식', mathBlock: '한 줄짜리 수식', props: '속성',
      underline: '밑줄', sup: '위 첨자', sub: '아래 첨자', kbd: '키보드 키', br: '어디서나 줄바꿈', color: '색 있는 글자', details: '클릭해서 더 보기',
    },
  },
  'zh-CN': {
    title: 'Markdown 速查表',
    intro: 'Graphite 支持的全部写法，左边是输入，右边是效果。**点击任意代码即可复制。** 公式请看 **LaTeX** 标签页。',
    what: '内容', type: '输入', result: '效果',
    s: { text: '文字格式', links: '链接和标签', embeds: '嵌入和图片', headings: '标题', paragraphs: '段落和换行', lists: '列表和任务', quotes: '引用和标注框', code: '代码块', tables: '表格', other: '分隔线和公式', props: '属性', html: 'HTML' },
    n: {
      text: '`%%…%%` 中的文字在阅读视图中隐藏，只在编辑时可见。',
      links: '指向尚不存在的笔记的链接显示为淡色，在笔记中点击即可创建该笔记。`#` 只有紧贴文字时才算标签。',
      embeds: '这些会显示仓库中其他文件的内容，所以这里不渲染。把图片粘贴或拖入编辑器，会自动保存到 `attachments/`。',
      headings: '`#` 后面要加空格。标题会显示在大纲中，并可以用 `[[笔记#标题]]` 链接。',
      paragraphs: '段落之间空一行。单个换行会保留为换行。',
      lists: '用 **Tab**（或两个空格）缩进即可嵌套。按 **Enter** 自动续写列表。在阅读视图中点击任务即可勾选。',
      quotes: '标注框类型：`note`、`abstract`、`info`、`todo`、`tip`、`success`、`question`、`warning`、`failure`、`danger`、`bug`、`example`、`quote`。在类型后加 `-`（折叠）或 `+`（展开）可让它可折叠。',
      code: '在开头的围栏后写语言名（`python`、`js`、`bash` 等）。',
      tables: '第二行中的冒号决定对齐方式。两侧的 `|` 可以省略。',
      other: '一行中单独写三个或更多 `-`、`*` 或 `_` 就是分隔线。所有公式命令都在 **LaTeX** 标签页中。',
      props: '必须写在笔记的最开头。`tags` 用来添加标签，其他 `键: 值` 会显示在笔记顶部的属性框中。',
      html: '笔记中可以使用简单的 HTML 标签。',
    },
    l: {
      bold: '粗体', boldAlt: '粗体（另一种写法）', italic: '斜体', italicAlt: '斜体（另一种写法）', boldItalic: '粗斜体', strike: '删除线',
      highlight: '高亮', code: '行内代码', escape: '原样显示符号', comment: '隐藏注释',
      wiki: '链接到笔记', alias: '显示其他文字的链接', heading: '链接到标题', sameHeading: '本笔记中的标题', mdlink: '网页链接',
      mdnote: 'Markdown 格式的笔记链接', autolink: '用 < > 包住的网页链接', bare: '直接写网址', tag: '标签', nested: '多级标签',
      embedNote: '嵌入整篇笔记', embedHeading: '嵌入一个章节', embedImg: '仓库中的图片', embedImgW: '指定宽度的图片（像素）',
      mdImg: '图片（Markdown 格式）', webImg: '网络图片', pdf: 'PDF', audio: '音频', video: '视频',
      bullets: '无序列表', numbers: '有序列表', nestedList: '嵌套列表', tasks: '任务列表',
      quote: '引用', nestedQuote: '引用中的引用', callout: '带标题的标注框', calloutNoTitle: '不带标题的标注框',
      foldClosed: '折叠的标注框', foldOpen: '可折叠、默认展开的标注框', calloutTypes: '全部标注框类型',
      codeBlock: '指定语言的代码块', codeTilde: '用波浪线的代码块', table: '表格', align: '列对齐',
      hr: '分隔线', mathInline: '句子中的公式', mathBlock: '单独一行的公式', props: '属性',
      underline: '下划线', sup: '上标', sub: '下标', kbd: '键盘按键', br: '任意位置换行', color: '彩色文字', details: '点击展开更多',
    },
  },
  'zh-TW': {
    title: 'Markdown 速查表',
    intro: 'Graphite 支援的全部寫法，左邊是輸入，右邊是效果。**點擊任一程式碼即可複製。** 公式請看 **LaTeX** 分頁。',
    what: '內容', type: '輸入', result: '效果',
    s: { text: '文字格式', links: '連結和標籤', embeds: '嵌入和圖片', headings: '標題', paragraphs: '段落和換行', lists: '清單和任務', quotes: '引用和標註框', code: '程式碼區塊', tables: '表格', other: '分隔線和公式', props: '屬性', html: 'HTML' },
    n: {
      text: '`%%…%%` 中的文字在閱讀檢視中隱藏，只在編輯時可見。',
      links: '指向尚不存在之筆記的連結會顯示為淡色，在筆記中點擊即可建立該筆記。`#` 只有緊貼文字時才算標籤。',
      embeds: '這些會顯示儲存庫中其他檔案的內容，所以這裡不呈現。把圖片貼上或拖入編輯器，會自動儲存到 `attachments/`。',
      headings: '`#` 後面要加空格。標題會顯示在大綱中，並可以用 `[[筆記#標題]]` 連結。',
      paragraphs: '段落之間空一行。單一換行會保留為換行。',
      lists: '用 **Tab**（或兩個空格）縮排即可巢狀。按 **Enter** 自動延續清單。在閱讀檢視中點擊任務即可勾選。',
      quotes: '標註框類型：`note`、`abstract`、`info`、`todo`、`tip`、`success`、`question`、`warning`、`failure`、`danger`、`bug`、`example`、`quote`。在類型後加 `-`（收合）或 `+`（展開）可讓它可收合。',
      code: '在開頭的圍欄後寫語言名稱（`python`、`js`、`bash` 等）。',
      tables: '第二列中的冒號決定對齊方式。兩側的 `|` 可以省略。',
      other: '一行中單獨寫三個或更多 `-`、`*` 或 `_` 就是分隔線。所有公式命令都在 **LaTeX** 分頁中。',
      props: '必須寫在筆記的最開頭。`tags` 用來新增標籤，其他 `鍵: 值` 會顯示在筆記頂端的屬性框中。',
      html: '筆記中可以使用簡單的 HTML 標籤。',
    },
    l: {
      bold: '粗體', boldAlt: '粗體（另一種寫法）', italic: '斜體', italicAlt: '斜體（另一種寫法）', boldItalic: '粗斜體', strike: '刪除線',
      highlight: '螢光標記', code: '行內程式碼', escape: '原樣顯示符號', comment: '隱藏註解',
      wiki: '連結到筆記', alias: '顯示其他文字的連結', heading: '連結到標題', sameHeading: '本筆記中的標題', mdlink: '網頁連結',
      mdnote: 'Markdown 格式的筆記連結', autolink: '用 < > 包住的網頁連結', bare: '直接寫網址', tag: '標籤', nested: '多層標籤',
      embedNote: '嵌入整篇筆記', embedHeading: '嵌入一個章節', embedImg: '儲存庫中的圖片', embedImgW: '指定寬度的圖片（像素）',
      mdImg: '圖片（Markdown 格式）', webImg: '網路圖片', pdf: 'PDF', audio: '音訊', video: '影片',
      bullets: '項目清單', numbers: '編號清單', nestedList: '巢狀清單', tasks: '任務清單',
      quote: '引用', nestedQuote: '引用中的引用', callout: '有標題的標註框', calloutNoTitle: '沒有標題的標註框',
      foldClosed: '收合的標註框', foldOpen: '可收合、預設展開的標註框', calloutTypes: '全部標註框類型',
      codeBlock: '指定語言的程式碼區塊', codeTilde: '用波浪號的程式碼區塊', table: '表格', align: '欄位對齊',
      hr: '分隔線', mathInline: '句子中的公式', mathBlock: '單獨一行的公式', props: '屬性',
      underline: '底線', sup: '上標', sub: '下標', kbd: '鍵盤按鍵', br: '任意位置換行', color: '彩色文字', details: '點擊展開更多',
    },
  },
};

// Pipes inside table cells must be escaped; code containing backticks needs a longer fence.
const cellCode = c => { const s = c.replace(/\|/g, '\\|'); return s.includes('`') ? `\`\` ${s} \`\`` : `\`${s}\``; };
const cellResult = c => c.replace(/\|/g, '\\|');

for (const lang of Object.keys(L)) {
  const t = L[lang];
  const out = [`# ${t.title}`, '', t.intro, ''];
  for (const [key, kind, rows] of SECTIONS) {
    out.push(`## ${t.s[key]}`, '');
    if (t.n[key]) out.push(t.n[key], '');
    if (kind === 'inline') {
      out.push(`| ${t.what} | ${t.type} | ${t.result} |`, '| --- | --- | --- |');
      for (const [label, code] of rows) out.push(`| ${t.l[label]} | ${cellCode(code)} | ${cellResult(code)} |`);
      out.push('');
    } else if (kind === 'code' && rows.every(([, c]) => !c.includes('\n'))) {
      out.push(`| ${t.what} | ${t.type} |`, '| --- | --- |');
      for (const [label, code] of rows) out.push(`| ${t.l[label]} | ${cellCode(code)} |`);
      out.push('');
    } else {
      for (const [label, code] of rows) {
        if (label) out.push(`**${t.l[label]}**`, '');
        out.push('~~~~markdown', code, '~~~~', '');
        // The rendered result sits in a box so it is clearly an example (and its headings stay out of the contents list).
        if (kind === 'block') out.push('<div class="md-example">', '', code, '', '</div>', '');
      }
    }
  }
  fs.writeFileSync(path.join(__dirname, '..', 'public', 'help', `markdown-${lang}.md`), out.join('\n'));
}
console.log('Wrote', Object.keys(L).length, 'Markdown cheatsheets');
