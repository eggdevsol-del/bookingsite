type Child = Node | string | number | null | undefined | false;

/** Tiny element builder: h('button', { class: 'btn', onclick }, 'Go'). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, unknown> | null = null,
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
      else if (k === 'class') el.className = String(v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k in el && typeof v !== 'string') (el as any)[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

export const ui = () => document.getElementById('ui')!;

let toastTimer = 0;
export function toast(message: string, bad = false, ms = 3800) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = h('div', { class: `toast${bad ? ' is-bad' : ''}`, role: 'status' }, message);
  ui().append(t);
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    t.classList.add('is-gone');
    setTimeout(() => t.remove(), 300);
  }, ms);
}

export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function tween(duration: number, onUpdate: (k: number) => void, ease: (k: number) => number = easeInOut): Promise<void> {
  return new Promise((resolve) => {
    const start = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / (duration * 1000));
      onUpdate(ease(k));
      if (k < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

export const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
export const easeOut = (k: number) => 1 - Math.pow(1 - k, 3);

export function formatMoney(amount: number, currency = 'NZD') {
  try {
    return new Intl.NumberFormat('en-NZ', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `$${amount.toLocaleString()}`;
  }
}
