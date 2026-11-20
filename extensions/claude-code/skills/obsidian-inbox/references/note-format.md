# Example note formats

Two common styles are shown here (from a real bilingual maths vault). Always copy the style of the notes already in the target folder; read one before writing.

## Source line (both styles)

Right under the frontmatter, every note starts with a 来源 line naming the slides or textbook pages it covers, then a blank line:

```markdown
来源：LA14 第 32–35 页（Matrix formulation (cont'd) 到 Now going back）。
```

Use the slide titles from those pages in brackets. Several ranges are separated by 、. When you append to a note and use new pages, extend its 来源 line. For a point taken from a specific page, you can also end its heading with （第 N 页）.

Link the 来源 to the slide PDF when it is in the vault: `来源：[[LA14.pdf|LA14]] 第 32–35 页（…）。` (slides are in `<Course>/课件 Slides/`).

## Related line and the graph (the graph shows knowledge only)

End a knowledge note with a 相关 Related line linking the notes it genuinely connects to, each with a few words on why, e.g. `相关 Related：[[行列式 Determinant]]（$X$ 可逆即 $\det X\neq0$）。` Only real mathematical connections; if there are none, leave it out. Index pages, inboxes, logs and other non-knowledge notes get `graph: hide` in their frontmatter so they stay off the graph.

## Linear Algebra style (`Linear Algebra/Slide NN/中文名 English.md`)

Numbered points, each a one-sentence heading line ending in `。` or `.`, then short paragraphs. Chinese prose, English terms kept, maths inline.

```markdown
---
tags: [Linear Algebra]
created: 2026.11.08
---
1. 如何把一个向量分成两部分。

我们可以像这样切割：$V, V^{\perp} \subset \mathbb{R}^n$ 且 $\forall x \in \R^n,\exist u \in V, v \in V^{\perp},x=u+v$.

2. 证明 $(V^{\perp})^{\perp}=V$.

- 证明 $V \subset (V^{\perp})^{\perp}$.

由定义知 $\forall u \in V,v \in V^{\perp},u \perp v$, then $u \in (V^{\perp})^{\perp}$.

- 证明 $(V^{\perp})^{\perp} \subset V$.

这个难一点。
```

## Mathematical Analysis style (`Mathematical Analysis/Chapter N/N.x 中文标题.md`)

Textbook-section notes: a source line linking `[[Mathematical Analysis/MA1 教材索引#…|教材 §…]]`, then `## 1.1 节名` and `### 小标题` sections, with `- ` bullets and display maths in `$$ … $$` on their own lines.

```markdown
---
tag: [Mathematical Analysis]
created: 2026.11.17
---

[[Mathematical Analysis/MA1 教材索引#第一章 绪论|教材 §1.1–1.2，第 7–12 页]] · 第 1 周第 2 节

## 1.1 集合

### 元素、子集与区间

- $x\in A$ 表示 $x$ 是 $A$ 的元素。$A\subseteq B$ 表示对每个 $x\in A$ 都有 $x\in B$。
- 要证 $A=B$，分别证明 $A\subseteq B$ 与 $B\subseteq A$。
```

When appending a capture to an MA note, add a `### 小标题` under the matching `##` section rather than a numbered point. A new MA concept note gets a `## 中文名 English` heading and `###` parts (直观理解 / 准确表述 / 例子).

Note the MA frontmatter key is `tag:` in the existing note while LA uses `tags:`. Copy whichever the neighbouring notes in that folder use.
