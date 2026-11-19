# LaTeX チートシート

数式を `$ … $` で囲むと文中に、前後の行に `$$` を置くと独立した行に表示されます。**コードをクリックするとコピーできます。**

## べき乗・添字・分数・根号

| 入力 | 表示 | 入力 | 表示 | 入力 | 表示 |
| --- | :---: | --- | :---: | --- | :---: |
| `x^2` | $x^2$ | `x_i` | $x_i$ | `x_{ij}^{2}` | $x_{ij}^{2}$ |
| `e^{i\pi}` | $e^{i\pi}$ | `\frac{a}{b}` | $\frac{a}{b}$ | `\tfrac{1}{2}` | $\tfrac{1}{2}$ |
| `\sqrt{x}` | $\sqrt{x}$ | `\sqrt[3]{x}` | $\sqrt[3]{x}$ | `\binom{n}{k}` | $\binom{n}{k}$ |

## ギリシャ文字

| 入力 | 表示 | 入力 | 表示 | 入力 | 表示 | 入力 | 表示 |
| --- | :---: | --- | :---: | --- | :---: | --- | :---: |
| `\alpha` | $\alpha$ | `\beta` | $\beta$ | `\gamma` | $\gamma$ | `\delta` | $\delta$ |
| `\epsilon` | $\epsilon$ | `\varepsilon` | $\varepsilon$ | `\theta` | $\theta$ | `\lambda` | $\lambda$ |
| `\mu` | $\mu$ | `\pi` | $\pi$ | `\rho` | $\rho$ | `\sigma` | $\sigma$ |
| `\tau` | $\tau$ | `\phi` | $\phi$ | `\varphi` | $\varphi$ | `\omega` | $\omega$ |
| `\Gamma` | $\Gamma$ | `\Delta` | $\Delta$ | `\Theta` | $\Theta$ | `\Lambda` | $\Lambda$ |
| `\Pi` | $\Pi$ | `\Sigma` | $\Sigma$ | `\Phi` | $\Phi$ | `\Omega` | $\Omega$ |

## 演算子と関係

| 入力 | 表示 | 入力 | 表示 | 入力 | 表示 | 入力 | 表示 |
| --- | :---: | --- | :---: | --- | :---: | --- | :---: |
| `\times` | $\times$ | `\div` | $\div$ | `\pm` | $\pm$ | `\cdot` | $\cdot$ |
| `\le` | $\le$ | `\ge` | $\ge$ | `\ne` | $\ne$ | `\approx` | $\approx$ |
| `\equiv` | $\equiv$ | `\sim` | $\sim$ | `\propto` | $\propto$ | `\ll` | $\ll$ |
| `\infty` | $\infty$ | `\partial` | $\partial$ | `\nabla` | $\nabla$ | `90^\circ` | $90^\circ$ |

## 集合・論理・矢印

| 入力 | 表示 | 入力 | 表示 | 入力 | 表示 | 入力 | 表示 |
| --- | :---: | --- | :---: | --- | :---: | --- | :---: |
| `\in` | $\in$ | `\notin` | $\notin$ | `\subset` | $\subset$ | `\subseteq` | $\subseteq$ |
| `\cup` | $\cup$ | `\cap` | $\cap$ | `\setminus` | $\setminus$ | `\emptyset` | $\emptyset$ |
| `\forall` | $\forall$ | `\exists` | $\exists$ | `\neg` | $\neg$ | `\land` | $\land$ |
| `\to` | $\to$ | `\Rightarrow` | $\Rightarrow$ | `\Leftrightarrow` | $\Leftrightarrow$ | `\mapsto` | $\mapsto$ |
| `\mathbb{N}` | $\mathbb{N}$ | `\mathbb{Z}` | $\mathbb{Z}$ | `\mathbb{R}` | $\mathbb{R}$ | `\mathbb{C}` | $\mathbb{C}$ |

## 矢印

| 入力 | 表示 | 入力 | 表示 | 入力 | 表示 | 入力 | 表示 |
| --- | :---: | --- | :---: | --- | :---: | --- | :---: |
| `\leftarrow` | $\leftarrow$ | `\rightarrow` | $\rightarrow$ | `\leftrightarrow` | $\leftrightarrow$ | `\longrightarrow` | $\longrightarrow$ |
| `\Leftarrow` | $\Leftarrow$ | `\implies` | $\implies$ | `\iff` | $\iff$ | `\uparrow` | $\uparrow$ |
| `\downarrow` | $\downarrow$ | `\hookrightarrow` | $\hookrightarrow$ | `\rightleftharpoons` | $\rightleftharpoons$ | `\xrightarrow{f}` | $\xrightarrow{f}$ |

