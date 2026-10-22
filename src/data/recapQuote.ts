import { fromMarkdown, type Options as ParseOptions } from 'mdast-util-from-markdown';
import remarkGfm from 'remark-gfm';
import remarkCjkFriendly from 'remark-cjk-friendly/parseOnly';
import { collapse, type SyntaxNode } from './messageRecap';

// Target matching for recap points. Keep it out of the message parser: the session client imports that parser,
// and the GFM syntax must load only with the message list.

/**
 * Normalize a quote or a rendered text for a target match.
 * Agents sometimes copy inline code marks or bold marks from the Markdown source.
 */
export function normalizeQuote(value: string): string {
  return collapse(value.replace(/`|\*\*/g, '')).trim();
}

// The chat renders replies with these remark plugins. The recap text uses the same syntax.
export const remarkPlugins = [remarkGfm, remarkCjkFriendly];
let parseOptions: ParseOptions | undefined;
// The parser extensions of the remark plugins, so the text of a reply matches the rendered chat.
function chatParseOptions(): ParseOptions {
  if (!parseOptions) {
    const data: { micromarkExtensions?: ParseOptions['extensions']; fromMarkdownExtensions?: ParseOptions['mdastExtensions'] } = {};
    for (const plugin of remarkPlugins) (plugin as (this: { data(): typeof data }) => void).call({ data: () => data });
    parseOptions = { extensions: data.micromarkExtensions, mdastExtensions: data.fromMarkdownExtensions };
  }
  return parseOptions;
}

const BLOCKS = new Set(['paragraph', 'heading', 'listItem', 'code', 'tableCell', 'tableRow', 'blockquote', 'thematicBreak']);
// Not whitespace, so a quote match cannot join two blocks. The chat finds a target in one block.
export const RECAP_BLOCK_BREAK = '\0';
// The rendered text of Markdown, with a block break after each block. keepHtml keeps raw HTML as text.
export function markdownText(markdown: string, keepHtml = false): string {
  const out: string[] = [];
  function visit(node: SyntaxNode) {
    if (typeof node.value === 'string' && (keepHtml || node.type !== 'html')) out.push(node.value);
    node.children?.forEach(visit);
    if (BLOCKS.has(node.type)) out.push(RECAP_BLOCK_BREAK);
  }
  visit(fromMarkdown(markdown, chatParseOptions()));
  return out.join('');
}

const needleCache = new Map<string, string[]>();
/**
 * The normalized forms of a quote to look for in the rendered text.
 * The prompt asks for a verbatim quote, so the agent can copy Markdown links, emphasis, or list marks.
 * The literal form stays first, because code blocks show Markdown marks as text.
 */
export function recapNeedles(quote: string): string[] {
  let needles = needleCache.get(quote);
  if (!needles) {
    const literal = normalizeQuote(quote);
    const rendered = normalizeQuote(markdownText(quote, true).split(RECAP_BLOCK_BREAK).join(' '));
    needles = [...new Set([literal, rendered])].filter(Boolean);
    if (needleCache.size > 500) needleCache.clear();
    needleCache.set(quote, needles);
  }
  return needles;
}

// True when one block of the sources holds the quote. An empty quote has no target.
export function findRecapQuote(quote: string, sources: readonly string[]): boolean {
  const needles = recapNeedles(quote);
  return !!needles.length && sources.some((source) =>
    source.split(RECAP_BLOCK_BREAK).some((text) => {
      const normalized = normalizeQuote(text);
      return needles.some((needle) => normalized.includes(needle));
    }));
}
