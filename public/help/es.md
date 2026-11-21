# Guía de Graphite

Graphite es una aplicación para tomar notas conectadas entre sí. Cada nota es un simple archivo Markdown (`.md`) en tu ordenador, así que tus notas siempre son tuyas.

> [!tip] Abre esta guía cuando quieras con **F1**, el botón **?** de la cinta izquierda o la paleta de comandos (`Ctrl+P` y escribe «ayuda»).

## Archivos y fechas de Canvas SJTU

Abre Canvas con el **botón de la universidad** (un edificio) de la cinta inferior izquierda (o una pestaña nueva, o **Ajustes → General**) y elige **Acceder con jAccount**. Todo se queda en Graphite: tareas, anuncios, páginas y debates se abren en el lector de Graphite, y los archivos se abren en Graphite tras guardarse en tu bóveda. **Abrir en la ventana Canvas de Graphite** sirve para lo que el lector no muestra (hacer un cuestionario, responder en un debate).

**Las diapositivas llegan solas.** Con **Sincronizar diapositivas automáticamente**, Graphite trae archivos nuevos al iniciar y cada 3 horas mientras tengas la sesión abierta. Elige en cada curso dónde van sus archivos (**Archivos nuevos en**: Graphite adivina la carpeta, p. ej. 线性代数 → *Linear Algebra*). Diapositivas en `<Curso>/课件 Slides/`, tareas en `作业 Homework/`, exámenes y soluciones en `复习资料/`; PowerPoint y Word reciben una copia PDF. Lo que ya está se omite, nunca se sobrescribe nada (otro archivo con el mismo nombre pasa a «nombre (2)»), lo que borres no vuelve, y la nota índice del curso recibe una línea de enlaces. Una insignia en el botón de Canvas y la tarjeta **Nuevo en tus carpetas de curso** muestran lo añadido.

**Fechas y entrega en un clic.** **Próximos 30 días** muestra los días que faltan. **Entregar tarea** junto a una fecha elige el archivo correspondiente de la carpeta de tareas del curso y muestra la vista previa; revísala y pulsa **Confirmar y entregar**. Nada se envía antes de confirmar. En **Tareas** también puedes elegir archivos tú mismo. Añade tu calendario de Canvas en **Suscripción de calendario**.

## Recortar, archivar y repasar lo que lees

Copiar texto de un PDF o de una página de estudio rompe las fórmulas y el formato. Usa **Recortar** (`Alt+S`, las tijeras de la barra del PDF o **Recortar** en la barra de selección): dibuja un recuadro sobre una fórmula, figura o tabla. El panel de captura ofrece:

- **Preguntar a Graphie**: se abre el chat con la captura adjunta.
- **A Markdown**: la IA elegida para *Captura a Markdown* (**Ajustes → IA**) la transcribe en Markdown con fórmulas `$…$`, editable antes de usarla.
- **Añadir a la nota**: elige la nota y la **sección**; se añade un enlace a la página. Sin Markdown, se incrusta la imagen (en `attachments/`).
- **No me suena**: Graphie lo explica enseguida en el chat, queda en Claude Inbox y una tarjeta vuelve en el repaso de mañana.
- **Interesante**: se archiva como bloque `[!tip]` en la sección elegida (o se deja a Graphie).
- **Tarjeta** / **Errores**: una tarjeta en el **mazo** del curso (repaso espaciado) o un problema para rehacer.

Las mismas acciones están en la barra de selección. En la página **Repaso**, cada mazo tiene su botón para repasar solo ese curso.

## Tu bóveda
- La **bóveda** es la carpeta que contiene tus notas. Su ubicación aparece en **Ajustes → General**.
- Para usar otra carpeta, por ejemplo una bóveda de Obsidian que ya tengas, inicia la aplicación con `node server.js "D:\ruta\a\la\bóveda"`.
- Las notas eliminadas se mueven a la carpeta `.trash` de la bóveda, así que puedes recuperarlas.
- Los archivos que cambies en otros programas aparecen al momento en la aplicación.
- Los títulos de las notas pueden llevar cualquier carácter. Los que Windows no permite en nombres de archivo, como `: ? / " < > * | \ # ^ [ ]`, se guardan con un carácter parecido (por ejemplo, `:` pasa a ser `꞉`). Los enlaces escritos con los caracteres normales siguen encontrando la nota.
- En la aplicación de escritorio aparece un botón **Actualizar** en la cinta izquierda y en la barra de estado cuando hay una versión nueva. Haz clic para instalarla: primero se guardan tus notas y la aplicación se vuelve a abrir sola.

