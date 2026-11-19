# Markdown 速查表

Graphite 支持的全部写法，左边是输入，右边是效果。**点击任意代码即可复制。** 公式请看 **LaTeX** 标签页。

## 文字格式

`%%…%%` 中的文字在阅读视图中隐藏，只在编辑时可见。

| 内容 | 输入 | 效果 |
| --- | --- | --- |
| 粗体 | `**bold**` | **bold** |
| 粗体（另一种写法） | `__bold__` | __bold__ |
| 斜体 | `*italic*` | *italic* |
| 斜体（另一种写法） | `_italic_` | _italic_ |
| 粗斜体 | `***bold and italic***` | ***bold and italic*** |
| 删除线 | `~~strikethrough~~` | ~~strikethrough~~ |
| 高亮 | `==highlight==` | ==highlight== |
| 行内代码 | `` `code` `` | `code` |
| 原样显示符号 | `\*not italic\*` | \*not italic\* |
| 隐藏注释 | `visible %%hidden%% text` | visible %%hidden%% text |

## 链接和标签

指向尚不存在的笔记的链接显示为淡色，在笔记中点击即可创建该笔记。`#` 只有紧贴文字时才算标签。

| 内容 | 输入 | 效果 |
| --- | --- | --- |
| 链接到笔记 | `[[Note name]]` | [[Note name]] |
| 显示其他文字的链接 | `[[Note name\|shown text]]` | [[Note name\|shown text]] |
| 链接到标题 | `[[Note name#Heading]]` | [[Note name#Heading]] |
| 本笔记中的标题 | `[[#Heading]]` | [[#Heading]] |
| 网页链接 | `[Obsidian](https://obsidian.md)` | [Obsidian](https://obsidian.md) |
| Markdown 格式的笔记链接 | `[text](Note%20name.md)` | [text](Note%20name.md) |
| 用 < > 包住的网页链接 | `<https://obsidian.md>` | <https://obsidian.md> |
| 直接写网址 | `https://obsidian.md` | https://obsidian.md |
| 标签 | `#tag` | #tag |
| 多级标签 | `#project/ideas` | #project/ideas |

## 嵌入和图片

这些会显示仓库中其他文件的内容，所以这里不渲染。把图片粘贴或拖入编辑器，会自动保存到 `attachments/`。

| 内容 | 输入 |
| --- | --- |
| 嵌入整篇笔记 | `![[Note name]]` |
| 嵌入一个章节 | `![[Note name#Heading]]` |
| 仓库中的图片 | `![[image.png]]` |
| 指定宽度的图片（像素） | `![[image.png\|300]]` |
| 图片（Markdown 格式） | `![description](image.png)` |
| 网络图片 | `![description](https://example.com/picture.png)` |
| PDF | `![[document.pdf]]` |
| 音频 | `![[recording.mp3]]` |
| 视频 | `![[clip.mp4]]` |

## 标题

`#` 后面要加空格。标题会显示在大纲中，并可以用 `[[笔记#标题]]` 链接。

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

## 段落和换行

段落之间空一行。单个换行会保留为换行。

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

## 列表和任务

用 **Tab**（或两个空格）缩进即可嵌套。按 **Enter** 自动续写列表。在阅读视图中点击任务即可勾选。

**无序列表**

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

**有序列表**

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

**嵌套列表**

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

**任务列表**

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

## 引用和标注框

标注框类型：`note`、`abstract`、`info`、`todo`、`tip`、`success`、`question`、`warning`、`failure`、`danger`、`bug`、`example`、`quote`。在类型后加 `-`（折叠）或 `+`（展开）可让它可折叠。

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

**带标题的标注框**

~~~~markdown
> [!note] Title of the callout
> Text inside the callout.
~~~~

<div class="md-example">

> [!note] Title of the callout
> Text inside the callout.

</div>

**不带标题的标注框**

~~~~markdown
> [!tip]
> Without a title, the type is used as the title.
~~~~

<div class="md-example">

> [!tip]
> Without a title, the type is used as the title.

</div>

**折叠的标注框**

~~~~markdown
> [!question]- Click to open
> Hidden until you open it.
~~~~

<div class="md-example">

> [!question]- Click to open
> Hidden until you open it.

</div>

**可折叠、默认展开的标注框**

~~~~markdown
> [!example]+ Click to close
> Shown, but can be folded.
~~~~

<div class="md-example">

> [!example]+ Click to close
> Shown, but can be folded.

</div>

**全部标注框类型**

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

## 代码块

在开头的围栏后写语言名（`python`、`js`、`bash` 等）。

**指定语言的代码块**

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

**用波浪线的代码块**

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

第二行中的冒号决定对齐方式。两侧的 `|` 可以省略。

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

**列对齐**

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

## 分隔线和公式

一行中单独写三个或更多 `-`、`*` 或 `_` 就是分隔线。所有公式命令都在 **LaTeX** 标签页中。

**分隔线**

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

**单独一行的公式**

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

## 属性

必须写在笔记的最开头。`tags` 用来添加标签，其他 `键: 值` 会显示在笔记顶部的属性框中。

**属性**

~~~~markdown
---
tags: [project, ideas]
aliases: [Other name]
status: active
created: 2026-11-08
---
~~~~

## HTML

笔记中可以使用简单的 HTML 标签。

| 内容 | 输入 | 效果 |
| --- | --- | --- |
| 下划线 | `<u>underline</u>` | <u>underline</u> |
| 上标 | `x<sup>2</sup>` | x<sup>2</sup> |
| 下标 | `H<sub>2</sub>O` | H<sub>2</sub>O |
| 键盘按键 | `<kbd>Ctrl</kbd> + <kbd>C</kbd>` | <kbd>Ctrl</kbd> + <kbd>C</kbd> |
| 任意位置换行 | `line one<br>line two` | line one<br>line two |
| 彩色文字 | `<span style="color:#e93147">red text</span>` | <span style="color:#e93147">red text</span> |
| 点击展开更多 | `<details><summary>More</summary>Hidden text</details>` | <details><summary>More</summary>Hidden text</details> |
