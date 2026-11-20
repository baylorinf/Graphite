// Required first by every test that starts Graphite's server: Study settings (~/.graphite) and the Claude Code
// copy (~/.claude/graphite.json) go to a new temporary folder, never to the real ones of the person running it.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
if (!process.env.GRAPHITE_TEST_ISOLATED) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'graphite-test-home-'));
  if (!process.env.GRAPHITE_HOME) process.env.GRAPHITE_HOME = path.join(dir, 'graphite');
  if (!process.env.GRAPHITE_CLAUDE_DIR) process.env.GRAPHITE_CLAUDE_DIR = path.join(dir, 'claude');
  process.env.GRAPHITE_TEST_ISOLATED = dir;
  process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* left for the OS */ } });
}
