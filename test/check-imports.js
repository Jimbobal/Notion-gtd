/* Static check: every named import resolves to an export. node test/check-imports.js */
'use strict';
const fs = require('fs'), path = require('path');
const files = ['js/main.js', ...fs.readdirSync('js').filter(f => f.endsWith('.js')).map(f => 'js/' + f),
               ...fs.readdirSync('js/views').map(f => 'js/views/' + f)];
const exportsOf = {};
for (const f of new Set(files)) {
  const src = fs.readFileSync(f, 'utf8');
  const names = new Set();
  for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+([\w$]+)/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^export\s*\{([^}]+)\}/gm)) m[1].split(',').forEach(s => names.add(s.trim().split(/\s+as\s+/).pop()));
  exportsOf[path.resolve(f)] = names;
}
let bad = 0;
for (const f of new Set(files)) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*'([^']+)'/g)) {
    const target = path.resolve(path.dirname(f), m[2]);
    const ex = exportsOf[target];
    if (!ex) { console.log(`${f}: cannot find ${m[2]}`); bad++; continue; }
    for (const n of m[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0]).filter(Boolean))
      if (!ex.has(n)) { console.log(`${f}: '${n}' is not exported by ${m[2]}`); bad++; }
  }
}
console.log(bad ? `${bad} problem(s)` : 'imports ok');
process.exit(bad ? 1 : 0);
