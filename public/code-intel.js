// Offline code help for the code workbench and source files: completions (keywords, snippets, standard library
// names, identifiers of the open file and the other open files of the project), parameter hints, hover
// information, bracket and indent help, and error marks (compiler messages and unbalanced brackets).
// No network, no key. The language data below is a short reference written for students.
//
// The first half has no DOM and no imports, so the tests load it in Node. attachIntel() binds it to a
// CodeMirror 5 editor.

/* ---------- languages ---------- */
const EXT = {
  c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', 'c++': 'cpp', hpp: 'cpp', hxx: 'cpp', hh: 'cpp',
  py: 'python', pyw: 'python', java: 'java',
  js: 'js', mjs: 'js', cjs: 'js', jsx: 'js', ts: 'ts', mts: 'ts', cts: 'ts', tsx: 'ts',
  go: 'go', rs: 'rust',
};
export function langOf(path) {
  const ext = (/\.([^./\\]+)$/.exec(path || '')?.[1] || '').toLowerCase();
  return EXT[ext] || null;
}
const words = s => s.trim().split(/\s+/);
const C_KW = words(`auto break case char const continue default do double else enum extern float for goto if inline int long
  register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while bool true false NULL`);
const CPP_KW = [...C_KW, ...words(`class namespace template typename public private protected virtual override final new delete this
  operator using try catch throw nullptr constexpr noexcept friend mutable explicit static_cast dynamic_cast reinterpret_cast
  const_cast decltype static_assert concept requires co_await co_return co_yield`)];
const KW = {
  c: C_KW,
  cpp: CPP_KW,
  python: words(`False None True and as assert async await break class continue def del elif else except finally for from
    global if import in is lambda nonlocal not or pass raise return try while with yield match case self`),
  java: words(`abstract assert boolean break byte case catch char class continue default do double else enum extends final
    finally float for if implements import instanceof int interface long native new package private protected public return
    short static super switch synchronized this throw throws transient try void volatile while var record true false null`),
  js: words(`break case catch class const continue debugger default delete do else export extends finally for function if
    import in instanceof let new return super switch this throw try typeof var void while yield async await of true false
    null undefined NaN Infinity static get set`),
  go: words(`break case chan const continue default defer else fallthrough for func go goto if import interface map package
    range return select struct switch type var true false nil iota`),
  rust: words(`as break const continue crate else enum extern false fn for if impl in let loop match mod move mut pub ref return
    self Self static struct super trait true type unsafe use where while async await dyn`),
};
KW.ts = [...KW.js, ...words(`interface type enum implements private public protected readonly abstract namespace declare keyof
  as any unknown never number string boolean object symbol bigint satisfies infer`)];

