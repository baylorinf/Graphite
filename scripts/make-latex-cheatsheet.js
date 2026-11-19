// Generates public/help/latex-<lang>.md (the in-app LaTeX cheatsheet) for every language.
// The LaTeX examples are shared; only headings and explanations are translated.
// Run: node scripts/make-latex-cheatsheet.js
const fs = require('fs');
const path = require('path');

// [section key, examples per table row, examples, how to show the result]
const SECTIONS = [
  ['scripts', 3, ['x^2', 'x_i', 'x_{ij}^{2}', 'e^{i\\pi}', '\\frac{a}{b}', '\\tfrac{1}{2}', '\\sqrt{x}', '\\sqrt[3]{x}', '\\binom{n}{k}']],
  ['greek', 4, ['\\alpha', '\\beta', '\\gamma', '\\delta', '\\epsilon', '\\varepsilon', '\\theta', '\\lambda', '\\mu', '\\pi', '\\rho', '\\sigma', '\\tau', '\\phi', '\\varphi', '\\omega', '\\Gamma', '\\Delta', '\\Theta', '\\Lambda', '\\Pi', '\\Sigma', '\\Phi', '\\Omega']],
  ['ops', 4, ['\\times', '\\div', '\\pm', '\\cdot', '\\le', '\\ge', '\\ne', '\\approx', '\\equiv', '\\sim', '\\propto', '\\ll', '\\infty', '\\partial', '\\nabla', '90^\\circ']],
  ['sets', 4, ['\\in', '\\notin', '\\subset', '\\subseteq', '\\cup', '\\cap', '\\setminus', '\\emptyset', '\\forall', '\\exists', '\\neg', '\\land', '\\to', '\\Rightarrow', '\\Leftrightarrow', '\\mapsto', '\\mathbb{N}', '\\mathbb{Z}', '\\mathbb{R}', '\\mathbb{C}']],
  ['arrows', 4, ['\\leftarrow', '\\rightarrow', '\\leftrightarrow', '\\longrightarrow', '\\Leftarrow', '\\implies', '\\iff', '\\uparrow', '\\downarrow', '\\hookrightarrow', '\\rightleftharpoons', '\\xrightarrow{f}']],
  ['dots', 4, ['\\ldots', '\\cdots', '\\vdots', '\\ddots', "f'(x)", "f''(x)", '\\therefore', '\\because']],
  ['big', 1,['\\sum_{i=1}^{n} i', '\\prod_{k=1}^{n} k', '\\int_a^b f(x)\\,dx', '\\iint_D f\\,dA', '\\oint_C \\vec{F} \\cdot d\\vec{r}', '\\lim_{x \\to 0} \\frac{\\sin x}{x}', '\\max_{x \\in S} f(x)'], 'display'],
  ['funcs', 3, ['\\sin x', '\\cos x', '\\tan x', '\\log x', '\\ln x', '\\exp x', '\\arcsin x', '\\sinh x', '\\det A']],
  ['brackets', 2, ['\\left( \\frac{a}{b} \\right)', '\\left[ x \\right]', '\\{ a, b \\}', '\\langle u, v \\rangle', '\\lvert x \\rvert', '\\lVert v \\rVert', '\\lfloor x \\rfloor', '\\lceil x \\rceil', '\\big( \\Big( \\bigg( \\Bigg(', '\\left. \\frac{df}{dx} \\right\\rvert_{x=0}']],
  ['stack', 2, ['\\overset{!}{=}', '\\underset{x}{\\arg\\min}', '\\stackrel{\\text{def}}{=}', '\\not\\subset', '\\operatorname{rank} A', 'a \\equiv b \\pmod{n}', 'a \\bmod b', '\\gcd(a, b)']],
  ['accents', 3, ['\\hat{x}', '\\bar{x}', '\\vec{v}', '\\dot{x}', '\\ddot{x}', '\\tilde{x}', '\\overline{AB}', '\\underline{x}', '\\overrightarrow{AB}', '\\mathbf{v}', '\\mathbb{R}', '\\mathcal{L}', '\\mathrm{d}x', '\\boldsymbol{\\alpha}', '\\mathit{diff}', '\\mathsf{A}', '\\mathtt{A}', '\\mathfrak{g}', '\\text{if } x > 0']],
  ['matrices', 0, ['\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', '\\begin{bmatrix} 1 & 0 \\\\ 0 & 1 \\end{bmatrix}', '\\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix}']],
  ['multiline', 0, ['\\begin{aligned}\n(a+b)^2 &= a^2 + 2ab + b^2 \\\\\n&\\ge 4ab\n\\end{aligned}', 'f(x) = \\begin{cases}\nx & \\text{if } x \\ge 0 \\\\\n-x & \\text{if } x < 0\n\\end{cases}', '\\begin{gathered}\na = b + c \\\\\nd = e - f\n\\end{gathered}', '\\begin{array}{c|cc}\n\\times & 1 & 2 \\\\ \\hline\n1 & 1 & 2 \\\\\n2 & 2 & 4\n\\end{array}']],
  ['chem', 1, ['\\ce{H2O}', '\\ce{2H2 + O2 -> 2H2O}', '\\ce{CO2 + H2O <=> H2CO3}', '\\ce{^{14}_{6}C}', '\\ce{SO4^2-}', '\\ce{Fe^3+}']],
  ['spacing', 2, ['a\\,b', 'a\\;b', 'a\\quad b', 'a\\qquad b']],
  ['extras', 1, ['\\textcolor{red}{x^2}', '\\boxed{E = mc^2}', '\\cancel{x}', '\\underbrace{a + b}_{n}', '\\overbrace{x + y}^{2}'], 'display'],
];

