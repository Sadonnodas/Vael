/**
 * ui/Toast.js
 * Lightweight toast notification system.
 * Shows brief messages in the bottom-left corner of the canvas.
 *
 * Usage:
 *   Toast.info('Scene loaded');
 *   Toast.success('Recording saved');
 *   Toast.warn('No audio source');
 *   Toast.error('Could not load preset');
 */

const Toast = (() => {

  let _container = null;

  function _getContainer() {
    if (_container) return _container;
    _container = document.createElement('div');
    _container.id = 'vael-toasts';
    _container.style.cssText = `
      position: fixed;
      bottom: 40px;
      left: 20px;
      z-index: 9999;
      display: flex;
      flex-direction: column-reverse;
      gap: 6px;
      pointer-events: none;
      max-width: 320px;
    `;
    document.body.appendChild(_container);
    return _container;
  }

  function _show(message, type = 'info', duration = 3000) {
    if (document.body.classList.contains('vael-presentation')) return null;
    const container = _getContainer();

    const colors = {
      info:    { bg: 'rgba(0,212,170,0.15)',  border: 'rgba(0,212,170,0.4)',  text: '#00d4aa' },
      success: { bg: 'rgba(0,212,170,0.2)',   border: 'rgba(0,212,170,0.6)',  text: '#00d4aa' },
      warn:    { bg: 'rgba(255,180,0,0.15)',  border: 'rgba(255,180,0,0.4)',  text: '#ffb400' },
      error:   { bg: 'rgba(255,80,80,0.15)',  border: 'rgba(255,80,80,0.4)',  text: '#ff6060' },
    };

    const icons = { info: 'ℹ', success: '✓', warn: '⚠', error: '✕' };
    const c = colors[type] || colors.info;

    const toast = document.createElement('div');
    toast.style.cssText = `
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 9px 14px;
      background: ${c.bg};
      border: 1px solid ${c.border};
      border-radius: 6px;
      backdrop-filter: blur(12px);
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      color: ${c.text};
      line-height: 1.5;
      opacity: 0;
      transform: translateY(8px);
      transition: opacity 0.2s, transform 0.2s;
      pointer-events: auto;
      max-width: 320px;
      word-break: break-word;
    `;

    toast.innerHTML = `
      <span style="flex-shrink:0;font-size:11px">${icons[type] || 'ℹ'}</span>
      <span>${message}</span>
    `;

    container.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        toast.style.opacity   = '1';
        toast.style.transform = 'translateY(0)';
      });
    });

    // Auto-remove
    const remove = () => {
      toast.style.opacity   = '0';
      toast.style.transform = 'translateY(8px)';
      setTimeout(() => toast.remove(), 220);
    };

    const timer = setTimeout(remove, duration);

    // Click to dismiss early
    toast.addEventListener('click', () => {
      clearTimeout(timer);
      remove();
    });

    return toast;
  }

  return {
    info:    (msg, dur) => _show(msg, 'info',    dur),
    success: (msg, dur) => _show(msg, 'success', dur),
    warn:    (msg, dur) => _show(msg, 'warn',    dur),
    error:   (msg, dur) => _show(msg, 'error',   dur || 5000),
  };

})();
