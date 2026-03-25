/**
 * layers/MathVisualizer.js
 * Stub — full port from current tool in next session.
 */
class MathVisualizer extends BaseLayer {
  static manifest = {
    name: 'Math Visualizer',
    version: '1.0',
    params: [],
  };
  constructor(id) { super(id, 'Math Visualizer'); }
  render(ctx, width, height) {
    // Placeholder — draws the Vael wordmark in the centre
    ctx.fillStyle = 'rgba(0, 212, 170, 0.08)';
    ctx.font = 'bold 72px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('VAEL', width / 2, height / 2);
    ctx.font = '14px monospace';
    ctx.fillStyle = 'rgba(0, 212, 170, 0.25)';
    ctx.fillText('Light onto Sound', width / 2, height / 2 + 52);
  }
}
