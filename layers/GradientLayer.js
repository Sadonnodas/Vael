/**
 * layers/GradientLayer.js
 * A full-screen colour gradient that shifts hue with audio.
 * This is the simplest possible layer — it validates the entire
 * render pipeline before we build anything more complex.
 */
class GradientLayer extends BaseLayer {

  static manifest = {
    name:    'Gradient',
    version: '1.0',
    params: [
      { id: 'hueA',   label: 'Hue A',       type: 'float', default: 220, min: 0,   max: 360 },
      { id: 'hueB',   label: 'Hue B',       type: 'float', default: 280, min: 0,   max: 360 },
      { id: 'speed',  label: 'Shift speed', type: 'float', default: 0.08, min: 0,  max: 1   },
      { id: 'angle',  label: 'Angle (deg)', type: 'float', default: 135, min: 0,   max: 360 },
      { id: 'audioTarget', label: 'Audio → hue shift', type: 'band', default: 'bass' },
    ],
  };

  constructor(id) {
    super(id, 'Gradient');
    this.params = {
      hueA:        220,
      hueB:        280,
      speed:       0.08,
      angle:       135,
      audioTarget: 'bass',
    };
    this._hueShift = 0;
    this._time     = 0;
  }

  init(params = {}) {
    Object.assign(this.params, params);
  }

  update(audioData, videoData, dt) {
    this._time += dt;

    // Slowly rotate the hue
    const audioVal = audioData?.isActive
      ? (audioData[this.params.audioTarget] ?? 0)
      : 0;

    // Base slow rotation + audio push
    const targetShift = this._time * this.params.speed * 40 + audioVal * 60;
    this._hueShift = VaelMath.lerp(this._hueShift, targetShift, 0.02);
  }

  render(ctx, width, height) {
    const { hueA, hueB, angle } = this.params;
    const shift = this._hueShift;

    const rad  = VaelMath.degToRad(angle);
    const hw   = width  / 2;
    const hh   = height / 2;
    const dx   = Math.cos(rad) * Math.max(width, height);
    const dy   = Math.sin(rad) * Math.max(width, height);

    const grad = ctx.createLinearGradient(
      hw - dx, hh - dy,
      hw + dx, hh + dy
    );

    const hA = (hueA + shift) % 360;
    const hB = (hueB + shift) % 360;

    grad.addColorStop(0,   VaelColor.hsl(hA, 0.6, 0.12));
    grad.addColorStop(0.5, VaelColor.hsl((hA + hB) / 2, 0.5, 0.08));
    grad.addColorStop(1,   VaelColor.hsl(hB, 0.6, 0.14));

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
  }

  toJSON() {
    return { ...super.toJSON(), params: { ...this.params } };
  }
}
