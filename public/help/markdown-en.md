# Markdown cheatsheet

Everything Graphite understands, with what you type and what you get. **Click any code to copy it.** For formulas, see the **LaTeX** tab.

## Text formatting

`%%…%%` hides text in Read view; it stays visible while editing.

| What | Type | Result |
| --- | --- | --- |
| Bold | `**bold**` | **bold** |
| Bold (other way) | `__bold__` | __bold__ |
| Italic | `*italic*` | *italic* |
| Italic (other way) | `_italic_` | _italic_ |
| Bold and italic | `***bold and italic***` | ***bold and italic*** |
| Strikethrough | `~~strikethrough~~` | ~~strikethrough~~ |
| Highlight | `==highlight==` | ==highlight== |
| Inline code | `` `code` `` | `code` |
| Show a symbol as-is | `\*not italic\*` | \*not italic\* |
| Hidden comment | `visible %%hidden%% text` | visible %%hidden%% text |

## Links and tags

Links to notes that don’t exist yet look faded; clicking one in a note creates it. `#` starts a tag only when it directly touches a word.

| What | Type | Result |
| --- | --- | --- |
| Link to a note | `[[Note name]]` | [[Note name]] |
| Link with other text | `[[Note name\|shown text]]` | [[Note name\|shown text]] |
| Link to a heading | `[[Note name#Heading]]` | [[Note name#Heading]] |
| Heading in this note | `[[#Heading]]` | [[#Heading]] |
| Web link | `[Obsidian](https://obsidian.md)` | [Obsidian](https://obsidian.md) |
| Markdown link to a note | `[text](Note%20name.md)` | [text](Note%20name.md) |
| Web link in < > | `<https://obsidian.md>` | <https://obsidian.md> |
| Plain web address | `https://obsidian.md` | https://obsidian.md |
| Tag | `#tag` | #tag |
| Nested tag | `#project/ideas` | #project/ideas |

## Embeds and images

These show content from other files in your vault, so they aren’t rendered here. Paste or drop an image into the editor to add it to `attachments/` automatically.

| What | Type |
| --- | --- |
| Embed a whole note | `![[Note name]]` |
| Embed one section | `![[Note name#Heading]]` |
| Image from the vault | `![[image.png]]` |
| Image with a width (px) | `![[image.png\|300]]` |
| Image (Markdown style) | `![description](image.png)` |
| Image from the web | `![description](https://example.com/picture.png)` |
| PDF | `![[document.pdf]]` |
| Audio | `![[recording.mp3]]` |
| Video | `![[clip.mp4]]` |

## Headings

Put a space after the `#` signs. Headings appear in the Outline panel and can be linked with `[[Note#Heading]]`.

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

## Paragraphs and line breaks

Leave an empty line between paragraphs. A single line break is kept as a line break.

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

## Lists and tasks

Indent with **Tab** (or two spaces) to nest. Press **Enter** to continue a list. Tick tasks by clicking them in Read view.

**Bullet list**

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

**Numbered list**

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

**Nested list**

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

**Task list**

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

## Quotes and callouts

Callout types: `note`, `abstract`, `info`, `todo`, `tip`, `success`, `question`, `warning`, `failure`, `danger`, `bug`, `example`, `quote`. Add `-` (folded) or `+` (open) after the type to make it foldable.

**Quote**

~~~~markdown
> The best way to have a good idea
> is to have lots of ideas.
~~~~

<div class="md-example">

> The best way to have a good idea
> is to have lots of ideas.

</div>

**Quote inside a quote**

~~~~markdown
> Outer quote
>> Quote inside a quote
~~~~

<div class="md-example">

> Outer quote
>> Quote inside a quote

</div>

**Callout with a title**

~~~~markdown
> [!note] Title of the callout
> Text inside the callout.
~~~~

<div class="md-example">

> [!note] Title of the callout
> Text inside the callout.

</div>

**Callout without a title**

~~~~markdown
> [!tip]
> Without a title, the type is used as the title.
~~~~

<div class="md-example">

> [!tip]
> Without a title, the type is used as the title.

</div>

**Folded callout**

~~~~markdown
> [!question]- Click to open
> Hidden until you open it.
~~~~

<div class="md-example">

> [!question]- Click to open
> Hidden until you open it.

</div>

**Foldable callout, open**

~~~~markdown
> [!example]+ Click to close
> Shown, but can be folded.
~~~~

<div class="md-example">

> [!example]+ Click to close
> Shown, but can be folded.

</div>

**All callout types**

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

## Code blocks

Write the language after the opening fence (`python`, `js`, `bash`…).

**Code block with a language**

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

**Code block with tildes**

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

## Tables

Colons in the second row set the alignment. The outer pipes are optional.

**Table**

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

**Column alignment**

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

## Lines and math

Three or more `-`, `*` or `_` on their own line make a horizontal line. All formula commands are in the **LaTeX** tab.

**Horizontal line**

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

**Formula in a sentence**

~~~~markdown
Einstein: $E = mc^2$
~~~~

<div class="md-example">

Einstein: $E = mc^2$

</div>

**Formula on its own line**

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

## Properties

Must be the very first lines of the note. `tags` adds tags; any other `key: value` is shown in the Properties box at the top of the note.

**Properties**

~~~~markdown
---
tags: [project, ideas]
aliases: [Other name]
status: active
created: 2026-11-08
---
~~~~

## HTML

Simple HTML tags work inside notes.

| What | Type | Result |
| --- | --- | --- |
| Underline | `<u>underline</u>` | <u>underline</u> |
| Superscript | `x<sup>2</sup>` | x<sup>2</sup> |
| Subscript | `H<sub>2</sub>O` | H<sub>2</sub>O |
| Keyboard keys | `<kbd>Ctrl</kbd> + <kbd>C</kbd>` | <kbd>Ctrl</kbd> + <kbd>C</kbd> |
| Line break anywhere | `line one<br>line two` | line one<br>line two |
| Coloured text | `<span style="color:#e93147">red text</span>` | <span style="color:#e93147">red text</span> |
| Click to show more | `<details><summary>More</summary>Hidden text</details>` | <details><summary>More</summary>Hidden text</details> |