// Library entries: "name(params)|returns|what it does" (functions) or "name|type|what it is".
// Groups: '' = global names, '.' = methods and fields after a dot, other keys = a namespace or module.
const L = (...rows) => rows;
const CLIB = L(
  'printf(const char *format, ...)|int|Writes formatted text to the screen (stdout). %d int, %f double, %s string, %c char.',
  'scanf(const char *format, ...)|int|Reads formatted input from the keyboard (stdin). Pass addresses: scanf("%d", &n). Returns how many items were read.',
  'puts(const char *s)|int|Writes a string and a newline.', 'putchar(int c)|int|Writes one character.', 'getchar()|int|Reads one character (EOF at the end).',
  'fgets(char *s, int n, FILE *stream)|char *|Reads one line (at most n-1 characters) into s.',
  'fopen(const char *path, const char *mode)|FILE *|Opens a file; mode "r", "w" or "a". NULL if it cannot be opened.',
  'fclose(FILE *stream)|int|Closes a file opened with fopen.', 'fprintf(FILE *stream, const char *format, ...)|int|Writes formatted text to a file.',
  'fscanf(FILE *stream, const char *format, ...)|int|Reads formatted input from a file.',
  'sprintf(char *buf, const char *format, ...)|int|Writes formatted text into a buffer.', 'snprintf(char *buf, size_t n, const char *format, ...)|int|Like sprintf, but writes at most n bytes.',
  'sscanf(const char *s, const char *format, ...)|int|Reads formatted values from a string.',
  'malloc(size_t size)|void *|Allocates size bytes (uninitialised). Free it with free().', 'calloc(size_t count, size_t size)|void *|Allocates zeroed memory for count items.',
  'realloc(void *ptr, size_t size)|void *|Resizes a block from malloc.', 'free(void *ptr)|void|Releases memory from malloc, calloc or realloc.',
  'strlen(const char *s)|size_t|Length of a string, without the final \\0.', 'strcpy(char *dst, const char *src)|char *|Copies a string (dst must be big enough).',
  'strncpy(char *dst, const char *src, size_t n)|char *|Copies at most n characters.', 'strcat(char *dst, const char *src)|char *|Appends src to dst.',
  'strcmp(const char *a, const char *b)|int|Compares strings: 0 if equal, <0 or >0 otherwise.', 'strncmp(const char *a, const char *b, size_t n)|int|Compares at most n characters.',
  'strchr(const char *s, int c)|char *|First occurrence of c in s, or NULL.', 'strstr(const char *s, const char *sub)|char *|First occurrence of sub in s, or NULL.',
  'memset(void *ptr, int value, size_t n)|void *|Fills n bytes with value (memset(a, 0, sizeof a)).', 'memcpy(void *dst, const void *src, size_t n)|void *|Copies n bytes.',
  'memmove(void *dst, const void *src, size_t n)|void *|Copies n bytes; the areas may overlap.',
  'abs(int x)|int|Absolute value.', 'labs(long x)|long|Absolute value of a long.', 'atoi(const char *s)|int|Converts a string to int.', 'atof(const char *s)|double|Converts a string to double.',
  'strtol(const char *s, char **end, int base)|long|Converts a string to long in the given base.',
  'qsort(void *base, size_t count, size_t size, int (*compare)(const void *, const void *))|void|Sorts an array with a comparison function.',
  'bsearch(const void *key, const void *base, size_t count, size_t size, int (*compare)(const void *, const void *))|void *|Binary search in a sorted array.',
  'rand()|int|A pseudo-random number between 0 and RAND_MAX.', 'srand(unsigned seed)|void|Seeds rand(), e.g. srand(time(NULL)).',
  'time(time_t *t)|time_t|Current time in seconds.', 'clock()|clock_t|Processor time used; divide by CLOCKS_PER_SEC.', 'exit(int status)|void|Ends the program.',
  'sqrt(double x)|double|Square root.', 'pow(double base, double exponent)|double|base raised to exponent.', 'fabs(double x)|double|Absolute value of a double.',
  'floor(double x)|double|Rounds down.', 'ceil(double x)|double|Rounds up.', 'round(double x)|double|Rounds to the nearest integer.',
  'sin(double x)|double|Sine (radians).', 'cos(double x)|double|Cosine (radians).', 'tan(double x)|double|Tangent (radians).',
  'log(double x)|double|Natural logarithm.', 'log10(double x)|double|Base-10 logarithm.', 'exp(double x)|double|e raised to x.',
  'fmax(double a, double b)|double|The larger value.', 'fmin(double a, double b)|double|The smaller value.',
  'isdigit(int c)|int|Non-zero if c is 0–9.', 'isalpha(int c)|int|Non-zero if c is a letter.', 'isspace(int c)|int|Non-zero if c is white space.',
  'isupper(int c)|int|Non-zero if c is an upper-case letter.', 'islower(int c)|int|Non-zero if c is a lower-case letter.',
  'toupper(int c)|int|Upper-case version of c.', 'tolower(int c)|int|Lower-case version of c.', 'assert(expression)|void|Stops the program if expression is false.',
  'size_t|type|Unsigned type for sizes and counts.', 'FILE|type|An open file (from fopen).', 'int64_t|type|64-bit signed integer (<stdint.h>).',
  'uint64_t|type|64-bit unsigned integer.', 'int32_t|type|32-bit signed integer.', 'uint32_t|type|32-bit unsigned integer.',
  'NULL|constant|The null pointer.', 'EOF|constant|End of file (-1).', 'INT_MAX|constant|Largest int (<limits.h>).', 'INT_MIN|constant|Smallest int.',
  'RAND_MAX|constant|Largest value of rand().', 'stdin|FILE *|Keyboard input.', 'stdout|FILE *|Screen output.', 'stderr|FILE *|Error output.',
);
const STD = L(
  'cout|ostream|Standard output: std::cout << x << "\\n";', 'cin|istream|Standard input: std::cin >> x;', 'cerr|ostream|Error output.',
  'endl|manipulator|Writes a newline and flushes (slower than "\\n").',
  'string|class|A text string: size(), substr(), find(), +, ==.', 'vector|class template|A resizable array: vector<int> v(n); v.push_back(x);',
  'map|class template|Sorted key → value map (balanced tree, O(log n)).', 'unordered_map|class template|Hash map, average O(1).',
  'set|class template|Sorted set of unique keys.', 'unordered_set|class template|Hash set of unique keys.', 'multiset|class template|Sorted set that keeps duplicates.',
  'pair|class template|Two values: first and second.', 'tuple|class template|A fixed-size group of values.', 'array|class template|Fixed-size array: array<int, 5>.',
  'queue|class template|First in, first out: push(), front(), pop().', 'stack|class template|Last in, first out: push(), top(), pop().',
  'deque|class template|Double-ended queue.', 'priority_queue|class template|Heap: top() is the largest (use greater<T> for smallest).', 'list|class template|Doubly linked list.',
  'make_pair(T1 first, T2 second)|pair<T1, T2>|Makes a pair.', 'sort(RandomIt first, RandomIt last, Compare comp = less())|void|Sorts [first, last): sort(v.begin(), v.end()).',
  'stable_sort(RandomIt first, RandomIt last, Compare comp = less())|void|Sorts, keeping equal elements in order.',
  'reverse(BidirIt first, BidirIt last)|void|Reverses [first, last).', 'max(const T &a, const T &b)|const T &|The larger value.', 'min(const T &a, const T &b)|const T &|The smaller value.',
  'swap(T &a, T &b)|void|Exchanges two values.', 'find(InputIt first, InputIt last, const T &value)|InputIt|First element equal to value, or last.',
  'count(InputIt first, InputIt last, const T &value)|size_t|How many elements equal value.',
  'lower_bound(ForwardIt first, ForwardIt last, const T &value)|ForwardIt|First element not less than value (sorted range).',
  'upper_bound(ForwardIt first, ForwardIt last, const T &value)|ForwardIt|First element greater than value (sorted range).',
  'binary_search(ForwardIt first, ForwardIt last, const T &value)|bool|Whether value is in the sorted range.',
  'unique(ForwardIt first, ForwardIt last)|ForwardIt|Removes consecutive duplicates; use with erase.',
  'accumulate(InputIt first, InputIt last, T init)|T|Sum of a range plus init (<numeric>).', 'fill(ForwardIt first, ForwardIt last, const T &value)|void|Sets every element to value.',
  'iota(ForwardIt first, ForwardIt last, T value)|void|Fills with value, value+1, …', 'next_permutation(BidirIt first, BidirIt last)|bool|Next lexicographic permutation.',
  'max_element(ForwardIt first, ForwardIt last)|ForwardIt|Iterator to the largest element.', 'min_element(ForwardIt first, ForwardIt last)|ForwardIt|Iterator to the smallest element.',
  'getline(istream &in, string &line)|istream &|Reads a whole line: getline(cin, s).', 'to_string(T value)|string|Number to string.',
  'stoi(const string &s)|int|String to int.', 'stoll(const string &s)|long long|String to long long.', 'stod(const string &s)|double|String to double.',
  'abs(T x)|T|Absolute value.', 'sqrt(double x)|double|Square root.', 'pow(double base, double exponent)|double|Power.', 'gcd(M a, N b)|common type|Greatest common divisor (C++17).',
  'greater|class template|Comparison a > b, e.g. sort(v.begin(), v.end(), greater<int>()).', 'less|class template|Comparison a < b.',
  'numeric_limits|class template|numeric_limits<int>::max() and friends.', 'function|class template|A callable: function<int(int)> f.',
  'ios|class|ios::sync_with_stdio(false) makes cin/cout faster.', 'size_t|type|Unsigned type for sizes.', 'move(T &&value)|T&&|Allows the value to be moved instead of copied.',
);
const CPP_MEMBERS = L(
  'push_back(const T &value)|void|Adds value at the end.', 'emplace_back(Args &&...args)|T &|Builds an element in place at the end.', 'pop_back()|void|Removes the last element.',
  'size()|size_t|Number of elements.', 'empty()|bool|Whether there are no elements.', 'clear()|void|Removes every element.',
  'begin()|iterator|Iterator to the first element.', 'end()|iterator|Iterator past the last element.', 'rbegin()|reverse_iterator|Reverse iterator to the last element.', 'rend()|reverse_iterator|Reverse end.',
  'front()|T &|First element.', 'back()|T &|Last element.', 'at(size_t index)|T &|Element with bounds checking.',
  'insert(const T &value)|iterator|Inserts value (for a vector: insert(pos, value)).', 'erase(iterator pos)|iterator|Removes an element (or a key).',
  'find(const Key &key)|iterator|Finds a key (end() if missing); for a string, the position or npos.', 'count(const Key &key)|size_t|1 if the key is there, else 0.',
  'contains(const Key &key)|bool|Whether the key is there (C++20).', 'resize(size_t n)|void|Changes the number of elements.', 'reserve(size_t n)|void|Reserves room for n elements.',
  'substr(size_t pos, size_t len = npos)|string|Part of the string.', 'length()|size_t|Length of the string.', 'c_str()|const char *|C string view of the text.',
  'append(const string &s)|string &|Appends text.', 'push(const T &value)|void|Adds to the queue / stack / heap.', 'pop()|void|Removes the front / top.',
  'top()|const T &|Top of a stack or heap.', 'first|T1|First value of a pair.', 'second|T2|Second value of a pair.',
  'lower_bound(const Key &key)|iterator|First key not less than key.', 'upper_bound(const Key &key)|iterator|First key greater than key.',
  'emplace(Args &&...args)|iterator|Builds an element in place.', 'data()|T *|Pointer to the elements.', 'swap(container &other)|void|Exchanges contents.',
);
const PY = L(
  "print(*values, sep=' ', end='\\n', file=None)|None|Prints values separated by sep.", "input(prompt='')|str|Reads one line from the keyboard (without the newline).",
  'len(obj)|int|Number of items.', 'range(start, stop, step=1)|range|Numbers from start up to (not including) stop. range(n) is 0…n-1.',
  'enumerate(iterable, start=0)|enumerate|Pairs (index, item).', 'zip(*iterables)|zip|Tuples taking one item from each iterable.',
  'map(function, iterable)|map|Applies function to every item.', 'filter(function, iterable)|filter|Items for which function is true.',
  'sorted(iterable, key=None, reverse=False)|list|A new sorted list.', 'sum(iterable, start=0)|number|Sum of the items.',
  'min(iterable, key=None)|item|Smallest item (or min(a, b, …)).', 'max(iterable, key=None)|item|Largest item (or max(a, b, …)).',
  'abs(x)|number|Absolute value.', 'round(number, ndigits=None)|number|Rounds (to ndigits decimals).', 'int(x, base=10)|int|Converts to an integer.',
  'float(x)|float|Converts to a float.', 'str(obj)|str|Converts to text.', 'bool(x)|bool|Truth value.', 'list(iterable)|list|A new list.',
  'dict(**kwargs)|dict|A new dictionary.', 'set(iterable)|set|A new set.', 'tuple(iterable)|tuple|A new tuple.',
  "open(file, mode='r', encoding=None)|file|Opens a file; use it with `with open(...) as f:`.", 'isinstance(obj, classinfo)|bool|Whether obj is of that type.',
  'type(obj)|type|The type of obj.', 'reversed(seq)|iterator|Items in reverse order.', 'any(iterable)|bool|True if any item is true.', 'all(iterable)|bool|True if every item is true.',
  'divmod(a, b)|tuple|(a // b, a % b).', 'pow(base, exp, mod=None)|number|Power (modulo mod).', 'chr(i)|str|Character with code i.', 'ord(c)|int|Code of a character.',
  'hex(x)|str|Hexadecimal text.', 'bin(x)|str|Binary text.', 'repr(obj)|str|Printable representation.', 'iter(obj)|iterator|An iterator.', 'next(iterator, default)|item|Next item.',
  'super()|super|The parent class.', 'format(value, format_spec)|str|Formats a value.', 'hash(obj)|int|Hash value.', 'id(obj)|int|Identity of an object.', 'dir(obj)|list|Names of attributes.',
);
const PY_MOD = {
  math: L('sqrt(x)|float|Square root.', 'isqrt(n)|int|Integer square root.', 'floor(x)|int|Rounds down.', 'ceil(x)|int|Rounds up.', 'pi|float|3.14159…', 'e|float|2.71828…',
    'inf|float|Infinity.', 'gcd(*integers)|int|Greatest common divisor.', 'lcm(*integers)|int|Least common multiple.', 'log(x, base=e)|float|Logarithm.', 'log2(x)|float|Base-2 logarithm.',
    'sin(x)|float|Sine (radians).', 'cos(x)|float|Cosine (radians).', 'factorial(n)|int|n!', 'comb(n, k)|int|n choose k.', 'perm(n, k=None)|int|Permutations.', 'hypot(*coordinates)|float|Euclidean length.'),
  random: L('randint(a, b)|int|Random integer a ≤ N ≤ b.', 'random()|float|Random float in [0, 1).', 'choice(seq)|item|A random item.', 'shuffle(x)|None|Shuffles a list in place.',
    'sample(population, k)|list|k distinct random items.', 'seed(a=None)|None|Seeds the generator.', 'uniform(a, b)|float|Random float between a and b.'),
  sys: L('argv|list|Command-line arguments.', 'exit(status=None)|None|Ends the program.', 'stdin|file|Standard input (sys.stdin.readline() is fast).', 'stdout|file|Standard output.',
    'setrecursionlimit(limit)|None|Allows deeper recursion.', 'maxsize|int|Largest list index.'),
  os: L('path|module|Path helpers: os.path.join, exists, basename…', 'listdir(path=".")|list|Names in a folder.', 'getcwd()|str|Current folder.', 'remove(path)|None|Deletes a file.',
    'mkdir(path)|None|Creates a folder.', 'environ|dict|Environment variables.'),
  collections: L('Counter(iterable)|Counter|Counts items: Counter("hello")["l"] == 2.', 'defaultdict(default_factory)|defaultdict|A dict with a default for missing keys.',
    'deque(iterable=(), maxlen=None)|deque|Fast appends and pops at both ends.', 'namedtuple(typename, field_names)|class|A tuple with named fields.', 'OrderedDict()|OrderedDict|A dict that remembers order.'),
  itertools: L('permutations(iterable, r=None)|iterator|All orderings.', 'combinations(iterable, r)|iterator|All r-length combinations.', 'product(*iterables, repeat=1)|iterator|Cartesian product.',
    'accumulate(iterable, func=None)|iterator|Running totals.', 'chain(*iterables)|iterator|One iterable after another.', 'count(start=0, step=1)|iterator|start, start+step, …'),
  heapq: L('heappush(heap, item)|None|Adds to a min-heap.', 'heappop(heap)|item|Removes the smallest item.', 'heapify(x)|None|Turns a list into a heap.', 'nlargest(n, iterable)|list|n largest items.', 'nsmallest(n, iterable)|list|n smallest items.'),
  functools: L('lru_cache(maxsize=128)|decorator|Remembers results (memoisation).', 'cache|decorator|Unbounded lru_cache.', 'reduce(function, iterable, initial)|value|Folds a sequence to one value.', 'cmp_to_key(func)|key|Turns a comparison into a key.'),
  bisect: L('bisect_left(a, x)|int|Insertion point before equal items.', 'bisect_right(a, x)|int|Insertion point after equal items.', 'insort(a, x)|None|Inserts keeping a sorted.'),
  time: L('time()|float|Seconds since 1970.', 'sleep(secs)|None|Waits secs seconds.', 'perf_counter()|float|A precise clock for timing.'),
  json: L('loads(s)|object|Parses JSON text.', 'dumps(obj, indent=None)|str|Writes JSON text.', 'load(fp)|object|Reads JSON from a file.', 'dump(obj, fp, indent=None)|None|Writes JSON to a file.'),
  re: L('match(pattern, string)|Match|Match at the start.', 'search(pattern, string)|Match|First match anywhere.', 'findall(pattern, string)|list|Every match.', 'sub(pattern, repl, string)|str|Replaces matches.', 'compile(pattern)|Pattern|A reusable pattern.'),
};
const PY_MEMBERS = L(
  'append(x)|None|Adds x at the end of the list.', 'extend(iterable)|None|Adds every item.', 'insert(i, x)|None|Inserts x before index i.', 'remove(x)|None|Removes the first x.',
  'pop(i=-1)|item|Removes and returns an item (the last by default).', 'sort(key=None, reverse=False)|None|Sorts the list in place.', 'reverse()|None|Reverses in place.',
  'index(x)|int|Position of x.', 'count(x)|int|How many times x occurs.', 'copy()|object|A shallow copy.', 'clear()|None|Removes everything.',
  'split(sep=None, maxsplit=-1)|list|Splits text (on white space by default).', 'join(iterable)|str|Joins strings with this one between them: ", ".join(items).',
  'strip(chars=None)|str|Without white space at both ends.', 'lstrip(chars=None)|str|Without leading white space.', 'rstrip(chars=None)|str|Without trailing white space.',
  'replace(old, new, count=-1)|str|Replaces text.', 'lower()|str|Lower-case text.', 'upper()|str|Upper-case text.', 'startswith(prefix)|bool|Whether it starts with prefix.',
  'endswith(suffix)|bool|Whether it ends with suffix.', 'find(sub)|int|Position of sub, or -1.', 'format(*args, **kwargs)|str|Fills {} fields.', 'isdigit()|bool|Only digits?', 'isalpha()|bool|Only letters?',
  'keys()|view|The keys of a dict.', 'values()|view|The values of a dict.', 'items()|view|(key, value) pairs.', 'get(key, default=None)|value|Value for key, or default.',
  'update(other)|None|Adds the other dict’s items.', 'setdefault(key, default=None)|value|Value for key, inserting default if missing.', 'add(x)|None|Adds x to the set.',
  'discard(x)|None|Removes x from the set if present.', 'read()|str|Reads the whole file.', 'readline()|str|Reads one line.', 'readlines()|list|Reads all lines.', 'write(s)|int|Writes text.', 'close()|None|Closes the file.',
  'most_common(n=None)|list|Most frequent items of a Counter.', 'appendleft(x)|None|Adds at the left of a deque.', 'popleft()|item|Removes from the left of a deque.',
);
const JAVA = L(
  'System|class|System.out (screen), System.in (keyboard), System.currentTimeMillis().', 'Math|class|Math.max, Math.sqrt, Math.pow, Math.abs, …',
  'String|class|Text: length(), charAt(i), substring(a, b), equals(o).', 'Integer|class|Integer.parseInt, Integer.MAX_VALUE, …', 'Double|class|Double.parseDouble, …',
  'Scanner|class|Reads input: new Scanner(System.in).nextInt().', 'ArrayList|class|A resizable list: add, get, set, size.', 'HashMap|class|Key → value map: put, get, getOrDefault.',
  'HashSet|class|A set: add, contains, remove.', 'LinkedList|class|A linked list (also a Queue / Deque).', 'ArrayDeque|class|A fast stack or queue.', 'PriorityQueue|class|A min-heap: offer, poll, peek.',
  'List|interface|An ordered collection.', 'Map|interface|Key → value.', 'Set|interface|Unique items.', 'Queue|interface|offer, poll, peek.', 'Deque|interface|push, pop, offerFirst, pollLast.',
  'StringBuilder|class|Builds text efficiently: append, toString.', 'Arrays|class|Arrays.sort, Arrays.fill, Arrays.toString.', 'Collections|class|Collections.sort, reverse, max.',
);
const JAVA_MOD = {
  'System.out': L('println(Object x)|void|Prints x and a newline.', 'print(Object x)|void|Prints x.', 'printf(String format, Object... args)|PrintStream|Prints formatted text (%d, %s, %.2f).'),
  System: L('out|PrintStream|Standard output.', 'in|InputStream|Standard input.', 'err|PrintStream|Error output.', 'currentTimeMillis()|long|Current time in ms.', 'nanoTime()|long|A precise clock.', 'exit(int status)|void|Ends the program.'),
  Math: L('max(int a, int b)|int|Larger value.', 'min(int a, int b)|int|Smaller value.', 'abs(int a)|int|Absolute value.', 'sqrt(double a)|double|Square root.', 'pow(double a, double b)|double|a to the power b.',
    'random()|double|Random number in [0, 1).', 'floor(double a)|double|Rounds down.', 'ceil(double a)|double|Rounds up.', 'round(double a)|long|Rounds.', 'PI|double|3.14159…'),
  Integer: L('parseInt(String s)|int|Text to int.', 'valueOf(int i)|Integer|Boxed int.', 'MAX_VALUE|int|2147483647', 'MIN_VALUE|int|-2147483648', 'toString(int i)|String|Int to text.', 'compare(int a, int b)|int|Compares.'),
  Double: L('parseDouble(String s)|double|Text to double.', 'MAX_VALUE|double|Largest double.', 'compare(double a, double b)|int|Compares.'),
  String: L('valueOf(Object x)|String|x as text.', 'format(String format, Object... args)|String|Formatted text.', 'join(CharSequence sep, Iterable elements)|String|Joins with sep.'),
  Arrays: L('sort(int[] a)|void|Sorts an array.', 'fill(int[] a, int val)|void|Sets every element.', 'toString(int[] a)|String|Array as text: [1, 2, 3].', 'asList(T... a)|List<T>|A fixed-size list.', 'copyOf(int[] a, int newLength)|int[]|A resized copy.'),
  Collections: L('sort(List<T> list)|void|Sorts a list.', 'reverse(List<?> list)|void|Reverses a list.', 'max(Collection<T> c)|T|Largest element.', 'min(Collection<T> c)|T|Smallest element.', 'swap(List<?> list, int i, int j)|void|Swaps two items.'),
};
const JAVA_MEMBERS = L(
  'nextInt()|int|Reads the next int.', 'nextLine()|String|Reads the rest of the line.', 'next()|String|Reads the next word.', 'nextDouble()|double|Reads the next double.', 'nextLong()|long|Reads the next long.',
  'hasNext()|boolean|Is there more input?', 'hasNextInt()|boolean|Is the next item an int?', 'close()|void|Closes it.', 'length()|int|Length of the text.', 'charAt(int index)|char|Character at index.',
  'substring(int begin, int end)|String|Text from begin up to end.', 'equals(Object o)|boolean|Same content? (use instead of == for text).', 'compareTo(T o)|int|Order compared with o.',
  'indexOf(Object o)|int|Position, or -1.', 'contains(Object o)|boolean|Contains o?', 'split(String regex)|String[]|Splits text.', 'trim()|String|Without white space at the ends.',
  'toUpperCase()|String|Upper-case text.', 'toLowerCase()|String|Lower-case text.', 'toCharArray()|char[]|The characters.', 'isEmpty()|boolean|No elements / empty text?',
  'add(E e)|boolean|Adds an element.', 'get(int index)|E|Element at index (or value for a key).', 'set(int index, E e)|E|Replaces an element.', 'remove(Object o)|boolean|Removes an element.',
  'size()|int|Number of elements.', 'put(K key, V value)|V|Stores a value for key.', 'getOrDefault(Object key, V def)|V|Value for key, or def.', 'containsKey(Object key)|boolean|Has this key?',
  'keySet()|Set<K>|The keys.', 'values()|Collection<V>|The values.', 'entrySet()|Set<Map.Entry<K, V>>|Key-value pairs.', 'append(Object x)|StringBuilder|Appends text.', 'toString()|String|As text.',
  'offer(E e)|boolean|Adds to a queue.', 'poll()|E|Removes the head (null if empty).', 'peek()|E|The head, without removing.', 'push(E e)|void|Pushes onto a stack.', 'pop()|E|Pops from a stack.',
);
const JS = L(
  'console|object|console.log, console.error, console.table.', 'Math|object|Math.max, Math.floor, Math.random, …', 'JSON|object|JSON.parse, JSON.stringify.',
  'Object|class|Object.keys, Object.entries, Object.assign.', 'Array|class|Array.isArray, Array.from.', 'Number(value)|number|Converts to a number.', 'String(value)|string|Converts to text.',
  'parseInt(string, radix)|number|Text to integer.', 'parseFloat(string)|number|Text to number.', 'isNaN(value)|boolean|Is it NaN?', 'Promise|class|A value that arrives later.',
  'setTimeout(callback, ms)|number|Runs callback after ms milliseconds.', 'setInterval(callback, ms)|number|Runs callback every ms milliseconds.', 'clearTimeout(id)|void|Cancels a timeout.',
  'fetch(url, options)|Promise<Response>|Makes an HTTP request.', 'document|object|The page: document.querySelector, getElementById.', 'require(id)|module|Loads a CommonJS module.',
  'Map|class|Key → value map: get, set, has.', 'Set|class|Unique values: add, has, delete.', 'Date|class|Dates and times.', 'RegExp|class|Regular expressions.', 'Error|class|An error to throw.',
  'structuredClone(value)|any|A deep copy.',
);
const JS_MOD = {
  console: L('log(...data)|void|Prints to the console.', 'error(...data)|void|Prints an error.', 'warn(...data)|void|Prints a warning.', 'table(data)|void|Prints a table.', 'time(label)|void|Starts a timer.', 'timeEnd(label)|void|Prints elapsed time.'),
  Math: L('max(...values)|number|Largest value.', 'min(...values)|number|Smallest value.', 'floor(x)|number|Rounds down.', 'ceil(x)|number|Rounds up.', 'round(x)|number|Rounds.', 'random()|number|Random in [0, 1).',
    'abs(x)|number|Absolute value.', 'sqrt(x)|number|Square root.', 'pow(x, y)|number|x to the power y.', 'trunc(x)|number|Integer part.', 'PI|number|3.14159…'),
  JSON: L('parse(text, reviver)|any|Parses JSON text.', 'stringify(value, replacer, space)|string|Writes JSON text.'),
  Object: L('keys(obj)|string[]|Own property names.', 'values(obj)|any[]|Own property values.', 'entries(obj)|[string, any][]|[key, value] pairs.', 'assign(target, ...sources)|object|Copies properties.', 'freeze(obj)|object|Makes it read-only.', 'fromEntries(entries)|object|Object from pairs.'),
  Array: L('isArray(value)|boolean|Is it an array?', 'from(iterable, mapFn)|any[]|An array from an iterable.', 'of(...items)|any[]|An array of the items.'),
  document: L('querySelector(selectors)|Element|First matching element.', 'querySelectorAll(selectors)|NodeList|Every matching element.', 'getElementById(id)|Element|Element with this id.', 'createElement(tagName)|Element|A new element.', 'body|HTMLElement|The page body.'),
  Promise: L('all(promises)|Promise|Waits for all.', 'race(promises)|Promise|First to settle.', 'resolve(value)|Promise|An already resolved promise.', 'allSettled(promises)|Promise|Waits for all, never rejects.'),
};
const JS_MEMBERS = L(
  'push(...items)|number|Adds at the end.', 'pop()|any|Removes the last item.', 'shift()|any|Removes the first item.', 'unshift(...items)|number|Adds at the start.',
  'slice(start, end)|array|A copy of part of it.', 'splice(start, deleteCount, ...items)|array|Removes / inserts in place.', 'map(callback)|array|A new array with callback applied.',
  'filter(callback)|array|Items for which callback is true.', 'reduce(callback, initialValue)|any|Folds to one value.', 'forEach(callback)|void|Runs callback for each item.',
  'find(callback)|any|First matching item.', 'findIndex(callback)|number|Index of the first match, or -1.', 'some(callback)|boolean|Does any item match?', 'every(callback)|boolean|Do all items match?',
  'includes(value)|boolean|Contains value?', 'indexOf(value)|number|Position, or -1.', 'join(separator)|string|Items joined as text.', 'sort(compareFn)|array|Sorts in place.',
  'reverse()|array|Reverses in place.', 'concat(...items)|array|A joined copy.', 'length|number|Number of items / characters.', 'split(separator)|string[]|Splits text.',
  'trim()|string|Without white space at the ends.', 'toUpperCase()|string|Upper-case text.', 'toLowerCase()|string|Lower-case text.', 'startsWith(search)|boolean|Starts with search?',
  'endsWith(search)|boolean|Ends with search?', 'replace(pattern, replacement)|string|Replaces the first match.', 'replaceAll(pattern, replacement)|string|Replaces every match.',
  'padStart(length, fill)|string|Pads at the start.', 'then(onFulfilled, onRejected)|Promise|Runs after it resolves.', 'catch(onRejected)|Promise|Handles an error.',
  'get(key)|any|Value for key.', 'set(key, value)|this|Stores a value.', 'has(key)|boolean|Has key?', 'delete(key)|boolean|Removes key.', 'add(value)|this|Adds to a set.',
  'addEventListener(type, listener)|void|Listens for an event.', 'toFixed(digits)|string|Number with fixed decimals.', 'at(index)|any|Item at index (negative from the end).',
);
const GO = L(
  'append(slice []T, elems ...T)|[]T|Adds elements to a slice: s = append(s, x).', 'len(v)|int|Length of a string, slice, map or channel.', 'cap(v)|int|Capacity of a slice.',
  'make(t Type, size ...int)|Type|Makes a slice, map or channel: make([]int, n).', 'new(Type)|*Type|A pointer to a new zero value.', 'delete(m map[K]V, key K)|void|Removes a key from a map.',
  'copy(dst, src []T)|int|Copies elements.', 'panic(v any)|void|Stops with an error.', 'recover()|any|Regains control after a panic (in defer).',
  'int|type|Integer.', 'int64|type|64-bit integer.', 'float64|type|Floating point.', 'string|type|Text.', 'bool|type|true or false.', 'byte|type|An 8-bit value.', 'rune|type|A Unicode character.', 'error|type|An error value.',
);
const GO_MOD = {
  fmt: L('Println(a ...any)|(n int, err error)|Prints values and a newline.', 'Printf(format string, a ...any)|(n int, err error)|Prints formatted text (%d %s %v).', 'Print(a ...any)|(n int, err error)|Prints values.',
    'Sprintf(format string, a ...any)|string|Formatted text.', 'Scan(a ...any)|(n int, err error)|Reads values: fmt.Scan(&n).', 'Scanln(a ...any)|(n int, err error)|Reads values on one line.',
    'Scanf(format string, a ...any)|(n int, err error)|Reads formatted input.', 'Errorf(format string, a ...any)|error|A formatted error.', 'Fprintln(w io.Writer, a ...any)|(n int, err error)|Prints to w.'),
  strings: L('Split(s, sep string)|[]string|Splits s.', 'Join(elems []string, sep string)|string|Joins with sep.', 'Contains(s, substr string)|bool|Contains substr?', 'HasPrefix(s, prefix string)|bool|Starts with prefix?',
    'HasSuffix(s, suffix string)|bool|Ends with suffix?', 'Index(s, substr string)|int|Position, or -1.', 'Replace(s, old, new string, n int)|string|Replaces n times (-1 = all).', 'ToUpper(s string)|string|Upper case.',
    'ToLower(s string)|string|Lower case.', 'TrimSpace(s string)|string|Without white space at the ends.', 'Fields(s string)|[]string|Words of s.', 'Repeat(s string, count int)|string|s repeated.', 'Builder|type|Builds strings efficiently.'),
  strconv: L('Itoa(i int)|string|Int to text.', 'Atoi(s string)|(int, error)|Text to int.', 'ParseInt(s string, base int, bitSize int)|(int64, error)|Text to int64.', 'FormatInt(i int64, base int)|string|Int64 to text.', 'ParseFloat(s string, bitSize int)|(float64, error)|Text to float.'),
  math: L('Sqrt(x float64)|float64|Square root.', 'Max(x, y float64)|float64|Larger value.', 'Min(x, y float64)|float64|Smaller value.', 'Abs(x float64)|float64|Absolute value.', 'Pow(x, y float64)|float64|x to the power y.',
    'Floor(x float64)|float64|Rounds down.', 'Ceil(x float64)|float64|Rounds up.', 'MaxInt|constant|Largest int.', 'Inf(sign int)|float64|Infinity.', 'Pi|constant|3.14159…'),
  sort: L('Ints(x []int)|void|Sorts ints.', 'Strings(x []string)|void|Sorts strings.', 'Slice(x any, less func(i, j int) bool)|void|Sorts with a function.', 'Search(n int, f func(int) bool)|int|Binary search.'),
  os: L('Args|[]string|Command-line arguments.', 'Exit(code int)|void|Ends the program.', 'Open(name string)|(*File, error)|Opens a file.', 'ReadFile(name string)|([]byte, error)|Reads a whole file.', 'Stdin|*File|Standard input.', 'Stdout|*File|Standard output.'),
  bufio: L('NewReader(rd io.Reader)|*Reader|Buffered reading: bufio.NewReader(os.Stdin).', 'NewScanner(r io.Reader)|*Scanner|Reads line by line.', 'NewWriter(w io.Writer)|*Writer|Buffered writing (call Flush).'),
  errors: L('New(text string)|error|A new error.', 'Is(err, target error)|bool|Does err match target?'),
  time: L('Now()|Time|Current time.', 'Sleep(d Duration)|void|Waits.', 'Since(t Time)|Duration|Time since t.', 'Second|Duration|One second.', 'Millisecond|Duration|One millisecond.'),
};
const RUST = L(
  'println!(fmt, args...)|macro|Prints formatted text and a newline: println!("{} {}", a, b).', 'print!(fmt, args...)|macro|Prints formatted text.', 'eprintln!(fmt, args...)|macro|Prints to stderr.',
  'format!(fmt, args...)|String|Formatted text.', 'vec![elems]|Vec<T>|A vector: vec![1, 2, 3] or vec![0; n].', 'panic!(msg)|macro|Stops with a message.', 'assert!(cond)|macro|Stops if cond is false.',
  'assert_eq!(left, right)|macro|Stops if left != right.', 'dbg!(expr)|macro|Prints expr with its value.', 'todo!()|macro|Not written yet.', 'unreachable!()|macro|Marks impossible code.',
  'write!(dst, fmt, args...)|macro|Writes formatted text to dst.', 'writeln!(dst, fmt, args...)|macro|Writes a line to dst.',
  'i32|type|32-bit integer.', 'i64|type|64-bit integer.', 'u32|type|Unsigned 32-bit.', 'u64|type|Unsigned 64-bit.', 'usize|type|Unsigned size / index.', 'f64|type|Floating point.', 'bool|type|true or false.', 'char|type|A Unicode character.',
  'str|type|A string slice (&str).', 'String|type|Owned, growable text.', 'Vec|type|A growable array.', 'Option|enum|Some(value) or None.', 'Some(value)|Option<T>|A present value.', 'None|Option<T>|No value.',
  'Result|enum|Ok(value) or Err(error).', 'Ok(value)|Result<T, E>|Success.', 'Err(error)|Result<T, E>|Failure.', 'Box|type|A heap allocation.', 'HashMap|type|Key → value map.', 'HashSet|type|Unique values.',
  'BTreeMap|type|Sorted map.', 'VecDeque|type|Double-ended queue.',
);
const RUST_MOD = {
  String: L('new()|String|An empty String.', 'from(s: &str)|String|A String from text.', 'with_capacity(n: usize)|String|An empty String with room for n bytes.'),
  Vec: L('new()|Vec<T>|An empty vector.', 'with_capacity(n: usize)|Vec<T>|An empty vector with room for n items.'),
  HashMap: L('new()|HashMap<K, V>|An empty map.'), HashSet: L('new()|HashSet<T>|An empty set.'),
  io: L('stdin()|Stdin|Standard input: io::stdin().read_line(&mut s).', 'stdout()|Stdout|Standard output.', 'Write|trait|Writing (flush, write_all).', 'Read|trait|Reading.'),
  std: L('io|module|Input and output.', 'collections|module|HashMap, HashSet, VecDeque, BTreeMap.', 'cmp|module|Ordering, min, max.', 'fmt|module|Formatting.'),
};
const RUST_MEMBERS = L(
  'push(value: T)|()|Adds at the end.', 'pop()|Option<T>|Removes the last item.', 'len()|usize|Number of items.', 'is_empty()|bool|No items?', 'iter()|Iter|Iterates by reference.', 'iter_mut()|IterMut|Iterates mutably.',
  'into_iter()|IntoIter|Iterates by value.', 'map(f)|Map|Transforms each item.', 'filter(predicate)|Filter|Keeps matching items.', 'collect()|B|Gathers into a collection: .collect::<Vec<_>>().',
  'sum()|S|Sum of the items.', 'count()|usize|Number of items.', 'enumerate()|Enumerate|(index, item) pairs.', 'rev()|Rev|Reverse order.', 'unwrap()|T|The value (panics on None / Err).',
  'expect(msg: &str)|T|The value, or panics with msg.', 'unwrap_or(default: T)|T|The value or default.', 'clone()|Self|A copy.', 'to_string()|String|As a String.', 'as_str()|&str|As a string slice.',
  'trim()|&str|Without white space at the ends.', 'split_whitespace()|SplitWhitespace|Words of the text.', 'parse::<F>()|Result<F, _>|Text to a number: s.trim().parse::<i32>().',
  'read_line(buf: &mut String)|io::Result<usize>|Reads a line into buf.', 'push_str(s: &str)|()|Appends text.', 'contains(x)|bool|Contains x?', 'insert(k, v)|Option<V>|Inserts.', 'get(k)|Option<&V>|Looks up.',
  'sort()|()|Sorts in place.', 'sort_by(compare)|()|Sorts with a comparison.', 'sort_unstable()|()|Sorts faster (no order of equals).', 'join(sep: &str)|String|Joins with sep.', 'chars()|Chars|The characters.',
  'lines()|Lines|The lines.', 'is_some()|bool|Holds a value?', 'is_none()|bool|No value?', 'ok()|Option<T>|Result to Option.', 'entry(key)|Entry|For insert-or-update.', 'or_insert(default)|&mut V|Inserts default if missing.',
  'extend(iter)|()|Adds every item.', 'retain(f)|()|Keeps matching items.', 'max()|Option<T>|Largest item.', 'min()|Option<T>|Smallest item.', 'fold(init, f)|B|Folds to one value.', 'any(predicate)|bool|Does any match?',
  'all(predicate)|bool|Do all match?', 'zip(other)|Zip|Pairs with another iterator.', 'take(n: usize)|Take|First n items.', 'skip(n: usize)|Skip|Skips n items.', 'windows(size: usize)|Windows|Overlapping slices.',
);
const LIB = {
  c: { '': CLIB, '.': CPP_MEMBERS.filter(r => /^(first|second)\|/.test(r)) },
  cpp: { '': [...CLIB, ...STD], std: STD, '.': CPP_MEMBERS },
  python: { '': PY, '.': PY_MEMBERS, ...PY_MOD },
  java: { '': JAVA, '.': JAVA_MEMBERS, ...JAVA_MOD },
  js: { '': JS, '.': JS_MEMBERS, ...JS_MOD },
  go: { '': GO, '.': [], ...GO_MOD },
  rust: { '': RUST, '.': RUST_MEMBERS, ...RUST_MOD },
};
LIB.ts = LIB.js;
// Header / module names offered after #include <, import, from or use.
const IMPORTS = {
  c: words('stdio.h stdlib.h string.h math.h ctype.h time.h stdbool.h stdint.h limits.h assert.h'),
  cpp: words('iostream vector string algorithm map set unordered_map unordered_set queue stack deque cmath cstdio cstdlib cstring numeric utility functional bits/stdc++.h iomanip sstream fstream climits array list tuple memory chrono random'),
  python: Object.keys(PY_MOD).concat(words('typing dataclasses pathlib string statistics fractions decimal copy')),
  go: Object.keys(GO_MOD).concat(words('io sync unicode')),
  java: words('java.util.* java.util.Scanner java.util.ArrayList java.util.HashMap java.util.Arrays java.io.* java.math.BigInteger'),
  rust: words('std::io std::collections::HashMap std::collections::HashSet std::collections::VecDeque std::cmp std::fmt'),
};

