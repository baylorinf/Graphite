// A DeepSeek Harness executor for snippet questions. It advertises zero tools
// and rejects unsolicited calls before they reach a shell or the filesystem.
export const name = 'graphite-code-answer';
export const inject = ['tools'];
export function apply(ctx) {
  ctx.tools.setExecutor({
    describe() { return { schemas: [] }; },
    execute() { throw new Error('This code question accepts text replies only.'); },
  });
}
