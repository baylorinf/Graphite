'use strict';
// Example plugin written exactly like an Obsidian community plugin (CommonJS + require('obsidian')).
// It is bundled with Graphite to show what the plugin API can do. Turn it on under
// Settings → Community plugins.
const { Plugin, Notice, Modal, PluginSettingTab, Setting, MarkdownView, EditorSuggest, moment } = require('obsidian');

const DEFAULTS = { showReadingTime: true, wordsPerMinute: 200 };
const countWords = s => (s.match(/[぀-ヿ㐀-鿿]|[^\s぀-ヿ㐀-鿿]+/g) || []).length;

class StatsModal extends Modal {
  constructor(app, stats) { super(app); this.stats = stats; }
  onOpen() {
    this.setTitle('Note statistics');
    const table = this.contentEl.createEl('table', { cls: 'note-stats-table' });
    for (const [k, v] of Object.entries(this.stats)) {
      const row = table.createEl('tr');
      row.createEl('td', { text: k });
      row.createEl('td', { text: String(v) });
    }
  }
  onClose() { this.contentEl.empty(); }
}

// Type "@" in the editor to get date suggestions.
class DateSuggest extends EditorSuggest {
  onTrigger(cursor, editor) {
    const before = editor.getLine(cursor.line).slice(0, cursor.ch);
    const m = before.match(/(?:^|\s)@(\w*)$/);
    if (!m) return null;
    return { start: { line: cursor.line, ch: cursor.ch - m[1].length - 1 }, end: cursor, query: m[1] };
  }
  getSuggestions(ctx) {
    return [['today', 0], ['tomorrow', 1], ['yesterday', -1]]
      .filter(([name]) => name.startsWith(ctx.query.toLowerCase()))
      .map(([name, days]) => ({ name, value: moment().add(days, 'day').format('YYYY-MM-DD') }));
  }
  renderSuggestion(item, el) {
    el.createSpan({ text: '@' + item.name });
    el.createSpan({ cls: 'mi-detail', text: '  ' + item.value });
  }
  selectSuggestion(item) {
    const { editor, start, end } = this.context;
    editor.replaceRange(item.value, start, end);
  }
}

class StatsSettingTab extends PluginSettingTab {
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Note Stats' });
    new Setting(containerEl)
      .setName('Show reading time')
      .setDesc('Show the estimated reading time in the status bar.')
      .addToggle(t => t.setValue(this.plugin.settings.showReadingTime).onChange(async v => {
        this.plugin.settings.showReadingTime = v;
        await this.plugin.saveSettings();
        this.plugin.updateStatus();
      }));
    new Setting(containerEl)
      .setName('Reading speed')
      .setDesc('Words per minute used for the reading time.')
      .addSlider(s => s.setLimits(100, 400, 25).setValue(this.plugin.settings.wordsPerMinute).setDynamicTooltip().onChange(async v => {
        this.plugin.settings.wordsPerMinute = v;
        await this.plugin.saveSettings();
        this.plugin.updateStatus();
      }));
  }
}

module.exports = class NoteStatsPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULTS, await this.loadData());
    this.statusEl = this.addStatusBarItem();

    this.addRibbonIcon('bar-chart-2', 'Note statistics', () => this.showStats());
    this.addCommand({ id: 'show-stats', name: 'Show statistics for this note', editorCallback: () => this.showStats() });
    this.addCommand({ id: 'insert-today', name: "Insert today's date", editorCallback: editor => editor.replaceSelection(moment().format('YYYY-MM-DD')) });
    this.addSettingTab(new StatsSettingTab(this.app, this));
    this.registerEditorSuggest(new DateSuggest(this.app));

    // ```stats``` code block → live statistics about the whole vault.
    this.registerMarkdownCodeBlockProcessor('stats', (source, el) => {
      const files = this.app.vault.getMarkdownFiles();
      const tags = new Set(); let links = 0;
      for (const f of files) {
        const c = this.app.metadataCache.getFileCache(f);
        (c?.tags || []).forEach(t => tags.add(t.tag));
        links += (c?.links || []).length;
      }
      const table = el.createEl('table', { cls: 'note-stats-table' });
      for (const [k, v] of [['Notes', files.length], ['Links', links], ['Tags', tags.size]]) {
        const row = table.createEl('tr');
        row.createEl('td', { text: k });
        row.createEl('td', { text: String(v) });
      }
    });

    this.registerEvent(this.app.workspace.on('file-open', () => this.updateStatus()));
    this.registerEvent(this.app.workspace.on('editor-change', () => this.updateStatus()));
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      menu.addItem(item => item.setTitle('Copy wikilink').setIcon('link').onClick(async () => {
        await navigator.clipboard.writeText(`[[${file.basename}]]`);
        new Notice(`Copied [[${file.basename}]]`);
      }));
    }));
    this.app.workspace.onLayoutReady(() => this.updateStatus());
  }

  updateStatus() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !this.settings.showReadingTime) { this.statusEl.setText(''); return; }
    const words = countWords(view.editor.getValue());
    this.statusEl.setText(`${Math.max(1, Math.round(words / this.settings.wordsPerMinute))} min read`);
  }

  async showStats() {
    const file = this.app.workspace.getActiveFile();
    if (!file) { new Notice('Open a note first'); return; }
    const text = await this.app.vault.read(file);
    const cache = this.app.metadataCache.getFileCache(file) || {};
    const backlinks = Object.values(this.app.metadataCache.resolvedLinks).filter(d => d[file.path]).length;
    new StatsModal(this.app, {
      Note: file.basename,
      Words: countWords(text),
      Characters: text.length,
      Headings: (cache.headings || []).length,
      Links: (cache.links || []).length,
      Backlinks: backlinks,
      Tags: (cache.tags || []).map(t => t.tag).join(', ') || '—',
      Modified: moment(file.stat.mtime).format('LLL'),
    }).open();
  }

  async saveSettings() { await this.saveData(this.settings); }
};