const parsed = new Map();
function entry(row, group) {
  const [head, ret, doc] = row.split('|');
  const m = /^([\w!:<>]+)\s*([(\[])(.*)[)\]]$/s.exec(head);
  const name = m ? m[1] : head;
  const params = m ? splitParams(m[3]) : null;
  const kind = params ? (ret === 'macro' || name.endsWith('!') ? 'function' : 'function') : /^(type|class|class template|interface|enum)$/.test(ret) ? 'type' : ret === 'module' ? 'module' : 'constant';
  return { label: name, kind, params, ret, doc, group, sig: params ? `${name}${m[2]}${m[3]}${m[2] === '(' ? ')' : ']'}` : '', open: m?.[2] || '(' };
}
function lib(lang, group) {
  const k = lang + '\n' + group;
  if (!parsed.has(k)) parsed.set(k, (LIB[lang]?.[group] || []).map(r => entry(r, group)));
  return parsed.get(k);
}
export function splitParams(s) {
  const out = []; let depth = 0, cur = '';
  for (const ch of String(s || '')) {
    if ('([{<'.includes(ch)) depth++;
    else if (')]}>'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/* ---------- snippets: ${1:name} placeholders, $0 the final cursor ---------- */
const CS = {
  main: 'int main() {\n\t$0\n\treturn 0;\n}', for: 'for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t$0\n}', while: 'while (${1:condition}) {\n\t$0\n}',
  if: 'if (${1:condition}) {\n\t$0\n}', ifelse: 'if (${1:condition}) {\n\t$0\n} else {\n\t\n}', struct: 'struct ${1:Name} {\n\t$0\n};', printf: 'printf("${1:%d}\\n", ${2:x});',
  include: '#include <${1:stdio.h}>',
};
const SNIP = {
  c: { ...CS, scanf: 'scanf("${1:%d}", &${2:x});' },
  cpp: { ...CS, main: 'int main() {\n\tios::sync_with_stdio(false);\n\tcin.tie(nullptr);\n\t$0\n\treturn 0;\n}', include: '#include <${1:iostream}>', class: 'class ${1:Name} {\npublic:\n\t${1:Name}() {}\n\t$0\n};',
    forr: 'for (auto &${1:x} : ${2:items}) {\n\t$0\n}', cout: 'cout << ${1:x} << "\\n";', cin: 'cin >> ${1:x};', vector: 'vector<${1:int}> ${2:v}(${3:n});', using: 'using namespace std;' },
  python: { def: 'def ${1:name}(${2:args}):\n\t$0', for: 'for ${1:item} in ${2:items}:\n\t$0', fori: 'for ${1:i} in range(${2:n}):\n\t$0', if: 'if ${1:condition}:\n\t$0',
    ifmain: 'if __name__ == "__main__":\n\t${0:main()}', class: 'class ${1:Name}:\n\tdef __init__(self${2:, args}):\n\t\t$0', while: 'while ${1:condition}:\n\t$0',
    with: 'with open(${1:"file.txt"}) as ${2:f}:\n\t$0', try: 'try:\n\t$0\nexcept ${1:Exception} as e:\n\tprint(e)', lambda: 'lambda ${1:x}: ${0:x}' },
  java: { main: 'public static void main(String[] args) {\n\t$0\n}', sout: 'System.out.println(${0});', for: 'for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t$0\n}',
    foreach: 'for (${1:int} ${2:x} : ${3:items}) {\n\t$0\n}', if: 'if (${1:condition}) {\n\t$0\n}', class: 'public class ${1:Main} {\n\t$0\n}', scanner: 'Scanner ${1:in} = new Scanner(System.in);',
    try: 'try {\n\t$0\n} catch (${1:Exception} e) {\n\te.printStackTrace();\n}' },
  js: { function: 'function ${1:name}(${2:args}) {\n\t$0\n}', arrow: 'const ${1:name} = (${2:args}) => {\n\t$0\n};', for: 'for (let ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t$0\n}',
    forof: 'for (const ${1:item} of ${2:items}) {\n\t$0\n}', if: 'if (${1:condition}) {\n\t$0\n}', log: 'console.log(${0});', class: 'class ${1:Name} {\n\tconstructor(${2:args}) {\n\t\t$0\n\t}\n}',
    try: 'try {\n\t$0\n} catch (err) {\n\tconsole.error(err);\n}', import: "import { ${2:name} } from '${1:module}';" },
  go: { main: 'package main\n\nimport "fmt"\n\nfunc main() {\n\t$0\n}', func: 'func ${1:name}(${2:args}) ${3:int} {\n\t$0\n}', for: 'for ${1:i} := 0; ${1:i} < ${2:n}; ${1:i}++ {\n\t$0\n}',
    forr: 'for ${1:_}, ${2:v} := range ${3:items} {\n\t$0\n}', if: 'if ${1:condition} {\n\t$0\n}', iferr: 'if err != nil {\n\t${0:return err}\n}', println: 'fmt.Println(${0})' },
  rust: { main: 'fn main() {\n\t$0\n}', fn: 'fn ${1:name}(${2:args}) -> ${3:i32} {\n\t$0\n}', for: 'for ${1:i} in ${2:0..n} {\n\t$0\n}', if: 'if ${1:condition} {\n\t$0\n}',
    match: 'match ${1:value} {\n\t${2:pattern} => $0,\n\t_ => {}\n}', struct: 'struct ${1:Name} {\n\t$0\n}', impl: 'impl ${1:Name} {\n\t$0\n}', let: 'let ${1:x} = ${0};',
    readline: 'let mut ${1:line} = String::new();\nstd::io::stdin().read_line(&mut ${1:line}).unwrap();' },
};
SNIP.ts = { ...SNIP.js, interface: 'interface ${1:Name} {\n\t$0\n}', type: 'type ${1:Name} = ${0};' };

/* ---------- reading code: strings and comments ---------- */
const SLASH = new Set(['c', 'cpp', 'java', 'js', 'ts', 'go', 'rust']);
// Returns the text with every string and comment blanked (same length, newlines kept), and their ranges.
export function scan(text, lang) {
  const n = text.length, out = text.split(''), ranges = [];
  const blank = (a, b, type) => { for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' '; ranges.push([a, b, type]); };
  for (let i = 0; i < n;) {
    const c = text[i], d = text[i + 1];
    if (SLASH.has(lang) && c === '/' && d === '/') { let j = text.indexOf('\n', i); if (j < 0) j = n; blank(i, j, 'comment'); i = j; continue; }
    if (SLASH.has(lang) && c === '/' && d === '*') { let j = text.indexOf('*/', i + 2); j = j < 0 ? n : j + 2; blank(i, j, 'comment'); i = j; continue; }
    if (lang === 'python' && c === '#') { let j = text.indexOf('\n', i); if (j < 0) j = n; blank(i, j, 'comment'); i = j; continue; }
    if (lang === 'python' && (c === '"' || c === "'") && text.startsWith(c.repeat(3), i)) { let j = text.indexOf(c.repeat(3), i + 3); j = j < 0 ? n : j + 3; blank(i, j, 'string'); i = j; continue; }
    if (c === '`' && (lang === 'js' || lang === 'ts' || lang === 'go')) { let j = i + 1; while (j < n && text[j] !== '`') j += text[j] === '\\' && lang !== 'go' ? 2 : 1; j = Math.min(n, j + 1); blank(i, j, 'string'); i = j; continue; }
    if (c === "'" && lang === 'rust' && !/^'(\\.[^']*|[^\\'\n])'/.test(text.slice(i, i + 12))) { i++; continue; } // a lifetime 'a
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && text[j] !== c && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
      j = Math.min(n, text[j] === c ? j + 1 : j);
      blank(i, j, 'string'); i = j; continue;
    }
    i++;
  }
  return { code: out.join(''), ranges };
}
export function contextAt(text, offset, lang) {
  for (const [a, b, type] of scan(text, lang).ranges) if (offset > a && offset < b + (type === 'comment' ? 1 : 0)) return type;
  return 'code';
}
const IDENT = /[A-Za-z_$][\w$]*/g;
export function identifiers(text, lang) {
  const counts = new Map(), kw = new Set(KW[lang] || []);
  for (const m of scan(text, lang).code.matchAll(IDENT)) if (!kw.has(m[0])) counts.set(m[0], (counts.get(m[0]) || 0) + 1);
  return counts;
}
// Functions written in the code: name → {params, line, label}.
export function userFunctions(text, lang) {
  const code = scan(text, lang).code, out = new Map();
  const re = {
    python: /^[ \t]*(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)/gm,
    go: /^func\s+(?:\([^)]*\)\s*)?(\w+)\s*\(([^)]*)\)/gm,
    rust: /\bfn\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)/g,
    js: /(?:\bfunction\s*\*?\s*(\w+)\s*\(([^)]*)\)|\b(\w+)\s*=\s*(?:async\s*)?(?:function\s*)?\(([^)]*)\)\s*(?:=>|\{))/g,
  }[lang === 'ts' ? 'js' : lang] || /^[ \t]*(?:[\w:<>,*&\[\]]+[ \t*&]+)+[*&]*(\w+)\s*\(([^;{}()]*(?:\([^)]*\)[^;{}()]*)*)\)\s*(?:const\s*)?(?:noexcept\s*)?(?:throws\s+[\w, .]+)?\s*\{/gm;
  const skip = new Set(['if', 'while', 'for', 'switch', 'return', 'catch', 'sizeof', 'else', 'new', 'do']);
  for (const m of code.matchAll(re)) {
    const name = m[1] || m[3], raw = (m[2] ?? m[4] ?? '').replace(/\s+/g, ' ').trim();
    if (!name || skip.has(name) || out.has(name)) continue;
    let params = splitParams(raw);
    if (lang === 'python') params = params.filter(p => p !== 'self' && p !== 'cls');
    out.set(name, { name, params, line: code.slice(0, m.index + m[0].indexOf(name)).split('\n').length, label: `${name}(${params.join(', ')})` });
  }
  return out;
}
// Where a name is first declared (a variable, parameter, class…): its line number and that line's text.
export function declarationOf(name, text, lang) {
  const code = scan(text, lang).code, lines = code.split('\n'), real = text.split('\n');
  const e = name.replace(/[$]/g, '\\$');
  const pats = [
    new RegExp(`\\b(?:class|struct|enum|interface|trait|type|union)\\s+${e}\\b`),
    new RegExp(`\\b(?:let|const|var|auto|mut)\\s+(?:mut\\s+)?${e}\\b`),
    new RegExp(`\\b${e}\\s*:=`),
    new RegExp(`(?:^|[,(])\\s*(?:const\\s+)?(?:unsigned\\s+|signed\\s+|long\\s+)*[A-Za-z_][\\w:<>,]*[\\s*&]+${e}\\s*(?:[=;,)\\[{]|$)`),
    new RegExp(`^\\s*${e}\\s*=[^=]`),
  ];
  for (const p of pats) for (let i = 0; i < lines.length; i++) if (p.test(lines[i])) return { line: i + 1, text: real[i].trim() };
  return null;
}

