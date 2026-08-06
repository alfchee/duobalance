#!/usr/bin/env node
// Fails if any locale file is missing a message key that another file has.
// Keeps es/en from silently diverging so untranslated UI never ships.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const messagesDir = path.resolve(dirname, "../src/messages");
const FILES = ["es.json", "en.json"];

function flattenKeys(obj, prefix = "", out = []) {
  for (const [key, value] of Object.entries(obj)) {
    const dotted = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object") {
      flattenKeys(value, dotted, out);
    } else {
      out.push(dotted);
    }
  }
  return out;
}

const byFile = Object.fromEntries(
  FILES.map((file) => [
    file,
    new Set(flattenKeys(JSON.parse(readFileSync(path.join(messagesDir, file), "utf8")))),
  ]),
);

const errors = [];
for (const [file, keys] of Object.entries(byFile)) {
  for (const [otherFile, otherKeys] of Object.entries(byFile)) {
    if (file === otherFile) continue;
    for (const key of keys) {
      if (!otherKeys.has(key)) {
        errors.push(`${file} has "${key}" but ${otherFile} does not`);
      }
    }
  }
}

if (errors.length > 0) {
  console.error(`i18n key mismatch (${errors.length}):`);
  for (const error of [...new Set(errors)]) console.error(`  ${error}`);
  process.exit(1);
}
console.log(`locale keys in sync: ${FILES.join(", ")}`);
