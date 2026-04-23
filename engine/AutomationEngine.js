/**
 * engine/AutomationEngine.js
 * Evaluates per-layer automation ramps each frame.
 *
 * Each ramp: { id, paramId, timeSource, startTime, endTime,
 *              startValue, endValue, curve, enabled }
 *
 * Time sources:
 *   'clock'      — seconds since page load (performance.now / 1000)
 *   'audio'      — AudioEngine currentTime (window._vaelAudio.currentTime)
 *   'video:<id>' — currentTime of a VideoPlayerLayer with that id
 *
 * Curves: linear | easeIn | easeOut | easeInOut | exponential | sine
 */

const AutomationEngine = (() => {

  const CURVES = {
    linear:      t => t,
    easeIn:      t => t * t,
    easeOut:     t => 1 - (1 - t) * (1 - t),
    easeInOut:   t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
    exponential: t => Math.pow(t, 3),
    sine:        t => (1 - Math.cos(t * Math.PI)) / 2,
  };

  const CURVE_LABELS = {
    linear:      'Linear',
    easeIn:      'Ease In',
    easeOut:     'Ease Out',
    easeInOut:   'Ease In+Out',
    exponential: 'Exponential',
    sine:        'Sine',
  };

  function _getTime(ramp, allLayers) {
    const src = ramp.timeSource || 'clock';
    if (src === 'audio') return window._vaelAudio?.currentTime ?? 0;
    if (src === 'clock') return performance.now() / 1000;
    if (src.startsWith('video:')) {
      const id = src.slice(6);
      const vl = allLayers.find(l => l.id === id);
      return vl?._videoEl?.currentTime ?? 0;
    }
    return 0;
  }

  function _setParam(layer, paramId, value) {
    if (paramId === 'opacity') {
      layer.opacity = Math.max(0, Math.min(1, value));
      return;
    }
    if (paramId.startsWith('transform.')) {
      const key = paramId.slice(10);
      if (layer.transform && key in layer.transform) layer.transform[key] = value;
      return;
    }
    if (layer.params && paramId in layer.params) layer.params[paramId] = value;
  }

  /** Apply all enabled ramps to a layer for the current frame. */
  function apply(layer, allLayers) {
    if (!layer.automation?.length) return;
    for (const ramp of layer.automation) {
      if (!ramp.enabled) continue;
      const dur = ramp.endTime - ramp.startTime;
      if (dur <= 0) continue;
      const t = _getTime(ramp, allLayers);
      if (t < ramp.startTime || t > ramp.endTime) continue;
      const norm   = (t - ramp.startTime) / dur;
      const curved = (CURVES[ramp.curve] || CURVES.linear)(Math.max(0, Math.min(1, norm)));
      const value  = ramp.startValue + (ramp.endValue - ramp.startValue) * curved;
      _setParam(layer, ramp.paramId, value);
    }
  }

  return { apply, CURVES, CURVE_LABELS };

})();
