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
        options: [
          // Generic / system
          'system','serif','mono',
          // Serif
          'Georgia','Palatino','Garamond','Times New Roman','Didot','Bodoni MT',
          'Book Antiqua','Cambria','Constantia','Hoefler Text',
          // Sans-serif
          'Arial','Helvetica','Verdana','Trebuchet MS','Gill Sans','Optima',
          'Calibri','Candara','Franklin Gothic Medium','Century Gothic',
          // Display / Impact
          'Impact','Arial Black','Arial Narrow',
          // Mono
          'Courier New','Courier','Lucida Console','Monaco',
          // Script / decorative (available on most systems)
          'Comic Sans MS','Papyrus',
        ]
      },
      { id: 'posY',        label: 'Vertical pos', type: 'float', default: 0.75, min: 0,   max: 1   },
      { id: 'color',       label: 'Color',        type: 'color', default: '#ffffff' },
      { id: 'transition',  label: 'Transition',   type: 'enum',  default: 'fade',
        options: ['fade', 'slide', 'typewriter', 'none'] },
      { id: 'duration',    label: 'Duration (s)', type: 'float', default: 4.0,  min: 0.5, max: 30  },
      { id: 'autoAdvance', label: 'Auto advance', type: 'bool',  default: false },
      { id: 'align',       label: 'Align',        type: 'enum',  default: 'center',
        options: ['left','center','right'] },
      { id: 'posX',        label: 'Horizontal pos',type:'float', default: 0.5,  min: 0,   max: 1   },
      { id: 'outline',     label: 'Outline',       type: 'bool',  default: false, triggersRefresh: true },
      { id: 'outlineColor',label: 'Outline color', type: 'color', default: '#000000',
        showWhen: { outline: true } },
      { id: 'outlineWidth',label: 'Outline width', type: 'float', default: 2.0,  min: 0.5, max: 10,
        showWhen: { outline: true } },
      { id: 'uppercase',   label: 'Uppercase',     type: 'bool',  default: false },
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
      align:       'center',
      posX:        0.5,
      outline:     false,
      outlineColor:'#000000',
      outlineWidth: 2.0,
      uppercase:   false,
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
    const posX     = (this.params.posX ?? 0.5) - 0.5;   // -0.5..+0.5 → offset from centre
    const color    = this.params.color || '#ffffff';
    const align    = this.params.align || 'center';
    const displayText = this.params.uppercase ? text.toUpperCase() : text;

    // X position: posX=0 → left edge, 0.5 → centre, 1 → right edge
    const xOffset  = posX * width;
    const xBase    = align === 'left' ? -width / 2 + xOffset
                   : align === 'right' ? width / 2 - (width * (1 - this.params.posX ?? 0.5))
                   : xOffset;

    ctx.save();
    ctx.globalAlpha  = VaelMath.clamp(this._alpha * this.opacity, 0, 1);

    // Well-known font stacks for generic names; everything else is passed
    // through verbatim so locally-discovered fonts work automatically.
    const _fontFamilies = {
      system:            'system-ui, -apple-system, sans-serif',
      serif:             'Georgia, "Times New Roman", serif',
      mono:              '"Courier New", Courier, monospace',
      Georgia:           'Georgia, serif',
      Palatino:          '"Palatino Linotype", Palatino, serif',
      Garamond:          'Garamond, "EB Garamond", serif',
      'Times New Roman': '"Times New Roman", Times, serif',
      Didot:             'Didot, "GFS Didot", serif',
      'Bodoni MT':       '"Bodoni MT", "Bodoni 72", serif',
      'Book Antiqua':    '"Book Antiqua", Palatino, serif',
      Cambria:           'Cambria, Georgia, serif',
      Constantia:        'Constantia, "Palatino Linotype", serif',
      'Hoefler Text':    '"Hoefler Text", Garamond, serif',
      Arial:             'Arial, Helvetica, sans-serif',
      Helvetica:         'Helvetica, Arial, sans-serif',
      Verdana:           'Verdana, Geneva, sans-serif',
      'Trebuchet MS':    '"Trebuchet MS", sans-serif',
      'Gill Sans':       '"Gill Sans", "Gill Sans MT", sans-serif',
      Optima:            'Optima, Segoe, sans-serif',
      Calibri:           'Calibri, Candara, sans-serif',
      Candara:           'Candara, Calibri, sans-serif',
      'Franklin Gothic Medium': '"Franklin Gothic Medium", "Arial Narrow", sans-serif',
      'Century Gothic':  '"Century Gothic", Futura, sans-serif',
      Impact:            'Impact, Haettenschweiler, sans-serif',
      'Arial Black':     '"Arial Black", Gadget, sans-serif',
      'Arial Narrow':    '"Arial Narrow", Arial, sans-serif',
      'Courier New':     '"Courier New", Courier, monospace',
      Courier:           '"Courier New", Courier, monospace',
      'Lucida Console':  '"Lucida Console", Monaco, monospace',
      Monaco:            'Monaco, "Lucida Console", monospace',
      'Comic Sans MS':   '"Comic Sans MS", cursive',
      Papyrus:           'Papyrus, fantasy',
    };

    // Passthrough: if the font name isn't in our table it's likely a locally
    // discovered font name — quote it and let the browser resolve it directly.
    const familyName = this.params.fontFamily || 'system';
    const _ff = _fontFamilies[familyName] || `"${familyName}", sans-serif`;
    ctx.font         = `bold ${fontSize}px ${_ff}`;
    ctx.textAlign    = align;
    ctx.textBaseline = 'middle';

    // Shadow for readability
    ctx.shadowColor   = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur    = fontSize * 0.35;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = fontSize * 0.04;

    // Optional outline/stroke
    if (this.params.outline) {
      ctx.shadowBlur    = 0;
      ctx.strokeStyle   = this.params.outlineColor || '#000000';
      ctx.lineWidth     = this.params.outlineWidth || 2;
      ctx.lineJoin      = 'round';
      ctx.strokeText(displayText, xBase, posY);
    }

    ctx.fillStyle = color;
    ctx.fillText(displayText, xBase, posY);

    ctx.restore();
  }

  // ── Font discovery ────────────────────────────────────────────

  /**
   * Try to enumerate locally installed fonts via the Font Access API
   * (Chrome 103+). Falls back silently if the API isn't available or the
   * user denies permission.
   *
   * Discovered font names are appended to the manifest options array so
   * the LyricsLayer dropdown in ParamPanel shows them automatically.
   * Call once at app startup: await LyricsLayer.discoverFonts();
   */
  static async discoverFonts() {
    if (typeof window.queryLocalFonts !== 'function') return;
    try {
      const fonts  = await window.queryLocalFonts();
      const names  = [...new Set(fonts.map(f => f.family))].sort();
      const param  = LyricsLayer.manifest.params.find(p => p.id === 'fontFamily');
      if (!param) return;
      // Add only fonts not already in the list
      const existing = new Set(param.options);
      names.forEach(n => { if (!existing.has(n)) param.options.push(n); });
      console.log(`LyricsLayer: discovered ${names.length} local fonts`);
    } catch (e) {
      // Permission denied or API unavailable — fail silently
      console.info('LyricsLayer: local font discovery unavailable', e.message);
    }
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
