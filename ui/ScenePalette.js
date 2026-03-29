/**
 * ui/ScenePalette.js
 * One-click color palette system.
 * Applies a unified color theme across all layers in the scene.
 *
 * Call ScenePalette.apply(paletteName, layerStack) to theme the scene.
 * The palette panel lives inside the PARAMS tab when no layer is selected.
 */

const ScenePalette = (() => {

  const PALETTES = {
    'campfire': {
      label: 'Campfire',
      desc: 'Warm embers',
      emoji: '🔥',
      hueA: 15, hueB: 45, hueC: 30,
      saturation: 0.85, lightness: 0.10,
      particleColor: 'ember',
      shaderHue: 30,
    },
    'aurora': {
      label: 'Aurora',
      desc: 'Northern lights',
      emoji: '🌌',
      hueA: 140, hueB: 200, hueC: 170,
      saturation: 0.8, lightness: 0.12,
      particleColor: 'cool',
      shaderHue: 160,
    },
    'forest': {
      label: 'Forest',
      desc: 'Deep greens',
      emoji: '🌿',
      hueA: 95, hueB: 140, hueC: 115,
      saturation: 0.6, lightness: 0.10,
      particleColor: 'cool',
      shaderHue: 110,
    },
    'ocean': {
      label: 'Ocean',
      desc: 'Deep blues',
      emoji: '🌊',
      hueA: 190, hueB: 230, hueC: 210,
      saturation: 0.75, lightness: 0.10,
      particleColor: 'cool',
      shaderHue: 200,
    },
    'dusk': {
      label: 'Dusk',
      desc: 'Purple twilight',
      emoji: '🌆',
      hueA: 270, hueB: 310, hueC: 290,
      saturation: 0.65, lightness: 0.12,
      particleColor: 'cool',
      shaderHue: 280,
    },
    'golden': {
      label: 'Golden',
      desc: 'Warm honey',
      emoji: '✨',
      hueA: 35, hueB: 60, hueC: 45,
      saturation: 0.75, lightness: 0.14,
      particleColor: 'warm',
      shaderHue: 45,
    },
    'midnight': {
      label: 'Midnight',
      desc: 'Dark + cool',
      emoji: '🌙',
      hueA: 220, hueB: 260, hueC: 240,
      saturation: 0.4, lightness: 0.07,
      particleColor: 'white',
      shaderHue: 220,
    },
    'spring': {
      label: 'Spring',
      desc: 'Fresh & light',
      emoji: '🌸',
      hueA: 80, hueB: 320, hueC: 150,
      saturation: 0.65, lightness: 0.16,
      particleColor: 'rainbow',
      shaderHue: 120,
    },
  };

  function apply(paletteName, layerStack) {
    const p = PALETTES[paletteName];
    if (!p) return;

    layerStack.layers.forEach(layer => {
      _applyToLayer(layer, p);
      // Also apply to group children
      if (layer instanceof GroupLayer) {
        layer.children.forEach(child => _applyToLayer(child, p));
      }
    });

    Toast.success(`Palette applied: ${p.label}`);
  }

  function _applyToLayer(layer, p) {
    if (!layer.params) return;

    if (layer instanceof GradientLayer || layer instanceof NoiseFieldLayer) {
      if ('hueA'       in layer.params) layer.params.hueA       = p.hueA;
      if ('hueB'       in layer.params) layer.params.hueB       = p.hueB;
      if ('hueC'       in layer.params) layer.params.hueC       = p.hueC;
      if ('saturation' in layer.params) layer.params.saturation = p.saturation;
      if ('lightness'  in layer.params) layer.params.lightness  = p.lightness;
    }

    if (layer instanceof ParticleLayer) {
      if ('colorMode' in layer.params) layer.params.colorMode = p.particleColor;
      if ('hueShift'  in layer.params) layer.params.hueShift  = p.hueA;
    }

    if (layer instanceof MathVisualizer) {
      if ('hueShift' in layer.params) layer.params.hueShift = p.hueA;
    }

    if (layer instanceof WaveformLayer) {
      if ('color' in layer.params) {
        const [r, g, b] = VaelColor.hslToRgb(p.hueA, p.saturation, 0.6);
        layer.params.color = VaelColor.rgbToHex(r, g, b);
      }
    }

    if (layer instanceof LyricsLayer) {
      if ('color' in layer.params) {
        const [r, g, b] = VaelColor.hslToRgb(p.hueB, 0.3, 0.85);
        layer.params.color = VaelColor.rgbToHex(r, g, b);
      }
    }

    // ShaderLayer — set iColorA, iColorB from palette hues, plus hueShift
    if (layer instanceof ShaderLayer) {
      if ('hueShift' in layer.params) layer.params.hueShift = p.shaderHue ?? p.hueA;
      if ('colorA'   in layer.params) {
        const [r, g, b] = VaelColor.hslToRgb(p.hueA, p.saturation, 0.55);
        layer.params.colorA = VaelColor.rgbToHex(r, g, b);
      }
      if ('colorB'   in layer.params) {
        const [r, g, b] = VaelColor.hslToRgb(p.hueB, p.saturation * 0.9, 0.45);
        layer.params.colorB = VaelColor.rgbToHex(r, g, b);
      }
      // Rebuild the GPU material so colour uniforms update immediately
      if (typeof layer._gpuDirty !== 'undefined') layer._gpuDirty = true;
    }

    // PatternLayer — set color and color2 from palette
    if (layer instanceof PatternLayer) {
      if ('color' in layer.params) {
        const [r, g, b] = VaelColor.hslToRgb(p.hueA, p.saturation, 0.6);
        layer.params.color = VaelColor.rgbToHex(r, g, b);
      }
      if ('color2' in layer.params) {
        const [r, g, b] = VaelColor.hslToRgb(p.hueB, p.saturation * 0.8, 0.5);
        layer.params.color2 = VaelColor.rgbToHex(r, g, b);
      }
    }

    // ImageLayer — apply tint from palette hue
    if (layer instanceof ImageLayer) {
      if ('tintHue'    in layer.params) layer.params.tintHue    = p.hueA;
      if ('tintAmount' in layer.params && layer.params.tintAmount === 0) {
        layer.params.tintAmount = 0.15; // nudge tint on if it was off
      }
    }
  }

  // ── UI ────────────────────────────────────────────────────────

  function renderPanel(layerStack, container) {
    container.innerHTML = '';

    const header = document.createElement('div');
    header.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:12px';
    header.textContent   = 'Scene Palette';
    container.appendChild(header);

    const desc = document.createElement('p');
    desc.style.cssText = 'font-size:10px;color:var(--text-dim);line-height:1.6;margin-bottom:12px';
    desc.textContent   = 'Apply a color theme to all layers at once.';
    container.appendChild(desc);

    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:6px';

    Object.entries(PALETTES).forEach(([id, palette]) => {
      const btn = document.createElement('button');
      btn.style.cssText = `
        background: var(--bg-card);
        border: 1px solid var(--border-dim);
        border-radius: 6px;
        padding: 8px 10px;
        cursor: pointer;
        text-align: left;
        transition: border-color 0.15s;
      `;
      btn.innerHTML = `
        <div style="font-size:16px;margin-bottom:4px">${palette.emoji}</div>
        <div style="font-family:var(--font-mono);font-size:9px;color:var(--text);margin-bottom:2px">
          ${palette.label}
        </div>
        <div style="font-size:8px;color:var(--text-dim)">${palette.desc}</div>
      `;

      // Color preview strip
      const strip = document.createElement('div');
      strip.style.cssText = `
        display:flex;height:4px;border-radius:2px;overflow:hidden;margin-top:6px;gap:1px
      `;
      [palette.hueA, palette.hueC, palette.hueB].forEach(hue => {
        const s = document.createElement('div');
        s.style.cssText = `flex:1;background:hsl(${hue},${Math.round(palette.saturation*100)}%,${Math.round((palette.lightness+0.25)*100)}%)`;
        strip.appendChild(s);
      });
      btn.appendChild(strip);

      btn.addEventListener('mouseenter', () => btn.style.borderColor = 'var(--accent)');
      btn.addEventListener('mouseleave', () => btn.style.borderColor = 'var(--border-dim)');
      btn.addEventListener('click', () => apply(id, layerStack));

      grid.appendChild(btn);
    });

    container.appendChild(grid);
  }

  return { apply, renderPanel, PALETTES };

})();
