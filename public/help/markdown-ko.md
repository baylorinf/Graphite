# Markdown 치트시트

Graphite이 이해하는 모든 문법을 입력과 결과로 정리했습니다. **코드를 클릭하면 복사됩니다.** 수식은 **LaTeX** 탭을 보세요.

## 글자 서식

`%%…%%`로 감싼 글자는 읽기 보기에서 숨겨지고, 편집할 때만 보입니다.

| 항목 | 입력 | 결과 |
| --- | --- | --- |
| 굵게 | `**bold**` | **bold** |
| 굵게(다른 방법) | `__bold__` | __bold__ |
| 기울임 | `*italic*` | *italic* |
| 기울임(다른 방법) | `_italic_` | _italic_ |
| 굵게 + 기울임 | `***bold and italic***` | ***bold and italic*** |
| 취소선 | `~~strikethrough~~` | ~~strikethrough~~ |
| 강조 표시 | `==highlight==` | ==highlight== |
| 인라인 코드 | `` `code` `` | `code` |
| 기호를 그대로 표시 | `\*not italic\*` | \*not italic\* |
| 숨김 주석 | `visible %%hidden%% text` | visible %%hidden%% text |

## 링크와 태그

아직 없는 노트로 가는 링크는 흐리게 보이며, 노트에서 클릭하면 그 노트가 만들어집니다. `#`은 단어에 바로 붙어 있을 때만 태그가 됩니다.

| 항목 | 입력 | 결과 |
| --- | --- | --- |
| 노트 링크 | `[[Note name]]` | [[Note name]] |
| 다른 글자로 보이는 링크 | `[[Note name\|shown text]]` | [[Note name\|shown text]] |
| 제목 링크 | `[[Note name#Heading]]` | [[Note name#Heading]] |
| 이 노트의 제목 | `[[#Heading]]` | [[#Heading]] |
| 웹 링크 | `[Obsidian](https://obsidian.md)` | [Obsidian](https://obsidian.md) |
| Markdown 형식 노트 링크 | `[text](Note%20name.md)` | [text](Note%20name.md) |
| < >로 감싼 웹 링크 | `<https://obsidian.md>` | <https://obsidian.md> |
| 웹 주소 그대로 | `https://obsidian.md` | https://obsidian.md |
| 태그 | `#tag` | #tag |
| 하위 태그 | `#project/ideas` | #project/ideas |

## 삽입과 이미지

보관함의 다른 파일 내용을 보여 주므로 여기서는 표시하지 않습니다. 이미지를 편집기에 붙여넣거나 끌어다 놓으면 자동으로 `attachments/`에 추가됩니다.

| 항목 | 입력 |
| --- | --- |
| 노트 전체 삽입 | `![[Note name]]` |
| 한 부분만 삽입 | `![[Note name#Heading]]` |
| 보관함의 이미지 | `![[image.png]]` |
| 너비를 정한 이미지(px) | `![[image.png\|300]]` |
| 이미지(Markdown 형식) | `![description](image.png)` |
| 웹의 이미지 | `![description](https://example.com/picture.png)` |
| PDF | `![[document.pdf]]` |
| 오디오 | `![[recording.mp3]]` |
| 동영상 | `![[clip.mp4]]` |

## 제목

`#` 뒤에 공백을 넣으세요. 제목은 개요 패널에 나타나고 `[[노트#제목]]`으로 연결할 수 있습니다.

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

## 문단과 줄바꿈

문단 사이에는 빈 줄을 두세요. 한 번의 줄바꿈은 그대로 줄바꿈으로 유지됩니다.

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

## 목록과 할 일

**Tab**(또는 공백 두 개)으로 들여쓰면 중첩됩니다. **Enter**를 누르면 목록이 이어집니다. 할 일은 읽기 보기에서 클릭해 체크합니다.

**글머리 목록**

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

**번호 목록**

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

**중첩 목록**

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

**할 일 목록**

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

## 인용과 콜아웃

콜아웃 종류: `note`, `abstract`, `info`, `todo`, `tip`, `success`, `question`, `warning`, `failure`, `danger`, `bug`, `example`, `quote`. 종류 뒤에 `-`(접힘)나 `+`(펼침)를 붙이면 접을 수 있습니다.

**인용**

~~~~markdown
> The best way to have a good idea
> is to have lots of ideas.
~~~~

<div class="md-example">

> The best way to have a good idea
> is to have lots of ideas.

</div>

**인용 안의 인용**

~~~~markdown
> Outer quote
>> Quote inside a quote
~~~~

<div class="md-example">

> Outer quote
>> Quote inside a quote

</div>

**제목 있는 콜아웃**

~~~~markdown
> [!note] Title of the callout
> Text inside the callout.
~~~~

<div class="md-example">

> [!note] Title of the callout
> Text inside the callout.

</div>

**제목 없는 콜아웃**

~~~~markdown
> [!tip]
> Without a title, the type is used as the title.
~~~~

<div class="md-example">

> [!tip]
> Without a title, the type is used as the title.

</div>

**접힌 콜아웃**

~~~~markdown
> [!question]- Click to open
> Hidden until you open it.
~~~~

<div class="md-example">

> [!question]- Click to open
> Hidden until you open it.

</div>

**펼쳐진 접이식 콜아웃**

~~~~markdown
> [!example]+ Click to close
> Shown, but can be folded.
~~~~

<div class="md-example">

> [!example]+ Click to close
> Shown, but can be folded.

</div>

**모든 콜아웃 종류**

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

## 코드 블록

여는 울타리 뒤에 언어 이름(`python`, `js`, `bash` 등)을 씁니다.

**언어를 지정한 코드 블록**

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

**물결표 코드 블록**

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

## 표

둘째 줄의 콜론으로 정렬을 정합니다. 양 끝의 `|`는 생략해도 됩니다.

**표**

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

**열 정렬**

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

## 구분선과 수식

`-`, `*`, `_` 중 하나를 세 개 이상 쓴 줄은 구분선이 됩니다. 수식 명령어는 모두 **LaTeX** 탭에 있습니다.

**구분선**

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

**문장 속 수식**

~~~~markdown
Einstein: $E = mc^2$
~~~~

<div class="md-example">

Einstein: $E = mc^2$

</div>

**한 줄짜리 수식**

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

## 속성

노트의 맨 처음에 써야 합니다. `tags`는 태그를 추가하고, 다른 `키: 값`은 노트 위쪽 속성 상자에 표시됩니다.

**속성**

~~~~markdown
---
tags: [project, ideas]
aliases: [Other name]
status: active
created: 2026-11-08
---
~~~~

## HTML

간단한 HTML 태그는 노트 안에서 쓸 수 있습니다.

| 항목 | 입력 | 결과 |
| --- | --- | --- |
| 밑줄 | `<u>underline</u>` | <u>underline</u> |
| 위 첨자 | `x<sup>2</sup>` | x<sup>2</sup> |
| 아래 첨자 | `H<sub>2</sub>O` | H<sub>2</sub>O |
| 키보드 키 | `<kbd>Ctrl</kbd> + <kbd>C</kbd>` | <kbd>Ctrl</kbd> + <kbd>C</kbd> |
| 어디서나 줄바꿈 | `line one<br>line two` | line one<br>line two |
| 색 있는 글자 | `<span style="color:#e93147">red text</span>` | <span style="color:#e93147">red text</span> |
| 클릭해서 더 보기 | `<details><summary>More</summary>Hidden text</details>` | <details><summary>More</summary>Hidden text</details> |
