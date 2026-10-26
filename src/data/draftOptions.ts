export type DraftOption = { key: string; messageId: string; text: string; start: number; end: number; addedBreak: boolean };

// Keep only spans that a draft edit leaves intact. Edited option text becomes ordinary draft text.
export function reconcileDraftOptions(previous: string, next: string, options: readonly DraftOption[]): DraftOption[] {
  if (previous === next) return [...options];
  let start = 0, oldEnd = previous.length, newEnd = next.length;
  while (start < oldEnd && start < newEnd && previous[start] === next[start]) start++;
  while (oldEnd > start && newEnd > start && previous[oldEnd - 1] === next[newEnd - 1]) { oldEnd--; newEnd--; }
  return options.flatMap(option => {
    if (option.end <= start) return [option];
    if (option.start >= oldEnd) {
      const shift = newEnd - oldEnd;
      return [{ ...option, start: option.start + shift, end: option.end + shift }];
    }
    return [];
  });
}

export function toggleDraftOption(value: string, options: readonly DraftOption[], key: string, messageId: string, text: string) {
  const selected = options.find(option => option.key === key);
  if (!selected) {
    const addedBreak = !!value && !value.endsWith('\n');
    const start = value.length + Number(addedBreak);
    return { value: value + (addedBreak ? '\n' : '') + text,
      options: [...options, { key, messageId, text, start, end: start + text.length, addedBreak }] };
  }
  let start = selected.start, end = selected.end;
  if (selected.addedBreak && value[start - 1] === '\n') start--;
  // Remove the next added separator when this choice has no separator of its own.
  const following = start === selected.start ? options.find(option => option.start === end + 1 && option.addedBreak) : undefined;
  if (following) end++;
  const next = value.slice(0, start) + value.slice(end);
  const remaining = options.filter(option => option !== selected).map(option => option === following ? { ...option, addedBreak: false } : option);
  return { value: next, options: remaining.map(option => option.start >= end
    ? { ...option, start: option.start - (end - start), end: option.end - (end - start) } : option) };
}
