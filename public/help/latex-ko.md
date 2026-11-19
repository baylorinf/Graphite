# LaTeX 치트시트

수식을 `$ … $`로 감싸면 문장 안에, 앞뒤 줄에 `$$`를 두면 별도의 줄에 표시됩니다. **코드를 클릭하면 복사됩니다.**

## 거듭제곱·첨자·분수·근호

| 입력 | 결과 | 입력 | 결과 | 입력 | 결과 |
| --- | :---: | --- | :---: | --- | :---: |
| `x^2` | $x^2$ | `x_i` | $x_i$ | `x_{ij}^{2}` | $x_{ij}^{2}$ |
| `e^{i\pi}` | $e^{i\pi}$ | `\frac{a}{b}` | $\frac{a}{b}$ | `\tfrac{1}{2}` | $\tfrac{1}{2}$ |
| `\sqrt{x}` | $\sqrt{x}$ | `\sqrt[3]{x}` | $\sqrt[3]{x}$ | `\binom{n}{k}` | $\binom{n}{k}$ |

## 그리스 문자

| 입력 | 결과 | 입력 | 결과 | 입력 | 결과 | 입력 | 결과 |
| --- | :---: | --- | :---: | --- | :---: | --- | :---: |
| `\alpha` | $\alpha$ | `\beta` | $\beta$ | `\gamma` | $\gamma$ | `\delta` | $\delta$ |
| `\epsilon` | $\epsilon$ | `\varepsilon` | $\varepsilon$ | `\theta` | $\theta$ | `\lambda` | $\lambda$ |
| `\mu` | $\mu$ | `\pi` | $\pi$ | `\rho` | $\rho$ | `\sigma` | $\sigma$ |
| `\tau` | $\tau$ | `\phi` | $\phi$ | `\varphi` | $\varphi$ | `\omega` | $\omega$ |
| `\Gamma` | $\Gamma$ | `\Delta` | $\Delta$ | `\Theta` | $\Theta$ | `\Lambda` | $\Lambda$ |
| `\Pi` | $\Pi$ | `\Sigma` | $\Sigma$ | `\Phi` | $\Phi$ | `\Omega` | $\Omega$ |

## 연산자와 관계

| 입력 | 결과 | 입력 | 결과 | 입력 | 결과 | 입력 | 결과 |
| --- | :---: | --- | :---: | --- | :---: | --- | :---: |
| `\times` | $\times$ | `\div` | $\div$ | `\pm` | $\pm$ | `\cdot` | $\cdot$ |
| `\le` | $\le$ | `\ge` | $\ge$ | `\ne` | $\ne$ | `\approx` | $\approx$ |
| `\equiv` | $\equiv$ | `\sim` | $\sim$ | `\propto` | $\propto$ | `\ll` | $\ll$ |
| `\infty` | $\infty$ | `\partial` | $\partial$ | `\nabla` | $\nabla$ | `90^\circ` | $90^\circ$ |

## 집합·논리·화살표

| 입력 | 결과 | 입력 | 결과 | 입력 | 결과 | 입력 | 결과 |
| --- | :---: | --- | :---: | --- | :---: | --- | :---: |
| `\in` | $\in$ | `\notin` | $\notin$ | `\subset` | $\subset$ | `\subseteq` | $\subseteq$ |
| `\cup` | $\cup$ | `\cap` | $\cap$ | `\setminus` | $\setminus$ | `\emptyset` | $\emptyset$ |
| `\forall` | $\forall$ | `\exists` | $\exists$ | `\neg` | $\neg$ | `\land` | $\land$ |
| `\to` | $\to$ | `\Rightarrow` | $\Rightarrow$ | `\Leftrightarrow` | $\Leftrightarrow$ | `\mapsto` | $\mapsto$ |
| `\mathbb{N}` | $\mathbb{N}$ | `\mathbb{Z}` | $\mathbb{Z}$ | `\mathbb{R}` | $\mathbb{R}$ | `\mathbb{C}` | $\mathbb{C}$ |

