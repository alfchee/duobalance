#!/usr/bin/env node
// Fails if any locale file is missing a message key that another file has.
// Keeps es/en from silently diverging so untranslated UI never ships.
// Also checks that language endonyms (the name of a language in its own
// language) are identical in every file — those have only one correct value.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const messagesDir = path.resolve(dirname, "../src/messages");
const FILES = ["es.json", "en.json"];
const ENDONYMS = ["settings.languages.es", "settings.languages.en"];

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

function lookup(obj, dotted) {
  return dotted.split(".").reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

const parsed = Object.fromEntries(
  FILES.map((file) => [file, JSON.parse(readFileSync(path.join(messagesDir, file), "utf8"))]),
);
const byFile = Object.fromEntries(FILES.map((file) => [file, new Set(flattenKeys(parsed[file]))]));

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

for (const key of ENDONYMS) {
  const values = new Set(FILES.map((file) => lookup(parsed[file], key)));
  if (values.size > 1) {
    errors.push(`endonym "${key}" differs between files: ${[...values].join(" vs ")}`);
  }
}

if (errors.length > 0) {
  console.error(`i18n key mismatch (${errors.length}):`);
  for (const error of [...new Set(errors)]) console.error(`  ${error}`);
  process.exit(1);
}
console.log(`locale keys in sync: ${FILES.join(", ")}`);
