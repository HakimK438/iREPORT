// Dependency-free i18n gate. Run: node scripts/check-i18n.mjs
//  - every T()/L()/o() entry in i18n.ts, questions.ts and brand.tsx must have non-empty hi and mr text
//  - the `copy` table in App.tsx must have the same keys in en, hi and mr
import { readFileSync } from "node:fs";

const read = f => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
const errors = [];

// Plain double-quoted strings only (escaped quotes are not used in these tables).
const CHECKS = [
  ["i18n.ts", /\bT\("([^"]*)",\s*"([^"]*)",\s*"([^"]*)"/g],
  ["questions.ts", /\b(?:L\(|o\("[^"]*",\s*)"([^"]*)",\s*"([^"]*)",\s*"([^"]*)"/g],
  ["brand.tsx", /\bL\("([^"]*)",\s*"([^"]*)",\s*"([^"]*)"/g],
];

for (const [file, re] of CHECKS) {
  let n = 0;
  for (const [, en, hi, mr] of read(file).matchAll(re)) {
    n++;
    if (!hi.trim()) errors.push(`${file}: empty hi for "${en}"`);
    if (!mr.trim()) errors.push(`${file}: empty mr for "${en}"`);
  }
  console.log(`${file}: ${n} entries checked`);
}

// copy table keys in App.tsx
const app = read("App.tsx");
const keys = lang => {
  const start = app.indexOf(`\n  ${lang}: {`);
  const end = app.indexOf("\n  },", start);
  return new Set([...app.slice(start, end).matchAll(/^ {4}(\w+):/gm)].map(m => m[1]));
};
const en = keys("en");
for (const lang of ["hi", "mr"]) {
  const k = keys(lang);
  for (const key of en) if (!k.has(key)) errors.push(`App.tsx copy.${lang} is missing "${key}"`);
}
console.log(`App.tsx copy: ${en.size} keys in en`);

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("i18n parity OK");
