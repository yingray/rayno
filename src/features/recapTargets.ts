import { normalizeQuote, recapNeedles } from '../data/recapQuote';
import styles from './recap.module.css';

// Paragraphs, list items, headings, code blocks, tables, and tool rows can be targets.
const BLOCKS = 'p, li, h1, h2, h3, h4, h5, h6, figure, [data-markdown-table]';
const FLASH_TIME = 1200;
const flashTimers = new WeakMap<HTMLElement, number>();

/**
 * Find the smallest block of a reply turn that holds the quote.
 * The turn is the agent message and the tool groups before it, back to the last user message.
 */
export function findRecapTarget(root: ParentNode, messageId: string, quote: string, toolGroups?: readonly string[]): HTMLElement | null {
  const needles = recapNeedles(quote);
  const article = root.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
  if (!needles.length) return null;
  const scopes: Element[] = article ? [article] : [];
  if (toolGroups) {
    for (const id of toolGroups) {
      const group = root.querySelector(`[data-tool-block="${CSS.escape(id)}"]`);
      if (group) scopes.push(group);
    }
  } else for (let node = article?.previousElementSibling; node && !node.matches('[data-role="user"]'); node = node.previousElementSibling) {
    if (node.matches('[data-tool-activity]')) scopes.push(node);
  }
  let best: HTMLElement | null = null;
  let length = Infinity;
  for (const scope of scopes) {
    for (const element of scope.querySelectorAll<HTMLElement>(BLOCKS)) {
      if (element.closest('[data-recap-card], [data-reply-options]')) continue;
      const text = normalizeQuote(element.textContent || '');
      if (text.length < length && needles.some((needle) => text.includes(needle))) {
        best = element;
        length = text.length;
      }
    }
  }
  return best;
}

// A tool row in a collapsed group has no box. Its group stands in for it.
export function visibleTarget(element: HTMLElement): HTMLElement {
  return element.getClientRects().length ? element
    : element.closest<HTMLElement>('[data-tool-activity]') || element;
}

// The tops of elements in the scroll content, independent of the scroll position. It reads the scroll box once.
export function contentOffsets(scroll: HTMLElement, elements: readonly HTMLElement[]): number[] {
  const origin = scroll.getBoundingClientRect().top - scroll.scrollTop;
  return elements.map((element) => visibleTarget(element).getBoundingClientRect().top - origin);
}

export function contentOffset(scroll: HTMLElement, element: HTMLElement): number {
  return contentOffsets(scroll, [element])[0];
}

function flash(element: HTMLElement) {
  clearTimeout(flashTimers.get(element));
  element.classList.remove(styles.flash);
  // Restart the animation when the same target gets a second jump.
  void element.offsetWidth;
  element.classList.add(styles.flash);
  if (element.closest('[data-tool-activity]')) element.classList.add(styles.flashInset);
  flashTimers.set(element, window.setTimeout(() => {
    element.classList.remove(styles.flash, styles.flashInset);
    flashTimers.delete(element);
  }, FLASH_TIME));
}

/**
 * Scroll the message list to a target and flash it.
 * A target in a collapsed tool group opens the group first.
 */
export function jumpToRecapTarget(scroll: HTMLElement, element: HTMLElement, behavior?: ScrollBehavior, onJump?: () => void) {
  const group = element.closest('[data-tool-activity]');
  const toggle = group?.querySelector<HTMLButtonElement>(':scope > button[aria-expanded="false"]');
  const expand = !!toggle && !element.getClientRects().length;
  if (expand) toggle.click();
  // The chat follows the latest message on each resize while it is near the bottom (Chat.tsx).
  // After an expand, let that resize pass first. Then the scroll moves away from the bottom and stays there.
  const later = (run: () => void) => requestAnimationFrame(expand ? () => requestAnimationFrame(run) : run);
  later(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // The scroll padding keeps the target below the overlay header.
    const padding = parseFloat(getComputedStyle(scroll).scrollPaddingTop) || 0;
    const top = Math.max(0, contentOffset(scroll, element) - padding);
    scroll.scrollTo({ top, behavior: behavior || (reduce ? 'auto' : 'smooth') });
    flash(element);
    onJump?.();
  });
}
