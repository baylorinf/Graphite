# Chuleta de Markdown

Todo lo que Graphite entiende, con lo que escribes y lo que obtienes. **Haz clic en cualquier código para copiarlo.** Para fórmulas, mira la pestaña **LaTeX**.

## Formato de texto

`%%…%%` oculta el texto en la vista de lectura; sigue visible al editar.

| Qué | Escribe | Resultado |
| --- | --- | --- |
| Negrita | `**bold**` | **bold** |
| Negrita (otra forma) | `__bold__` | __bold__ |
| Cursiva | `*italic*` | *italic* |
| Cursiva (otra forma) | `_italic_` | _italic_ |
| Negrita y cursiva | `***bold and italic***` | ***bold and italic*** |
| Tachado | `~~strikethrough~~` | ~~strikethrough~~ |
| Resaltado | `==highlight==` | ==highlight== |
| Código en línea | `` `code` `` | `code` |
| Mostrar un símbolo tal cual | `\*not italic\*` | \*not italic\* |
| Comentario oculto | `visible %%hidden%% text` | visible %%hidden%% text |

## Enlaces y etiquetas

Los enlaces a notas que aún no existen se ven atenuados; al hacer clic en uno dentro de una nota, se crea. `#` solo empieza una etiqueta si toca directamente una palabra.

| Qué | Escribe | Resultado |
| --- | --- | --- |
| Enlace a una nota | `[[Note name]]` | [[Note name]] |
| Enlace con otro texto | `[[Note name\|shown text]]` | [[Note name\|shown text]] |
| Enlace a un encabezado | `[[Note name#Heading]]` | [[Note name#Heading]] |
| Encabezado de esta nota | `[[#Heading]]` | [[#Heading]] |
| Enlace web | `[Obsidian](https://obsidian.md)` | [Obsidian](https://obsidian.md) |
| Enlace Markdown a una nota | `[text](Note%20name.md)` | [text](Note%20name.md) |
| Enlace web entre < > | `<https://obsidian.md>` | <https://obsidian.md> |
| Dirección web simple | `https://obsidian.md` | https://obsidian.md |
| Etiqueta | `#tag` | #tag |
| Etiqueta anidada | `#project/ideas` | #project/ideas |

## Insertar notas e imágenes

Muestran contenido de otros archivos de la bóveda, por eso no se ven aquí. Pega o arrastra una imagen al editor para añadirla a `attachments/` automáticamente.

| Qué | Escribe |
| --- | --- |
| Insertar una nota entera | `![[Note name]]` |
| Insertar una sección | `![[Note name#Heading]]` |
| Imagen de la bóveda | `![[image.png]]` |
| Imagen con ancho (px) | `![[image.png\|300]]` |
| Imagen (estilo Markdown) | `![description](image.png)` |
| Imagen de la web | `![description](https://example.com/picture.png)` |
| PDF | `![[document.pdf]]` |
| Audio | `![[recording.mp3]]` |
| Vídeo | `![[clip.mp4]]` |

## Encabezados

Pon un espacio después de los `#`. Los encabezados aparecen en el Esquema y se pueden enlazar con `[[Nota#Encabezado]]`.

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

## Párrafos y saltos de línea

Deja una línea vacía entre párrafos. Un salto de línea simple se conserva.

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

## Listas y tareas

Sangra con **Tab** (o dos espacios) para anidar. **Intro** continúa la lista. Marca las tareas haciendo clic en la vista de lectura.

**Lista con viñetas**

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

**Lista numerada**

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

**Lista anidada**

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

**Lista de tareas**

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

## Citas y bloques destacados

Tipos de bloque: `note`, `abstract`, `info`, `todo`, `tip`, `success`, `question`, `warning`, `failure`, `danger`, `bug`, `example`, `quote`. Añade `-` (plegado) o `+` (abierto) tras el tipo para hacerlo plegable.

**Cita**

~~~~markdown
> The best way to have a good idea
> is to have lots of ideas.
~~~~

<div class="md-example">

> The best way to have a good idea
> is to have lots of ideas.

</div>

**Cita dentro de una cita**

~~~~markdown
> Outer quote
>> Quote inside a quote
~~~~

<div class="md-example">

> Outer quote
>> Quote inside a quote

</div>

**Bloque destacado con título**

~~~~markdown
> [!note] Title of the callout
> Text inside the callout.
~~~~

<div class="md-example">

> [!note] Title of the callout
> Text inside the callout.

</div>

**Bloque destacado sin título**

~~~~markdown
> [!tip]
> Without a title, the type is used as the title.
~~~~

<div class="md-example">

> [!tip]
> Without a title, the type is used as the title.

</div>

**Bloque plegado**

~~~~markdown
> [!question]- Click to open
> Hidden until you open it.
~~~~

<div class="md-example">

> [!question]- Click to open
> Hidden until you open it.

</div>

**Bloque plegable, abierto**

~~~~markdown
> [!example]+ Click to close
> Shown, but can be folded.
~~~~

<div class="md-example">

> [!example]+ Click to close
> Shown, but can be folded.

</div>

**Todos los tipos de bloque**

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

## Bloques de código

Escribe el lenguaje tras la valla de apertura (`python`, `js`, `bash`…).

**Bloque de código con lenguaje**

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

**Bloque de código con virgulillas**

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

## Tablas

Los dos puntos de la segunda fila fijan la alineación. Las barras exteriores son opcionales.

**Tabla**

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

**Alineación de columnas**

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

## Líneas y fórmulas

Tres o más `-`, `*` o `_` en su propia línea forman una línea horizontal. Todos los comandos de fórmulas están en la pestaña **LaTeX**.

**Línea horizontal**

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

**Fórmula en una frase**

~~~~markdown
Einstein: $E = mc^2$
~~~~

<div class="md-example">

Einstein: $E = mc^2$

</div>

**Fórmula en su propia línea**

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

## Propiedades

Deben ser las primeras líneas de la nota. `tags` añade etiquetas; cualquier otro `clave: valor` aparece en el recuadro de Propiedades arriba de la nota.

**Propiedades**

~~~~markdown
---
tags: [project, ideas]
aliases: [Other name]
status: active
created: 2026-11-08
---
~~~~

## HTML

Las etiquetas HTML sencillas funcionan dentro de las notas.

| Qué | Escribe | Resultado |
| --- | --- | --- |
| Subrayado | `<u>underline</u>` | <u>underline</u> |
| Superíndice | `x<sup>2</sup>` | x<sup>2</sup> |
| Subíndice | `H<sub>2</sub>O` | H<sub>2</sub>O |
| Teclas | `<kbd>Ctrl</kbd> + <kbd>C</kbd>` | <kbd>Ctrl</kbd> + <kbd>C</kbd> |
| Salto de línea en cualquier sitio | `line one<br>line two` | line one<br>line two |
| Texto en color | `<span style="color:#e93147">red text</span>` | <span style="color:#e93147">red text</span> |
| Clic para ver más | `<details><summary>More</summary>Hidden text</details>` | <details><summary>More</summary>Hidden text</details> |
