"use client";

import Link from "next/link";
import React, { type ReactNode } from "react";

function renderInline(text: string): ReactNode[] {
  // Regex matches:
  // [link text](url)
  // `code`
  // **bold**
  // *italic*
  const pattern = /(\[[^\]]+\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  const parts = text.split(pattern);

  return parts.map((part, index) => {
    if (!part) return null;

    // Link: [text](url)
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      const linkText = linkMatch[1] ?? "";
      const href = linkMatch[2] ?? "";
      if (href.startsWith("/")) {
        return (
          <Link
            key={index}
            href={href}
            className="font-semibold text-primary underline underline-offset-2 hover:text-primary/80"
          >
            {linkText}
          </Link>
        );
      }
      return (
        <a
          key={index}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-primary underline underline-offset-2 hover:text-primary/80"
        >
          {linkText}
        </a>
      );
    }

    // Code: `code`
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={index}
          className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-medium text-foreground"
        >
          {part.slice(1, -1)}
        </code>
      );
    }

    // Bold: **bold**
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={index} className="font-bold">
          {part.slice(2, -2)}
        </strong>
      );
    }

    // Italic: *italic*
    if (part.startsWith("*") && part.endsWith("*")) {
      return (
        <em key={index} className="italic">
          {part.slice(1, -1)}
        </em>
      );
    }

    return <React.Fragment key={index}>{part}</React.Fragment>;
  });
}

export function MarkdownRenderer({ content }: { content: string }) {
  const lines = content.split(/\r?\n/);
  const elements: ReactNode[] = [];

  let currentList: { type: "ul" | "ol"; items: string[] } | null = null;

  function flushList() {
    if (!currentList) return;
    const ListTag = currentList.type === "ul" ? "ul" : "ol";
    const items = currentList.items;
    elements.push(
      <ListTag
        key={`list-${elements.length}`}
        className={`my-3 space-y-1.5 ${
          currentList.type === "ul" ? "list-disc pl-5" : "list-decimal pl-5"
        }`}
      >
        {items.map((item, idx) => (
          <li key={idx} className="text-sm leading-relaxed text-foreground">
            {renderInline(item)}
          </li>
        ))}
      </ListTag>,
    );
    currentList = null;
  }

  lines.forEach((line, lineIndex) => {
    const trimmed = line.trim();

    if (!trimmed) {
      flushList();
      return;
    }

    // Headings: #, ##, ###
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch && headingMatch[1] && headingMatch[2]) {
      flushList();
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();
      const id = text
        .toLowerCase()
        .replace(/[^\w\s-]/g, "")
        .replace(/\s+/g, "-");

      if (level === 1) {
        elements.push(
          <h1
            key={`line-${lineIndex}`}
            id={id}
            className="mb-4 mt-6 text-2xl font-black tracking-tight text-foreground sm:text-3xl"
          >
            {renderInline(text)}
          </h1>,
        );
      } else if (level === 2) {
        elements.push(
          <h2
            key={`line-${lineIndex}`}
            id={id}
            className="mb-3 mt-6 border-b pb-2 text-lg font-bold tracking-tight text-foreground sm:text-xl"
          >
            {renderInline(text)}
          </h2>,
        );
      } else {
        elements.push(
          <h3
            key={`line-${lineIndex}`}
            id={id}
            className="mb-2 mt-4 text-base font-semibold tracking-tight text-foreground"
          >
            {renderInline(text)}
          </h3>,
        );
      }
      return;
    }

    // Unordered List item: - or *
    const ulMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (ulMatch && ulMatch[1]) {
      if (!currentList || currentList.type !== "ul") {
        flushList();
        currentList = { type: "ul", items: [] };
      }
      currentList.items.push(ulMatch[1]);
      return;
    }

    // Ordered List item: 1.
    const olMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (olMatch && olMatch[1]) {
      if (!currentList || currentList.type !== "ol") {
        flushList();
        currentList = { type: "ol", items: [] };
      }
      currentList.items.push(olMatch[1]);
      return;
    }

    // Blockquote: >
    if (trimmed.startsWith(">")) {
      flushList();
      const quoteText = trimmed.replace(/^>\s*/, "");
      elements.push(
        <blockquote
          key={`line-${lineIndex}`}
          className="my-3 border-l-4 border-primary/50 bg-muted/40 py-2 pl-4 text-sm italic text-muted-foreground"
        >
          {renderInline(quoteText)}
        </blockquote>,
      );
      return;
    }

    // Paragraph
    flushList();
    elements.push(
      <p key={`line-${lineIndex}`} className="my-2.5 text-sm leading-relaxed text-foreground">
        {renderInline(trimmed)}
      </p>,
    );
  });

  flushList();

  return <div className="prose prose-sm dark:prose-invert max-w-none">{elements}</div>;
}