/* ---------- completions ---------- */
const KIND_ORDER = { variable: 0, function: 1, method: 1, field: 2, snippet: 3, keyword: 4, type: 5, constant: 6, module: 7 };
function fuzzy(label, prefix) {
  if (!prefix) return 3;
  if (label.startsWith(prefix)) return label === prefix ? -1 : 0;
  const L = label.toLowerCase(), P = prefix.toLowerCase();
  if (L.startsWith(P)) return 1;
  if (P.length < 2) return null; // one letter: only names starting with it
  if (L.includes(P)) return 2;
  let i = 0; for (const ch of L) if (ch === P[i]) i++;
  return i === P.length && P[0] === L[0] ? 3 : null;
}
// What is being typed before the cursor: the word, and what comes before it (a namespace, an object…).
export function wordBefore(text, offset) {
  let a = offset; while (a > 0 && /[\w$]/.test(text[a - 1])) a--;
  let b = offset; while (b < text.length && /[\w$]/.test(text[b])) b++;
  const before = text.slice(Math.max(0, a - 200), a);
  const q = /((?:[A-Za-z_$][\w$]*\s*(?:\.|::|->)\s*)*[A-Za-z_$][\w$]*)\s*(\.|::|->)\s*$/.exec(before) || /([)\]"'`])\s*(\.|::|->)\s*$/.exec(before);
  return { from: a, to: b, prefix: text.slice(a, offset), qualifier: q ? q[1].replace(/\s+/g, '').replace(/->/g, '.').replace(/::/g, '::') : null, sep: q?.[2] || null };
}
export function complete({ text, offset, lang, extraText = '', manual = false }) {
  const w = wordBefore(text, offset);
  const line = text.slice(text.lastIndexOf('\n', offset - 1) + 1, offset);
  const items = [];
  // #include <…>, import …, from … import, use …
  const inc = lang === 'c' || lang === 'cpp' ? /^\s*#\s*include\s*[<"]([\w./+]*)$/.exec(line)
    : lang === 'python' ? /^\s*(?:import|from)\s+([\w.]*)$/.exec(line)
    : lang === 'go' ? /^\s*(?:import\s+)?"([\w/]*)$/.exec(line)
    : lang === 'java' ? /^\s*import\s+([\w.*]*)$/.exec(line)
    : lang === 'rust' ? /^\s*use\s+([\w:]*)$/.exec(line) : null;
  if (inc && IMPORTS[lang]) {
    const typed = inc[1], from = offset - typed.length;
    for (const m of IMPORTS[lang]) { const s = fuzzy(m, typed); if (s != null) items.push({ label: m, kind: 'module', score: s }); }
    return { from, to: w.to, prefix: typed, items: rank(items) };
  }
  if (!lang) {
    for (const [id] of identifiers(text + '\n' + extraText, 'c')) { const s = fuzzy(id, w.prefix); if (s != null && id !== w.prefix) items.push({ label: id, kind: 'variable', score: s }); }
    return { from: w.from, to: w.to, prefix: w.prefix, items: rank(items) };
  }
  const all = text + '\n' + extraText;
  if (w.qualifier) {
    const q = w.qualifier, groups = [];
    if (LIB[lang]?.[q]) groups.push(q);
    else if (w.sep === '::' && lang === 'cpp') groups.push('std');
    else if (LIB[lang]?.[q.split(/\.|::/).pop()]) groups.push(q.split(/\.|::/).pop());
    else groups.push('.');
    for (const g of groups) for (const e of lib(lang, g)) { const s = fuzzy(e.label, w.prefix); if (s != null) items.push({ ...e, kind: g === '.' ? (e.params ? 'method' : 'field') : e.kind, score: s, detail: e.sig || e.ret }); }
    if (groups[0] === '.') {
      // Members used elsewhere in the project: x.name / x->name
      const code = scan(all, lang).code, seen = new Set(items.map(i => i.label));
      for (const m of code.matchAll(/(?:\.|->)\s*([A-Za-z_$][\w$]*)/g)) {
        const name = m[1]; if (seen.has(name) || name === w.prefix) continue; seen.add(name);
        const s = fuzzy(name, w.prefix); if (s != null) items.push({ label: name, kind: 'field', score: s + .5 });
      }
    }
    return { from: w.from, to: w.to, prefix: w.prefix, qualifier: q, items: rank(items) };
  }
  if (!w.prefix && !manual) return { from: w.from, to: w.to, prefix: '', items: [] };
  const seen = new Set();
  const add = it => { if (seen.has(it.kind + it.label)) return; seen.add(it.kind + it.label); items.push(it); };
  const fns = userFunctions(all, lang);
  for (const [name, f] of fns) { const s = fuzzy(name, w.prefix); if (s != null && name !== w.prefix) add({ label: name, kind: 'function', score: s, params: f.params, detail: f.label, doc: '', user: f.line }); }
  const ids = identifiers(all, lang);
  for (const [id, count] of ids) {
    if (fns.has(id) || (id === w.prefix && count <= 1)) continue;
    const s = fuzzy(id, w.prefix); if (s != null) add({ label: id, kind: 'variable', score: s });
  }
  for (const [label, body] of Object.entries(SNIP[lang] || {})) { const s = fuzzy(label, w.prefix); if (s != null) add({ label, kind: 'snippet', score: s, snippet: body, detail: snippetPreview(body) }); }
  for (const k of KW[lang] || []) { const s = fuzzy(k, w.prefix); if (s != null && k !== w.prefix) add({ label: k, kind: 'keyword', score: s }); }
  for (const e of lib(lang, '')) { const s = fuzzy(e.label, w.prefix); if (s != null && !fns.has(e.label)) add({ ...e, score: s, detail: e.sig || e.ret }); }
  return { from: w.from, to: w.to, prefix: w.prefix, items: rank(items) };
}
function rank(items) {
  return items.sort((a, b) => a.score - b.score || (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9) || a.label.length - b.label.length || a.label.localeCompare(b.label)).slice(0, 60);
}
export function snippetPreview(body) { return expandSnippet(body).text.split('\n')[0].replace(/\t/g, ' ').slice(0, 48); }
// "${1:i} < n; ${1:i}++ $0" → text and the placeholder ranges (offsets in that text), first by number, $0 last.
export function expandSnippet(body) {
  let text = ''; const stops = new Map(); let i = 0;
  while (i < body.length) {
    const m = /^\$\{(\d+):([^}]*)\}|^\$(\d+)/.exec(body.slice(i));
    if (m) {
      const n = +(m[1] ?? m[3]), value = m[2] ?? '';
      if (!stops.has(n)) stops.set(n, []);
      stops.get(n).push([text.length, text.length + value.length]);
      text += value; i += m[0].length; continue;
    }
    if (body[i] === '\\' && body[i + 1] === '$') { text += '$'; i += 2; continue; }
    text += body[i++];
  }
  const order = [...stops.keys()].filter(k => k > 0).sort((a, b) => a - b).map(k => stops.get(k));
  if (stops.has(0)) order.push(stops.get(0)); else order.push([[text.length, text.length]]);
  return { text, stops: order };
}

