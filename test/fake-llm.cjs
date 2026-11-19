// A scripted stand-in for an LLM API, so local agent frameworks (DeepSeek Harness, Codex CLI) can be run for real
// in tests without any account: it speaks the Anthropic Messages API (what dsh uses) and the OpenAI Responses /
// Chat Completions APIs (what Codex uses), streaming or not. Each request is handed to `script(req)`, which
// returns either { text } or { tool: { name, input } }; every request is recorded in `log`.
const http = require('node:http');

function start(script) {
  const log = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    let json = {};
    try { json = JSON.parse(body || '{}'); } catch { /* not JSON */ }
    const entry = { method: req.method, url: req.url, body: json, headers: req.headers };
    log.push(entry);
    const u = req.url.split('?')[0];
    if (req.method === 'GET') { // model lists
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ object: 'list', data: [{ id: 'fake-model', object: 'model', type: 'model', display_name: 'Fake' }] }));
    }
    let reply;
    try { reply = await script({ ...entry, api: /\/messages$/.test(u) ? 'anthropic' : /\/responses$/.test(u) ? 'responses' : 'chat' }); }
    catch (e) { reply = { text: 'script error: ' + e.message }; }
    entry.reply = reply;
    if (reply && reply.error) { // a controlled failure from the AI service
      res.writeHead(reply.error, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Controlled test failure' } }));
    }
    if (/\/messages$/.test(u)) return anthropic(res, json, reply);
    if (/\/responses$/.test(u)) return responses(res, json, reply);
    return chat(res, json, reply);
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ url: 'http://127.0.0.1:' + server.address().port, log, close: () => server.close() })));
}

let n = 0;
const id = p => p + '_' + (++n) + Date.now().toString(36);

function anthropic(res, req, reply) {
  const msgId = id('msg');
  const blocks = reply.tool ? [{ type: 'tool_use', id: id('toolu'), name: reply.tool.name, input: reply.tool.input }] : [{ type: 'text', text: reply.text || '' }];
  const stop = reply.tool ? 'tool_use' : 'end_turn';
  const usage = { input_tokens: 10, output_tokens: 10 };
  if (!req.stream) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ id: msgId, type: 'message', role: 'assistant', model: req.model || 'fake', content: blocks, stop_reason: stop, stop_sequence: null, usage }));
  }
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  ev('message_start', { message: { id: msgId, type: 'message', role: 'assistant', model: req.model || 'fake', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } });
  blocks.forEach((b, i) => {
    if (b.type === 'text') {
      ev('content_block_start', { index: i, content_block: { type: 'text', text: '' } });
      ev('content_block_delta', { index: i, delta: { type: 'text_delta', text: b.text } });
    } else {
      ev('content_block_start', { index: i, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } });
      ev('content_block_delta', { index: i, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } });
    }
    ev('content_block_stop', { index: i });
  });
  ev('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 10 } });
  ev('message_stop', {});
  res.end();
}

function responses(res, req, reply) {
  const respId = id('resp');
  const item = reply.tool
    ? { type: 'function_call', id: id('fc'), call_id: id('call'), name: reply.tool.name, arguments: JSON.stringify(reply.tool.input), status: 'completed' }
    : { type: 'message', id: id('m'), role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: reply.text || '', annotations: [] }] };
  const full = { id: respId, object: 'response', created_at: Math.floor(Date.now() / 1000), status: 'completed', model: req.model || 'fake', output: [item],
    usage: { input_tokens: 10, input_tokens_details: { cached_tokens: 0 }, output_tokens: 10, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 20 } };
  if (!req.stream) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(full)); }
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  let seq = 0;
  const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: seq++, ...data })}\n\n`);
  ev('response.created', { response: { ...full, status: 'in_progress', output: [] } });
  ev('response.output_item.added', { output_index: 0, item: { ...item, ...(item.type === 'message' ? { content: [] } : { arguments: '' }), status: 'in_progress' } });
  if (item.type === 'message') {
    ev('response.content_part.added', { item_id: item.id, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
    ev('response.output_text.delta', { item_id: item.id, output_index: 0, content_index: 0, delta: item.content[0].text });
    ev('response.output_text.done', { item_id: item.id, output_index: 0, content_index: 0, text: item.content[0].text });
    ev('response.content_part.done', { item_id: item.id, output_index: 0, content_index: 0, part: item.content[0] });
  } else {
    ev('response.function_call_arguments.delta', { item_id: item.id, output_index: 0, delta: item.arguments });
    ev('response.function_call_arguments.done', { item_id: item.id, output_index: 0, arguments: item.arguments });
  }
  ev('response.output_item.done', { output_index: 0, item });
  ev('response.completed', { response: full });
  res.end();
}

function chat(res, req, reply) {
  const msg = reply.tool
    ? { role: 'assistant', content: null, tool_calls: [{ id: id('call'), type: 'function', function: { name: reply.tool.name, arguments: JSON.stringify(reply.tool.input) } }] }
    : { role: 'assistant', content: reply.text || '' };
  const full = { id: id('chatcmpl'), object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: req.model || 'fake',
    choices: [{ index: 0, message: msg, finish_reason: reply.tool ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } };
  if (!req.stream) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(full)); }
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const delta = reply.tool ? { role: 'assistant', tool_calls: msg.tool_calls.map((c, i) => ({ index: i, ...c })) } : { role: 'assistant', content: msg.content };
  res.write(`data: ${JSON.stringify({ ...full, object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ ...full, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: full.choices[0].finish_reason }] })}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

module.exports = { start };