## 点・プライム・論理

| 入力 | 表示 | 入力 | 表示 | 入力 | 表示 | 入力 | 表示 |
| --- | :---: | --- | :---: | --- | :---: | --- | :---: |
| `\ldots` | $\ldots$ | `\cdots` | $\cdots$ | `\vdots` | $\vdots$ | `\ddots` | $\ddots$ |
| `f'(x)` | $f'(x)$ | `f''(x)` | $f''(x)$ | `\therefore` | $\therefore$ | `\because` | $\because$ |

## 総和・積分・極限

`$$` ブロックの中では、ここにあるように上下に範囲が付きます。

| 入力 | 表示 |
| --- | :---: |
| `\sum_{i=1}^{n} i` | $\displaystyle \sum_{i=1}^{n} i$ |
| `\prod_{k=1}^{n} k` | $\displaystyle \prod_{k=1}^{n} k$ |
| `\int_a^b f(x)\,dx` | $\displaystyle \int_a^b f(x)\,dx$ |
| `\iint_D f\,dA` | $\displaystyle \iint_D f\,dA$ |
| `\oint_C \vec{F} \cdot d\vec{r}` | $\displaystyle \oint_C \vec{F} \cdot d\vec{r}$ |
| `\lim_{x \to 0} \frac{\sin x}{x}` | $\displaystyle \lim_{x \to 0} \frac{\sin x}{x}$ |
| `\max_{x \in S} f(x)` | $\displaystyle \max_{x \in S} f(x)$ |

## 関数

| 入力 | 表示 | 入力 | 表示 | 入力 | 表示 |
| --- | :---: | --- | :---: | --- | :---: |
| `\sin x` | $\sin x$ | `\cos x` | $\cos x$ | `\tan x` | $\tan x$ |
| `\log x` | $\log x$ | `\ln x` | $\ln x$ | `\exp x` | $\exp x$ |
| `\arcsin x` | $\arcsin x$ | `\sinh x` | $\sinh x$ | `\det A` | $\det A$ |

## 伸びるかっこ

`\left` と `\right` を付けると、中身に合わせてかっこが伸びます。

