# Aide-mémoire Markdown

Tout ce que Graphite comprend, avec ce que vous tapez et ce que vous obtenez. **Cliquez sur un code pour le copier.** Pour les formules, voir l’onglet **LaTeX**.

## Mise en forme du texte

`%%…%%` masque le texte en mode lecture ; il reste visible pendant l’édition.

| Élément | Saisie | Résultat |
| --- | --- | --- |
| Gras | `**bold**` | **bold** |
| Gras (autre façon) | `__bold__` | __bold__ |
| Italique | `*italic*` | *italic* |
| Italique (autre façon) | `_italic_` | _italic_ |
| Gras et italique | `***bold and italic***` | ***bold and italic*** |
| Barré | `~~strikethrough~~` | ~~strikethrough~~ |
| Surlignage | `==highlight==` | ==highlight== |
| Code en ligne | `` `code` `` | `code` |
| Afficher un symbole tel quel | `\*not italic\*` | \*not italic\* |
| Commentaire masqué | `visible %%hidden%% text` | visible %%hidden%% text |

## Liens et étiquettes

Les liens vers des notes inexistantes apparaissent estompés ; cliquer dessus dans une note la crée. `#` ne commence une étiquette que s’il touche directement un mot.

| Élément | Saisie | Résultat |
| --- | --- | --- |
| Lien vers une note | `[[Note name]]` | [[Note name]] |
| Lien avec un autre texte | `[[Note name\|shown text]]` | [[Note name\|shown text]] |
| Lien vers un titre | `[[Note name#Heading]]` | [[Note name#Heading]] |
| Titre de cette note | `[[#Heading]]` | [[#Heading]] |
| Lien web | `[Obsidian](https://obsidian.md)` | [Obsidian](https://obsidian.md) |
| Lien Markdown vers une note | `[text](Note%20name.md)` | [text](Note%20name.md) |
| Lien web entre < > | `<https://obsidian.md>` | <https://obsidian.md> |
| Adresse web simple | `https://obsidian.md` | https://obsidian.md |
| Étiquette | `#tag` | #tag |
| Étiquette imbriquée | `#project/ideas` | #project/ideas |

## Intégrations et images

Ces éléments affichent le contenu d’autres fichiers du coffre ; ils ne sont donc pas rendus ici. Collez ou déposez une image dans l’éditeur pour l’ajouter automatiquement à `attachments/`.

| Élément | Saisie |
| --- | --- |
| Intégrer une note entière | `![[Note name]]` |
| Intégrer une section | `![[Note name#Heading]]` |
| Image du coffre | `![[image.png]]` |
| Image avec largeur (px) | `![[image.png\|300]]` |
| Image (style Markdown) | `![description](image.png)` |
| Image du web | `![description](https://example.com/picture.png)` |
| PDF | `![[document.pdf]]` |
| Audio | `![[recording.mp3]]` |
| Vidéo | `![[clip.mp4]]` |

## Titres

Mettez une espace après les `#`. Les titres apparaissent dans le Plan et peuvent être liés avec `[[Note#Titre]]`.

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

## Paragraphes et retours à la ligne

Laissez une ligne vide entre les paragraphes. Un simple retour à la ligne est conservé.

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

## Listes et tâches

Indentez avec **Tab** (ou deux espaces) pour imbriquer. **Entrée** continue la liste. Cochez les tâches en cliquant dessus en mode lecture.

**Liste à puces**

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

**Liste numérotée**

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

**Liste imbriquée**

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

**Liste de tâches**

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

## Citations et encadrés

Types d’encadrés : `note`, `abstract`, `info`, `todo`, `tip`, `success`, `question`, `warning`, `failure`, `danger`, `bug`, `example`, `quote`. Ajoutez `-` (replié) ou `+` (ouvert) après le type pour le rendre repliable.

**Citation**

~~~~markdown
> The best way to have a good idea
> is to have lots of ideas.
~~~~

<div class="md-example">

> The best way to have a good idea
> is to have lots of ideas.

</div>

**Citation dans une citation**

~~~~markdown
> Outer quote
>> Quote inside a quote
~~~~

<div class="md-example">

> Outer quote
>> Quote inside a quote

</div>

**Encadré avec titre**

~~~~markdown
> [!note] Title of the callout
> Text inside the callout.
~~~~

<div class="md-example">

> [!note] Title of the callout
> Text inside the callout.

</div>

**Encadré sans titre**

~~~~markdown
> [!tip]
> Without a title, the type is used as the title.
~~~~

<div class="md-example">

> [!tip]
> Without a title, the type is used as the title.

</div>

**Encadré replié**

~~~~markdown
> [!question]- Click to open
> Hidden until you open it.
~~~~

<div class="md-example">

> [!question]- Click to open
> Hidden until you open it.

</div>

**Encadré repliable, ouvert**

~~~~markdown
> [!example]+ Click to close
> Shown, but can be folded.
~~~~

<div class="md-example">

> [!example]+ Click to close
> Shown, but can be folded.

</div>

**Tous les types d’encadrés**

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

## Blocs de code

Écrivez le langage après la barrière d’ouverture (`python`, `js`, `bash`…).

**Bloc de code avec langage**

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

**Bloc de code avec tildes**

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

## Tableaux

Les deux-points de la deuxième ligne règlent l’alignement. Les barres extérieures sont facultatives.

**Tableau**

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

**Alignement des colonnes**

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

## Lignes et formules

Trois `-`, `*` ou `_` ou plus sur une ligne font une ligne horizontale. Toutes les commandes de formules sont dans l’onglet **LaTeX**.

**Ligne horizontale**

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

**Formule dans une phrase**

~~~~markdown
Einstein: $E = mc^2$
~~~~

<div class="md-example">

Einstein: $E = mc^2$

</div>

**Formule sur sa propre ligne**

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

## Propriétés

Doivent être les toutes premières lignes de la note. `tags` ajoute des étiquettes ; toute autre paire `clé: valeur` s’affiche dans l’encadré Propriétés en haut de la note.

**Propriétés**

~~~~markdown
---
tags: [project, ideas]
aliases: [Other name]
status: active
created: 2026-11-08
---
~~~~

## HTML

Les balises HTML simples fonctionnent dans les notes.

| Élément | Saisie | Résultat |
| --- | --- | --- |
| Souligné | `<u>underline</u>` | <u>underline</u> |
| Exposant | `x<sup>2</sup>` | x<sup>2</sup> |
| Indice | `H<sub>2</sub>O` | H<sub>2</sub>O |
| Touches du clavier | `<kbd>Ctrl</kbd> + <kbd>C</kbd>` | <kbd>Ctrl</kbd> + <kbd>C</kbd> |
| Retour à la ligne n’importe où | `line one<br>line two` | line one<br>line two |
| Texte en couleur | `<span style="color:#e93147">red text</span>` | <span style="color:#e93147">red text</span> |
| Cliquer pour en voir plus | `<details><summary>More</summary>Hidden text</details>` | <details><summary>More</summary>Hidden text</details> |
