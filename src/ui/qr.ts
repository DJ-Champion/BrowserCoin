import QRCode from 'qrcode';

/** Where the QR-share link points. Same origin as wherever the page is served. */
export function shareUrl(address: string): string {
  return `${window.location.origin}/?to=${address}`;
}

const QR_OPTS = {
  type: 'svg' as const,
  margin: 1,
  errorCorrectionLevel: 'M' as const,
  color: { dark: '#0d0f17', light: '#ffffff' },
};

/**
 * Render a QR for the given address into `el`. Caches the last-rendered
 * address on the element itself so we don't redraw on every paint() call.
 * Also wires a click handler on first call that opens a large fullscreen
 * QR so the code is easy to scan from across the room.
 */
export function renderAddressQr(el: HTMLElement, address: string): void {
  if (el.dataset['qrFor'] !== address) {
    el.dataset['qrFor'] = address;
    QRCode.toString(shareUrl(address), QR_OPTS).then((svg) => {
      el.innerHTML = svg;
    }).catch(() => {
      el.innerHTML = '';
    });
  }
  if (!el.dataset['qrClickWired']) {
    el.dataset['qrClickWired'] = '1';
    el.style.cursor = 'zoom-in';
    el.title = 'Tap to enlarge';
    el.addEventListener('click', () => {
      const addr = el.dataset['qrFor'] ?? address;
      openQrModal(addr);
    });
  }
}

let modalEl: HTMLElement | null = null;
let escListenerAttached = false;

function ensureModal(): HTMLElement {
  if (modalEl) return modalEl;
  modalEl = document.createElement('div');
  modalEl.className = 'qr-modal';
  modalEl.innerHTML = `
    <div class="qr-modal-card" data-w="card">
      <button class="qr-modal-close" data-w="close" aria-label="Close">×</button>
      <div class="qr-modal-svg" data-w="svg"></div>
      <div class="qr-modal-addr mono" data-w="addr"></div>
      <div class="qr-modal-caption">Scan to send coins to this wallet.</div>
    </div>
  `;
  document.body.appendChild(modalEl);
  modalEl.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    // Close on backdrop click or the close button. Inside the card stays open.
    if (t === modalEl || t.dataset['w'] === 'close') closeQrModal();
  });
  if (!escListenerAttached) {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modalEl?.classList.contains('open')) closeQrModal();
    });
    escListenerAttached = true;
  }
  return modalEl;
}

function openQrModal(address: string): void {
  const m = ensureModal();
  const svgEl = m.querySelector<HTMLElement>('[data-w="svg"]')!;
  const addrEl = m.querySelector<HTMLElement>('[data-w="addr"]')!;
  addrEl.textContent = address;
  // Render fresh — different size, separate cache from the inline preview.
  QRCode.toString(shareUrl(address), QR_OPTS).then((svg) => {
    svgEl.innerHTML = svg;
  }).catch(() => {
    svgEl.innerHTML = '';
  });
  m.classList.add('open');
}

function closeQrModal(): void {
  modalEl?.classList.remove('open');
}