/* ---------- parameter hints and hover ---------- */
// The call the cursor is in: name, which argument, and its parameters.
export function signatureAt({ text, offset, lang, extraText = '' }) {
  if (!lang) return null;
  const code = scan(text, lang).code;
  let depth = 0, commas = 0, i = offset - 1;
  const stopAt = Math.max(0, offset - 4000);
  for (; i >= stopAt; i--) {
    const c = code[i];
    if (c === ')' || c === ']' || c === '}') depth++;
    else if (c === '(' || c === '[' || c === '{') { if (depth === 0) break; depth--; }
    else if (c === ',' && depth === 0) commas++;
    else if (c === ';' && depth === 0) return null;
  }
  if (i < stopAt || code[i] !== '(' && !(code[i] === '[' && code[i - 1] === '!')) return null;
  let j = i - 1; if (code[j] === '!') j--;
  while (j >= 0 && code[j] === ' ') j--;
  const end = j + 1; while (j >= 0 && /[\w$]/.test(code[j])) j--;
  const name = code.slice(j + 1, end) + (code[i - 1] === '!' ? '!' : '');
  if (!name || (KW[lang] || []).includes(name)) return null;
  const q = /((?:[A-Za-z_$][\w$]*(?:\.|::|->))*[A-Za-z_$][\w$]*)(\.|::|->)\s*$/.exec(code.slice(Math.max(0, j - 120), j + 1));
  const found = lookup(name, q ? q[1].replace(/->/g, '.') : null, lang, text + '\n' + extraText, !!q);
  if (!found?.params) return null;
  const variadic = found.params.length && /\.\.\.|^\*/.test(found.params[found.params.length - 1]);
  const active = variadic ? Math.min(commas, found.params.length - 1) : commas;
  return { name: found.label, params: found.params, active, doc: found.doc || '', ret: found.ret || '', line: found.user || 0 };
}
function lookup(name, qualifier, lang, all, member) {
  const groups = [];
  if (qualifier && LIB[lang]?.[qualifier]) groups.push(qualifier);
  if (qualifier && LIB[lang]?.[qualifier.split(/\.|::/).pop()]) groups.push(qualifier.split(/\.|::/).pop());
  if (member) groups.push('.');
  groups.push('', 'std');
  const user = userFunctions(all, lang).get(name);
  if (user && !qualifier) return { label: name, params: user.params, doc: '', user: user.line };
  for (const g of groups) { const e = lib(lang, g).find(x => x.label === name); if (e) return e; }
  if (user) return { label: name, params: user.params, doc: '', user: user.line };
  return null;
}
export function hoverAt({ text, offset, lang, extraText = '' }) {
  if (!lang || contextAt(text, offset, lang) !== 'code') return null;
  let a = offset, b = offset;
  while (a > 0 && /[\w$]/.test(text[a - 1])) a--;
  while (b < text.length && /[\w$]/.test(text[b])) b++;
  const name = text.slice(a, b);
  if (!name || /^\d/.test(name)) return null;
  const bang = lang === 'rust' && text[b] === '!' ? '!' : '';
  const q = /((?:[A-Za-z_$][\w$]*(?:\.|::|->))*[A-Za-z_$][\w$]*)(\.|::|->)$/.exec(text.slice(Math.max(0, a - 120), a));
  const all = text + '\n' + extraText;
  const e = lookup(name + bang, q ? q[1].replace(/->/g, '.') : null, lang, all, !!q);
  if (e) return { from: a, to: b, title: e.params ? (e.sig || `${e.label}(${e.params.join(', ')})`) + (e.ret && !/^(macro|type|class)/.test(e.ret) ? ' → ' + e.ret : '') : `${e.label}: ${e.ret}`, doc: e.doc || '', line: e.user || 0 };
  if ((KW[lang] || []).includes(name)) return { from: a, to: b, title: name, doc: '', keyword: true };
  const d = declarationOf(name, text, lang);
  if (d) return { from: a, to: b, title: d.text, doc: '', line: d.line };
  return null;
}