const L = {
  en: {
    title: 'LaTeX cheatsheet', back: '← Back to the guide',
    intro: 'Write formulas between `$ … $` to keep them in the sentence, or put `$$` on the lines before and after to show them on their own line. **Click any code to copy it.**',
    type: 'Type', result: 'Result',
    s: { scripts: 'Powers, indices, fractions and roots', greek: 'Greek letters', ops: 'Operators and relations', sets: 'Sets, logic and arrows', big: 'Sums, integrals and limits', funcs: 'Functions', brackets: 'Brackets that grow', accents: 'Accents and letter styles', matrices: 'Matrices', multiline: 'Several lines and cases', chem: 'Chemistry', spacing: 'Spacing', extras: 'Colour, boxes and braces' },
    n: { big: 'In a `$$` block the limits go above and below the symbol, as shown here.', brackets: '`\\left` and `\\right` make brackets grow with what is inside.', matrices: 'Use these inside a `$$` block. `&` separates columns and `\\\\` starts a new row.', multiline: '`&` lines the rows up at that point. `\\\\` starts a new line.', chem: '`\\ce{…}` writes chemical formulas and reactions.', accents: '`\\text{…}` writes normal words inside a formula.' },
  },
  fr: {
    title: 'Aide-mémoire LaTeX', back: '← Retour au guide',
    intro: 'Écrivez les formules entre `$ … $` pour les garder dans la phrase, ou placez `$$` sur les lignes avant et après pour les afficher sur leur propre ligne. **Cliquez sur un code pour le copier.**',
    type: 'Saisie', result: 'Résultat',
    s: { scripts: 'Puissances, indices, fractions et racines', greek: 'Lettres grecques', ops: 'Opérateurs et relations', sets: 'Ensembles, logique et flèches', big: 'Sommes, intégrales et limites', funcs: 'Fonctions', brackets: 'Parenthèses extensibles', accents: 'Accents et styles de lettres', matrices: 'Matrices', multiline: 'Plusieurs lignes et cas', chem: 'Chimie', spacing: 'Espacement', extras: 'Couleur, cadres et accolades' },
    n: { big: 'Dans un bloc `$$`, les bornes se placent au-dessus et au-dessous du symbole, comme ici.', brackets: '`\\left` et `\\right` adaptent la taille des parenthèses à leur contenu.', matrices: 'À utiliser dans un bloc `$$`. `&` sépare les colonnes et `\\\\` commence une nouvelle ligne.', multiline: '`&` aligne les lignes à cet endroit. `\\\\` commence une nouvelle ligne.', chem: '`\\ce{…}` écrit des formules et réactions chimiques.', accents: '`\\text{…}` écrit des mots normaux dans une formule.' },
  },
  es: {
    title: 'Chuleta de LaTeX', back: '← Volver a la guía',
    intro: 'Escribe las fórmulas entre `$ … $` para mantenerlas en la frase, o pon `$$` en las líneas de antes y después para mostrarlas en su propia línea. **Haz clic en cualquier código para copiarlo.**',
    type: 'Escribe', result: 'Resultado',
    s: { scripts: 'Potencias, subíndices, fracciones y raíces', greek: 'Letras griegas', ops: 'Operadores y relaciones', sets: 'Conjuntos, lógica y flechas', big: 'Sumas, integrales y límites', funcs: 'Funciones', brackets: 'Paréntesis que crecen', accents: 'Acentos y estilos de letra', matrices: 'Matrices', multiline: 'Varias líneas y casos', chem: 'Química', spacing: 'Espaciado', extras: 'Color, recuadros y llaves' },
    n: { big: 'En un bloque `$$`, los límites van encima y debajo del símbolo, como aquí.', brackets: '`\\left` y `\\right` hacen que los paréntesis crezcan con su contenido.', matrices: 'Úsalas dentro de un bloque `$$`. `&` separa columnas y `\\\\` empieza una fila nueva.', multiline: '`&` alinea las filas en ese punto. `\\\\` empieza una línea nueva.', chem: '`\\ce{…}` escribe fórmulas y reacciones químicas.', accents: '`\\text{…}` escribe palabras normales dentro de una fórmula.' },
  },
  ja: {
    title: 'LaTeX チートシート', back: '← ガイドに戻る',
    intro: '数式を `$ … $` で囲むと文中に、前後の行に `$$` を置くと独立した行に表示されます。**コードをクリックするとコピーできます。**',
    type: '入力', result: '表示',
    s: { scripts: 'べき乗・添字・分数・根号', greek: 'ギリシャ文字', ops: '演算子と関係', sets: '集合・論理・矢印', big: '総和・積分・極限', funcs: '関数', brackets: '伸びるかっこ', accents: 'アクセントと書体', matrices: '行列', multiline: '複数行と場合分け', chem: '化学式', spacing: '空白', extras: '色・枠・括弧' },
    n: { big: '`$$` ブロックの中では、ここにあるように上下に範囲が付きます。', brackets: '`\\left` と `\\right` を付けると、中身に合わせてかっこが伸びます。', matrices: '`$$` ブロックの中で使います。`&` で列を、`\\\\` で行を区切ります。', multiline: '`&` の位置で各行がそろいます。`\\\\` で改行します。', chem: '`\\ce{…}` で化学式や反応式を書けます。', accents: '`\\text{…}` で数式の中にふつうの文字を書けます。' },
  },
  ko: {
    title: 'LaTeX 치트시트', back: '← 가이드로 돌아가기',
    intro: '수식을 `$ … $`로 감싸면 문장 안에, 앞뒤 줄에 `$$`를 두면 별도의 줄에 표시됩니다. **코드를 클릭하면 복사됩니다.**',
    type: '입력', result: '결과',
    s: { scripts: '거듭제곱·첨자·분수·근호', greek: '그리스 문자', ops: '연산자와 관계', sets: '집합·논리·화살표', big: '합·적분·극한', funcs: '함수', brackets: '크기가 바뀌는 괄호', accents: '악센트와 글꼴', matrices: '행렬', multiline: '여러 줄과 경우 나누기', chem: '화학식', spacing: '간격', extras: '색·상자·중괄호' },
    n: { big: '`$$` 블록 안에서는 여기처럼 범위가 기호 위아래에 붙습니다.', brackets: '`\\left`와 `\\right`를 쓰면 괄호가 내용에 맞게 커집니다.', matrices: '`$$` 블록 안에서 사용하세요. `&`는 열을, `\\\\`는 행을 나눕니다.', multiline: '`&` 위치에서 줄이 정렬됩니다. `\\\\`는 줄을 바꿉니다.', chem: '`\\ce{…}`로 화학식과 반응식을 씁니다.', accents: '`\\text{…}`로 수식 안에 일반 글자를 씁니다.' },
  },
  'zh-CN': {
    title: 'LaTeX 速查表', back: '← 返回使用指南',
    intro: '用 `$ … $` 包住公式会显示在句子中；在公式前后各放一行 `$$` 会单独成行显示。**点击任意代码即可复制。**',
    type: '输入', result: '效果',
    s: { scripts: '上标、下标、分数和根号', greek: '希腊字母', ops: '运算符和关系', sets: '集合、逻辑和箭头', big: '求和、积分和极限', funcs: '函数', brackets: '自动伸缩的括号', accents: '重音符号和字体', matrices: '矩阵', multiline: '多行与分段', chem: '化学式', spacing: '间距', extras: '颜色、方框和括注' },
    n: { big: '在 `$$` 块中，上下限会像这里一样写在符号的上方和下方。', brackets: '加上 `\\left` 和 `\\right`，括号会随内容自动变大。', matrices: '在 `$$` 块中使用。`&` 分隔列，`\\\\` 换到下一行。', multiline: '各行会在 `&` 处对齐，`\\\\` 换行。', chem: '`\\ce{…}` 用来书写化学式和化学反应。', accents: '`\\text{…}` 可在公式中写普通文字。' },
  },
  'zh-TW': {
    title: 'LaTeX 速查表', back: '← 返回使用指南',
    intro: '用 `$ … $` 包住公式會顯示在句子中；在公式前後各放一行 `$$` 會單獨成行顯示。**點擊任一程式碼即可複製。**',
    type: '輸入', result: '效果',
    s: { scripts: '上標、下標、分數和根號', greek: '希臘字母', ops: '運算子和關係', sets: '集合、邏輯和箭頭', big: '求和、積分和極限', funcs: '函數', brackets: '自動伸縮的括號', accents: '重音符號和字體', matrices: '矩陣', multiline: '多行與分段', chem: '化學式', spacing: '間距', extras: '顏色、方框和括註' },
    n: { big: '在 `$$` 區塊中，上下限會像這裡一樣寫在符號的上方和下方。', brackets: '加上 `\\left` 和 `\\right`，括號會隨內容自動變大。', matrices: '在 `$$` 區塊中使用。`&` 分隔欄，`\\\\` 換到下一列。', multiline: '各行會在 `&` 處對齊，`\\\\` 換行。', chem: '`\\ce{…}` 用來書寫化學式和化學反應。', accents: '`\\text{…}` 可在公式中寫一般文字。' },
  },
};