## 화살표

| 입력 | 결과 | 입력 | 결과 | 입력 | 결과 | 입력 | 결과 |
| --- | :---: | --- | :---: | --- | :---: | --- | :---: |
| `\leftarrow` | $\leftarrow$ | `\rightarrow` | $\rightarrow$ | `\leftrightarrow` | $\leftrightarrow$ | `\longrightarrow` | $\longrightarrow$ |
| `\Leftarrow` | $\Leftarrow$ | `\implies` | $\implies$ | `\iff` | $\iff$ | `\uparrow` | $\uparrow$ |
| `\downarrow` | $\downarrow$ | `\hookrightarrow` | $\hookrightarrow$ | `\rightleftharpoons` | $\rightleftharpoons$ | `\xrightarrow{f}` | $\xrightarrow{f}$ |

## 점·프라임·논리

| 입력 | 결과 | 입력 | 결과 | 입력 | 결과 | 입력 | 결과 |
| --- | :---: | --- | :---: | --- | :---: | --- | :---: |
| `\ldots` | $\ldots$ | `\cdots` | $\cdots$ | `\vdots` | $\vdots$ | `\ddots` | $\ddots$ |
| `f'(x)` | $f'(x)$ | `f''(x)` | $f''(x)$ | `\therefore` | $\therefore$ | `\because` | $\because$ |

## 합·적분·극한

`$$` 블록 안에서는 여기처럼 범위가 기호 위아래에 붙습니다.

| 입력 | 결과 |
| --- | :---: |
| `\sum_{i=1}^{n} i` | $\displaystyle \sum_{i=1}^{n} i$ |
| `\prod_{k=1}^{n} k` | $\displaystyle \prod_{k=1}^{n} k$ |
| `\int_a^b f(x)\,dx` | $\displaystyle \int_a^b f(x)\,dx$ |
| `\iint_D f\,dA` | $\displaystyle \iint_D f\,dA$ |
| `\oint_C \vec{F} \cdot d\vec{r}` | $\displaystyle \oint_C \vec{F} \cdot d\vec{r}$ |
| `\lim_{x \to 0} \frac{\sin x}{x}` | $\displaystyle \lim_{x \to 0} \frac{\sin x}{x}$ |
| `\max_{x \in S} f(x)` | $\displaystyle \max_{x \in S} f(x)$ |

## 함수

| 입력 | 결과 | 입력 | 결과 | 입력 | 결과 |
| --- | :---: | --- | :---: | --- | :---: |
| `\sin x` | $\sin x$ | `\cos x` | $\cos x$ | `\tan x` | $\tan x$ |
| `\log x` | $\log x$ | `\ln x` | $\ln x$ | `\exp x` | $\exp x$ |
| `\arcsin x` | $\arcsin x$ | `\sinh x` | $\sinh x$ | `\det A` | $\det A$ |

## 크기가 바뀌는 괄호

`\left`와 `\right`를 쓰면 괄호가 내용에 맞게 커집니다.

