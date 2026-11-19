// The scripted AI behind the real local frameworks in tests: it plays the model for DeepSeek Harness (Anthropic
// Messages API) and Codex (Responses API). Plan phase: read a file with the framework's own tool, answer with a plan.
// Write phase: follow Graphite's numbered steps with the framework's own write / shell tools.
const fs = require('node:fs'); const path = require('node:path');
// ---------- the scripted AI ----------
// Each test sets `script.mode` and the stand-in plays the framework's model: plan phase (read a file, answer with a
// plan), write phase (follow Graphite's numbered steps with the framework's own write / shell tools).
const script = { mode: 'plan', plan: null, readFile: null, writeWrong: false, fail: false, outside: null };
const seen = { reads: [], writes: [], prompts: [] };
function textOf(r) {
  if (r.api === 'anthropic') return (r.body.messages || []).map(m => (Array.isArray(m.content) ? m.content.map(c => c.text || (typeof c.content === 'string' ? c.content : JSON.stringify(c.content || ''))).join('\n') : m.content)).join('\n');
  return (r.body.input || []).map(i => (i.content ? i.content.map(c => c.text || '').join('\n') : i.output || '')).join('\n');
}
const toolResults = r => (r.api === 'anthropic'
  ? (r.body.messages || []).flatMap(m => (Array.isArray(m.content) ? m.content : [])).filter(c => c.type === 'tool_result')
  : (r.body.input || []).filter(i => i.type === 'function_call_output'));
function steps(prompt) {
  const out = [];
  for (const m of prompt.matchAll(/(\d+)\. Write the file "([^"]+)"[^\n]*\n<<<GRAPHITE-FILE\n([\s\S]*?)\nGRAPHITE-FILE>>>/g)) out.push({ n: +m[1], kind: 'file', rel: m[2], content: m[3] + '\n' });
  for (const m of prompt.matchAll(/(\d+)\. Copy the file "([^"]+)" to "([^"]+)"/g)) out.push({ n: +m[1], kind: 'copy', src: m[2], rel: m[3] });
  const idx = prompt.match(/The notes you may edit are already in your working directory: ([^\n]+?)\. Keep/);
  if (idx) for (const rel of idx[1].split(', ')) out.push({ n: 0, kind: 'index', rel });
  return out.sort((a, b) => a.n - b.n);
}
const ps = s => String(s).replace(/'/g, "''");
async function model(r) {
  const prompt = textOf(r), names = (r.body.tools || []).map(t => t.name || t.type), dsh = r.api === 'anthropic';
  if (!names.length) return { text: 'Fixture' }; // dsh's session-title request
  seen.prompts.push(prompt);
  if (script.fail) return { error: 400 };
  const results = toolResults(r), done = results.length, outText = JSON.stringify(results);
  const stage = (prompt.match(/temporary stage folder: ([^\n]+)/) || [])[1];
  if (!stage) { // planning
    if (script.outside && !done) return dsh ? { tool: { name: 'read', input: { file_path: script.outside } } } : { tool: { name: 'exec_command', input: { cmd: `Get-Content -LiteralPath '${ps(script.outside)}'` } } };
    if (script.readFile && !done) return dsh ? { tool: { name: 'read', input: { file_path: script.readFile } } } : { tool: { name: 'exec_command', input: { cmd: `Get-Content -LiteralPath '${ps(script.readFile)}'` } } };
    const marker = (outText.match(/MARK-[0-9a-f]{8}/) || [])[0] || 'NOT-READ';
    if (marker !== 'NOT-READ') seen.reads.push(marker);
    const plan = typeof script.plan === 'function' ? script.plan(prompt) : script.plan;
    return { text: '<graphite-result>' + JSON.stringify(plan).replaceAll('NATIVE_MARKER', marker) + '</graphite-result>' };
  }
  // carrying out confirmed steps, one tool call per turn
  const todo = steps(prompt);
  if (done < todo.length) {
    const s = todo[done];
    seen.writes.push(s.rel);
    if (s.kind === 'copy') {
      const dest = path.join(stage, s.rel);
      const cmd = `New-Item -ItemType Directory -Force -Path '${ps(path.dirname(dest))}' | Out-Null; Copy-Item -LiteralPath '${ps(s.src)}' -Destination '${ps(dest)}'`;
      return dsh ? { tool: { name: 'pwsh', input: { description: 'Copy the confirmed file into the stage', command: cmd } } } : { tool: { name: 'exec_command', input: { cmd } } };
    }
    let content = s.kind === 'index' ? fs.readFileSync(path.join(stage, s.rel), 'utf8').replace(/\s*$/, '') + '\n- [[Slides.pdf|Slides]] ' + (script.marker || '') + '\n' : s.content;
    if (script.writeWrong) content = 'something else\n';
    if (dsh) return { tool: { name: 'write', input: { file_path: s.rel, content } } };
    const dest = path.join(stage, s.rel);
    return { tool: { name: 'exec_command', input: { cmd: `New-Item -ItemType Directory -Force -Path '${ps(path.dirname(dest))}' | Out-Null; [IO.File]::WriteAllBytes('${ps(dest)}', [Convert]::FromBase64String('${Buffer.from(content).toString('base64')}'))` } } };
  }
  return { text: '<graphite-result>{"done":[' + todo.filter(s => s.n).map(s => s.n).join(',') + ']}</graphite-result>' };
}

module.exports = { script, seen, model, steps };
