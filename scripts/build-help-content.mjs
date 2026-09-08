#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const helpContentDir = path.resolve(dirname, "../src/content/help");
const outputFile = path.resolve(dirname, "../src/lib/help/generated-content.ts");

const LOCALES = ["es", "en", "pt-BR"];

function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { data: {}, content: raw };
  const yaml = match[1];
  const content = match[2];
  const data = {};
  const lines = yaml.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    let val = trimmed.slice(colonIdx + 1).trim();
    if (!val && lines[index + 1]?.trim().startsWith("[")) {
      const arrayLines = [];
      index += 1;
      while (index < lines.length) {
        const arrayLine = lines[index].trim();
        arrayLines.push(arrayLine);
        if (arrayLine.endsWith("]")) break;
        index += 1;
      }
      val = arrayLines.join("");
    }
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    } else if (val.startsWith("[") && val.endsWith("]")) {
      const inner = val.slice(1, -1);
      val = inner
        ? inner
            .split(",")
            .map((s) => s.trim().replace(/^["']|["']$/g, ""))
            .filter(Boolean)
        : [];
    } else if (!isNaN(val) && val !== "") {
      val = Number(val);
    }
    data[key] = val;
  }
  return { data, content };
}

function slugify(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function extractHeadings(content) {
  const headingRegex = /^(#{1,6})\s+(.+)$/gm;
  const headings = [];
  let match;
  while ((match = headingRegex.exec(content)) !== null) {
    const level = match[1].length;
    const text = match[2].trim();
    const id = slugify(text);
    headings.push({ level, text, id });
  }
  return headings;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInlineHtml(text) {
  const pattern = /(\[[^\]]+\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  const parts = text.split(pattern);
  let out = "";
  for (const part of parts) {
    if (!part) continue;
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      const linkText = escapeHtml(linkMatch[1] ?? "");
      const href = linkMatch[2] ?? "";
      const escHref = escapeHtml(href);
      if (href.startsWith("/")) {
        out += `<a href="${escHref}" class="font-semibold text-primary underline underline-offset-2 hover:text-primary/80">${linkText}</a>`;
      } else {
        out += `<a href="${escHref}" target="_blank" rel="noopener noreferrer" class="font-semibold text-primary underline underline-offset-2 hover:text-primary/80">${linkText}</a>`;
      }
      continue;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      out += `<code class="rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-medium text-foreground">${escapeHtml(part.slice(1, -1))}</code>`;
      continue;
    }
    if (part.startsWith("**") && part.endsWith("**")) {
      out += `<strong class="font-bold">${escapeHtml(part.slice(2, -2))}</strong>`;
      continue;
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      out += `<em class="italic">${escapeHtml(part.slice(1, -1))}</em>`;
      continue;
    }
    out += escapeHtml(part);
  }
  return out;
}

function markdownToHtml(content) {
  const lines = content.split(/\r?\n/);
  let html = "";
  let currentList = null;
  function flushList() {
    if (!currentList) return;
    const tag = currentList.type === "ul" ? "ul" : "ol";
    const cls = currentList.type === "ul" ? "my-3 space-y-1.5 list-disc pl-5" : "my-3 space-y-1.5 list-decimal pl-5";
    html += `<${tag} class="${cls}">`;
    for (const item of currentList.items) {
      html += `<li class="text-sm leading-relaxed text-foreground">${renderInlineHtml(item)}</li>`;
    }
    html += `</${tag}>`;
    currentList = null;
  }
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      continue;
    }
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch && headingMatch[1] && headingMatch[2]) {
      flushList();
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();
      const id = slugify(text);
      const inner = renderInlineHtml(text);
      if (level === 1) html += `<h1 id="${id}" class="mb-4 mt-6 text-2xl font-black tracking-tight text-foreground sm:text-3xl">${inner}</h1>`;
      else if (level === 2) html += `<h2 id="${id}" class="mb-3 mt-6 border-b pb-2 text-lg font-bold tracking-tight text-foreground sm:text-xl">${inner}</h2>`;
      else html += `<h3 id="${id}" class="mb-2 mt-4 text-base font-semibold tracking-tight text-foreground">${inner}</h3>`;
      continue;
    }
    const ulMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (ulMatch && ulMatch[1]) {
      if (!currentList || currentList.type !== "ul") {
        flushList();
        currentList = { type: "ul", items: [] };
      }
      currentList.items.push(ulMatch[1]);
      continue;
    }
    const olMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (olMatch && olMatch[1]) {
      if (!currentList || currentList.type !== "ol") {
        flushList();
        currentList = { type: "ol", items: [] };
      }
      currentList.items.push(olMatch[1]);
      continue;
    }
    if (trimmed.startsWith(">")) {
      flushList();
      const quoteText = trimmed.replace(/^>\s*/, "");
      html += `<blockquote class="my-3 border-l-4 border-primary/50 bg-muted/40 py-2 pl-4 text-sm italic text-muted-foreground">${renderInlineHtml(quoteText)}</blockquote>`;
      continue;
    }
    if (trimmed.startsWith("|")) {
      flushList();
      html += `<p class="my-2.5 text-sm leading-relaxed text-foreground">${renderInlineHtml(trimmed)}</p>`;
      continue;
    }
    flushList();
    html += `<p class="my-2.5 text-sm leading-relaxed text-foreground">${renderInlineHtml(trimmed)}</p>`;
  }
  flushList();
  return `<div class="prose prose-sm dark:prose-invert max-w-none">${html}</div>`;
}

const articlesByLocale = {};
const allSlugsSet = new Set();

for (const locale of LOCALES) {
  const localeDir = path.join(helpContentDir, locale);
  articlesByLocale[locale] = {};
  if (!existsSync(localeDir)) continue;

  const files = readdirSync(localeDir).filter((f) => f.endsWith(".md"));
  for (const file of files) {
    const raw = readFileSync(path.join(localeDir, file), "utf8");
    const { data, content } = parseFrontmatter(raw);
    if (!data.slug || !data.title) {
      console.warn(`Warning: ${locale}/${file} missing title or slug frontmatter`);
      continue;
    }
    const headings = extractHeadings(content);
    const html = markdownToHtml(content);
    articlesByLocale[locale][data.slug] = {
      frontmatter: {
        title: data.title,
        slug: data.slug,
        category: data.category ?? "general",
        order: Number(data.order ?? 99),
        related: Array.isArray(data.related) ? data.related : [],
        updated: String(data.updated ?? new Date().toISOString().split("T")[0]),
      },
      headings,
      content,
      html,
    };
    allSlugsSet.add(data.slug);
  }
}

const allSlugs = Array.from(allSlugsSet).sort();

const fileHeader = `// Auto-generated by scripts/build-help-content.mjs. Do not edit manually.

export type ArticleFrontmatter = {
  title: string;
  slug: string;
  category: string;
  order: number;
  related: string[];
  updated: string;
};

export type ArticleHeading = {
  level: number;
  text: string;
  id: string;
};

export type Article = {
  frontmatter: ArticleFrontmatter;
  headings: ArticleHeading[];
  content: string;
  html: string;
};

export const ALL_HELP_SLUGS: string[] = ${JSON.stringify(allSlugs, null, 2)};

export const HELP_ARTICLES: Record<string, Record<string, Article>> = ${JSON.stringify(articlesByLocale, null, 2)};
`;

const libHelpDir = path.dirname(outputFile);
if (!existsSync(libHelpDir)) {
  mkdirSync(libHelpDir, { recursive: true });
}

writeFileSync(outputFile, fileHeader, "utf8");
try {
  execSync(`npx prettier --write "${outputFile}"`, { stdio: "ignore" });
} catch {
  // ignore
}
console.log(
  `Successfully generated help content index at ${outputFile} with ${allSlugs.length} articles across ${LOCALES.join(", ")}`,
);
