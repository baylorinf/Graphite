# Markdown チートシート

Graphite で使える書き方の一覧です。入力と表示を並べています。**コードをクリックするとコピーできます。** 数式は **LaTeX** タブを見てください。

## 文字の装飾

`%%…%%` で囲んだ文字は閲覧ビューで隠れ、編集中だけ見えます。

| 内容 | 入力 | 表示 |
| --- | --- | --- |
| 太字 | `**bold**` | **bold** |
| 太字（別の書き方） | `__bold__` | __bold__ |
| 斜体 | `*italic*` | *italic* |
| 斜体（別の書き方） | `_italic_` | _italic_ |
| 太字＋斜体 | `***bold and italic***` | ***bold and italic*** |
| 取り消し線 | `~~strikethrough~~` | ~~strikethrough~~ |
| ハイライト | `==highlight==` | ==highlight== |
| インラインコード | `` `code` `` | `code` |
| 記号をそのまま表示 | `\*not italic\*` | \*not italic\* |
| 非表示のコメント | `visible %%hidden%% text` | visible %%hidden%% text |

## リンクとタグ

まだ存在しないノートへのリンクは薄く表示され、ノート内でクリックするとそのノートが作成されます。`#` は単語に直接付いたときだけタグになります。

| 内容 | 入力 | 表示 |
| --- | --- | --- |
| ノートへのリンク | `[[Note name]]` | [[Note name]] |
| 別の文字で表示するリンク | `[[Note name\|shown text]]` | [[Note name\|shown text]] |
| 見出しへのリンク | `[[Note name#Heading]]` | [[Note name#Heading]] |
| 同じノート内の見出し | `[[#Heading]]` | [[#Heading]] |
| Web リンク | `[Obsidian](https://obsidian.md)` | [Obsidian](https://obsidian.md) |
| Markdown 形式のノートリンク | `[text](Note%20name.md)` | [text](Note%20name.md) |
| < > で囲んだ Web リンク | `<https://obsidian.md>` | <https://obsidian.md> |
| URL をそのまま | `https://obsidian.md` | https://obsidian.md |
| タグ | `#tag` | #tag |
| 階層付きタグ | `#project/ideas` | #project/ideas |

## 埋め込みと画像

保管庫内の別ファイルを表示するため、ここでは表示していません。画像をエディタに貼り付けるかドロップすると、自動的に `attachments/` に追加されます。

| 内容 | 入力 |
| --- | --- |
| ノート全体を埋め込む | `![[Note name]]` |
| セクションを埋め込む | `![[Note name#Heading]]` |
| 保管庫の画像 | `![[image.png]]` |
| 幅を指定した画像（px） | `![[image.png\|300]]` |
| 画像（Markdown 形式） | `![description](image.png)` |
| Web 上の画像 | `![description](https://example.com/picture.png)` |
| PDF | `![[document.pdf]]` |
| 音声 | `![[recording.mp3]]` |
| 動画 | `![[clip.mp4]]` |

## 見出し

`#` のあとにスペースを入れます。見出しはアウトラインに表示され、`[[ノート#見出し]]` でリンクできます。

~~~~markdown
# Heading 1
## Heading 2
### Heading 3
#### Heading 4
##### Heading 5
###### Heading 6
~~~~

<div class="md-example">

# Heading 1
## Heading 2
### Heading 3
#### Heading 4
##### Heading 5
###### Heading 6

</div>

## 段落と改行

段落の間は空行を入れます。1回の改行はそのまま改行として表示されます。

~~~~markdown
First paragraph.
This line starts on a new line.

A second paragraph after an empty line.
~~~~

<div class="md-example">

First paragraph.
This line starts on a new line.

A second paragraph after an empty line.

</div>

## リストとタスク

**Tab**（またはスペース2つ）で字下げすると入れ子になります。**Enter** でリストが続きます。タスクは閲覧ビューでクリックしてチェックできます。

**箇条書き**

~~~~markdown
- Apples
- Pears
* Stars work too
+ So do pluses
~~~~

<div class="md-example">

- Apples
- Pears
* Stars work too
+ So do pluses

</div>

**番号付きリスト**

~~~~markdown
1. First
2. Second
3. Third
~~~~

<div class="md-example">

1. First
2. Second
3. Third

</div>

**入れ子のリスト**

~~~~markdown
- Fruit
  - Apples
  - Pears
    1. Conference
    2. Williams
- Vegetables
~~~~

<div class="md-example">

- Fruit
  - Apples
  - Pears
    1. Conference
    2. Williams
- Vegetables

</div>

**タスクリスト**

~~~~markdown
- [ ] To do
- [x] Done
  - [ ] Sub-task
~~~~

<div class="md-example">

- [ ] To do
- [x] Done
  - [ ] Sub-task

</div>

## 引用とコールアウト

コールアウトの種類：`note`、`abstract`、`info`、`todo`、`tip`、`success`、`question`、`warning`、`failure`、`danger`、`bug`、`example`、`quote`。種類のあとに `-`（閉じた状態）か `+`（開いた状態）を付けると折りたためます。

**引用**

~~~~markdown
> The best way to have a good idea
> is to have lots of ideas.
~~~~

<div class="md-example">

> The best way to have a good idea
> is to have lots of ideas.

</div>

**引用の中の引用**

~~~~markdown
> Outer quote
>> Quote inside a quote
~~~~

<div class="md-example">

> Outer quote
>> Quote inside a quote

</div>

**タイトル付きコールアウト**

~~~~markdown
> [!note] Title of the callout
> Text inside the callout.
~~~~

<div class="md-example">

> [!note] Title of the callout
> Text inside the callout.

</div>

**タイトルなしのコールアウト**

~~~~markdown
> [!tip]
> Without a title, the type is used as the title.
~~~~

<div class="md-example">

> [!tip]
> Without a title, the type is used as the title.

</div>

**閉じたコールアウト**

~~~~markdown
> [!question]- Click to open
> Hidden until you open it.
~~~~

<div class="md-example">

> [!question]- Click to open
> Hidden until you open it.

</div>

**開いた折りたたみコールアウト**

~~~~markdown
> [!example]+ Click to close
> Shown, but can be folded.
~~~~

<div class="md-example">

> [!example]+ Click to close
> Shown, but can be folded.

</div>

**すべてのコールアウトの種類**

~~~~markdown
> [!note]

> [!abstract]

> [!info]

> [!todo]

> [!tip]

> [!success]

> [!question]

> [!warning]

> [!failure]

> [!danger]

> [!bug]

> [!example]

> [!quote]
~~~~

<div class="md-example">

> [!note]

> [!abstract]

> [!info]

> [!todo]

> [!tip]

> [!success]

> [!question]

> [!warning]

> [!failure]

> [!danger]

> [!bug]

> [!example]

> [!quote]

</div>

## コードブロック

最初の区切りのあとに言語名（`python`、`js`、`bash` など）を書きます。

**言語を指定したコードブロック**

~~~~markdown
```python
def hello(name):
    return f"Hello, {name}!"
```
~~~~

<div class="md-example">

```python
def hello(name):
    return f"Hello, {name}!"
```

</div>

**チルダのコードブロック**

~~~~markdown
~~~
Tildes work as fences too.
~~~
~~~~

<div class="md-example">

~~~
Tildes work as fences too.
~~~

</div>

## 表

2行目のコロンで配置を決めます。両端の `|` は省略できます。

**表**

~~~~markdown
| Name | Age | City |
| --- | --- | --- |
| Ana | 31 | Lisbon |
| Ben | 27 | Oslo |
~~~~

<div class="md-example">

| Name | Age | City |
| --- | --- | --- |
| Ana | 31 | Lisbon |
| Ben | 27 | Oslo |

</div>

**列の配置**

~~~~markdown
| Left | Centre | Right |
| :--- | :---: | ---: |
| a | b | c |
| longer text | longer text | longer text |
~~~~

<div class="md-example">

| Left | Centre | Right |
| :--- | :---: | ---: |
| a | b | c |
| longer text | longer text | longer text |

</div>

## 区切り線と数式

`-`、`*`、`_` のいずれかを3つ以上並べた行は区切り線になります。数式のコマンドはすべて **LaTeX** タブにあります。

**区切り線**

~~~~markdown
Above the line

---

Below the line
~~~~

<div class="md-example">

Above the line

---

Below the line

</div>

**文中の数式**

~~~~markdown
Einstein: $E = mc^2$
~~~~

<div class="md-example">

Einstein: $E = mc^2$

</div>

**独立した行の数式**

~~~~markdown
$$
\int_0^1 x^2\,dx = \frac{1}{3}
$$
~~~~

<div class="md-example">

$$
\int_0^1 x^2\,dx = \frac{1}{3}
$$

</div>

## プロパティ

ノートのいちばん最初に書きます。`tags` でタグを追加し、その他の `キー: 値` はノート上部のプロパティ欄に表示されます。

**プロパティ**

~~~~markdown
---
tags: [project, ideas]
aliases: [Other name]
status: active
created: 2026-11-08
---
~~~~

## HTML

簡単な HTML タグはノートの中で使えます。

| 内容 | 入力 | 表示 |
| --- | --- | --- |
| 下線 | `<u>underline</u>` | <u>underline</u> |
| 上付き文字 | `x<sup>2</sup>` | x<sup>2</sup> |
| 下付き文字 | `H<sub>2</sub>O` | H<sub>2</sub>O |
| キー表示 | `<kbd>Ctrl</kbd> + <kbd>C</kbd>` | <kbd>Ctrl</kbd> + <kbd>C</kbd> |
| どこでも改行 | `line one<br>line two` | line one<br>line two |
| 色付きの文字 | `<span style="color:#e93147">red text</span>` | <span style="color:#e93147">red text</span> |
| クリックで続きを表示 | `<details><summary>More</summary>Hidden text</details>` | <details><summary>More</summary>Hidden text</details> |
