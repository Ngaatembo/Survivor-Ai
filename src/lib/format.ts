export const usd = (n: number): string =>
  (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export const usdWhole = (n: number): string =>
  (n < 0 ? '-$' : '$') + Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export const timeAgo = (ts: number): string => {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
};

export const clockTime = (ts: number): string =>
  new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export const dateTime = (ts: number): string =>
  new Date(ts).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

export const dayRange = (min: number, max: number): string => {
  if (min === max) return min === 1 ? '1 day' : `${min} days`;
  return `${min}–${max} days`;
};

export const capRange = (min: number, max: number): string => {
  if (min === 0 && max === 0) return '$0';
  if (min === 0) return `$0–$${max}`;
  return `$${min}–$${max}`;
};

export const pct = (n: number): string => `${n > 0 ? '+' : ''}${Math.round(n)}%`;

let counter = 0;
export const uid = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
