# Markdown Cheatsheet

Back to [[Welcome]]. #reference

## Text
**bold**, *italic*, ~~strikethrough~~, ==highlight==, `inline code`, and %%this comment is hidden in reading view%%.

## Lists
1. First
2. Second
   - Nested bullet
   - [ ] Nested task

## Code
```js
function hello(name) {
  return `Hello, ${name}!`;
}
```

## Callouts
> [!tip] Callouts work like in Obsidian
> Use `> [!note]`, `[!warning]`, `[!danger]`, `[!success]`, `[!question]`, `[!example]`…

> [!warning]- Foldable callout (click me)
> Add `-` or `+` after the type to make it collapsible.

## Math
Inline math: $E = mc^2$ and $\sqrt{a^2 + b^2}$. Prices stay plain text: it costs $5 or $10.

$$
\int_0^1 x^2\,dx = \frac{1}{3} \qquad \sum_{n=1}^{\infty} \frac{1}{n^2} = \frac{\pi^2}{6}
$$

Chemistry: $\ce{2H2 + O2 -> 2H2O}$

## Links
- Wikilink: [[Welcome]]
- Link to a heading: [[Welcome#Keyboard shortcuts]]
- Markdown link: [Project Alpha](Ideas/Project%20Alpha.md)
- External: [Obsidian help](https://help.obsidian.md)

## Quote
> The best way to have a good idea is to have lots of ideas.
