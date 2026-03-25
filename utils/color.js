/**
 * utils/color.js
 * Colour conversion and manipulation utilities.
 * No dependencies. All functions are pure.
 */

const VaelColor = (() => {

  // ── Conversion ───────────────────────────────────────────────

  /** HSL (0–360, 0–1, 0–1) → RGB (0–1 each) */
  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if      (h < 60)  { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else              { r = c; b = x; }
    return [r + m, g + m, b + m];
  }

  /** RGB (0–1 each) → HSL (0–360, 0–1, 0–1) */
  function rgbToHsl(r, g, b) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l   = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      default: h = ((r - g) / d + 4) / 6;
    }
    return [h * 360, s, l];
  }

  /** Hex string (#rrggbb or #rgb) → RGB (0–1 each) */
  function hexToRgb(hex) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const n = parseInt(hex, 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  }

  /** RGB (0–1 each) → hex string #rrggbb */
  function rgbToHex(r, g, b) {
    const byte = x => Math.round(VaelMath.clamp(x, 0, 1) * 255).toString(16).padStart(2, '0');
    return `#${byte(r)}${byte(g)}${byte(b)}`;
  }

  // ── CSS string helpers ───────────────────────────────────────

  /** Return a CSS hsl() string */
  function hsl(h, s, l) {
    return `hsl(${((h % 360) + 360) % 360},${Math.round(s * 100)}%,${Math.round(l * 100)}%)`;
  }

  /** Return a CSS hsla() string */
  function hsla(h, s, l, a) {
    return `hsla(${((h % 360) + 360) % 360},${Math.round(s * 100)}%,${Math.round(l * 100)}%,${a})`;
  }

  // ── Interpolation ────────────────────────────────────────────

  /**
   * Interpolate between two hex colours.
   * t = 0 → colourA, t = 1 → colourB
   */
  function lerpHex(hexA, hexB, t) {
    const [r1, g1, b1] = hexToRgb(hexA);
    const [r2, g2, b2] = hexToRgb(hexB);
    return rgbToHex(
      VaelMath.lerp(r1, r2, t),
      VaelMath.lerp(g1, g2, t),
      VaelMath.lerp(b1, b2, t)
    );
  }

  /**
   * Interpolate hue around the colour wheel (always takes shortest path).
   */
  function lerpHue(hA, hB, t) {
    let delta = ((hB - hA + 540) % 360) - 180;
    return ((hA + delta * t) + 360) % 360;
  }

  // ── Palette ──────────────────────────────────────────────────

  /**
   * Generate a palette of n colours evenly spaced around the hue wheel.
   * Returns CSS hsl strings.
   */
  function palette(n, saturation = 0.8, lightness = 0.55, hueOffset = 0) {
    return Array.from({ length: n }, (_, i) =>
      hsl(hueOffset + (i / n) * 360, saturation, lightness)
    );
  }

  /**
   * The digit colour palette used by MathVisualizer.
   * Digits 0–9 each get a distinct hue.
   */
  const DIGIT_COLORS = palette(10, 0.85, 0.58);

  // ── Three.js helpers ─────────────────────────────────────────

  /**
   * Convert a hex colour string to a Three.js Color object.
   * Only available after Three.js is loaded.
   */
  function toThreeColor(hex) {
    if (typeof THREE === 'undefined') return null;
    return new THREE.Color(hex);
  }

  /**
   * Convert HSL values to a Three.js Color object.
   */
  function hslToThreeColor(h, s, l) {
    if (typeof THREE === 'undefined') return null;
    const color = new THREE.Color();
    color.setHSL(((h % 360) + 360) % 360 / 360, s, l);
    return color;
  }

  // ── Rainbow mapping ──────────────────────────────────────────

  /**
   * Map a normalised value (0–1) to a rainbow hue with optional shift.
   * Returns a CSS hsla string.
   */
  function rainbow(t, hueShift = 0, saturation = 0.85, lightness = 0.58, alpha = 1) {
    const h = (t * 360 + hueShift) % 360;
    return hsla(h, saturation, lightness, alpha);
  }

  /**
   * Map a digit (0–9) to its fixed colour.
   * Returns a CSS hsla string.
   */
  function digitColor(digit, hueShift = 0, alpha = 1) {
    const h = (digit / 9) * 300 + hueShift;
    return hsla(h, 0.85, 0.58, alpha);
  }

  /**
   * Greyscale — maps t (0–1) to a grey hsl string.
   */
  function mono(t, minL = 0.25, maxL = 0.8) {
    const l = VaelMath.lerp(minL, maxL, t);
    return hsl(0, 0, l);
  }

  // ── Public API ───────────────────────────────────────────────
  return {
    hslToRgb, rgbToHsl,
    hexToRgb, rgbToHex,
    hsl, hsla,
    lerpHex, lerpHue,
    palette,
    DIGIT_COLORS,
    toThreeColor, hslToThreeColor,
    rainbow, digitColor, mono,
  };

})();