/* ---------- problems found while typing: unbalanced brackets ---------- */
const PAIRS = { '(': ')', '[': ']', '{': '}' }, CLOSE = { ')': '(', ']': '[', '}': '{' };
export function bracketProblems(text, lang) {
  const code = scan(text, lang).code, stack = [], out = [];
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (PAIRS[c]) stack.push(i);
    else if (CLOSE[c]) {
      const top = stack.length ? code[stack[stack.length - 1]] : null;
      if (top === CLOSE[c]) stack.pop();
      else if (top && stack.some(k => code[k] === CLOSE[c])) {
        // An opener in between was never closed: report it, then match this one.
        while (stack.length && code[stack[stack.length - 1]] !== CLOSE[c]) { const k = stack.pop(); out.push({ offset: k, kind: 'unclosed', char: code[k] }); }
        stack.pop();
      } else { out.push({ offset: i, kind: top ? 'mismatch' : 'unexpected', char: c, open: top, openAt: top ? stack[stack.length - 1] : null }); if (top) stack.pop(); }
    }
  }
  for (const k of stack) out.push({ offset: k, kind: 'unclosed', char: code[k] });
  return out.sort((a, b) => a.offset - b.offset).slice(0, 20);
}
export function matchBracket(text, offset, lang) {
  const code = scan(text, lang).code;
  for (const at of [offset - 1, offset]) {
    const c = code[at];
    if (PAIRS[c]) { let d = 0; for (let i = at; i < code.length; i++) { if (code[i] === c) d++; else if (code[i] === PAIRS[c] && --d === 0) return [at, i]; } return null; }
    if (CLOSE[c]) { let d = 0; for (let i = at; i >= 0; i--) { if (code[i] === c) d++; else if (code[i] === CLOSE[c] && --d === 0) return [i, at]; } return null; }
  }
  return null;
}

