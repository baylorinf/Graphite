# Markdown 速查表

Graphite 支援的全部寫法，左邊是輸入，右邊是效果。**點擊任一程式碼即可複製。** 公式請看 **LaTeX** 分頁。

## 文字格式

`%%…%%` 中的文字在閱讀檢視中隱藏，只在編輯時可見。

| 內容 | 輸入 | 效果 |
| --- | --- | --- |
| 粗體 | `**bold**` | **bold** |
| 粗體（另一種寫法） | `__bold__` | __bold__ |
| 斜體 | `*italic*` | *italic* |
| 斜體（另一種寫法） | `_italic_` | _italic_ |
| 粗斜體 | `***bold and italic***` | ***bold and italic*** |
| 刪除線 | `~~strikethrough~~` | ~~strikethrough~~ |
| 螢光標記 | `==highlight==` | ==highlight== |
| 行內程式碼 | `` `code` `` | `code` |
| 原樣顯示符號 | `\*not italic\*` | \*not italic\* |
| 隱藏註解 | `visible %%hidden%% text` | visible %%hidden%% text |

## 連結和標籤

指向尚不存在之筆記的連結會顯示為淡色，在筆記中點擊即可建立該筆記。`#` 只有緊貼文字時才算標籤。

| 內容 | 輸入 | 效果 |
| --- | --- | --- |
| 連結到筆記 | `[[Note name]]` | [[Note name]] |
| 顯示其他文字的連結 | `[[Note name\|shown text]]` | [[Note name\|shown text]] |
| 連結到標題 | `[[Note name#Heading]]` | [[Note name#Heading]] |
| 本筆記中的標題 | `[[#Heading]]` | [[#Heading]] |
| 網頁連結 | `[Obsidian](https://obsidian.md)` | [Obsidian](https://obsidian.md) |
| Markdown 格式的筆記連結 | `[text](Note%20name.md)` | [text](Note%20name.md) |
| 用 < > 包住的網頁連結 | `<https://obsidian.md>` | <https://obsidian.md> |
| 直接寫網址 | `https://obsidian.md` | https://obsidian.md |
| 標籤 | `#tag` | #tag |
| 多層標籤 | `#project/ideas` | #project/ideas |

## 嵌入和圖片

這些會顯示儲存庫中其他檔案的內容，所以這裡不呈現。把圖片貼上或拖入編輯器，會自動儲存到 `attachments/`。

| 內容 | 輸入 |
| --- | --- |
| 嵌入整篇筆記 | `![[Note name]]` |
| 嵌入一個章節 | `![[Note name#Heading]]` |
| 儲存庫中的圖片 | `![[image.png]]` |
| 指定寬度的圖片（像素） | `![[image.png\|300]]` |
| 圖片（Markdown 格式） | `![description](image.png)` |
| 網路圖片 | `![description](https://example.com/picture.png)` |
| PDF | `![[document.pdf]]` |
| 音訊 | `![[recording.mp3]]` |
| 影片 | `![[clip.mp4]]` |

## 標題

`#` 後面要加空格。標題會顯示在大綱中，並可以用 `[[筆記#標題]]` 連結。

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

## 段落和換行

段落之間空一行。單一換行會保留為換行。

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

## 清單和任務

用 **Tab**（或兩個空格）縮排即可巢狀。按 **Enter** 自動延續清單。在閱讀檢視中點擊任務即可勾選。

**項目清單**

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

**編號清單**

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

**巢狀清單**

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

**任務清單**

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

## 引用和標註框

標註框類型：`note`、`abstract`、`info`、`todo`、`tip`、`success`、`question`、`warning`、`failure`、`danger`、`bug`、`example`、`quote`。在類型後加 `-`（收合）或 `+`（展開）可讓它可收合。

**引用**

~~~~markdown
> The best way to have a good idea
> is to have lots of ideas.
~~~~

<div class="md-example">

> The best way to have a good idea
> is to have lots of ideas.

</div>

**引用中的引用**

~~~~markdown
> Outer quote
>> Quote inside a quote
~~~~

<div class="md-example">

> Outer quote
>> Quote inside a quote

</div>

**有標題的標註框**

~~~~markdown
> [!note] Title of the callout
> Text inside the callout.
~~~~

<div class="md-example">

> [!note] Title of the callout
> Text inside the callout.

</div>

**沒有標題的標註框**

~~~~markdown
> [!tip]
> Without a title, the type is used as the title.
~~~~

<div class="md-example">

> [!tip]
> Without a title, the type is used as the title.

</div>

**收合的標註框**

~~~~markdown
> [!question]- Click to open
> Hidden until you open it.
~~~~

<div class="md-example">

> [!question]- Click to open
> Hidden until you open it.

</div>

**可收合、預設展開的標註框**

~~~~markdown
> [!example]+ Click to close
> Shown, but can be folded.
~~~~

<div class="md-example">

> [!example]+ Click to close
> Shown, but can be folded.

</div>

**全部標註框類型**

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

## 程式碼區塊

在開頭的圍欄後寫語言名稱（`python`、`js`、`bash` 等）。

**指定語言的程式碼區塊**

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

**用波浪號的程式碼區塊**

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

## 表格

第二列中的冒號決定對齊方式。兩側的 `|` 可以省略。

**表格**

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

**欄位對齊**

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

## 分隔線和公式

一行中單獨寫三個或更多 `-`、`*` 或 `_` 就是分隔線。所有公式命令都在 **LaTeX** 分頁中。

**分隔線**

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

**句子中的公式**

~~~~markdown
Einstein: $E = mc^2$
~~~~

<div class="md-example">

Einstein: $E = mc^2$

</div>

**單獨一行的公式**

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

## 屬性

必須寫在筆記的最開頭。`tags` 用來新增標籤，其他 `鍵: 值` 會顯示在筆記頂端的屬性框中。

**屬性**

~~~~markdown
---
tags: [project, ideas]
aliases: [Other name]
status: active
created: 2026-11-08
---
~~~~

## HTML

筆記中可以使用簡單的 HTML 標籤。

| 內容 | 輸入 | 效果 |
| --- | --- | --- |
| 底線 | `<u>underline</u>` | <u>underline</u> |
| 上標 | `x<sup>2</sup>` | x<sup>2</sup> |
| 下標 | `H<sub>2</sub>O` | H<sub>2</sub>O |
| 鍵盤按鍵 | `<kbd>Ctrl</kbd> + <kbd>C</kbd>` | <kbd>Ctrl</kbd> + <kbd>C</kbd> |
| 任意位置換行 | `line one<br>line two` | line one<br>line two |
| 彩色文字 | `<span style="color:#e93147">red text</span>` | <span style="color:#e93147">red text</span> |
| 點擊展開更多 | `<details><summary>More</summary>Hidden text</details>` | <details><summary>More</summary>Hidden text</details> |
