// Shared helpers loaded by every page that runs script.
//
// Markup declares behaviour with data-action / data-on-error attributes and
// pages register handlers here. Delegation rather than inline onclick is what
// lets the Content-Security-Policy stay at script-src 'self', with no
// 'unsafe-inline'.

// Escapes for both text and attribute contexts. A textContent/innerHTML round
// trip does not escape quotes, which is safe between tags but not inside
// alt="..." or data-code="...".
function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const actionHandlers = Object.create(null);
const imageFallbacks = Object.create(null);

// map: { "action-name": (element, event) => {} }
function registerActions(map) {
  Object.assign(actionHandlers, map);
}

// map: { "fallback-name": (imgElement) => {} }
function registerImageFallbacks(map) {
  Object.assign(imageFallbacks, map);
}

document.addEventListener('click', (event) => {
  const el = event.target.closest('[data-action]');
  if (!el) return;
  const handler = actionHandlers[el.dataset.action];
  if (!handler) return;
  if (el.tagName === 'A' || el.tagName === 'BUTTON') event.preventDefault();
  handler(el, event);
});

// Enter-to-submit for inputs marked data-enter-action.
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  const el = event.target.closest('[data-enter-action]');
  if (!el) return;
  const handler = actionHandlers[el.dataset.enterAction];
  if (!handler) return;
  event.preventDefault();
  handler(el, event);
});

// 'error' does not bubble, so this listens in the capture phase. The attribute
// is cleared before running so a failing fallback cannot loop.
document.addEventListener('error', (event) => {
  const img = event.target;
  if (!(img instanceof HTMLImageElement)) return;
  const key = img.dataset.onError;
  if (!key) return;
  delete img.dataset.onError;
  const handler = imageFallbacks[key];
  if (handler) handler(img);
  else img.style.display = 'none';
}, true);

// Built-in fallbacks used by more than one page.
registerImageFallbacks({
  // Hide the image and reveal the placeholder element right after it.
  placeholder(img) {
    img.style.display = 'none';
    const next = img.nextElementSibling;
    if (next) next.style.display = 'flex';
  },
  hide(img) {
    img.style.display = 'none';
  }
});
