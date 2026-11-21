# Guide de Graphite

Graphite est une application de prise de notes reliées entre elles. Chaque note est un simple fichier Markdown (`.md`) sur votre ordinateur : vos notes restent toujours à vous.

> [!tip] Ouvrez ce guide à tout moment avec **F1**, le bouton **?** du ruban de gauche, ou la palette de commandes (`Ctrl+P`, puis tapez « aide »).

## Fichiers et échéances de Canvas SJTU

Ouvrez Canvas avec le **bouton université** (un bâtiment) du ruban en bas à gauche (ou un nouvel onglet, ou **Paramètres → Général**) et choisissez **Se connecter avec jAccount**. Tout reste dans Graphite : devoirs, annonces, pages et discussions s’ouvrent dans le lecteur de Graphite, et les fichiers s’ouvrent dans Graphite une fois enregistrés dans votre coffre. **Ouvrir dans la fenêtre Canvas de Graphite** sert pour ce que le lecteur ne montre pas (passer un quiz, répondre à une discussion).

**Les diapositives arrivent seules.** Avec **Synchroniser les diapositives automatiquement**, Graphite récupère les nouveaux fichiers au démarrage puis toutes les 3 heures tant que vous êtes connecté. Choisissez pour chaque cours où vont ses fichiers (**Dossier du cours** : Graphite devine le dossier, p. ex. 线性代数 → *Linear Algebra*, ou en crée un au nom du cours). Il n’y a plus de dossier Canvas à part : les notes de devoirs vont dans `作业 Homework/`, les exigences du cours dans le dossier du cours, et les fichiers tels que l’école les a envoyés sont gardés à l’écart, rien n’est téléchargé deux fois. Un ancien dossier `Canvas/` est réparti une fois dans les dossiers de cours, au premier démarrage. Diapositives dans `<Cours>/课件 Slides/`, devoirs dans `作业 Homework/`, examens et corrigés dans `复习资料/` ; les PowerPoint et Word reçoivent une copie PDF. Un fichier déjà présent est ignoré, rien n’est jamais écrasé (un autre fichier du même nom devient « nom (2) »), un fichier supprimé ne revient pas, et la note d’index du cours reçoit une ligne de liens. Un badge sur le bouton Canvas et la carte **Nouveau dans vos dossiers de cours** montrent ce qui a été ajouté. **Récupérer les supports de tous les cours** fait de même tout de suite.

**Échéances et remise en un clic.** **À venir (30 jours)** indique les jours restants. **Remettre le devoir** à côté d’une échéance choisit le fichier correspondant dans le dossier de devoirs du cours et affiche l’aperçu ; vérifiez puis **Confirmer et remettre**. Rien n’est envoyé avant votre confirmation. Dans **Devoirs**, vous pouvez aussi choisir vous-même des fichiers. Ajoutez votre calendrier Canvas sous **Abonnement au calendrier**.

## Capturer, classer et réviser ce que vous lisez

Copier le texte d’un PDF ou d’une page d’étude casse les maths et la mise en forme. Utilisez plutôt **Capturer** (`Alt+S`, les ciseaux de la barre d’un PDF, ou **Capturer** dans la barre de sélection) : tracez un cadre autour d’une formule, d’une figure ou d’un tableau. Le panneau de capture propose :

- **Demander à Graphie** : le chat s’ouvre avec la capture jointe.
- **En Markdown** : l’IA choisie pour *Capture en Markdown* (**Paramètres → IA**) la retranscrit en Markdown avec des maths `$…$`, modifiable avant usage.
- **Ajouter à la note** : choisissez la note et la **section** ; un lien vers la page est ajouté. Sans Markdown, l’image elle-même est intégrée (dans `attachments/`).
- **Pas familier** : Graphie l’explique aussitôt dans le chat, il est gardé dans Claude Inbox, et une carte revient dans la révision de demain.
- **Intéressant** : classé en encadré `[!tip]` sous la section choisie (ou laissé à Graphie).
- **Carte** / **Carnet d’erreurs** : une carte dans le **paquet** du cours (révision espacée), ou un exercice à refaire.

Les mêmes actions figurent dans la barre de sélection. Sur la page **Révision**, chaque paquet a son bouton pour ne réviser que ce cours.

