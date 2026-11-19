export type Child = Node | string | null | undefined | false;
export type Attrs = Record<string, unknown>;
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (Child | Child[])[]) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') (el as any)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}
const ICONS: Record<string, string> = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>', home: '<path d="M4 11.5 12 5l8 6.5M6.5 10v9h11v-9"/>', back: '<path d="m14 6-6 6 6 6"/>', forward: '<path d="m10 6 6 6-6 6"/>',
  settings: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>', full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>', close: '<path d="m6 6 12 12M18 6 6 18"/>',
  play: '<path d="M8 5.5v13l10-6.5z"/>', pause: '<path d="M8 5v14M16 5v14"/>', faster: '<path d="m5 6 7 6-7 6zM13 6l7 6-7 6z"/>', slower: '<path d="m19 6-7 6 7 6zM11 6l-7 6 7 6z"/>', reverse: '<path d="M4 9h12a4 4 0 0 1 0 8H9M4 9l4-4M4 9l4 4"/>',
  star: '<path d="m12 4 2.4 5.2 5.6.7-4.1 3.9 1 5.6-4.9-2.8-4.9 2.8 1-5.6L4 9.9l5.6-.7z"/>', bookmark: '<path d="M7 4h10v16l-5-3.5L7 20z"/>', focus: '<circle cx="12" cy="12" r="3"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/>',
  hand: '<path d="M8 12V6a1.5 1.5 0 0 1 3 0v5-6.5a1.5 1.5 0 0 1 3 0V11 6a1.5 1.5 0 0 1 3 0v8c0 4-2.5 6.5-6 6.5-3 0-4.5-1.5-6-4.5l-1.5-3a1.4 1.4 0 0 1 2.4-1.4z"/>',
};
export const icon = (n: string) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = ICONS[n]; return s; };
