'use strict';
// Code help (public/code-intel.js) without a browser: completions, parameter hints, hover, brackets, snippets
// and compiler messages, for C, C++, Python, Java, JavaScript, TypeScript, Go and Rust.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(process.env.GRAPHITE_TEST_APP || path.join(__dirname, '..'));
let CI;
test.before(async () => {
  const src = fs.readFileSync(path.join(root, 'public/code-intel.js'), 'utf8');
  CI = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
});
// "|" marks the cursor.
const at = s => ({ text: s.replace('|', ''), offset: s.indexOf('|') });
const labels = (src, lang, extra = {}) => CI.complete({ ...at(src), lang, ...extra }).items.map(i => i.label);
const kinds = (src, lang) => { const o = {}; for (const i of CI.complete({ ...at(src), lang }).items) if (i.kind !== 'snippet') o[i.label] ??= i.kind; return o; };

test('languages come from the file extension', () => {
  assert.deepEqual(['a.c', 'b.h', 'm.cpp', 'x.hpp', 'p.py', 'J.java', 'a.mjs', 'c.tsx', 'g.go', 'r.rs', 'n.md'].map(CI.langOf),
    ['c', 'c', 'cpp', 'cpp', 'python', 'java', 'js', 'ts', 'go', 'rust', null]);
});

test('C++: library, keywords, snippets and the file’s own names, best match first', () => {
  const src = '#include <vector>\nint total_count = 0;\nint main() {\n  tot|\n}';
  assert.equal(labels(src, 'cpp')[0], 'total_count');
  const k = kinds('int main() { pri| }', 'cpp');
  assert.equal(k.printf, 'function'); assert.equal(k.private, 'keyword'); assert.equal(k.priority_queue, 'type');
  assert.ok(labels('int main() { so| }', 'cpp').includes('sort'));
  assert.ok(labels('fo|', 'cpp').includes('for'), 'snippet and keyword');
  const sn = CI.complete({ ...at('fo|'), lang: 'cpp' }).items.find(i => i.kind === 'snippet' && i.label === 'for');
  assert.match(sn.snippet, /\$\{1:i\}/);
});

test('members after . -> and :: (C++ containers, std::)', () => {
  assert.deepEqual(labels('vector<int> v; v.pu|', 'cpp').slice(0, 2), ['push', 'push_back']);
  assert.ok(labels('p->se|', 'cpp').includes('second'));
  const std = labels('std::so|', 'cpp');
  assert.ok(std.includes('sort') && !std.includes('for'), 'only std names after std::');
  assert.ok(labels('struct P { int weight; }; P p; p.weight = 1; P q; q.we|', 'cpp').includes('weight'), 'members used in the file');
});

test('#include, import and use offer headers and modules', () => {
  assert.ok(labels('#include <io|', 'cpp').includes('iostream'));
  assert.ok(labels('#include <std|', 'c').includes('stdio.h'));
  assert.ok(labels('import ma|', 'python').includes('math'));
  assert.ok(labels('from coll|', 'python').includes('collections'));
  assert.ok(labels('import "str|', 'go').includes('strings'));
  assert.ok(labels('use std::coll|', 'rust').some(l => l.startsWith('std::collections')));
});

test('Python, Java, JavaScript / TypeScript, Go and Rust libraries', () => {
  assert.ok(labels('pr|', 'python').includes('print'));
  assert.deepEqual(labels('import math\nmath.sq|', 'python'), ['sqrt', 'isqrt']);
  assert.ok(labels('xs = []\nxs.app|', 'python').includes('append'));
  assert.ok(labels('System.out.pr|', 'java').includes('println'));
  assert.ok(labels('Math.ma|', 'java').includes('max'));
  assert.ok(labels('Scanner in = new Scanner(System.in); in.nextI|', 'java').includes('nextInt'));
  assert.ok(labels('console.l|', 'js').includes('log'));
  assert.ok(labels('[1,2].fil|', 'js').includes('filter'));
  assert.ok(labels('let x: num|', 'ts').includes('number'), 'TypeScript keywords');
  assert.ok(labels('fmt.Pri|', 'go').includes('Println'));
  assert.ok(labels('strconv.A|', 'go').includes('Atoi'));
  assert.ok(labels('prin|', 'rust').includes('println!'));
  assert.ok(labels('let v = vec![1]; v.it|', 'rust').includes('iter'));
  assert.ok(labels('String::fr|', 'rust').includes('from'));
});