// Sections added later: arrows, dots, stacking.
const EXTRA = {
  en: { s: { arrows: 'Arrows', dots: 'Dots, primes and logic', stack: 'Stacking, negation and named operators' }, n: { stack: '`\\operatorname{…}` writes your own function name in upright letters. `\\not` crosses out the symbol after it.' } },
  fr: { s: { arrows: 'Flèches', dots: 'Points, primes et logique', stack: 'Superposition, négation et opérateurs nommés' }, n: { stack: '`\\operatorname{…}` écrit votre propre nom de fonction en lettres droites. `\\not` barre le symbole qui suit.' } },
  es: { s: { arrows: 'Flechas', dots: 'Puntos, primas y lógica', stack: 'Apilar, negar y operadores con nombre' }, n: { stack: '`\\operatorname{…}` escribe tu propio nombre de función en letra recta. `\\not` tacha el símbolo siguiente.' } },
  ja: { s: { arrows: '矢印', dots: '点・プライム・論理', stack: '重ね書き・否定・名前付き演算子' }, n: { stack: '`\\operatorname{…}` で独自の関数名を立体で書けます。`\\not` は直後の記号に斜線を引きます。' } },
  ko: { s: { arrows: '화살표', dots: '점·프라임·논리', stack: '겹쳐 쓰기·부정·이름 있는 연산자' }, n: { stack: '`\\operatorname{…}`로 직접 만든 함수 이름을 바른 글꼴로 씁니다. `\\not`은 뒤에 오는 기호에 사선을 긋습니다.' } },
  'zh-CN': { s: { arrows: '箭头', dots: '省略号、撇号和逻辑', stack: '上下叠放、否定和命名运算符' }, n: { stack: '`\\operatorname{…}` 用正体书写自定义函数名。`\\not` 会在后面的符号上加斜线。' } },
  'zh-TW': { s: { arrows: '箭頭', dots: '省略號、撇號和邏輯', stack: '上下疊放、否定和具名運算子' }, n: { stack: '`\\operatorname{…}` 用正體書寫自訂函數名稱。`\\not` 會在後面的符號上加斜線。' } },
};
for (const [lang, x] of Object.entries(EXTRA)) { Object.assign(L[lang].s, x.s); Object.assign(L[lang].n, x.n); }

