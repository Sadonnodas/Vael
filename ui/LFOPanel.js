/**
 * ui/LFOPanel.js
 * Per-layer LFO panel rendered in PARAMS between Modulation and FX.
 * One LFO can drive multiple params simultaneously.
 * LFOs stored on layer._lfos — ticked each frame via LFOPanel.tickAll().
 */
const LFOPanel = (() => {

  const SHAPES    = ['sine','triangle','square','sawtooth','random'];
  const DIVISIONS = ['1/16','1/8','1/4','1/2','1','2','4'];

  // ── Per-frame tick ────────────────────────────────────────────

  function tickAll(layers, dt, bpm) {
    layers.forEach(layer => {
      if (!layer._lfos?.length) return;
      layer._lfos.forEach(lfo => _tick(lfo, layer, dt, bpm || 120));
    });
  }

  function _tick(lfo, layer, dt, bpm) {
    let rateHz = lfo.rate || 1;
    if (lfo.syncBpm) {
      const divBeats = { '1/16':0.25,'1/8':0.5,'1/4':1,'1/2':2,'1':4,'2':8,'4':16 };
      rateHz = (bpm / 60) / (divBeats[lfo.division] || 1);
    }
    lfo._phase = ((lfo._phase || 0) + rateHz * dt) % 1;
    const p = lfo._phase;
    let out;
    switch (lfo.shape) {
      case 'triangle': out = p < 0.5 ? p*4-1 : 3-p*4; break;
      case 'square':   out = p < 0.5 ? 1 : -1; break;
      case 'sawtooth': out = p*2-1; break;
      case 'random':
        if (p < (lfo._prevP||0)) lfo._rand = Math.random()*2-1;
        lfo._prevP = p; out = lfo._rand || 0; break;
      default: out = Math.sin(p * Math.PI * 2);
    }
    lfo._value = out;

    (lfo.targets || []).forEach(t => {
      if (!t.paramId) return;
      const manifest = layer.constructor?.manifest?.params?.find(m => m.id === t.paramId);
      const min = manifest?.min ?? 0;
      const max = manifest?.max ?? 1;
      const depth = t.depth ?? 0.5;

      if (t.paramId.startsWith('transform.')) {
        const key = t.paramId.split('.')[1];
        if (!layer.transform) return;
        if (t.base === undefined) t.base = layer.transform[key] ?? 0;
        const tmin = {x:-800,y:-450,scaleX:0.1,scaleY:0.1,rotation:-180}[key] ?? -1;
        const tmax = {x:800, y:450, scaleX:4,  scaleY:4,  rotation:180  }[key] ?? 1;
        layer.transform[key] = Math.max(tmin, Math.min(tmax, t.base + out * depth * (tmax - tmin)));
      } else if (t.paramId === 'opacity') {
        if (t.base === undefined) t.base = layer.opacity ?? 1;
        layer.opacity = Math.max(0, Math.min(1, t.base + out * depth));
      } else if (t.paramId.startsWith('fx:')) {
        const dotIdx  = t.paramId.indexOf('.', 3);
        if (dotIdx < 0) return;
        const fxIndex = parseInt(t.paramId.slice(3, dotIdx), 10);
        const paramId = t.paramId.slice(dotIdx + 1);
        const fx      = layer.fx?.[fxIndex];
        if (!fx?.params || !(paramId in fx.params)) return;
        if (t.base === undefined) t.base = fx.params[paramId] ?? 0;
        fx.params[paramId] = Math.max(0, Math.min(1, t.base + out * depth));
      } else if (layer.params && t.paramId in layer.params) {
        if (t.base === undefined) t.base = layer.params[t.paramId] ?? ((min+max)/2);
        layer.params[t.paramId] = Math.max(min, Math.min(max, t.base + out * depth * (max - min)));
      }
    });
  }

  // ── UI ─────────────────────────────────────────────────────────

  function render(layer, container, onChanged) {
    container.innerHTML = '';
    if (!layer._lfos) layer._lfos = [];

    if (!layer._lfos.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:var(--text-dim);text-align:center;padding:6px 0 10px';
      empty.textContent = 'No LFOs yet';
      container.appendChild(empty);
    }

    layer._lfos.forEach((lfo, i) => container.appendChild(_card(lfo, i, layer, container, onChanged)));

    const addBtn = document.createElement('button');
    addBtn.className = 'btn accent';
    addBtn.style.cssText = 'width:100%;font-size:9px;margin-top:4px';
    addBtn.textContent = '+ Add LFO';
    addBtn.addEventListener('click', () => {
      layer._lfos.push({ id:`lfo-${Math.random().toString(36).slice(2,6)}`,
        shape:'sine', rate:1, syncBpm:false, division:'1/4',
        _phase:0, _value:0, targets:[] });
      if (onChanged) onChanged();
      render(layer, container, onChanged);
    });
    container.appendChild(addBtn);
  }

  function _card(lfo, idx, layer, container, onChanged) {
    const card = document.createElement('div');
    card.style.cssText = 'background:var(--bg-card);border:1px solid var(--accent);border-radius:6px;padding:10px;margin-bottom:8px';

    // Header
    const hdr = document.createElement('div');
    hdr.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:10px';

    const badge = document.createElement('span');
    badge.style.cssText = 'font-family:var(--font-mono);font-size:8px;color:var(--accent);font-weight:500;flex-shrink:0';
    badge.textContent = `LFO ${idx+1}`;

    // Shape
    const shapeSel = document.createElement('select');
    shapeSel.style.cssText = 'flex:1;background:var(--bg);border:1px solid var(--border-dim);border-radius:3px;color:var(--text);font-family:var(--font-mono);font-size:9px;padding:3px 4px';
    SHAPES.forEach(s => { const o=document.createElement('option'); o.value=s; o.textContent=_icon(s)+' '+s; o.selected=s===lfo.shape; shapeSel.appendChild(o); });
    shapeSel.addEventListener('change', () => { lfo.shape=shapeSel.value; lfo._phase=0; });

    const delBtn = document.createElement('button');
    delBtn.style.cssText = 'background:none;border:none;color:#ff4444;cursor:pointer;font-size:11px';
    delBtn.textContent = '✕';
    delBtn.addEventListener('click', () => { layer._lfos.splice(idx,1); if(onChanged)onChanged(); render(layer,container,onChanged); });

    hdr.append(badge, shapeSel, delBtn);
    card.appendChild(hdr);

    // Rate row
    const rateRow = document.createElement('div');
    rateRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:10px';

    const syncChk = document.createElement('input');
    syncChk.type='checkbox'; syncChk.checked=lfo.syncBpm;
    syncChk.style.cssText='accent-color:var(--accent);flex-shrink:0';

    const syncLbl = document.createElement('span');
    syncLbl.style.cssText='font-family:var(--font-mono);font-size:8px;color:var(--text-dim);flex-shrink:0';
    syncLbl.textContent='BPM sync';

    const rateWrap = document.createElement('div');
    rateWrap.style.cssText='display:flex;align-items:center;gap:6px;flex:1';

    const _buildRate = () => {
      rateWrap.innerHTML='';
      if (lfo.syncBpm) {
        const d=document.createElement('select');
        d.style.cssText='flex:1;background:var(--bg);border:1px solid var(--border-dim);border-radius:3px;color:var(--accent);font-family:var(--font-mono);font-size:9px;padding:3px 4px';
        DIVISIONS.forEach(v=>{ const o=document.createElement('option'); o.value=v; o.textContent=v+' beat'; o.selected=v===lfo.division; d.appendChild(o); });
        d.addEventListener('change',()=>{ lfo.division=d.value; });
        rateWrap.appendChild(d);
      } else {
        const sl=document.createElement('input'); sl.type='range'; sl.min=0.01; sl.max=10; sl.step=0.01; sl.value=lfo.rate;
        sl.style.cssText='flex:1;accent-color:var(--accent)';
        const vl=document.createElement('span'); vl.style.cssText='font-family:var(--font-mono);font-size:8px;color:var(--accent);min-width:40px;text-align:right';
        vl.textContent=lfo.rate.toFixed(2)+'Hz';
        sl.addEventListener('input',()=>{ lfo.rate=parseFloat(sl.value); vl.textContent=lfo.rate.toFixed(2)+'Hz'; });
        rateWrap.append(sl,vl);
      }
    };
    syncChk.addEventListener('change',()=>{ lfo.syncBpm=syncChk.checked; _buildRate(); });
    _buildRate();
    rateRow.append(syncChk, syncLbl, rateWrap);
    card.appendChild(rateRow);

    // Targets
    const tLabel = document.createElement('div');
    tLabel.style.cssText='font-family:var(--font-mono);font-size:8px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px';
    tLabel.textContent='Destinations';
    card.appendChild(tLabel);

    const tList = document.createElement('div');
    card.appendChild(tList);

    const _renderTargets = () => {
      tList.innerHTML='';
      const manifest = layer.constructor?.manifest?.params || [];
      const fxOpts = (layer.fx || []).flatMap((fx, i) => {
        const catalog = typeof LayerFX !== 'undefined' ? LayerFX.CATALOG?.find(e => e.type === fx.type) : null;
        const fxLabel = catalog?.label || fx.type;
        return Object.keys(fx.params || {}).map(paramId => ({
          id: `fx:${i}.${paramId}`,
          label: `FX ${i + 1} ${fxLabel} – ${paramId}`,
        }));
      });
      const opts = [
        ...manifest.filter(p=>p.type==='float'||p.type==='int').map(p=>({ id:p.id, label:p.label })),
        { id:'opacity',            label:'Opacity'    },
        { id:'transform.x',       label:'Position X' },
        { id:'transform.y',       label:'Position Y' },
        { id:'transform.scaleX',  label:'Scale X'    },
        { id:'transform.scaleY',  label:'Scale Y'    },
        { id:'transform.rotation',label:'Rotation'   },
        ...fxOpts,
      ];

      (lfo.targets||[]).forEach((t,ti) => {
        const tRow=document.createElement('div');
        tRow.style.cssText='display:flex;align-items:center;gap:6px;margin-bottom:6px';

        const pSel=document.createElement('select');
        pSel.style.cssText='flex:1;background:var(--bg);border:1px solid var(--border-dim);border-radius:3px;color:var(--text);font-family:var(--font-mono);font-size:8px;padding:2px 4px';
        opts.forEach(o=>{ const el=document.createElement('option'); el.value=o.id; el.textContent=o.label; el.selected=o.id===t.paramId; pSel.appendChild(el); });
        pSel.addEventListener('change',()=>{ t.paramId=pSel.value; t.base=undefined; });

        const dSl=document.createElement('input'); dSl.type='range'; dSl.min=0; dSl.max=1; dSl.step=0.01; dSl.value=t.depth??0.5;
        dSl.style.cssText='width:56px;accent-color:var(--accent2)'; dSl.title='Depth';
        const dVl=document.createElement('span'); dVl.style.cssText='font-family:var(--font-mono);font-size:8px;color:var(--accent2);min-width:26px;text-align:right';
        dVl.textContent=(t.depth??0.5).toFixed(2);
        dSl.addEventListener('input',()=>{ t.depth=parseFloat(dSl.value); dVl.textContent=t.depth.toFixed(2); });

        const tDel=document.createElement('button');
        tDel.style.cssText='background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:10px';
        tDel.textContent='✕';
        tDel.addEventListener('click',()=>{ lfo.targets.splice(ti,1); _renderTargets(); });

        tRow.append(pSel, dSl, dVl, tDel);
        tList.appendChild(tRow);
      });

      const addDest=document.createElement('button');
      addDest.className='btn'; addDest.style.cssText='width:100%;font-size:8px;color:var(--accent2);margin-top:2px';
      addDest.textContent='+ Add destination';
      addDest.addEventListener('click',()=>{
        const manifest=layer.constructor?.manifest?.params||[];
        const first=manifest.find(p=>p.type==='float');
        lfo.targets.push({ paramId:first?.id||'opacity', depth:0.5, base:undefined });
        _renderTargets();
      });
      tList.appendChild(addDest);
    };
    _renderTargets();

    return card;
  }

  function _icon(s) {
    return {sine:'∿',triangle:'⋀',square:'⊓',sawtooth:'⋰',random:'⁓'}[s]||'∿';
  }

  return { render, tickAll };
})();