test('names are not offered inside strings or comments, and the word being typed is not offered to itself', () => {
  const src = 'int alpha = 1; // betaword\nconst char *s = "gammaword";\nint main() { al| }';
  const l = labels(src, 'c');
  assert.ok(l.includes('alpha')); assert.ok(!l.includes('betaword') && !l.includes('gammaword'));
  assert.ok(!labels('int main() { uniqueword| }', 'c').includes('uniqueword'));
  assert.equal(CI.contextAt('x = "ab|c"'.replace('|', ''), 6, 'python'), 'string');
  assert.equal(CI.contextAt('# note', 3, 'python'), 'comment');
  assert.equal(CI.contextAt("let r: &'a str = s;", 10, 'rust'), 'code', 'a lifetime is not a string');
});

test('names from the other open files of the project are offered', () => {
  assert.ok(labels('int main() { comp| }', 'cpp', { extraText: 'int compute_area(int w, int h) { return w * h; }' }).includes('compute_area'));
});

test('parameter hints: library and own functions, the argument being typed', () => {
  let s = CI.signatureAt({ ...at('int main() { printf("%d", |'), lang: 'c' });
  assert.equal(s.name, 'printf'); assert.equal(s.active, 1, 'variadic stays on the last parameter');
  s = CI.signatureAt({ ...at('int add(int a, int b) { return a + b; }\nint main() { add(1, |); }'), lang: 'cpp' });
  assert.deepEqual([s.name, s.params, s.active, s.line], ['add', ['int a', 'int b'], 1, 1]);
  s = CI.signatureAt({ ...at('def area(w, h=1):\n    return w*h\nprint(area(|'), lang: 'python' });
  assert.deepEqual([s.name, s.params, s.active], ['area', ['w', 'h=1'], 0]);
  s = CI.signatureAt({ ...at('class A:\n    def go(self, n):\n        pass\nA().go(|'), lang: 'python' });
  assert.deepEqual(s.params, ['n'], 'self is not a parameter to type');
  s = CI.signatureAt({ ...at('import math\nmath.log(8, |'), lang: 'python' });
  assert.deepEqual([s.name, s.active], ['log', 1]);
  s = CI.signatureAt({ ...at('fmt.Printf("%d", x, |'), lang: 'go' });
  assert.equal(s.name, 'Printf');
  s = CI.signatureAt({ ...at('function mix(a, b, c) {}\nmix(1, f(2, 3), |'), lang: 'js' });
  assert.deepEqual([s.name, s.active], ['mix', 2], 'commas inside nested calls do not count');
  s = CI.signatureAt({ ...at('fn dist(x: f64, y: f64) -> f64 { x }\nfn main() { dist(1.0, |'), lang: 'rust' });
  assert.deepEqual(s.params, ['x: f64', 'y: f64']);
  assert.equal(CI.signatureAt({ ...at('if (x > |'), lang: 'c' }), null, 'if is not a call');
  assert.equal(CI.signatureAt({ ...at('foo(1); |'), lang: 'c' }), null, 'outside the call');
});

test('hover: library documentation, own functions and where a variable is declared', () => {
  const src = '#include <cstdio>\nint add(int a, int b) { return a + b; }\nint main() {\n  int counter = 3;\n  printf("%d", add(counter, 1));\n}';
  let h = CI.hoverAt({ text: src, offset: src.indexOf('printf(') + 2, lang: 'cpp' });
  assert.match(h.title, /^printf\(const char \*format, \.\.\.\)/); assert.match(h.doc, /formatted/);
  h = CI.hoverAt({ text: src, offset: src.indexOf('add(counter') + 1, lang: 'cpp' });
  assert.equal(h.line, 2);
  h = CI.hoverAt({ text: src, offset: src.lastIndexOf('counter') + 2, lang: 'cpp' });
  assert.deepEqual([h.title, h.line], ['int counter = 3;', 4]);
  assert.equal(CI.hoverAt({ text: src, offset: src.indexOf('%d') + 1, lang: 'cpp' }), null, 'nothing inside a string');
  h = CI.hoverAt({ text: 'import math\nmath.sqrt(2)', offset: 18, lang: 'python' });
  assert.match(h.title, /^sqrt\(x\)/);
});