## Escribir
- Cambia entre **Editar**, **Dividir** (editor y vista previa lado a lado) y **Leer** con los botones de arriba a la derecha, o con `Ctrl+E`.
- Las notas se guardan solas. `Ctrl+S` guarda al instante.
- Cambia el nombre de una nota editando su título: todos los enlaces a ella se actualizan.
- Pega o arrastra una imagen al editor para guardarla en `attachments/` e insertarla.

| Formato | Escribe |
| --- | --- |
| Negrita / cursiva | `**negrita**` / `*cursiva*` (o `Ctrl+B` / `Ctrl+I`) |
| Resaltado | `==resaltado==` |
| Tachado | `~~texto~~` |
| Encabezado | `# Encabezado`, `## Subencabezado` |
| Tarea | `- [ ] pendiente`, `- [x] hecha` |
| Código | `` `en línea` `` o un bloque entre ```` ``` ```` |
| Comentario oculto | `%%solo visible al editar%%` |

Toda la sintaxis, con ejemplos que puedes copiar, está en la <a href="#" data-help-page="markdown">chuleta de Markdown</a>.

## Enlazar notas
- `[[Nombre de la nota]]` enlaza una nota. Escribe `[[` para ver sugerencias.
- `[[Nombre de la nota|texto visible]]` cambia el texto del enlace, y `[[Nombre de la nota#Encabezado]]` salta a un encabezado.
- `![[Nombre de la nota]]` inserta una nota completa. `![[imagen.png]]` muestra una imagen, y `![[imagen.png|300]]` fija su ancho.
- Los enlaces a notas que aún no existen se ven atenuados: haz clic para crear la nota.
- El panel derecho muestra **enlaces entrantes**, **menciones sin enlazar**, **enlaces salientes**, **etiquetas** y el **esquema**.

## Organizar
- **Carpetas:** arrastra notas y carpetas para moverlas, y haz clic derecho para más opciones.
- **Etiquetas:** escribe `#etiqueta` en cualquier parte, o `tags: [a, b]` en el bloque de propiedades al inicio de una nota.
- **Propiedades:** empieza una nota con un bloque `---` con líneas `clave: valor`.
- **Notas diarias:** `Alt+D` abre la nota de hoy en `Daily Notes/`.

> [!example] Ejemplo de propiedades
> ```
> ---
> tags: [proyecto, ideas]
> status: activo
> ---
> ```

## Encontrar
- **Selector rápido** (`Ctrl+O`): escribe parte de un nombre para abrir una nota. Si no hay coincidencias, `Mayús+Intro` la crea.
- **Buscar** (`Ctrl+Mayús+F`): busca en todas las notas. Puedes combinar filtros:

| Búsqueda | Encuentra |
| --- | --- |
| `notas reunión` | notas que contienen ambas palabras |
| `"frase exacta"` | esa frase exacta |
| `#proyecto` | notas con la etiqueta (incluida `#proyecto/sub`) |
| `path:Ideas` | notas dentro de una carpeta |
| `file:borrador` | notas cuyo nombre contiene «borrador» |

- **Vista de grafo** (`Ctrl+G`): un mapa de tus notas que funciona un poco como la memoria del cerebro. Arrastra para mover y usa la rueda para hacer zoom. **Grafo local** muestra solo los vecinos de la nota actual.
  - **Regiones:** las notas muy conectadas se agrupan en zonas de color, con el nombre de su etiqueta común o de su nota más conectada.
  - **Asociaciones:** líneas discontinuas unen notas con ideas parecidas que aún no has enlazado. Se encuentran comparando las palabras de tus notas.
  - **Memoria:** las notas que recuerdas bien (según tus quiz) brillan, las que olvidas se apagan y las que toca repasar tienen un anillo naranja que late.
  - **Haz clic en una nota** para «pensar en ella»: un impulso recorre sus conexiones y una tarjeta muestra lo que te **recuerda**, de más a menos fuerte, con su estado en la memoria y los botones **Abrir**, **Ponerme a prueba** y **Divagar desde aquí**. Con **doble clic** se abre la nota.
  - **Dejar divagar mi mente** pasa de una idea a otra por tus conexiones más fuertes, a veces con un salto a una idea sin relación (⤳), y deja abajo un **hilo de pensamiento** en el que puedes hacer clic.

## Bloques destacados
Empieza una cita con `[!tipo]` para crear un recuadro de color. Tipos: `note`, `tip`, `warning`, `danger`, `success`, `question`, `example`, `quote`. Añade `-` tras el tipo para que aparezca plegado, o `+` para que sea plegable pero abierto.

```
> [!warning]- Haz clic para desplegar
> Oculto hasta que lo abras.
```

## Fórmulas matemáticas (LaTeX)
Escribe fórmulas en LaTeX, igual que en Obsidian:
- **En línea:** `$E = mc^2$` muestra $E = mc^2$ dentro de la frase.
- **En bloque:** pon `$$` en la línea anterior y posterior a la fórmula para mostrarla centrada en su propia línea:

```
$$
\int_0^1 x^2\,dx = \frac{1}{3}
$$
```

$$
\int_0^1 x^2\,dx = \frac{1}{3}
$$

- **Química:** `$\ce{2H2 + O2 -> 2H2O}$` muestra $\ce{2H2 + O2 -> 2H2O}$
- **Los importes de dinero no se ven afectados:** un `$` seguido de un espacio o un número no se trata como fórmula. Para mostrar un signo de dólar en cualquier lugar, escribe `\$`.
- **Comando:** **Insertar bloque de fórmula** en la paleta de comandos añade un bloque `$$` vacío.
- **Errores:** una fórmula con un error se muestra en rojo, para que veas qué corregir.
- **Lista completa:** la <a href="#" data-help-page="latex">chuleta de LaTeX</a> muestra unos 160 comandos con su resultado. También está en la paleta de comandos como **Abrir la chuleta de LaTeX**.

## Atajos de teclado
| Acción | Teclas |
| --- | --- |
| Paleta de comandos | `Ctrl+P` |
| Selector rápido | `Ctrl+O` |
| Nueva nota | `Alt+N` |
| Nota diaria | `Alt+D` |
| Editar / leer | `Ctrl+E` |
| Vista de grafo | `Ctrl+G` |
| Buscar | `Ctrl+Mayús+F` |
| Renombrar nota | `F2` |
| Atrás / adelante | `Alt+←` / `Alt+→` |
| Negrita / cursiva / enlace | `Ctrl+B` / `Ctrl+I` / `Ctrl+K` |
| Sangrar / quitar sangría | `Tab` / `Mayús+Tab` |
| Ajustes | `Ctrl+,` |
| Recortar una zona | `Alt+S` |
| Esta guía | `F1` |

## Repaso y memoria
Graphite te ayuda a recordar lo que escribes. Tus notas se convierten en preguntas automáticamente:

- Las palabras `==resaltadas==` o en **negrita** de una frase se convierten en preguntas para completar, y `- **Término**: definición` en «¿Qué es Término?».
- `Pregunta :: respuesta` en una línea (o una pregunta, una línea con solo `?` y la respuesta) se convierte en una tarjeta.
- Cada sección con encabezado se convierte en «¿Qué recuerdas de …?».

**Revisar errores:** el botón de lupa de arriba (`Ctrl+Mayús+E`) revisa la nota abierta. Cada problema se muestra como texto antiguo → texto corregido, con una breve explicación. Pulsa **Aplicar** para corregirlo (`Ctrl+Z` lo deshace), **Ver en la nota** para ir allí, o **Ignorar**. Sin IA, una revisión básica encuentra palabras repetidas, espacios que faltan, `[[enlaces]]` rotos (sugiriendo la nota más parecida), `**`/`==` sin cerrar y niveles de encabezado saltados. Con la IA activada, la IA revisa también datos, ortografía, gramática y frases poco claras.

**Quiz:** el birrete de arriba (`Ctrl+Mayús+K`) te pone a prueba con la nota abierta. Con la IA activada, la IA añade sus propias preguntas sobre la nota; se escriben una vez por versión de la nota. Al salir de una nota en la que acabas de escribir, una pequeña tarjeta ofrece **Revisar** o **Ponerme a prueba**. Ambos están también en el menú del clic derecho.

**Elegir la IA:** en **Ajustes → IA**, cada tarea (Revisar, Preguntas de quiz, Chat, Planes de repaso, Análisis de exámenes, Ordenar formato) tiene su propia elección. **Claude Code** usa la ventana de Claude de este ordenador, sin clave, pero solo mientras está conectada (dile «connect to Graphite»). Los **modelos por API** funcionan siempre con tu propia clave: Anthropic (Claude), OpenAI, Google Gemini, DeepSeek, Qwen, Kimi, GLM o cualquier servicio compatible con OpenAI. Pega una clave en **Claves API** y pulsa **Probar la clave**, que también carga los modelos actuales del proveedor. Las claves se quedan en este ordenador y solo se envía la nota o el examen de cada tarea, y solo a ese proveedor. Cada tarea tiene también **Modelo para esta tarea**: deja **Predeterminado** (el modelo de la clave) o elige otro modelo del mismo proveedor. Revisar y el chat también tienen un menú para cambiar de IA allí mismo.

**Plan de repaso:** en la página de Repaso (o la paleta), **Hacer un plan de repaso**. Indica el examen, su fecha, el temario, marca las carpetas que entran y los minutos al día. La IA planifica cada día hasta el examen, primero lo débil y pendiente, y guarda el plan con casillas en `<Curso>/复习计划 Review Plans`.

**Análisis de exámenes:** **Analizar un examen** en la página de Repaso, o clic derecho en un PDF o nota de la lista de archivos. La IA lista cada ejercicio con su tema y tu nota correspondiente, explica qué falló si tus respuestas o notas aparecen, y añade consejos y un plan, guardados en `<Curso>/考试分析 Exam Analysis`. Para PDF escaneados, elige Claude Code.

**Ordenar formato:** el botón 🪄 de arriba (`Ctrl+Mayús+Y`) hace que la nota abierta siga el formato de las demás notas de su carpeta: frontmatter, encabezados, numeración, líneas de fuente y «Related». El contenido no cambia; primero ves una vista previa antes/después, y `Ctrl+Z` lo deshace.

**Páginas de estudio:** las páginas de repaso interactivas están en la carpeta `学习页面 Study Pages` de cada curso. Haz clic en una en la lista de archivos (o en un enlace) para abrirla en una pestaña 🎓.

**Word y PowerPoint:** los archivos `.docx` se abren como una página legible (**Diseño exacto** los muestra tal como Word los imprime). Los `.doc`, `.ppt` y `.pptx` se abren como un PDF creado por tu Word o PowerPoint, con números de página, zoom, búsqueda y «Enlace a una página…»; la primera vez tarda unos segundos y después es instantáneo. **Guardar copia en PDF** deja un PDF junto al original.

**Repaso diario:** el botón del cerebro en la cinta izquierda (`Alt+R`) muestra cuántas preguntas tocan. Valora cada respuesta con **Otra vez**, **Difícil**, **Bien** o **Fácil**. La aplicación programa el siguiente repaso justo antes de que lo olvides (repetición espaciada).

**Notas relacionadas:** el panel derecho sugiere notas de temas parecidos que aún no están enlazadas. Pulsa **Enlazar** para unirlas.

## Sincronizar entre dispositivos
Graphite se sincroniza mediante una carpeta en la nube. Guarda tu bóveda en OneDrive (incluido en Windows), Dropbox, Google Drive o iCloud Drive, y abre esa misma carpeta en cada ordenador. **Ajustes → Sincronización** muestra si tu bóveda está sincronizada y dónde están tus carpetas en la nube.

- **Editar en dos dispositivos a la vez:** si los cambios están en partes distintas de una nota, se combinan automáticamente. Si cambiaron las mismas líneas, tu versión se queda en la nota y la otra se guarda al lado como copia «(conflict …)», así que no se pierde nada.
- **Las copias en conflicto**, ya sean de Graphite o de tu aplicación en la nube, aparecen en **Ajustes → Sincronización**. Un aviso ⚠ en la barra de estado te indica cuando hay alguna.
- **En tu teléfono:** usa la aplicación oficial de Obsidian (gratuita) con la misma carpeta. En iPhone y iPad, guarda la bóveda en iCloud Drive. En Android, copia la carpeta al teléfono con una aplicación como FolderSync o Syncthing.

## Plugins
Graphite puede ejecutar muchos **plugins de la comunidad de Obsidian**.

1. Abre **Ajustes** (icono de engranaje o `Ctrl+,`) y luego **Plugins de la comunidad**.
2. Pulsa **Activar plugins de la comunidad**. Los plugins son código escrito por otras personas y pueden cambiar tus notas, así que usa solo los que sean de confianza.
3. Pulsa **Explorar**, busca y pulsa **Instalar**. También puedes copiar la carpeta de un plugin en `.obsidian/plugins/` dentro de tu bóveda.
4. Activa el plugin con su interruptor. Si tiene opciones, aparece un icono de engranaje a su lado.

> [!info] Qué funciona
> Funcionan los comandos, iconos de la cinta, elementos de la barra de estado, páginas de ajustes, renderizado de Markdown y de bloques de código, sugerencias del editor, menús de archivo, ventanas emergentes y avisos. Los plugins que abren sus propios paneles laterales o modifican el propio editor (extensiones de CodeMirror) no funcionarán por completo. Si un plugin no carga, el motivo aparece bajo su nombre.

Los plugins usan la misma estructura de carpetas que Obsidian. Si abres una bóveda de Obsidian con Graphite, los plugins ya instalados aparecen automáticamente.

### Gestionar plugins
- **Desinstalar:** el icono de papelera junto a un plugin lo elimina. Su carpeta se mueve al `.trash` de la bóveda, así que puedes recuperarla.
- **Recargar plugins** (la flecha circular junto a «Plugins instalados») vuelve a cargar todos los plugins. Úsalo después de copiar o modificar la carpeta de un plugin. También está en la paleta de comandos.
- **Abrir carpeta de plugins** (el icono de carpeta) muestra `.obsidian/plugins/` en el Explorador de archivos.

### Plugin de ejemplo: Note Stats
Graphite incluye un pequeño plugin de ejemplo, **Note Stats**. Actívalo para tener:
- el tiempo de lectura en la barra de estado
- una ventana de estadísticas (el icono de gráfico en la cinta, o el comando «Note Stats: Show statistics for this note»)
- un bloque de código ```` ```stats ```` que muestra cuántas notas, enlaces y etiquetas tiene tu bóveda
- sugerencias de fecha al escribir `@today`, `@tomorrow` o `@yesterday`
- **Copy wikilink** al hacer clic derecho en un archivo

Su código, en `.obsidian/plugins/note-stats/main.js`, es un ejemplo breve de cómo escribir tu propio plugin.

### Dataview
Las consultas de Dataview (bloques ```` ```dataview ````) muestran sus resultados en las vistas **Leer** y **Dividir**. La vista previa en vivo de Dataview dentro del editor no funciona, porque necesita funciones del editor que Graphite no tiene.

## Idioma y apariencia
- Cambia el idioma con el botón 🌐 o en **Ajustes → General**. La aplicación arranca en el idioma de tu sistema.
- Alterna entre tema claro y oscuro con el botón de la luna.
- Cambia la fuente del texto, la del código y el tamaño de letra en **Ajustes → Apariencia**. También puedes escribir con una fuente monoespaciada al editar.
- Arrastra el borde de los paneles laterales para cambiar su tamaño, y ocúltalos con los botones de arriba.