function table(items, perRow, lang, display) {
  const head = Array(perRow).fill(`${L[lang].type} | ${L[lang].result}`).join(' | ');
  const sep = Array(perRow).fill('--- | :---:').join(' | ');
  const rows = [];
  for (let i = 0; i < items.length; i += perRow) {
    const cells = items.slice(i, i + perRow).map(c => `\`${c}\` | $${display ? '\\displaystyle ' : ''}${c}$`);
    while (cells.length < perRow) cells.push(' | ');
    rows.push(`| ${cells.join(' | ')} |`);
  }
  return [`| ${head} |`, `| ${sep} |`, ...rows].join('\n');
}

for (const lang of Object.keys(L)) {
  const t = L[lang];
  const out = [`# ${t.title}`, '', t.intro, ''];
  for (const [key, perRow, items, mode] of SECTIONS) {
    out.push(`## ${t.s[key]}`, '');
    if (t.n[key]) out.push(t.n[key], '');
    if (perRow) out.push(table(items, perRow, lang, mode === 'display'), '');
    else for (const code of items) out.push('```latex', code, '```', '', '$$', code, '$$', '');
  }
  fs.writeFileSync(path.join(__dirname, '..', 'public', 'help', `latex-${lang}.md`), out.join('\n'));
}
console.log('Wrote', Object.keys(L).length, 'cheatsheets');