| 入力 | 表示 | 入力 | 表示 |
| --- | :---: | --- | :---: |
| `\left( \frac{a}{b} \right)` | $\left( \frac{a}{b} \right)$ | `\left[ x \right]` | $\left[ x \right]$ |
| `\{ a, b \}` | $\{ a, b \}$ | `\langle u, v \rangle` | $\langle u, v \rangle$ |
| `\lvert x \rvert` | $\lvert x \rvert$ | `\lVert v \rVert` | $\lVert v \rVert$ |
| `\lfloor x \rfloor` | $\lfloor x \rfloor$ | `\lceil x \rceil` | $\lceil x \rceil$ |
| `\big( \Big( \bigg( \Bigg(` | $\big( \Big( \bigg( \Bigg($ | `\left. \frac{df}{dx} \right\rvert_{x=0}` | $\left. \frac{df}{dx} \right\rvert_{x=0}$ |

## 重ね書き・否定・名前付き演算子

`\operatorname{…}` で独自の関数名を立体で書けます。`\not` は直後の記号に斜線を引きます。

| 入力 | 表示 | 入力 | 表示 |
| --- | :---: | --- | :---: |
| `\overset{!}{=}` | $\overset{!}{=}$ | `\underset{x}{\arg\min}` | $\underset{x}{\arg\min}$ |
| `\stackrel{\text{def}}{=}` | $\stackrel{\text{def}}{=}$ | `\not\subset` | $\not\subset$ |
| `\operatorname{rank} A` | $\operatorname{rank} A$ | `a \equiv b \pmod{n}` | $a \equiv b \pmod{n}$ |
| `a \bmod b` | $a \bmod b$ | `\gcd(a, b)` | $\gcd(a, b)$ |

## アクセントと書体

`\text{…}` で数式の中にふつうの文字を書けます。

| 入力 | 表示 | 入力 | 表示 | 入力 | 表示 |
| --- | :---: | --- | :---: | --- | :---: |
| `\hat{x}` | $\hat{x}$ | `\bar{x}` | $\bar{x}$ | `\vec{v}` | $\vec{v}$ |
| `\dot{x}` | $\dot{x}$ | `\ddot{x}` | $\ddot{x}$ | `\tilde{x}` | $\tilde{x}$ |
| `\overline{AB}` | $\overline{AB}$ | `\underline{x}` | $\underline{x}$ | `\overrightarrow{AB}` | $\overrightarrow{AB}$ |
| `\mathbf{v}` | $\mathbf{v}$ | `\mathbb{R}` | $\mathbb{R}$ | `\mathcal{L}` | $\mathcal{L}$ |
| `\mathrm{d}x` | $\mathrm{d}x$ | `\boldsymbol{\alpha}` | $\boldsymbol{\alpha}$ | `\mathit{diff}` | $\mathit{diff}$ |
| `\mathsf{A}` | $\mathsf{A}$ | `\mathtt{A}` | $\mathtt{A}$ | `\mathfrak{g}` | $\mathfrak{g}$ |
| `\text{if } x > 0` | $\text{if } x > 0$ |  |  |  |  |

## 行列

`$$` ブロックの中で使います。`&` で列を、`\\` で行を区切ります。

```latex
\begin{pmatrix} a & b \\ c & d \end{pmatrix}
```

$$
\begin{pmatrix} a & b \\ c & d \end{pmatrix}
$$

```latex
\begin{bmatrix} 1 & 0 \\ 0 & 1 \end{bmatrix}
```

$$
\begin{bmatrix} 1 & 0 \\ 0 & 1 \end{bmatrix}
$$

```latex
\begin{vmatrix} a & b \\ c & d \end{vmatrix}
```

$$
\begin{vmatrix} a & b \\ c & d \end{vmatrix}
$$

## 複数行と場合分け

`&` の位置で各行がそろいます。`\\` で改行します。

```latex
\begin{aligned}
(a+b)^2 &= a^2 + 2ab + b^2 \\
&\ge 4ab
\end{aligned}
```

$$
\begin{aligned}
(a+b)^2 &= a^2 + 2ab + b^2 \\
&\ge 4ab
\end{aligned}
$$

```latex
f(x) = \begin{cases}
x & \text{if } x \ge 0 \\
-x & \text{if } x < 0
\end{cases}
```

$$
f(x) = \begin{cases}
x & \text{if } x \ge 0 \\
-x & \text{if } x < 0
\end{cases}
$$

```latex
\begin{gathered}
a = b + c \\
d = e - f
\end{gathered}
```

$$
\begin{gathered}
a = b + c \\
d = e - f
\end{gathered}
$$

```latex
\begin{array}{c|cc}
\times & 1 & 2 \\ \hline
1 & 1 & 2 \\
2 & 2 & 4
\end{array}
```

$$
\begin{array}{c|cc}
\times & 1 & 2 \\ \hline
1 & 1 & 2 \\
2 & 2 & 4
\end{array}
$$

## 化学式

`\ce{…}` で化学式や反応式を書けます。

| 入力 | 表示 |
| --- | :---: |
| `\ce{H2O}` | $\ce{H2O}$ |
| `\ce{2H2 + O2 -> 2H2O}` | $\ce{2H2 + O2 -> 2H2O}$ |
| `\ce{CO2 + H2O <=> H2CO3}` | $\ce{CO2 + H2O <=> H2CO3}$ |
| `\ce{^{14}_{6}C}` | $\ce{^{14}_{6}C}$ |
| `\ce{SO4^2-}` | $\ce{SO4^2-}$ |
| `\ce{Fe^3+}` | $\ce{Fe^3+}$ |

## 空白

| 入力 | 表示 | 入力 | 表示 |
| --- | :---: | --- | :---: |
| `a\,b` | $a\,b$ | `a\;b` | $a\;b$ |
| `a\quad b` | $a\quad b$ | `a\qquad b` | $a\qquad b$ |

## 色・枠・括弧

| 入力 | 表示 |
| --- | :---: |
| `\textcolor{red}{x^2}` | $\displaystyle \textcolor{red}{x^2}$ |
| `\boxed{E = mc^2}` | $\displaystyle \boxed{E = mc^2}$ |
| `\cancel{x}` | $\displaystyle \cancel{x}$ |
| `\underbrace{a + b}_{n}` | $\displaystyle \underbrace{a + b}_{n}$ |
| `\overbrace{x + y}^{2}` | $\displaystyle \overbrace{x + y}^{2}$ |
