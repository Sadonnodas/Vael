/**
 * layers/GroupLayer.js
 * A layer that acts as a container for other layers.
 * Children are composited to the group's own canvas,
 * then the group is composited to the scene as a single unit.
 *
 * This lets you:
 *  - Apply a single opacity/blend mode to multiple layers
 *  - Apply a single mask to multiple layers
 *  - Collapse complex scenes into named groups
 *
 * Children are NOT in the main LayerStack — they live in group.children.
 * The Renderer detects GroupLayer and renders children internally.
 *
 * Usage:
 *   const group = new GroupLayer('group-1');
 *   group.name = 'Intro';
 *   group.children = [noiseLayer, mathLayer];
 *   layers.add(group);
 */

class GroupLayer extends BaseLayer {

  static manifest = {
    name: 'Group',
    version: '1.0',
    params: [],
  };

  constructor(id) {
    super(id, 'Group');
    this.children   = [];        // child BaseLayer instances
    this.collapsed  = false;     // UI: whether children are shown in layer list
    this._off       = null;      // offscreen canvas for compositing children
    this._offCtx    = null;
  }

  init(params = {}) {}

  update(audioData, videoData, dt) {
    // Propagate update to all visible children
    this.children.forEach(child => {
      if (!child.visible) return;
      child.uniforms.iTime   = this.uniforms.iTime;
      child.uniforms.iBeat   = this.uniforms.iBeat;
      child.uniforms.iBpm    = this.uniforms.iBpm;
      child.uniforms.iMouseX = this.uniforms.iMouseX;
      child.uniforms.iMouseY = this.uniforms.iMouseY;
      if (child.modMatrix?.routes.length > 0) {
        child.modMatrix.apply(child, audioData);
      }
      if (typeof child.update === 'function') child.update(audioData, videoData, dt);
    });
  }

  render(ctx, width, height) {
    if (this.children.length === 0) return;

    // Ensure offscreen canvas
    if (!this._off || this._off.width !== width || this._off.height !== height) {
      this._off       = document.createElement('canvas');
      this._off.width  = width;
      this._off.height = height;
      this._offCtx     = this._off.getContext('2d', { willReadFrequently: false });
    }

    const gc = this._offCtx;
    gc.clearRect(0, 0, width, height);

    // Composite children onto group canvas
    this.children.forEach(child => {
      if (!child.visible) return;
      gc.save();
      gc.globalAlpha = VaelMath.clamp(child.opacity ?? 1, 0, 1);
      gc.globalCompositeOperation = _blendMode(child.blendMode);

      // Apply child transform
      const t = child.transform || {};
      gc.translate(width / 2 + (t.x || 0), height / 2 + (t.y || 0));
      if (t.rotation) gc.rotate(t.rotation * Math.PI / 180);
      if (t.scaleX !== undefined || t.scaleY !== undefined) {
        gc.scale(t.scaleX ?? 1, t.scaleY ?? 1);
      }

      if (typeof child.render === 'function') child.render(gc, width, height);
      gc.restore();
    });

    // Draw group canvas onto main ctx (already translated to centre by Renderer)
    ctx.save();
    ctx.translate(-width / 2, -height / 2);
    ctx.drawImage(this._off, 0, 0);
    ctx.restore();
  }

  dispose() {
    this.children.forEach(c => { if (typeof c.dispose === 'function') c.dispose(); });
    this.children = [];
  }

  addChild(layer) {
    this.children.push(layer);
  }

  removeChild(id) {
    this.children = this.children.filter(c => c.id !== id);
  }

  toJSON() {
    return {
      ...super.toJSON(),
      collapsed: this.collapsed,
      children:  this.children.map(c => {
        const base = {
          type:        c.constructor.name,
          id:          c.id,
          name:        c.name,
          visible:     c.visible,
          opacity:     c.opacity,
          blendMode:   c.blendMode,
          maskLayerId: c.maskLayerId || null,
          transform:   { ...c.transform },
          modMatrix:   c.modMatrix?.toJSON() || [],
        };
        if (c.params) base.params = { ...c.params };
        return base;
      }),
    };
  }
}

// Canvas 2D blend mode names
function _blendMode(mode) {
  const map = {
    normal: 'source-over', multiply: 'multiply', screen: 'screen',
    overlay: 'overlay', add: 'lighter', softlight: 'soft-light',
    difference: 'difference', exclusion: 'exclusion', subtract: 'destination-out',
  };
  return map[mode] || 'source-over';
}