## Votre coffre
- Le **coffre** est le dossier qui contient vos notes. Son emplacement figure dans **Paramètres → Général**.
- Pour utiliser un autre dossier, par exemple un coffre Obsidian existant, lancez l’application avec `node server.js "D:\chemin\du\coffre"`.
- Les notes supprimées sont déplacées dans le dossier `.trash` du coffre : vous pouvez les récupérer.
- Les fichiers modifiés dans d’autres programmes apparaissent aussitôt dans l’application.
- Les titres de notes peuvent contenir n’importe quel caractère. Ceux que Windows n’accepte pas dans les noms de fichiers, comme `: ? / " < > * | \ # ^ [ ]`, sont enregistrés sous une forme ressemblante (par exemple `:` devient `꞉`). Les liens tapés avec les caractères normaux trouvent quand même la note.
- Dans l’application de bureau, un bouton **Mettre à jour** apparaît dans le ruban de gauche et la barre d’état quand une nouvelle version est disponible. Cliquez dessus pour l’installer : vos notes sont d’abord enregistrées, puis l’application se rouvre d’elle-même.

## Écrire
- Passez de **Éditer** à **Partagé** (éditeur et aperçu côte à côte) puis à **Lecture** avec les boutons en haut à droite, ou avec `Ctrl+E`.
- Les notes s’enregistrent automatiquement. `Ctrl+S` enregistre immédiatement.
- Renommez une note en modifiant son titre : tous les liens vers elle sont mis à jour.
- Collez ou déposez une image dans l’éditeur pour l’enregistrer dans `attachments/` et l’intégrer.

