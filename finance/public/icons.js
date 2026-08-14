/* Line icon set (24x24, currentColor strokes) — matches the app's chrome. */
'use strict';

const ICON_PATHS = {
  dashboard: '<path d="M3 10.2 12 3l9 7.2V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  accounts: '<path d="M12 3 2.5 7.5 12 12l9.5-4.5z"/><path d="M2.5 12 12 16.5 21.5 12"/><path d="M2.5 16.5 12 21l9.5-4.5"/>',
  transactions: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19"/>',
  cashflow: '<path d="M4 20V11"/><path d="M9.3 20V4"/><path d="M14.7 20v-6"/><path d="M20 20V8"/>',
  reports: '<path d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M14.5 2.5A9 9 0 0 1 21.5 9.5h-7z"/>',
  budget: '<path d="M9 4 3 6.5v14L9 18l6 2.5 6-2.5v-14L15 6.5z"/><path d="M9 4v14"/><path d="M15 6.5v14"/>',
  recurring: '<rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18"/><path d="M8 2.5v4"/><path d="M16 2.5v4"/>',
  goals: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
  investments: '<path d="M3 17 9.5 10.5l4 4L21 7"/><path d="M15.5 7H21v5.5"/>',
  advice: '<path d="M7 21V10.5l4.5-8a2.2 2.2 0 0 1 2.9 2.9L13 9h5.4a2.2 2.2 0 0 1 2.1 2.8l-1.9 7A2.2 2.2 0 0 1 16.4 21z"/><rect x="2.5" y="10.5" width="4.5" height="10.5" rx="1.2"/>',
  settings: '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 14.4a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.9-3.9"/>',
  bell: '<path d="M18 8.5a6 6 0 1 0-12 0c0 6-2.5 7.5-2.5 7.5h17S18 14.5 18 8.5"/><path d="M13.7 20a2 2 0 0 1-3.4 0"/>',
  panel: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M10 4.5v15"/>',
  help: '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8A8.5 8.5 0 0 1 12.5 20a8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7A8.4 8.4 0 0 1 4 11.5 8.5 8.5 0 0 1 8.7 3.9a8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18"/><path d="M8 2.5v4"/><path d="M16 2.5v4"/>',
  filter: '<path d="M4 6h16"/><path d="M7 12h10"/><path d="M10 18h4"/>',
  share: '<path d="M12 15V3"/><path d="m8 7 4-4 4 4"/><path d="M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  refresh: '<path d="M20.5 12a8.5 8.5 0 1 1-2.5-6"/><path d="M20.5 4v5h-5"/>',
  upload: '<path d="M12 16V4"/><path d="m8 8 4-4 4 4"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
  sankey: '<path d="M3 5v14"/><path d="M21 5v6"/><path d="M21 15v4"/><path d="M3 8c8 0 10 -1 18 -1"/><path d="M3 15c8 0 10 2 18 2"/>',
  donut: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.2"/>',
  bars: '<path d="M4 20V9"/><path d="M12 20V4"/><path d="M20 20v-7"/>',
  list: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3.5 6h.01"/><path d="M3.5 12h.01"/><path d="M3.5 18h.01"/>',
  wallet: '<path d="M20 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6"/><path d="M17.5 12.5h.01"/>',
  arrowUp: '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>',
  arrowDown: '<path d="M12 5v14"/><path d="m5 12 7 7 7-7"/>',
  warning: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  check: '<path d="m4 12.5 5 5L20 6.5"/>',
  trash: '<path d="M3.5 6h17"/><path d="M8 6V4.5a1.5 1.5 0 0 1 1.5-1.5h5A1.5 1.5 0 0 1 16 4.5V6"/><path d="M18.5 6v14a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 20V6"/>',
  bank: '<path d="M3 9.5 12 4l9 5.5"/><path d="M4.5 9.5V19"/><path d="M9.5 9.5V19"/><path d="M14.5 9.5V19"/><path d="M19.5 9.5V19"/><path d="M2.5 19h19"/>',
};

function icon(name, size = 20, extraClass = '') {
  const d = ICON_PATHS[name] || ICON_PATHS.dashboard;
  return `<svg class="ic ${extraClass}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none"
    stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}

function iconEl(name, size = 20, extraClass = '') {
  const span = document.createElement('span');
  span.className = 'ic-wrap';
  span.innerHTML = icon(name, size, extraClass);
  return span;
}