/* ---------- compiler and interpreter messages ---------- */
// GCC / Clang, MSVC, javac, tsc, Go, rustc and Python tracebacks → {path, file, line, col, kind, text}.
export function parseDiagnostics(text, root = '') {
  const out = [], rootPath = String(root).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const place = f => {
    let file = String(f).replace(/\\/g, '/').replace(/^\.\//, '');
    if (rootPath && file.toLowerCase().startsWith(rootPath + '/')) file = file.slice(rootPath.length + 1);
    const inside = !/^[a-z]:\//i.test(file) && !file.startsWith('/') && !file.startsWith('<');
    return inside ? file : null;
  };
  const lines = text.replace(/\u0002/g, '').split(/\r?\n/);
  let pyFile = null;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    let m;
    if ((m = /^(.*?):(\d+):(?:(\d+):)?\s*(fatal error|error|warning|note):\s*(.*)$/.exec(raw))) {
      out.push({ path: place(m[1]), file: m[1], line: +m[2], col: +(m[3] || 0), kind: m[4] === 'fatal error' ? 'error' : m[4], text: m[5] });
    } else if ((m = /^(.*?)\((\d+)(?:,(\d+))?\)\s*:\s*(fatal error|error|warning)\s*([A-Z]+\d+)?\s*:\s*(.*)$/.exec(raw))) {
      out.push({ path: place(m[1]), file: m[1], line: +m[2], col: +(m[3] || 0), kind: m[4] === 'warning' ? 'warning' : 'error', text: (m[5] ? m[5] + ': ' : '') + m[6] });
    } else if ((m = /^(.*?\.go):(\d+):(\d+):\s*(.*)$/.exec(raw))) {
      out.push({ path: place(m[1]), file: m[1], line: +m[2], col: +m[3], kind: 'error', text: m[4] });
    } else if ((m = /^(error|warning)(\[\w+\])?:\s*(.*)$/.exec(raw)) && /^\s*-->\s*(.*?):(\d+):(\d+)/.test(lines[i + 1] || '')) {
      const at = /^\s*-->\s*(.*?):(\d+):(\d+)/.exec(lines[i + 1]);
      out.push({ path: place(at[1]), file: at[1], line: +at[2], col: +at[3], kind: m[1], text: (m[2] ? m[2].slice(1, -1) + ': ' : '') + m[3] });
    } else if ((m = /^File "(.*?)", line (\d+)/.exec(raw))) {
      pyFile = { path: place(m[1]), file: m[1], line: +m[2] };
    } else if (pyFile && (m = /^(\w*(?:Error|Exception|Warning)|KeyboardInterrupt)\b:?\s*(.*)$/.exec(raw))) {
      out.push({ ...pyFile, col: 0, kind: /Warning$/.test(m[1]) ? 'warning' : 'error', text: m[1] + (m[2] ? ': ' + m[2] : '') });
      pyFile = null;
    }
  }
  return out;
}