test('brackets: unclosed, unexpected and mismatched are found; strings and comments are ignored', () => {
  assert.deepEqual(CI.bracketProblems('int main() { if (x) { return; }', 'c').map(p => [p.kind, p.char]), [['unclosed', '{']]);
  assert.deepEqual(CI.bracketProblems('f(a));', 'c').map(p => [p.kind, p.char, p.offset]), [['unexpected', ')', 4]]);
  assert.deepEqual(CI.bracketProblems('x = [1, 2)', 'python').map(p => p.kind), ['mismatch']);
  assert.deepEqual(CI.bracketProblems('s = "(((" # )\nt = """\n{\n"""', 'python'), []);
  assert.deepEqual(CI.bracketProblems('const s = `${a} (`; // )', 'js'), []);
  assert.deepEqual(CI.bracketProblems("fn f<'a>(x: &'a str) -> char { '(' }", 'rust'), []);
  assert.deepEqual(CI.matchBracket('a(b[c])', 2, 'c'), [1, 6]);
  assert.deepEqual(CI.matchBracket('a(b[c])', 6, 'c'), [3, 5]);
});

test('snippets: placeholders in order, repeated ones together, $0 last', () => {
  const ex = CI.expandSnippet('for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t$0\n}');
  assert.equal(ex.text, 'for (int i = 0; i < n; i++) {\n\t\n}');
  assert.equal(ex.stops.length, 3);
  assert.equal(ex.stops[0].length, 3, 'every i is edited together');
  assert.deepEqual(ex.stops[1].map(([a, b]) => ex.text.slice(a, b)), ['n']);
  assert.equal(ex.stops[2][0][0], ex.text.indexOf('\n\t') + 2);
});

test('compiler and interpreter messages: GCC, MSVC, javac, tsc, Go, rustc, Python', () => {
  const out = CI.parseDiagnostics([
    'C:/proj/src/main.cpp:12:5: error: expected \';\' before \'return\'',
    'C:/proj/src/main.cpp:3:1: warning: unused variable',
    'C:\\proj\\lib.cpp(7,2): error C2065: \'x\': undeclared identifier',
    'Main.java:4: error: cannot find symbol',
    'src/app.ts(3,5): error TS2322: Type \'string\' is not assignable',
    './main.go:9:2: undefined: foo',
    'error[E0308]: mismatched types', '  --> src/main.rs:4:13',
    'Traceback (most recent call last):', '  File "C:/proj/tool.py", line 3, in <module>', 'ZeroDivisionError: division by zero',
    'C:/msys64/include/c++/vector:10:1: note: in a system header',
  ].join('\n'), 'C:/proj');
  assert.deepEqual(out.map(d => [d.path, d.line, d.col, d.kind]), [
    ['src/main.cpp', 12, 5, 'error'], ['src/main.cpp', 3, 1, 'warning'], ['lib.cpp', 7, 2, 'error'], ['Main.java', 4, 0, 'error'],
    ['src/app.ts', 3, 5, 'error'], ['main.go', 9, 2, 'error'], ['src/main.rs', 4, 13, 'error'], ['tool.py', 3, 0, 'error'], [null, 10, 1, 'note'],
  ]);
  assert.equal(out[2].text, "C2065: 'x': undeclared identifier");
  assert.equal(out[6].text, 'E0308: mismatched types');
  assert.equal(out[7].text, 'ZeroDivisionError: division by zero');
});

test('completion stays quick on a long file', () => {
  const big = Array.from({ length: 4000 }, (_, i) => `int value${i} = compute(${i}, "text ${i}"); // note ${i}`).join('\n') + '\nint main() { val|';
  const t0 = performance.now();
  const r = CI.complete({ ...at(big), lang: 'cpp' });
  assert.ok(r.items.length > 10);
  assert.ok(performance.now() - t0 < 1500, 'took ' + (performance.now() - t0) + ' ms');
});
