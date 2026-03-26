/**
 * ui/PostFXPanel.js
 * Sidebar panel for adding, removing, and adjusting post-processing effects.
 * Renders inside the FX tab.
 */

const PostFXPanel = (() => {

  let _renderer = null;
  let _container = null;

  const EFFECTS = [
    {
      id: 'bloom',
      label: 'Bloom',
      desc: 'Glow around bright areas',
      defaults: { intensity: 0.6, threshold: 0.35 },
      params: [
        { id: 'intensity', label: 'Intensity', min: 0, max: 2,   step: 0.05, default: 0.6  },
        { id: 'threshold', label: 'Threshold', min: 0, max: 1,   step: 0.05, default: 0.35 },
        { id: 'radius',    label: 'Radius',    min: 0, max: 4,   step: 0.1,  default: 0.8  },
      ],
    },
    {
      id: 'chromatic',
      label: 'Chromatic aberration',
      desc: 'RGB channel split — filmic look',
      defaults: { amount: 0.003 },
      params: [
        { id: 'amount', label: 'Amount', min: 0, max: 0.02, step: 0.001, default: 0.003 },
      ],
    },
    {
      id: 'distort',
      label: 'Liquid distortion',
      desc: 'Noise-based warp, audio-reactive',
      defaults: { strength: 0.015, speed: 0.4 },
      params: [
        { id: 'strength', label: 'Strength', min: 0, max: 0.08, step: 0.002, default: 0.015 },
        { id: 'speed',    label: 'Speed',    min: 0, max: 2,    step: 0.05,  default: 0.4   },
      ],
    },
    {
      id: 'vignette',
      label: 'Vignette',
      desc: 'Darken the edges',
      defaults: { darkness: 0.5, offset: 0.5 },
      params: [
        { id: 'darkness', label: 'Darkness', min: 0, max: 1, step: 0.05, default: 0.5 },
        { id: 'offset',   label: 'Size',     min: 0, max: 1, step: 0.05, default: 0.5 },
      ],
    },
    {
      id: 'grain',
      label: 'Film grain',
      desc: 'Analog noise texture',
      defaults: { amount: 0.04 },
      params: [
        { id: 'amount', label: 'Amount', min: 0, max: 0.2, step: 0.005, default: 0.04 },
      ],
    },
  ];

  function init(renderer, container) {
    _renderer  = renderer;
    _container = container;
    _render();
  }

  function _render() {
    if (!_container) return;
    _container.innerHTML = '';

    const intro = document.createElement('p');
    intro.style.cssText = 'font-size:10px;color:var(--text-muted);line-height:1.6;margin-bottom:14px';
    intro.textContent   = 'Post-processing runs after all layers composite. Effects stack in order.';
    _container.appendChild(intro);

    EFFECTS.forEach(effect => {
      const isActive = PostFX.has(effect.id);
      const card     = document.createElement('div');
      card.style.cssText = `
        background: var(--bg-card);
        border: 1px solid ${isActive ? 'var(--accent)' : 'var(--border-dim)'};
        border-radius: 6px;
        padding: 10px 12px;
        margin-bottom: 8px;
        transition: border-color 0.15s;
      `;

      card.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:${isActive ? '10px' : '0'}">
          <span style="flex:1;font-family:var(--font-mono);font-size:10px;
                       color:${isActive ? 'var(--text)' : 'var(--text-muted)'}">
            ${effect.label}
          </span>
          <span style="font-size:9px;color:var(--text-dim);flex:1">${effect.desc}</span>
          <button class="fx-toggle btn ${isActive ? 'danger' : 'accent'}"
            data-id="${effect.id}"
            style="font-size:9px;padding:4px 10px;flex-shrink:0">
            ${isActive ? 'Remove' : 'Add'}
          </button>
        </div>
        ${isActive ? _buildParams(effect) : ''}
      `;

      // Toggle button
      card.querySelector('.fx-toggle').addEventListener('click', () => {
        if (PostFX.has(effect.id)) {
          PostFX.remove(_renderer, effect.id);
        } else {
          PostFX.add(_renderer, effect.id, effect.defaults);
        }
        _render();
      });

      // Parameter sliders (only when active)
      if (isActive) {
        effect.params.forEach(param => {
          const slider = card.querySelector(`[data-param="${param.id}"]`);
          const valEl  = card.querySelector(`[data-val="${param.id}"]`);
          if (!slider) return;
          slider.addEventListener('input', () => {
            const v = parseFloat(slider.value);
            if (valEl) valEl.textContent = v.toFixed(3);
            PostFX.update(effect.id, { [param.id]: v });
          });
        });
      }

      _container.appendChild(card);
    });
  }

  function _buildParams(effect) {
    return effect.params.map(param => `
      <div style="margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px">
          <span style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted)">
            ${param.label}
          </span>
          <span data-val="${param.id}"
            style="font-family:var(--font-mono);font-size:9px;color:var(--accent)">
            ${param.default.toFixed(3)}
          </span>
        </div>
        <input type="range" data-param="${param.id}"
          min="${param.min}" max="${param.max}" step="${param.step}"
          value="${param.default}"
          style="width:100%;accent-color:var(--accent)" />
      </div>
    `).join('');
  }

  return { init };

})();
