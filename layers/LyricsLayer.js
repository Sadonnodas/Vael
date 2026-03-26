/**
 * layers/LyricsLayer.js
 * Text and lyrics overlay layer.
 * Type lines of text, set display duration, trigger manually or on beat.
 * Transitions: fade, slide-up, typewriter.
 *
 * Usage:
 *   const layer = new LyricsLayer('lyrics-1');
 *   layer.init({ lines: ['Hello world', 'Second line'], transition: 'fade' });
 *   layer.next();   // advance to next line
 *   layer.show('Custom text');  // show arbitrary text
 */

class LyricsLayer extends BaseLayer {

  static manifest = {
    name: 'Lyrics / Text',
    version: '1.0',
    params: [
      { id: 'fontSize',    label: 'Font size',    type: 'int',   default: 48,   min: 12,  max: 200 },
      { id: 'fontFamily',  label: 'Font',         type: 'enum',  default: 'system',
        options: ['system','serif','mono','Georgia','Palatino','Garamond','Didot','Futura','Gill Sans','Trebuchet','Impact','Courier'] },
      { id: 'posY',        label: 'Vertical pos', type: 'float', default: 0.75, min: 0,   max: 1   },
      { id: 'color',       label: 'Color',        type: 'color', default: '#ffffff' },
      { id: 'transition',  label: 'Transition',   type: 'enum',  default: 'fade',
        options: ['fade', 'slide', 'typewriter', 'none'] },
      { id: 'duration',    label: 'Duration (s)', type: 'float', default: 4.0,  min: 0.5, max: 30  },
      { id: 'autoAdvance', label: 'Auto advance', type: 'bool',  default: false },
    ],
  };

  constructor(id) {
    super(id, 'Lyrics');
    this.params = {
      fontSize:    48,
      fontFamily:  'system',
      posY:        0.75,
      color:       '#ffffff',
      transition:  'fade',
      duration:    4.0,
      autoAdvance: false,
    };

    this.lines        = [];     // array of strings
    this._lineIndex   = -1;     // current line index
    this._currentText = '';
    this._displayText = '';     // animated version (typewriter)
    this._alpha       = 0;
    this._slideY      = 0;
    this._time        = 0;      // time since this line started showing
    this._showing     = false;
    this._hiding      = false;
    this._typeIdx     = 0;      // typewriter character index
    this._typeTimer   = 0;
  }

  init(params = {}) {
    if (params.lines) this.lines = [...params.lines];
    delete params.lines;
    Object.assign(this.params, params);
  }

  setParam(id, value) {
    this.params[id] = value;
  }

  // ── Public controls ──────────────────────────────────────────

  /** Show the next line in the lines array */
  next() {
    if (this.lines.length === 0) return;
    this._lineIndex = (this._lineIndex + 1) % this.lines.length;
    this.show(this.lines[this._lineIndex]);
  }

  /** Show the previous line */
  prev() {
    if (this.lines.length === 0) return;
    this._lineIndex = (this._lineIndex - 1 + this.lines.length) % this.lines.length;
    this.show(this.lines[this._lineIndex]);
  }

  /** Show arbitrary text */
  show(text) {
    this._currentText = text || '';
    this._displayText = this.params.transition === 'typewriter' ? '' : this._currentText;
    this._time        = 0;
    this._typeIdx     = 0;
    this._typeTimer   = 0;
    this._showing     = true;
    this._hiding      = false;
    this._alpha       = this.params.transition === 'fade' ? 0 : 1;
    this._slideY      = this.params.transition === 'slide' ? 30 : 0;
  }

  /** Clear / hide current text */
  hide() {
    this._hiding  = true;
    this._showing = false;
  }

  /** Clear immediately */
  clear() {
    this._currentText = '';
    this._displayText = '';
    this._alpha       = 0;
    this._showing     = false;
    this._hiding      = false;
  }

  get currentLine() { return this._lineIndex; }
  get totalLines()  { return this.lines.length; }

  // ── Update ───────────────────────────────────────────────────

  update(audioData, videoData, dt) {
    this._time += dt;
    const transition = this.params.transition;
    const fadeSpeed  = 4;  // alpha units per second

    if (this._showing) {
      // Fade in
      if (transition === 'fade') {
        this._alpha = Math.min(1, this._alpha + dt * fadeSpeed);
      } else {
        this._alpha = 1;
      }

      // Slide in
      if (transition === 'slide') {
        this._slideY = Math.max(0, this._slideY - dt * 120);
      }

      // Typewriter
      if (transition === 'typewriter') {
        this._typeTimer += dt;
        const charsPerSec = 30;
        const targetIdx = Math.floor(this._typeTimer * charsPerSec);
        if (targetIdx > this._typeIdx) {
          this._typeIdx    = Math.min(targetIdx, this._currentText.length);
          this._displayText = this._currentText.slice(0, this._typeIdx);
        }
      }

      // Auto-advance
      if (this.params.autoAdvance && this._time > this.params.duration) {
        this.hide();
      }

    } else if (this._hiding) {
      // Fade out
      if (transition === 'fade' || transition === 'slide') {
        this._alpha = Math.max(0, this._alpha - dt * fadeSpeed);
      } else {
        this._alpha = 0;
      }
      if (this._alpha <= 0) {
        this._hiding      = false;
        this._currentText = '';
        this._displayText = '';
      }
    }
  }

  // ── Render ───────────────────────────────────────────────────

  render(ctx, width, height) {
    const text = this._displayText || this._currentText;
    if (!text || this._alpha <= 0.01) return;

    const fontSize = this.params.fontSize;
    const posY     = (this.params.posY - 0.5) * height + this._slideY;
    const color    = this.params.color || '#ffffff';

    ctx.save();
    ctx.globalAlpha  = VaelMath.clamp(this._alpha * this.opacity, 0, 1);
    const _fontFamilies = {
      system: 'system-ui, -apple-system, sans-serif',
      serif:  'Georgia, "Times New Roman", serif',
      mono:   '"Courier New", Courier, monospace',
      Georgia: 'Georgia, serif',
      Palatino: '"Palatino Linotype", Palatino, serif',
      Garamond: 'Garamond, "EB Garamond", serif',
      Trebuchet: '"Trebuchet MS", sans-serif',
      Impact: 'Impact, Haettenschweiler, sans-serif',
      Courier: '"Courier New", Courier, monospace',
    };
    const _ff = _fontFamilies[this.params.fontFamily || 'system'] || _fontFamilies.system;
    ctx.font         = `bold ${fontSize}px ${_ff}`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';

    // Shadow for readability over any background
    ctx.shadowColor  = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur   = fontSize * 0.4;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = fontSize * 0.05;

    ctx.fillStyle = color;
    ctx.fillText(text, 0, posY);

    ctx.restore();
  }

  // ── Serialisation ─────────────────────────────────────────────

  toJSON() {
    return {
      ...super.toJSON(),
      lines:  [...this.lines],
      params: { ...this.params },
    };
  }
}