/* ---------- the editor binding (CodeMirror 5) ---------- */
const KIND_ICON = { keyword: 'K', function: 'ƒ', method: 'm', field: '·', variable: 'x', snippet: '{}', type: 'T', constant: 'c', module: '◫' };
const escHtml = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// opts: lang() → language id, extraText() → other open files' text, t(key, vars) → translated text,
//       gutter: the gutter id for problem marks (it must be in the editor's gutters), or null.
export function attachIntel(cm, { lang, extraText = () => '', t = k => k, gutter = null } = {}) {
  const CM = cm.constructor.Pass ? cm.constructor : window.CodeMirror;
  const doc = () => cm.getDoc();
  const L = () => lang() || null;
  let pop = null, popState = null, sigEl = null, hoverEl = null, hoverTimer = 0, lintTimer = 0;
  let snippet = null;           // {marks: [[TextMarker…]…], i}
  let matchMarks = [];
  const diagMarks = new WeakMap(); // doc → {compile: [...], lint: [...]}
  const diags = new WeakMap();     // doc → {compile: [...], lint: [...]} as {line, col, kind, text}
  const wrap = cm.getWrapperElement();

  /* completion popup */
  function closePop() { pop?.remove(); pop = null; popState = null; cm.removeKeyMap(popKeys); }
  function render() {
    const { items, active } = popState;
    pop.innerHTML = `<ul class="ci-list" role="listbox">${items.map((it, i) => `<li role="option" class="ci-item${i === active ? ' is-active' : ''}" data-i="${i}" aria-selected="${i === active}">
      <span class="ci-icon ci-${it.kind}" title="${escHtml(t('ci.kind.' + it.kind))}">${KIND_ICON[it.kind] || '·'}</span><span class="ci-label">${highlight(it.label, popState.prefix)}</span><span class="ci-detail">${escHtml(it.detail || '')}</span></li>`).join('')}</ul>
      ${docPane(items[active])}`;
    pop.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  }
  function docPane(it) {
    if (!it) return '';
    const head = it.kind === 'snippet' ? t('ci.snippet') : it.sig ? it.sig + (it.ret && !/^(macro)$/.test(it.ret) ? ' → ' + it.ret : '') : it.user ? t('ci.definedAt', { line: it.user }) : it.ret ? `${it.label}: ${it.ret}` : '';
    const body = it.kind === 'snippet' ? `<pre class="ci-snippet">${escHtml(expandSnippet(it.snippet).text.replace(/\t/g, '  '))}</pre>` : it.doc ? `<p>${escHtml(it.doc)}</p>` : '';
    return head || body ? `<div class="ci-doc">${head ? `<code>${escHtml(head)}</code>` : ''}${body}</div>` : '';
  }
  function highlight(label, prefix) {
    if (prefix && label.toLowerCase().startsWith(prefix.toLowerCase())) return `<b>${escHtml(label.slice(0, prefix.length))}</b>${escHtml(label.slice(prefix.length))}`;
    return escHtml(label);
  }
  function show(manual = false) {
    const text = cm.getValue(), offset = doc().indexFromPos(cm.getCursor());
    const lg = L();
    if (lg && !manual && contextAt(text, offset, lg) !== 'code') {
      const line = cm.getLine(cm.getCursor().line);
      if (!/^\s*#\s*include|^\s*import|^\s*from/.test(line)) { closePop(); return; }
    }
    const r = complete({ text, offset, lang: lg, extraText: lg ? extraText() : '', manual });
    if (!r.items.length) { if (manual && !pop) toastEmpty(); closePop(); return; }
    // A single result that is exactly what was typed is nothing to offer.
    if (!manual && r.items.length === 1 && r.items[0].label === r.prefix && r.items[0].kind !== 'snippet') { closePop(); return; }
    const keep = popState?.items[popState.active]?.label;
    popState = { ...r, active: Math.max(0, r.items.findIndex(i => i.label === keep)) };
    if (!pop) {
      pop = document.createElement('div'); pop.className = 'ci-pop';
      pop.addEventListener('mousedown', e => e.preventDefault());
      pop.addEventListener('click', e => { const li = e.target.closest('[data-i]'); if (li) { popState.active = +li.dataset.i; accept(); } });
      document.body.append(pop); cm.addKeyMap(popKeys);
    }
    render(); place(pop, doc().posFromIndex(r.from));
  }
  function toastEmpty() {
    const el = document.createElement('div'); el.className = 'ci-pop ci-empty'; el.textContent = t('ci.none');
    document.body.append(el); place(el, cm.getCursor()); setTimeout(() => el.remove(), 1200);
  }
  function place(el, pos, above = false) {
    const c = cm.cursorCoords(pos, 'window');
    el.style.left = Math.max(4, Math.min(c.left - 26, innerWidth - el.offsetWidth - 8)) + 'px';
    const h = el.offsetHeight;
    if (above || (c.bottom + h + 8 > innerHeight && c.top - h - 6 > 0)) { el.style.top = (c.top - h - 4) + 'px'; el.classList.add('is-above'); }
    else { el.style.top = (c.bottom + 3) + 'px'; el.classList.remove('is-above'); }
  }
  function move(d) { const n = popState.items.length; popState.active = (popState.active + d + n) % n; render(); }
  function accept() {
    const it = popState.items[popState.active];
    const from = doc().posFromIndex(popState.from), to = doc().posFromIndex(Math.max(popState.to, doc().indexFromPos(cm.getCursor())));
    closePop();
    if (it.kind === 'snippet') return insertSnippet(it.snippet, from, to);
    let text = it.label;
    const after = cm.getRange(to, { line: to.line, ch: to.ch + 1 });
    if (it.params && it.kind !== 'module' && after !== '(' && !it.label.endsWith('!')) {
      // Functions get their brackets; the cursor goes inside when there are parameters.
      cm.replaceRange(text + '()', from, to, '+complete');
      const end = { line: from.line, ch: from.ch + text.length + (it.params.length ? 1 : 2) };
      cm.setCursor(end); updateSignature(); return;
    }
    if (it.label.endsWith('!') && it.params && after !== '(' && after !== '[') {
      const o = it.open || '(', c = o === '[' ? ']' : ')';
      cm.replaceRange(text + o + c, from, to, '+complete'); cm.setCursor({ line: from.line, ch: from.ch + text.length + 1 }); updateSignature(); return;
    }
    cm.replaceRange(text, from, to, '+complete');
  }
  const popKeys = {
    Up: () => move(-1), Down: () => move(1), PageUp: () => move(-8), PageDown: () => move(8),
    Enter: () => accept(), Tab: () => accept(), Esc: () => closePop(),
  };
  /* snippets */
  function insertSnippet(body, from, to) {
    const indent = /^\s*/.exec(cm.getLine(from.line))[0];
    const unit = ' '.repeat(cm.getOption('indentUnit') || 4);
    const ex = expandSnippet(body.replace(/\t/g, unit).replace(/\n/g, '\n' + indent));
    // Offsets shift by the indentation that was added, so expand after re-indenting the body.
    cm.operation(() => {
      cm.replaceRange(ex.text, from, to, '+complete');
      const base = doc().indexFromPos(from);
      const marks = ex.stops.map(group => group.map(([a, b]) => doc().markText(doc().posFromIndex(base + a), doc().posFromIndex(base + b), { className: 'ci-stop', clearWhenEmpty: false, inclusiveLeft: true, inclusiveRight: true })));
      snippet = { marks, i: -1 };
      nextStop();
    });
  }
  function nextStop(dir = 1) {
    if (!snippet) return CM.Pass;
    snippet.i += dir;
    if (snippet.i < 0) snippet.i = 0;
    const group = snippet.marks[snippet.i];
    if (!group) { endSnippet(); return CM.Pass; }
    const ranges = group.map(m => m.find()).filter(Boolean).map(r => ({ anchor: r.from, head: r.to }));
    if (!ranges.length) return nextStop(dir);
    cm.setSelections(ranges, 0);
    if (snippet.i === snippet.marks.length - 1) endSnippet();
  }
  function endSnippet() { if (!snippet) return; for (const g of snippet.marks) for (const m of g) m.clear(); snippet = null; }

  /* parameter hints */
  function updateSignature() {
    const lg = L();
    const s = lg && !cm.somethingSelected() ? signatureAt({ text: cm.getValue(), offset: doc().indexFromPos(cm.getCursor()), lang: lg, extraText: extraText() }) : null;
    if (!s) { sigEl?.remove(); sigEl = null; return; }
    if (!sigEl) { sigEl = document.createElement('div'); sigEl.className = 'ci-sig'; document.body.append(sigEl); }
    const ps = s.params.map((p, i) => i === s.active ? `<b class="ci-param">${escHtml(p)}</b>` : escHtml(p)).join(', ');
    sigEl.innerHTML = `<code>${escHtml(s.name)}(${ps})${s.ret && s.ret !== 'macro' ? ' → ' + escHtml(s.ret) : ''}</code>${s.doc ? `<p>${escHtml(s.doc)}</p>` : s.line ? `<p>${escHtml(t('ci.definedAt', { line: s.line }))}</p>` : ''}`;
    place(sigEl, cm.getCursor(), true);
  }

  /* hover */
  function hideHover() { clearTimeout(hoverTimer); hoverEl?.remove(); hoverEl = null; }
  function onMove(e) {
    clearTimeout(hoverTimer);
    if (hoverEl && hoverEl.contains(e.target)) return;
    hoverTimer = setTimeout(() => {
      const pos = cm.coordsChar({ left: e.clientX, top: e.clientY }, 'window');
      const ch = cm.charCoords(pos, 'window');
      if (e.clientX < ch.left - 12 || e.clientX > ch.right + 12) { hoverEl?.remove(); hoverEl = null; return; }
      const parts = [];
      const d = diags.get(doc());
      for (const p of [...(d?.compile || []), ...(d?.lint || [])]) if (p.line - 1 === pos.line && (p.line && (!p.col || Math.abs(p.col - 1 - pos.ch) < 40))) parts.push(`<p class="ci-hover-${p.kind}"><b>${escHtml(t(p.kind === 'warning' ? 'wb.warning' : p.kind === 'note' ? 'wb.note' : 'wb.error'))}</b> ${escHtml(p.text)}</p>`);
      const lg = L();
      const h = lg ? hoverAt({ text: cm.getValue(), offset: doc().indexFromPos(pos), lang: lg, extraText: extraText() }) : null;
      if (h && !h.keyword) parts.push(`<code>${escHtml(h.title)}</code>${h.doc ? `<p>${escHtml(h.doc)}</p>` : ''}${h.line ? `<p class="ci-muted">${escHtml(t('ci.definedAt', { line: h.line }))}</p>` : ''}`);
      hoverEl?.remove(); hoverEl = null;
      if (!parts.length) return;
      hoverEl = document.createElement('div'); hoverEl.className = 'ci-hover'; hoverEl.innerHTML = parts.join('');
      document.body.append(hoverEl);
      place(hoverEl, pos, true);
    }, 380);
  }
  wrap.addEventListener('mousemove', onMove);
  wrap.addEventListener('mouseleave', () => { clearTimeout(hoverTimer); setTimeout(() => { if (!hoverEl?.matches(':hover')) hideHover(); }, 120); });

  /* brackets and indentation */
  const OPEN = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };
  function typeOpen(ch) {
    return c => {
      if (c.getOption('readOnly')) return CM.Pass;
      const sels = c.listSelections();
      if (sels.length !== 1) return CM.Pass;
      const s = sels[0], close = OPEN[ch];
      if (c.somethingSelected()) { const text = c.getSelection(); c.replaceSelection(ch + text + close, 'around'); const a = c.getCursor('from'), b = c.getCursor('to'); c.setSelection({ line: a.line, ch: a.ch + 1 }, { line: b.line, ch: b.ch - 1 }); return; }
      const cur = s.head, next = c.getRange(cur, { line: cur.line, ch: cur.ch + 1 }), prev = c.getRange({ line: cur.line, ch: Math.max(0, cur.ch - 1) }, cur);
      const quote = ch === close;
      if (quote && next === ch) { c.setCursor({ line: cur.line, ch: cur.ch + 1 }); return; }
      if (quote && (/[\w$]/.test(prev) || (ch === "'" && L() === 'rust'))) return CM.Pass;
      const type = c.getTokenTypeAt(cur) || '';
      if (/string|comment/.test(type) && quote) return CM.Pass;
      if (next && !/[\s)\]};,:]/.test(next)) return CM.Pass;
      c.replaceRange(ch + close, cur, cur, '+input'); c.setCursor({ line: cur.line, ch: cur.ch + 1 });
    };
  }
  function typeClose(ch) {
    return c => {
      if (c.somethingSelected() || c.listSelections().length !== 1) return CM.Pass;
      const cur = c.getCursor(), next = c.getRange(cur, { line: cur.line, ch: cur.ch + 1 });
      if (next === ch) { c.setCursor({ line: cur.line, ch: cur.ch + 1 }); return; }
      return CM.Pass;
    };
  }
  const bracketKeys = {
    "'('": typeOpen('('), "'['": typeOpen('['), "'{'": typeOpen('{'), "'\"'": typeOpen('"'), "'''": typeOpen("'"), "'`'": c => (/^(js|ts|go)$/.test(L() || '') ? typeOpen('`')(c) : CM.Pass),
    "')'": typeClose(')'), "']'": typeClose(']'), "'}'": typeClose('}'),
    Backspace: c => {
      if (c.somethingSelected() || c.listSelections().length !== 1) return CM.Pass;
      const cur = c.getCursor(), pair = c.getRange({ line: cur.line, ch: cur.ch - 1 }, { line: cur.line, ch: cur.ch + 1 });
      if (pair.length === 2 && OPEN[pair[0]] === pair[1]) { c.replaceRange('', { line: cur.line, ch: cur.ch - 1 }, { line: cur.line, ch: cur.ch + 1 }, '+delete'); return; }
      return CM.Pass;
    },
    Enter: c => {
      if (c.somethingSelected() || c.listSelections().length !== 1) return CM.Pass;
      const cur = c.getCursor(), pair = c.getRange({ line: cur.line, ch: cur.ch - 1 }, { line: cur.line, ch: cur.ch + 1 });
      if (!['{}', '[]', '()'].includes(pair)) return CM.Pass;
      c.operation(() => {
        c.replaceSelection('\n\n', 'end', '+input');
        c.indentLine(cur.line + 1, 'smart'); c.indentLine(cur.line + 2, 'smart');
        const line = cur.line + 1, unit = c.getOption('indentUnit');
        // Inside a new block the line is one level deeper than the closing bracket.
        const closing = /^\s*/.exec(c.getLine(cur.line + 2))[0].length;
        const want = closing + unit;
        c.replaceRange(' '.repeat(want), { line, ch: 0 }, { line, ch: c.getLine(line).length });
        c.setCursor({ line, ch: want });
      });
    },
    Tab: c => (snippet ? nextStop(1) : CM.Pass),
    'Shift-Tab': c => (snippet ? nextStop(-1) : CM.Pass),
    'Ctrl-Space': () => show(true), 'Cmd-I': () => show(true),
    'Ctrl-Shift-Space': () => updateSignature(),
    Esc: () => { if (sigEl) { sigEl.remove(); sigEl = null; return; } if (snippet) { endSnippet(); return; } hideHover(); return CM.Pass; },
  };
  cm.addKeyMap(bracketKeys);

  /* matching bracket */
  function markMatch() {
    for (const m of matchMarks) m.clear(); matchMarks = [];
    const lg = L(); if (!lg || cm.somethingSelected()) return;
    const text = cm.getValue(); if (text.length > 300000) return;
    const r = matchBracket(text, doc().indexFromPos(cm.getCursor()), lg);
    if (!r) return;
    for (const at of r) matchMarks.push(doc().markText(doc().posFromIndex(at), doc().posFromIndex(at + 1), { className: 'ci-match' }));
  }

  /* problem marks: compiler messages (setDiagnostics) and brackets found while typing */
  function drawMarks() {
    const d = doc(), state = diags.get(d) || {}, old = diagMarks.get(d) || [];
    for (const m of old) m.clear();
    const marks = [];
    if (gutter) cm.clearGutter(gutter);
    const byLine = new Map();
    for (const p of [...(state.compile || []), ...(state.lint || [])]) {
      if (!p.line || p.line - 1 > d.lastLine()) continue;
      const ln = p.line - 1, text = d.getLine(ln);
      let a = p.col ? Math.min(p.col - 1, text.length) : /^\s*/.exec(text)[0].length, b = a;
      while (b < text.length && /[\w$]/.test(text[b])) b++;
      if (b === a) b = p.col ? Math.min(a + 1, text.length) : text.length;
      if (b > a) marks.push(d.markText({ line: ln, ch: a }, { line: ln, ch: b }, { className: 'ci-squiggle ci-' + p.kind, attributes: { title: p.text } }));
      const prev = byLine.get(ln);
      if (!prev || p.kind === 'error') byLine.set(ln, p);
    }
    if (gutter) for (const [ln, p] of byLine) {
      const el = document.createElement('span'); el.className = 'ci-gutter ci-' + p.kind; el.title = p.text; el.textContent = p.kind === 'warning' ? '▲' : p.kind === 'note' ? 'i' : '●';
      cm.setGutterMarker(ln, gutter, el);
    }
    diagMarks.set(d, marks);
  }
  function lint() {
    const lg = L(), d = doc();
    const state = diags.get(d) || {}; diags.set(d, state);
    state.lint = [];
    if (lg && d.getValue().length < 400000) {
      const text = d.getValue();
      state.lint = bracketProblems(text, lg).map(p => {
        const pos = d.posFromIndex(p.offset);
        const msg = p.kind === 'unclosed' ? t('ci.unclosed', { c: p.char }) : p.kind === 'mismatch' ? t('ci.mismatch', { c: p.char, o: p.open, line: d.posFromIndex(p.openAt).line + 1 }) : t('ci.unexpected', { c: p.char });
        return { line: pos.line + 1, col: pos.ch + 1, kind: 'error', text: msg, lint: true };
      });
    }
    drawMarks();
  }

  /* events */
  const onInput = (c, change) => {
    const typed = change.text.join('\n');
    if (change.origin !== '+input' || typed.length !== 1) { if (pop) show(); return; }
    if (/[\w$]/.test(typed)) show();
    else if (typed === '.' || typed === ':' && c.getRange({ line: change.from.line, ch: change.from.ch - 1 }, change.from) === ':' || typed === '>' && c.getRange({ line: change.from.line, ch: change.from.ch - 1 }, change.from) === '-') show();
    else if ((typed === '<' || typed === '"') && /^\s*#\s*include\s*[<"]$/.test(c.getLine(change.from.line).slice(0, change.from.ch + 1))) show(true);
    else closePop();
  };
  cm.on('inputRead', onInput);
  const onChange = (c, change) => {
    if (pop && change.origin === '+delete') show();
    clearTimeout(lintTimer); lintTimer = setTimeout(lint, 450);
  };
  cm.on('change', onChange);
  const onCursor = () => {
    if (pop) {
      const off = doc().indexFromPos(cm.getCursor());
      if (off < popState.from || cm.getCursor().line !== doc().posFromIndex(popState.from).line) closePop();
    }
    updateSignature(); markMatch();
    if (snippet && !snippet.marks.some(g => g.some(m => { const r = m.find(); return r && cm.getCursor().line >= r.from.line && cm.getCursor().line <= r.to.line + 3; }))) endSnippet();
  };
  cm.on('cursorActivity', onCursor);
  const onBlur = () => { setTimeout(() => { if (!cm.hasFocus()) { closePop(); sigEl?.remove(); sigEl = null; } }, 100); };
  cm.on('blur', onBlur);
  const onScroll = () => { closePop(); hideHover(); if (sigEl) updateSignature(); };
  cm.on('scroll', onScroll);
  const onSwap = () => { closePop(); hideHover(); sigEl?.remove(); sigEl = null; endSnippet(); for (const m of matchMarks) m.clear(); matchMarks = []; lint(); };
  cm.on('swapDoc', onSwap);
  setTimeout(lint, 0);

  return {
    // Compiler / run messages for the open document: [{line, col, kind, text}]
    setDiagnostics(list) { const d = doc(), state = diags.get(d) || {}; state.compile = (list || []).filter(p => p.line); diags.set(d, state); drawMarks(); },
    complete: manual => show(manual !== false),
    close() { closePop(); hideHover(); sigEl?.remove(); sigEl = null; },
    lint,
    get open() { return !!pop; },
    dispose() {
      closePop(); hideHover(); sigEl?.remove(); sigEl = null; endSnippet();
      cm.removeKeyMap(bracketKeys);
      cm.off('inputRead', onInput); cm.off('change', onChange); cm.off('cursorActivity', onCursor); cm.off('blur', onBlur); cm.off('scroll', onScroll); cm.off('swapDoc', onSwap);
      wrap.removeEventListener('mousemove', onMove);
    },
  };
}
