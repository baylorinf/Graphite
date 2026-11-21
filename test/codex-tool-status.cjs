'use strict';
const assert = require('node:assert/strict');
const { FRAMEWORKS } = require('../frameworks')({ HttpError: Error });
const state = {};
const failure = 'Failed to create unified exec process: registered Core process has no package identity';
function command(status, exit_code, aggregated_output) {
  FRAMEWORKS.codex.onLine(JSON.stringify({
    type: 'item.completed', item: { type: 'command_execution', status, exit_code, aggregated_output },
  }), state);
}
command('completed', 0, failure);
assert.ok(!state.windowsFileToolUnavailable);
command('failed', 1, 'An ordinary failing command');
assert.ok(!state.windowsFileToolUnavailable);
command('failed', -1, failure);
assert.equal(state.windowsFileToolUnavailable, true);
FRAMEWORKS.codex.onLine('{"type":"turn.completed"}', state);
assert.equal(state.windowsFileToolUnavailable, true);
command('completed', 0, 'ok');
assert.equal(state.windowsFileToolUnavailable, false);
command('failed', -1, failure);
FRAMEWORKS.codex.onLine('{"type":"item.completed","item":{"type":"file_change","status":"completed"}}', state);
assert.equal(state.windowsFileToolUnavailable, false);
console.log('PASS tool startup failure, normal errors, successful reads and recovered changes');