| Mise en forme | Saisie |
| --- | --- |
| Gras / italique | `**gras**` / `*italique*` (ou `Ctrl+B` / `Ctrl+I`) |
| Surlignage | `==surligné==` |
| Barré | `~~texte~~` |
| Titre | `# Titre`, `## Sous-titre` |
| Tâche | `- [ ] à faire`, `- [x] fait` |
| Code | `` `en ligne` `` ou un bloc entouré de ```` ``` ```` |
| Commentaire masqué | `%%visible uniquement en édition%%` |

Toute la syntaxe, avec des exemples à copier, se trouve dans l’<a href="#" data-help-page="markdown">aide-mémoire Markdown</a>.

## Relier les notes
- `[[Nom de la note]]` crée un lien. Tapez `[[` pour obtenir des suggestions.
- `[[Nom de la note|texte affiché]]` change le texte du lien, et `[[Nom de la note#Titre]]` mène à un titre.
- `![[Nom de la note]]` intègre une note entière. `![[image.png]]` affiche une image, et `![[image.png|300]]` fixe sa largeur.
- Les liens vers des notes inexistantes apparaissent estompés : cliquez pour créer la note.
- Le panneau de droite affiche les **liens entrants**, les **mentions non liées**, les **liens sortants**, les **étiquettes** et le **plan**.

## Organiser
- **Dossiers :** faites glisser notes et dossiers pour les déplacer, et faites un clic droit pour plus d’options.
- **Étiquettes :** écrivez `#tag` n’importe où, ou `tags: [a, b]` dans le bloc de propriétés en haut d’une note.
- **Propriétés :** commencez une note par un bloc `---` contenant des lignes `clé: valeur`.
- **Notes quotidiennes :** `Alt+D` ouvre la note du jour dans `Daily Notes/`.

> [!example] Exemple de propriétés
> ```
> ---
> tags: [projet, idées]
> status: actif
> ---
> ```

## Retrouver
- **Sélecteur rapide** (`Ctrl+O`) : tapez une partie d’un nom pour ouvrir une note. Si rien ne correspond, `Maj+Entrée` la crée.
- **Recherche** (`Ctrl+Maj+F`) : parcourt toutes les notes. Les filtres se combinent :

| Recherche | Trouve |
| --- | --- |
| `réunion notes` | les notes contenant les deux mots |
| `"phrase exacte"` | cette phrase exacte |
| `#projet` | les notes avec l’étiquette (y compris `#projet/sous`) |
| `path:Idées` | les notes d’un dossier |
| `file:brouillon` | les notes dont le nom contient « brouillon » |

- **Vue graphique** (`Ctrl+G`) : une carte de vos notes qui fonctionne un peu comme la mémoire du cerveau. Faites glisser pour déplacer, la molette pour zoomer. **Graphe local** n’affiche que les voisins de la note actuelle.
  - **Régions :** les notes très liées se regroupent en zones colorées, nommées d’après leur tag commun ou leur note la plus connectée.
  - **Associations :** des lignes pointillées relient des notes aux idées proches que vous n’avez pas encore liées. Elles sont trouvées en comparant les mots de vos notes.
  - **Mémoire :** les notes bien retenues (d’après vos quiz) brillent, celles que vous oubliez pâlissent, et celles à réviser ont un anneau orange qui pulse.
  - **Cliquez sur une note** pour « y penser » : une impulsion se propage le long de ses liens, et une carte liste ce qu’elle **évoque**, du plus fort au plus faible, avec son état en mémoire et les boutons **Ouvrir**, **Me tester** et **Vagabonder d’ici**. Un **double-clic** ouvre la note.
  - **Laisser vagabonder mon esprit** passe d’une pensée à l’autre par vos liens les plus forts, avec parfois un saut vers une idée sans rapport (⤳), et laisse en bas un **fil de pensée** cliquable.

## Encadrés
Commencez une citation par `[!type]` pour créer un encadré coloré. Types disponibles : `note`, `tip`, `warning`, `danger`, `success`, `question`, `example`, `quote`. Ajoutez `-` après le type pour qu’il soit replié, ou `+` pour qu’il soit repliable mais ouvert.

```
> [!warning]- Cliquez pour déplier
> Caché jusqu’à l’ouverture.
```

## Formules mathématiques (LaTeX)
Écrivez vos formules en LaTeX, comme dans Obsidian :
- **En ligne :** `$E = mc^2$` affiche $E = mc^2$ dans la phrase.
- **Bloc :** placez `$$` sur la ligne avant et après la formule pour l’afficher centrée sur sa propre ligne :

```
$$
\int_0^1 x^2\,dx = \frac{1}{3}
$$
```

$$
\int_0^1 x^2\,dx = \frac{1}{3}
$$

- **Chimie :** `$\ce{2H2 + O2 -> 2H2O}$` affiche $\ce{2H2 + O2 -> 2H2O}$
- **Les montants sont sans risque :** un `$` suivi d’une espace ou d’un chiffre n’est pas traité comme une formule. Pour afficher un signe dollar n’importe où, tapez `\$`.
- **Commande :** **Insérer un bloc de formule** dans la palette de commandes ajoute un bloc `$$` vide.
- **Erreurs :** une formule erronée s’affiche en rouge, pour que vous voyiez quoi corriger.
- **Liste complète :** l’<a href="#" data-help-page="latex">aide-mémoire LaTeX</a> présente environ 160 commandes avec leur résultat. Il est aussi dans la palette de commandes : **Ouvrir l’aide-mémoire LaTeX**.

## Raccourcis clavier
| Action | Touches |
| --- | --- |
| Palette de commandes | `Ctrl+P` |
| Sélecteur rapide | `Ctrl+O` |
| Nouvelle note | `Alt+N` |
| Note quotidienne | `Alt+D` |
| Édition / lecture | `Ctrl+E` |
| Vue graphique | `Ctrl+G` |
| Rechercher | `Ctrl+Maj+F` |
| Renommer la note | `F2` |
| Retour / suivant | `Alt+←` / `Alt+→` |
| Gras / italique / lien | `Ctrl+B` / `Ctrl+I` / `Ctrl+K` |
| Indenter / désindenter | `Tab` / `Maj+Tab` |
| Paramètres | `Ctrl+,` |
| Capturer une zone | `Alt+S` |
| Ce guide | `F1` |

## Révision et mémoire
Graphite vous aide à retenir ce que vous écrivez. Vos notes deviennent automatiquement des questions :

- Les mots `==surlignés==` ou en **gras** dans une phrase deviennent des textes à trous, et `- **Terme** : définition` devient « Qu’est-ce que Terme ? ».
- `Question :: réponse` sur une ligne (ou une question, une ligne avec seulement `?`, puis la réponse) devient une carte.
- Chaque section avec un titre devient « Que retenez-vous de … ? ».

**Vérifier les erreurs :** le bouton loupe en haut (`Ctrl+Maj+E`) vérifie la note ouverte. Chaque problème s’affiche sous la forme ancien texte → texte corrigé, avec une courte explication. Cliquez sur **Appliquer** pour corriger (`Ctrl+Z` annule), **Voir dans la note** pour y aller, ou **Ignorer**. Sans IA, une vérification de base trouve les mots répétés, les espaces manquantes, les `[[liens]]` cassés (avec la note la plus proche suggérée), les `**`/`==` non fermés et les niveaux de titre sautés. Avec l’IA, l’IA vérifie aussi les faits, l’orthographe, la grammaire et les phrases peu claires.

**Quiz :** la toque en haut (`Ctrl+Maj+K`) vous teste sur la note ouverte. Avec l’IA, l’IA ajoute ses propres questions sur la note ; elles sont écrites une fois par version de la note. Quand vous quittez une note que vous venez d’écrire, une petite carte propose **Vérifier** ou **Me tester**. Les deux sont aussi dans le menu du clic droit.

**Choisir l’IA :** dans **Paramètres → IA**, chaque tâche (Vérifier, Questions de quiz, Chat, Plans de révision, Analyse d’examen, Mise en forme) a son propre choix. **Claude Code** utilise la fenêtre Claude de cet ordinateur, sans clé, mais seulement quand elle est connectée (dites-y « connect to Graphite »). Les **modèles par API** marchent à tout moment avec votre propre clé : Anthropic (Claude), OpenAI, Google Gemini, DeepSeek, Qwen, Kimi, GLM ou tout service compatible OpenAI. Collez une clé sous **Clés API** et cliquez sur **Tester la clé**, qui charge aussi les modèles actuels du fournisseur. Les clés restent sur cet ordinateur, et seule la note ou la copie concernée est envoyée, à ce seul fournisseur. Chaque tâche a aussi **Modèle pour cette tâche** : gardez **Par défaut** (le modèle de la clé) ou choisissez un autre modèle du même fournisseur. Vérifier et le chat ont aussi un menu pour changer d’IA sur place.

**Plan de révision :** sur la page Révision (ou dans la palette), **Faire un plan de révision**. Indiquez l’examen, sa date, le programme, cochez les dossiers concernés et le temps par jour. L’IA planifie chaque jour jusqu’à l’examen, sujets faibles et à revoir d’abord, et enregistre le plan avec des cases à cocher dans `<Cours>/复习计划 Review Plans`.

**Analyse de sujet d’examen :** **Analyser un sujet d’examen** sur la page Révision, ou clic droit sur un PDF ou une note dans la liste des fichiers. L’IA liste chaque exercice avec son thème et votre note correspondante, explique les erreurs si vos réponses ou notes figurent sur la copie, puis donne des conseils et un plan, enregistrés dans `<Cours>/考试分析 Exam Analysis`. Pour un PDF scanné, choisissez Claude Code.

**Mise en forme :** le bouton 🪄 en haut (`Ctrl+Maj+Y`) donne à la note ouverte le format des autres notes de son dossier : frontmatter, titres, numérotation, lignes de source et « Related ». Le contenu ne change pas ; vous voyez d’abord un aperçu avant/après, et `Ctrl+Z` annule.

**Pages d’étude :** les pages de révision interactives sont dans le dossier `学习页面 Study Pages` de chaque cours. Cliquez sur l’une d’elles dans la liste des fichiers (ou sur un lien) pour l’ouvrir dans un onglet 🎓.

**Word et PowerPoint :** les fichiers `.docx` s’ouvrent comme une page lisible (**Mise en page exacte** les montre comme Word les imprime). Les fichiers `.doc`, `.ppt` et `.pptx` s’ouvrent en PDF créé par votre Word ou PowerPoint, avec numéros de page, zoom, recherche et « Lien vers une page… » ; la première fois prend quelques secondes, ensuite c’est instantané. **Enregistrer une copie PDF** place un PDF à côté de l’original.

**Révision quotidienne :** le bouton cerveau du ruban de gauche (`Alt+R`) indique le nombre de questions à revoir. Notez chaque réponse **À revoir**, **Difficile**, **Bien** ou **Facile**. L’application programme alors la révision suivante juste avant l’oubli (répétition espacée).

**Notes liées par le sujet :** le panneau de droite suggère des notes sur des sujets proches qui ne sont pas encore liées. Cliquez sur **Lier** pour les relier.

## Synchroniser entre appareils
Graphite se synchronise via un dossier cloud. Placez votre coffre dans OneDrive (intégré à Windows), Dropbox, Google Drive ou iCloud Drive, et ouvrez ce même dossier sur chaque ordinateur. **Paramètres → Synchronisation** indique si votre coffre est synchronisé et où se trouvent vos dossiers cloud.

- **Modifier sur deux appareils à la fois :** si les modifications portent sur des parties différentes d’une note, elles sont combinées automatiquement. Si les mêmes lignes ont changé, votre version reste dans la note et l’autre est enregistrée à côté sous forme de copie « (conflict …) » : rien n’est perdu.
- **Les copies en conflit**, qu’elles viennent de Graphite ou de votre application cloud, sont listées dans **Paramètres → Synchronisation**. Un avertissement ⚠ dans la barre d’état vous signale leur présence.
- **Sur votre téléphone :** utilisez l’application officielle Obsidian (gratuite) sur le même dossier. Sur iPhone et iPad, gardez le coffre dans iCloud Drive. Sur Android, copiez le dossier sur votre téléphone avec une application comme FolderSync ou Syncthing.

## Plugins
Graphite peut exécuter de nombreux **plugins communautaires d’Obsidian**.

1. Ouvrez les **Paramètres** (icône d’engrenage ou `Ctrl+,`), puis **Plugins communautaires**.
2. Cliquez sur **Activer les plugins communautaires**. Les plugins sont du code écrit par d’autres personnes et peuvent modifier vos notes : n’utilisez que ceux en qui vous avez confiance.
3. Cliquez sur **Parcourir**, cherchez, puis **Installer**. Vous pouvez aussi copier le dossier d’un plugin dans `.obsidian/plugins/` dans votre coffre.
4. Activez le plugin avec son interrupteur. S’il a des options, une icône d’engrenage apparaît à côté.

> [!info] Ce qui fonctionne
> Les commandes, icônes du ruban, éléments de la barre d’état, pages de paramètres, rendus Markdown et de blocs de code, suggestions de l’éditeur, menus de fichiers, fenêtres et notifications fonctionnent. Les plugins qui ouvrent leurs propres panneaux latéraux ou modifient l’éditeur lui-même (extensions CodeMirror) ne fonctionneront pas entièrement. Si un plugin ne se charge pas, la raison s’affiche sous son nom.

Les plugins utilisent la même organisation de dossiers qu’Obsidian. Si vous ouvrez un coffre Obsidian avec Graphite, les plugins déjà installés apparaissent automatiquement.

### Gérer les plugins
- **Désinstaller :** l’icône de corbeille à côté d’un plugin le supprime. Son dossier est déplacé dans le `.trash` du coffre, vous pouvez donc le récupérer.
- **Recharger les plugins** (la flèche circulaire à côté de « Plugins installés ») charge à nouveau tous les plugins. Utilisez-le après avoir copié ou modifié un dossier de plugin. Cette action existe aussi dans la palette de commandes.
- **Ouvrir le dossier des plugins** (l’icône de dossier) affiche `.obsidian/plugins/` dans l’Explorateur de fichiers.

### Plugin d’exemple : Note Stats
Graphite est fourni avec un petit plugin d’exemple, **Note Stats**. Activez-le pour obtenir :
- le temps de lecture dans la barre d’état
- une fenêtre de statistiques (l’icône de graphique dans le ruban, ou la commande « Note Stats: Show statistics for this note »)
- un bloc de code ```` ```stats ```` qui indique le nombre de notes, de liens et d’étiquettes de votre coffre
- des suggestions de date quand vous tapez `@today`, `@tomorrow` ou `@yesterday`
- **Copy wikilink** dans le menu du clic droit sur un fichier

Son code, dans `.obsidian/plugins/note-stats/main.js`, est un court exemple pour écrire votre propre plugin.

### Dataview
Les requêtes Dataview (blocs ```` ```dataview ````) affichent leurs résultats en mode **Lecture** et **Partagé**. L’aperçu en direct de Dataview dans l’éditeur ne fonctionne pas, car il nécessite des fonctions d’éditeur que Graphite n’a pas.

## Langue et apparence
- Changez de langue avec le bouton 🌐 ou dans **Paramètres → Général**. L’application démarre dans la langue de votre système.
- Basculez entre thème clair et sombre avec le bouton en forme de lune.
- Changez la police du texte, la police du code et la taille du texte dans **Paramètres → Apparence**. Vous pouvez aussi écrire dans une police à chasse fixe pendant l’édition.
- Faites glisser le bord des panneaux latéraux pour les redimensionner, et masquez-les avec les boutons du haut.