| 입력 | 결과 | 입력 | 결과 |
| --- | :---: | --- | :---: |
| `\left( \frac{a}{b} \right)` | $\left( \frac{a}{b} \right)$ | `\left[ x \right]` | $\left[ x \right]$ |
| `\{ a, b \}` | $\{ a, b \}$ | `\langle u, v \rangle` | $\langle u, v \rangle$ |
| `\lvert x \rvert` | $\lvert x \rvert$ | `\lVert v \rVert` | $\lVert v \rVert$ |
| `\lfloor x \rfloor` | $\lfloor x \rfloor$ | `\lceil x \rceil` | $\lceil x \rceil$ |
| `\big( \Big( \bigg( \Bigg(` | $\big( \Big( \bigg( \Bigg($ | `\left. \frac{df}{dx} \right\rvert_{x=0}` | $\left. \frac{df}{dx} \right\rvert_{x=0}$ |

## 겹쳐 쓰기·부정·이름 있는 연산자

`\operatorname{…}`로 직접 만든 함수 이름을 바른 글꼴로 씁니다. `\not`은 뒤에 오는 기호에 사선을 긋습니다.

| 입력 | 결과 | 입력 | 결과 |
| --- | :---: | --- | :---: |
| `\overset{!}{=}` | $\overset{!}{=}$ | `\underset{x}{\arg\min}` | $\underset{x}{\arg\min}$ |
| `\stackrel{\text{def}}{=}` | $\stackrel{\text{def}}{=}$ | `\not\subset` | $\not\subset$ |
| `\operatorname{rank} A` | $\operatorname{rank} A$ | `a \equiv b \pmod{n}` | $a \equiv b \pmod{n}$ |
| `a \bmod b` | $a \bmod b$ | `\gcd(a, b)` | $\gcd(a, b)$ |

## 악센트와 글꼴

`\text{…}`로 수식 안에 일반 글자를 씁니다.

| 입력 | 결과 | 입력 | 결과 | 입력 | 결과 |
| --- | :---: | --- | :---: | --- | :---: |
| `\hat{x}` | $\hat{x}$ | `\bar{x}` | $\bar{x}$ | `\vec{v}` | $\vec{v}$ |
| `\dot{x}` | $\dot{x}$ | `\ddot{x}` | $\ddot{x}$ | `\tilde{x}` | $\tilde{x}$ |
| `\overline{AB}` | $\overline{AB}$ | `\underline{x}` | $\underline{x}$ | `\overrightarrow{AB}` | $\overrightarrow{AB}$ |
| `\mathbf{v}` | $\mathbf{v}$ | `\mathbb{R}` | $\mathbb{R}$ | `\mathcal{L}` | $\mathcal{L}$ |
| `\mathrm{d}x` | $\mathrm{d}x$ | `\boldsymbol{\alpha}` | $\boldsymbol{\alpha}$ | `\mathit{diff}` | $\mathit{diff}$ |
| `\mathsf{A}` | $\mathsf{A}$ | `\mathtt{A}` | $\mathtt{A}$ | `\mathfrak{g}` | $\mathfrak{g}$ |
| `\text{if } x > 0` | $\text{if } x > 0$ |  |  |  |  |

## 행렬

`$$` 블록 안에서 사용하세요. `&`는 열을, `\\`는 행을 나눕니다.

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

## 여러 줄과 경우 나누기

`&` 위치에서 줄이 정렬됩니다. `\\`는 줄을 바꿉니다.

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

## 화학식

`\ce{…}`로 화학식과 반응식을 씁니다.

| 입력 | 결과 |
| --- | :---: |
| `\ce{H2O}` | $\ce{H2O}$ |
| `\ce{2H2 + O2 -> 2H2O}` | $\ce{2H2 + O2 -> 2H2O}$ |
| `\ce{CO2 + H2O <=> H2CO3}` | $\ce{CO2 + H2O <=> H2CO3}$ |
| `\ce{^{14}_{6}C}` | $\ce{^{14}_{6}C}$ |
| `\ce{SO4^2-}` | $\ce{SO4^2-}$ |
| `\ce{Fe^3+}` | $\ce{Fe^3+}$ |

## 간격

| 입력 | 결과 | 입력 | 결과 |
| --- | :---: | --- | :---: |
| `a\,b` | $a\,b$ | `a\;b` | $a\;b$ |
| `a\quad b` | $a\quad b$ | `a\qquad b` | $a\qquad b$ |

## 색·상자·중괄호

| 입력 | 결과 |
| --- | :---: |
| `\textcolor{red}{x^2}` | $\displaystyle \textcolor{red}{x^2}$ |
| `\boxed{E = mc^2}` | $\displaystyle \boxed{E = mc^2}$ |
| `\cancel{x}` | $\displaystyle \cancel{x}$ |
| `\underbrace{a + b}_{n}` | $\displaystyle \underbrace{a + b}_{n}$ |
| `\overbrace{x + y}^{2}` | $\displaystyle \overbrace{x + y}^{2}$ |
