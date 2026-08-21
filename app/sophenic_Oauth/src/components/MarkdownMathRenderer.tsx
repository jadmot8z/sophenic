"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

const MATH_FENCE = /```(?:math|latex|tex)[^\S\r\n]*\r?\n([\s\S]*?)```/gi;
const UNCLOSED_MATH_FENCE = /```(?:math|latex|tex)[^\S\r\n]*\r?\n([\s\S]*)$/i;

function convertStandaloneLatexLines(markdown: string) {
  const lines = markdown.split("\n");
  let inCodeFence = false;
  let fenceMarker = "";
  let inDisplayMath = false;
  const commandPattern = /\\(?:frac|dfrac|tfrac|sqrt|Delta|Gamma|Theta|Lambda|Omega|alpha|beta|gamma|delta|theta|lambda|mu|pi|sigma|phi|psi|omega|pm|mp|times|cdot|div|sum|prod|int|lim|infty|leq|geq|neq|approx|left|right|overline|underline|vec|begin|end)\b|[_^]\{/;
  const mathShapePattern = /(?:=|\+|-|\*|\/|\^|_|<|>|\\[a-zA-Z]+)/;

  return lines.map((line) => {
    const trimmed = line.trim();
    const fence = trimmed.match(/^(```+|~~~+)/)?.[1];
    if (fence) {
      if (!inCodeFence) {
        inCodeFence = true;
        fenceMarker = fence[0];
      } else if (fence[0] === fenceMarker) {
        inCodeFence = false;
        fenceMarker = "";
      }
      return line;
    }
    if (inCodeFence || !trimmed) return line;
    if (trimmed === "$$") {
      inDisplayMath = !inDisplayMath;
      return line;
    }
    if (inDisplayMath || trimmed.includes("$")) return line;
    if (commandPattern.test(trimmed) && mathShapePattern.test(trimmed)) return `$$\n${trimmed}\n$$`;
    return line;
  }).join("\n");
}

export function normalizeMathMarkdown(input: string) {
  let markdown = (input || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/\bundefined\b/g, "")
    .replace(MATH_FENCE, (_match, body: string) => `\n$$\n${body.trim()}\n$$\n`)
    .replace(/\\\[([\s\S]*?)\\\]/g, (_match, body: string) => `\n$$\n${body.trim()}\n$$\n`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_match, body: string) => `$${body.trim()}$`);

  // Les modèles en streaming peuvent terminer sans fermer un bloc ```math.
  markdown = markdown.replace(UNCLOSED_MATH_FENCE, (_match, body: string) => `\n$$\n${body.trim()}\n$$\n`);
  return convertStandaloneLatexLines(markdown);
}

export function MarkdownMathRenderer({ content }: { content: string }) {
  return <ReactMarkdown
    remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: true }]]}
    rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: "warn" }]]}
  >
    {normalizeMathMarkdown(content)}
  </ReactMarkdown>;
}
