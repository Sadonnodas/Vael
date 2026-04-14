/**
 * ui/PlaylistPanel.js — Concert setlist with song/part hierarchy
 */
const PlaylistPanel = (() => {
  let _setlist=null,_audio=null,_container=null,_playlist=null,_activePartId=null,_open=true,_root=null;
  const STORAGE_KEY='vael-playlist-v2';

  function _uid(){ return Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,6); }
  function _flatParts(){ if(!_playlist)return []; return _playlist.songs.flatMap(s=>s.parts.map(p=>({...p,songName:s.name,songId:s.id}))); }
  function _activePart(){ return _flatParts().find(p=>p.id===_activePartId)||null; }

  function init({setlist,audio,container}){
    _setlist=setlist; _audio=audio;
    _container=container||document.getElementById('tab-scenes');
    _load(); _inject();
    if(window._vaelMidi){
      const orig=window._vaelMidi.onGlobalAction;
      window._vaelMidi.onGlobalAction=(action)=>{
        if(action==='scene:next'){ _nextPart(); return; }
        if(action==='scene:prev'){ _prevPart(); return; }

        if(action==='scene:play'){
          // Re-trigger the currently active part (reload scene + restart audio)
          if(_activePartId) _selectPart(_activePartId);
          else { const p=_flatParts(); if(p.length>0) _selectPart(p[0].id); }
          return;
        }

        if(action==='scene:stop'){
          // Stop audio; leave visuals as-is
          if(_audio) { try { _audio.pause?.() || _audio.stop?.(); } catch(_){} }
          Toast.info('⏹ Stopped');
          return;
        }

        if(action.startsWith('scene:jump:')){
          // PC-style jump: jump to part at 0-indexed position in the flat parts list
          const pcNum = parseInt(action.split(':')[2]);
          if(!isNaN(pcNum)){
            const flat=_flatParts();
            if(pcNum < flat.length){
              _selectPart(flat[pcNum].id);
            } else {
              Toast.warn(`MIDI jump: no part at index ${pcNum} (${flat.length} parts total)`);
            }
          }
          return;
        }

        if(orig)orig(action);
      };
    }
  }

  function _nextPart(){const p=_flatParts(),i=p.findIndex(x=>x.id===_activePartId);if(i<p.length-1)_selectPart(p[i+1].id);}
  function _prevPart(){const p=_flatParts(),i=p.findIndex(x=>x.id===_activePartId);if(i>0)_selectPart(p[i-1].id);}

  function _selectPart(partId){
    _activePartId=partId;
    const part=_flatParts().find(p=>p.id===partId);
    if(!part)return;
    if(part.sceneName&&typeof PresetBrowser!=='undefined'){
      const preset=(PresetBrowser._getAll?PresetBrowser._getAll():[]).find(p=>p.name===part.sceneName);
      if(preset&&_setlist)_setlist._loadPreset(preset.data||preset);
    }
    if(part.audioUrl&&_audio){
      _audio.loadUrl(part.audioUrl,part.audioName||'audio').then(()=>_audio.play()).catch(()=>{});
    }
    _save(); _refreshUI();
    Toast.info('▶ '+part.songName+' — '+part.name);
  }

  function _save(){
    if(!_playlist)return;
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify({playlist:_playlist,activePartId:_activePartId}));}catch{}
  }

  function _load(){
    try{
      const raw=localStorage.getItem(STORAGE_KEY);
      if(!raw)return;
      const saved=JSON.parse(raw);
      _playlist=saved.playlist||null; _activePartId=saved.activePartId||null;
      if(_playlist)_playlist.songs.forEach(s=>s.parts.forEach(p=>{if(p.audioUrl?.startsWith('blob:')){p.audioUrl=null;p.audioName=null;}}));
    }catch{}
  }

  function _inject(){
    document.getElementById('playlist-panel-root')?.remove();
    _root=document.createElement('div'); _root.id='playlist-panel-root';
    _container.appendChild(_root); _renderRoot();
  }

  function _refreshUI(){ if(_root)_renderRoot(); }

  function _renderRoot(){
    _root.innerHTML='';
    const div=document.createElement('div'); div.className='divider'; _root.appendChild(div);
    const section=document.createElement('div'); section.className='section'; _root.appendChild(section);

    const hdr=document.createElement('div');
    hdr.style.cssText='display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:10px';
    hdr.innerHTML=`<span style="font-family:var(--font-mono);font-size:9px;color:var(--accent);text-transform:uppercase;letter-spacing:1px;flex:1">🎵 Concert setlist${_playlist?' — '+_playlist.name:''}</span><span class="pl-arr" style="font-size:10px;color:var(--text-dim);transition:transform 0.15s;transform:${_open?'rotate(90deg)':'rotate(0deg)'}">▶</span>`;
    const body=document.createElement('div'); body.style.display=_open?'block':'none';
    hdr.addEventListener('click',()=>{_open=!_open;body.style.display=_open?'block':'none';hdr.querySelector('.pl-arr').style.transform=_open?'rotate(90deg)':'rotate(0deg)';});
    section.appendChild(hdr); section.appendChild(body);
    if(!_playlist)_renderEmpty(body); else _renderPlaylist(body,section);
  }

  function _renderEmpty(container){
    const p=document.createElement('p');
    p.style.cssText='font-family:var(--font-mono);font-size:9px;color:var(--text-dim);line-height:1.7;margin-bottom:10px';
    p.textContent='Create a setlist to organise your songs and parts, assign audio and visuals, then step through live with your MIDI controller.';
    container.appendChild(p);
    const btn=document.createElement('button'); btn.className='btn accent'; btn.style.cssText='width:100%;font-size:9px'; btn.textContent='+ Create setlist';
    btn.addEventListener('click',()=>{const n=prompt('Setlist name (e.g. "Bearfeet @ Venue 2026"):');if(!n?.trim())return;_playlist={name:n.trim(),songs:[]};_save();_refreshUI();});
    container.appendChild(btn);
  }

  function _renderPlaylist(container){
    const flat=_flatParts(),total=flat.length,activeIdx=flat.findIndex(p=>p.id===_activePartId);

    if(total>0){
      const prog=document.createElement('div'); prog.style.cssText='height:3px;background:var(--border-dim);border-radius:2px;margin-bottom:8px;overflow:hidden';
      const fill=document.createElement('div'); const pct=activeIdx>=0?Math.round(((activeIdx+1)/total)*100):0;
      fill.style.cssText=`height:100%;width:${pct}%;background:var(--accent);border-radius:2px;transition:width 0.3s`; prog.appendChild(fill); container.appendChild(prog);
      const info=document.createElement('div'); info.style.cssText='font-family:var(--font-mono);font-size:8px;color:var(--text-dim);margin-bottom:10px';
      info.textContent=activeIdx>=0?`Part ${activeIdx+1} of ${total} — ${_activePart()?.songName} · ${_activePart()?.name}`:`${total} parts · no selection`;
      container.appendChild(info);
    }

    _playlist.songs.forEach((song,si)=>container.appendChild(_buildSong(song,si,flat)));

    const addBtn=document.createElement('button'); addBtn.className='btn'; addBtn.style.cssText='width:100%;font-size:9px;margin-top:8px;color:var(--accent)'; addBtn.textContent='+ Add song';
    addBtn.addEventListener('click',()=>{const n=prompt('Song name:');if(!n?.trim())return;_playlist.songs.push({id:_uid(),name:n.trim(),parts:[{id:_uid(),name:'Full song',audioUrl:null,audioName:null,sceneName:null,notes:''}]});_save();_refreshUI();});
    container.appendChild(addBtn);

    if(total>0){
      const t=document.createElement('div'); t.style.cssText='display:flex;gap:6px;margin-top:10px';
      const pb=document.createElement('button'); pb.className='btn'; pb.style.cssText='flex:1;font-size:9px'; pb.textContent='← Prev'; pb.disabled=activeIdx<=0; pb.addEventListener('click',_prevPart);
      const nb=document.createElement('button'); nb.className='btn accent'; nb.style.cssText='flex:1;font-size:9px'; nb.textContent='Next →'; nb.disabled=activeIdx>=total-1; nb.addEventListener('click',_nextPart);
      t.append(pb,nb); container.appendChild(t);
    }

    // ── Transition controls ───────────────────────────────────
    const trSection=document.createElement('div');
    trSection.style.cssText='margin-top:12px;padding:10px;background:var(--bg-card);border:1px solid var(--border-dim);border-radius:5px';
    trSection.innerHTML=`
      <div style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Scene transition</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div>
          <div style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim);margin-bottom:4px">Type</div>
          <select id="tr-type" style="width:100%;background:var(--bg);border:1px solid var(--border-dim);border-radius:3px;color:var(--text);font-family:var(--font-mono);font-size:9px;padding:4px 6px">
            <option value="crossfade" ${(_setlist.transitionType||'crossfade')==='crossfade'?'selected':''}>Crossfade</option>
            <option value="flash"     ${(_setlist.transitionType)==='flash'?'selected':''}>Flash</option>
            <option value="blur"      ${(_setlist.transitionType)==='blur'?'selected':''}>Blur</option>
            <option value="cut"       ${(_setlist.transitionType)==='cut'?'selected':''}>Cut</option>
          </select>
        </div>
        <div>
          <div style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim);margin-bottom:4px">Duration (s)</div>
          <input id="tr-dur" type="number" min="0" max="10" step="0.1" value="${(_setlist.fadeDuration||1.5).toFixed(1)}"
            style="width:100%;background:var(--bg);border:1px solid var(--border-dim);border-radius:3px;color:var(--text);font-family:var(--font-mono);font-size:9px;padding:4px 6px;box-sizing:border-box">
        </div>
      </div>
    `;
    trSection.querySelector('#tr-type').addEventListener('change',e=>{
      _setlist.transitionType=e.target.value;
      document.dispatchEvent(new CustomEvent('vael:transition-type',{detail:e.target.value}));
    });
    trSection.querySelector('#tr-dur').addEventListener('change',e=>{
      const v=parseFloat(e.target.value)||1.5;
      _setlist.fadeDuration=Math.max(0,Math.min(10,v));
      document.dispatchEvent(new CustomEvent('vael:fade-duration',{detail:_setlist.fadeDuration}));
    });
    container.appendChild(trSection);

    const io=document.createElement('div'); io.style.cssText='display:flex;gap:4px;margin-top:8px;flex-wrap:wrap';
    io.append(_sb('↓ Export',_exportSetlist),_sb('↑ Import',_importSetlist),_sb('✎ Rename',()=>{const n=prompt('New name:',_playlist.name);if(n?.trim()){_playlist.name=n.trim();_save();_refreshUI();}}));
    const clr=_sb('✕ Clear',()=>{if(confirm('Delete setlist?')){_playlist=null;_activePartId=null;_save();_refreshUI();}}); clr.style.color='#ff4444'; io.appendChild(clr);
    container.appendChild(io);

    const hint=document.createElement('p'); hint.style.cssText='font-family:var(--font-mono);font-size:8px;color:var(--text-dim);line-height:1.6;margin-top:8px';
    hint.innerHTML='Map MIDI buttons in <strong style="color:var(--text)">MIDI tab</strong> → Scene navigation to step through parts live';
    container.appendChild(hint);
  }

  function _buildSong(song,si,flat){
    const hasActive=song.parts.some(p=>p.id===_activePartId);
    const card=document.createElement('div');
    card.draggable=true;
    card.dataset.si=si;
    card.style.cssText=`border:1px solid ${hasActive?'var(--accent)':'var(--border-dim)'};border-radius:6px;margin-bottom:6px;overflow:hidden;cursor:grab`;

    // Drag to reorder songs
    card.addEventListener('dragstart',e=>{e.dataTransfer.setData('song-idx',String(si));card.style.opacity='0.4';});
    card.addEventListener('dragend',()=>{card.style.opacity='1';});
    card.addEventListener('dragover',e=>{e.preventDefault();card.style.borderColor='var(--accent)';});
    card.addEventListener('dragleave',()=>{card.style.borderColor=hasActive?'var(--accent)':'var(--border-dim)';});
    card.addEventListener('drop',e=>{
      e.preventDefault(); card.style.borderColor=hasActive?'var(--accent)':'var(--border-dim)';
      const from=parseInt(e.dataTransfer.getData('song-idx'));
      if(!isNaN(from)&&from!==si){
        const [moved]=_playlist.songs.splice(from,1);
        _playlist.songs.splice(from<si?si-1:si,0,moved);
        _save();_refreshUI();
      }
    });

    const sh=document.createElement('div');
    sh.style.cssText=`display:flex;align-items:center;gap:8px;padding:8px 10px;background:${hasActive?'color-mix(in srgb,var(--accent) 6%,var(--bg-card))':'var(--bg-card)'};`;

    // Drag handle
    const grip=document.createElement('span');
    grip.style.cssText='font-size:10px;color:var(--text-dim);cursor:grab;flex-shrink:0;opacity:0.5';
    grip.textContent='⠿'; grip.title='Drag to reorder';

    const arrow=document.createElement('span');
    arrow.className='sa';
    arrow.style.cssText='font-size:8px;color:var(--text-dim);transform:rotate(90deg);display:inline-block;transition:transform 0.15s;flex-shrink:0';
    arrow.textContent='▶';

    // Song name — double-click to rename inline
    const nameSpan=document.createElement('span');
    nameSpan.style.cssText='font-family:var(--font-mono);font-size:9px;color:var(--text);font-weight:500;flex:1;cursor:text';
    nameSpan.textContent=song.name;
    nameSpan.title='Double-click to rename';
    nameSpan.addEventListener('dblclick',e=>{
      e.stopPropagation();
      const inp=document.createElement('input');
      inp.type='text'; inp.value=song.name;
      inp.style.cssText='font-family:var(--font-mono);font-size:9px;color:var(--text);font-weight:500;background:var(--bg);border:1px solid var(--accent);border-radius:3px;padding:1px 4px;width:100%;outline:none';
      nameSpan.replaceWith(inp); inp.focus(); inp.select();
      const commit=()=>{const v=inp.value.trim();if(v)song.name=v;_save();_refreshUI();};
      inp.addEventListener('blur',commit);
      inp.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();inp.blur();}if(e.key==='Escape'){_refreshUI();}});
    });

    const partCount=document.createElement('span');
    partCount.style.cssText='font-family:var(--font-mono);font-size:8px;color:var(--text-dim);flex-shrink:0';
    partCount.textContent=song.parts.length+'p';

    sh.append(grip,arrow,nameSpan,partCount);

    const pb=document.createElement('div'); let ex=true;
    sh.addEventListener('click',e=>{
      if(e.target===nameSpan||e.target.tagName==='INPUT')return;
      ex=!ex;pb.style.display=ex?'block':'none';
      sh.querySelector('.sa').style.transform=ex?'rotate(90deg)':'rotate(0deg)';
    });
    card.appendChild(sh);

    // Song actions
    const sa=document.createElement('div'); sa.style.cssText='display:flex;gap:4px;padding:4px 10px 5px;background:var(--bg-card);border-top:1px solid var(--border-dim)';
    const dl=_tb('✕ Delete song',()=>{if(confirm('Delete "'+song.name+'" and all its parts?')){_playlist.songs.splice(si,1);_save();_refreshUI();}}); dl.style.color='#ff4444';
    const ap=_tb('+ Add part',()=>{const n=prompt('Part name (e.g. Intro, Verse, Chorus, Bridge):');if(!n?.trim())return;song.parts.push({id:_uid(),name:n.trim(),audioUrl:null,audioName:null,sceneName:null,notes:''});_save();_refreshUI();}); ap.style.color='var(--accent)';
    sa.append(dl,ap); card.appendChild(sa);

    song.parts.forEach((p,pi)=>pb.appendChild(_buildPart(p,pi,song,flat)));
    card.appendChild(pb);
    return card;
  }

  function _buildPart(part,pi,song,flat){
    const isAct=part.id===_activePartId;
    const idx=flat.findIndex(p=>p.id===part.id)+1;
    const row=document.createElement('div');
    row.style.cssText=`display:flex;align-items:center;gap:6px;padding:6px 10px 6px 22px;background:${isAct?'color-mix(in srgb,var(--accent) 12%,var(--bg))':'var(--bg)'};border-top:1px solid var(--border-dim);cursor:pointer`;
    row.addEventListener('click',()=>_selectPart(part.id));
    row.addEventListener('mouseenter',()=>{if(!isAct)row.style.background='var(--bg-card)';});
    row.addEventListener('mouseleave',()=>{if(!isAct)row.style.background='var(--bg)';});

    const numSpan=document.createElement('span');
    numSpan.style.cssText=`font-family:var(--font-mono);font-size:7px;color:${isAct?'var(--accent)':'var(--text-dim)'};min-width:16px;flex-shrink:0`;
    numSpan.textContent=idx;

    const playSpan=document.createElement('span');
    playSpan.style.cssText=`font-size:8px;color:${isAct?'var(--accent)':'transparent'};flex-shrink:0`;
    playSpan.textContent='▶';

    // Part name — double-click to rename
    const nameSpan=document.createElement('span');
    nameSpan.style.cssText=`font-family:var(--font-mono);font-size:9px;color:${isAct?'var(--accent)':'var(--text)'};flex:1;cursor:text`;
    nameSpan.textContent=part.name;
    nameSpan.title='Double-click to rename';
    nameSpan.addEventListener('dblclick',e=>{
      e.stopPropagation();
      const inp=document.createElement('input');
      inp.type='text'; inp.value=part.name;
      inp.style.cssText=`font-family:var(--font-mono);font-size:9px;color:${isAct?'var(--accent)':'var(--text)'};background:var(--bg);border:1px solid var(--accent);border-radius:3px;padding:1px 4px;flex:1;outline:none`;
      nameSpan.replaceWith(inp); inp.focus(); inp.select();
      const commit=()=>{const v=inp.value.trim();if(v)part.name=v;_save();_refreshUI();};
      inp.addEventListener('blur',commit);
      inp.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();inp.blur();}if(e.key==='Escape'){_refreshUI();}});
    });

    const audioIcon=document.createElement('span');
    audioIcon.title='Audio'+(part.audioUrl?' — '+part.audioName:' — not set');
    audioIcon.style.cssText=`font-size:9px;opacity:${part.audioUrl?1:0.2};color:var(--accent2)`;
    audioIcon.textContent='♪';

    const sceneIcon=document.createElement('span');
    sceneIcon.title='Scene'+(part.sceneName?' — '+part.sceneName:' — not set');
    sceneIcon.style.cssText=`font-size:9px;opacity:${part.sceneName?1:0.2};color:var(--accent)`;
    sceneIcon.textContent='✦';

    const eb=document.createElement('button');
    eb.style.cssText='background:none;border:1px solid var(--border-dim);border-radius:3px;color:var(--text-dim);font-family:var(--font-mono);font-size:7px;padding:2px 6px;cursor:pointer;flex-shrink:0';
    eb.textContent='Edit'; eb.title='Edit this part (audio, scene, notes)';
    eb.addEventListener('click',e=>{e.stopPropagation();_partEditor(part,song,pi);});

    row.append(numSpan,playSpan,nameSpan,audioIcon,sceneIcon,eb);
    return row;
  }

  function _partEditor(part,song,pi){
    const presets=typeof PresetBrowser!=='undefined'&&PresetBrowser._getAll?PresetBrowser._getAll():[];
    const ov=document.createElement('div');
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:10000;display:flex;align-items:center;justify-content:center;font-family:var(--font-mono)';
    const m=document.createElement('div');
    m.style.cssText='background:var(--bg-mid);border:1px solid var(--border);border-radius:10px;width:380px;max-height:80vh;overflow-y:auto';
    m.innerHTML=`
      <div style="display:flex;align-items:center;padding:14px 16px;border-bottom:1px solid var(--border-dim);position:sticky;top:0;background:var(--bg-mid);z-index:1">
        <div style="flex:1"><div style="font-size:8px;color:var(--text-dim);margin-bottom:2px">${song.name}</div><div style="font-size:11px;color:var(--accent)">${part.name}</div></div>
        <button id="x" style="background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:16px">✕</button>
      </div>
      <div style="padding:16px;display:flex;flex-direction:column;gap:14px">
        <div><div style="font-size:8px;color:var(--text-dim);margin-bottom:5px">Part name</div>
          <input id="pn" type="text" value="${part.name}" style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);font-family:var(--font-mono);font-size:10px;padding:6px 8px;box-sizing:border-box"></div>
        <div><div style="font-size:8px;color:var(--text-dim);margin-bottom:5px">Audio file</div>
          <div style="display:flex;align-items:center;gap:8px">
            <span id="an" style="flex:1;font-size:9px;color:${part.audioUrl?'var(--accent2)':'var(--text-dim)'}">${part.audioUrl?part.audioName:'— no audio'}</span>
            <button id="ap" class="btn accent" style="font-size:8px">♪ Choose</button>
            ${part.audioUrl?'<button id="ac" class="btn" style="font-size:8px;color:#ff4444">✕</button>':''}
          </div>
          <p style="font-size:8px;color:var(--text-dim);margin-top:5px;line-height:1.5">Plays automatically when this part becomes active live.</p>
        </div>
        <div><div style="font-size:8px;color:var(--text-dim);margin-bottom:5px">Visual scene</div>
          <select id="ps" style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);font-family:var(--font-mono);font-size:9px;padding:6px 8px">
            <option value="">— Not assigned —</option>
            ${presets.map(p=>`<option value="${p.name}" ${p.name===part.sceneName?'selected':''}>${p.name}</option>`).join('')}
          </select>
          <p style="font-size:8px;color:var(--text-dim);margin-top:5px;line-height:1.5">
            First build the visual in the canvas, then <button id="sc" style="background:none;border:none;color:var(--accent);cursor:pointer;font-family:var(--font-mono);font-size:8px;padding:0;text-decoration:underline">save it as a scene</button> and pick it here.
          </p>
        </div>
        <div><div style="font-size:8px;color:var(--text-dim);margin-bottom:5px">Notes</div>
          <textarea id="nt" rows="2" style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);font-family:var(--font-mono);font-size:9px;padding:6px 8px;resize:vertical;box-sizing:border-box" placeholder="Tempo, cues, lighting notes…">${part.notes||''}</textarea>
        </div>
        <div style="display:flex;gap:6px">
          <button id="mu" class="btn" style="flex:1;font-size:9px" ${pi===0?'disabled':''}>↑ Up</button>
          <button id="md" class="btn" style="flex:1;font-size:9px" ${pi===song.parts.length-1?'disabled':''}>↓ Down</button>
          <button id="dl" class="btn" style="flex:1;font-size:9px;color:#ff4444">✕ Delete</button>
        </div>
      </div>
      <div style="padding:12px 16px;border-top:1px solid var(--border-dim);display:flex;justify-content:flex-end;gap:8px;position:sticky;bottom:0;background:var(--bg-mid)">
        <button id="ca" class="btn" style="font-size:9px">Cancel</button>
        <button id="sv" class="btn accent" style="font-size:9px">Save</button>
      </div>`;
    ov.appendChild(m); document.body.appendChild(ov);
    const close=()=>ov.remove();

    m.querySelector('#ap').addEventListener('click',()=>{
      const inp=document.createElement('input'); inp.type='file'; inp.accept='audio/*';
      inp.addEventListener('change',e=>{
        const f=e.target.files[0]; if(!f)return;
        if(part.audioUrl?.startsWith('blob:'))URL.revokeObjectURL(part.audioUrl);
        part.audioUrl=URL.createObjectURL(f); part.audioName=f.name;
        m.querySelector('#an').textContent=f.name; m.querySelector('#an').style.color='var(--accent2)';
      }); inp.click();
    });

    m.querySelector('#ac')?.addEventListener('click',()=>{
      if(part.audioUrl?.startsWith('blob:'))URL.revokeObjectURL(part.audioUrl);
      part.audioUrl=null; part.audioName=null;
      m.querySelector('#an').textContent='— no audio'; m.querySelector('#an').style.color='var(--text-dim)';
      m.querySelector('#ac').remove();
    });

    m.querySelector('#sc').addEventListener('click',()=>{
      const name=(m.querySelector('#pn').value.trim()||part.name);
      window.dispatchEvent(new CustomEvent('vael:save-scene-named',{detail:{name}}));
      setTimeout(()=>{
        const sel=m.querySelector('#ps'); const opt=document.createElement('option');
        opt.value=name; opt.textContent=name; opt.selected=true; sel.appendChild(opt);
        Toast.success(`Scene saved as "${name}"`);
      },300);
    });

    m.querySelector('#mu')?.addEventListener('click',()=>{if(pi>0){[song.parts[pi-1],song.parts[pi]]=[song.parts[pi],song.parts[pi-1]];_save();close();_refreshUI();}});
    m.querySelector('#md')?.addEventListener('click',()=>{if(pi<song.parts.length-1){[song.parts[pi],song.parts[pi+1]]=[song.parts[pi+1],song.parts[pi]];_save();close();_refreshUI();}});
    m.querySelector('#dl')?.addEventListener('click',()=>{if(song.parts.length===1){Toast.warn('A song needs at least one part.');return;}if(confirm('Delete part "'+part.name+'"?')){song.parts.splice(pi,1);if(_activePartId===part.id)_activePartId=null;_save();close();_refreshUI();}});
    m.querySelector('#sv').addEventListener('click',()=>{part.name=m.querySelector('#pn').value.trim()||part.name;part.sceneName=m.querySelector('#ps').value||null;part.notes=m.querySelector('#nt').value;_save();close();_refreshUI();Toast.success('Part updated');});
    m.querySelector('#x').addEventListener('click',close);
    m.querySelector('#ca').addEventListener('click',close);
    ov.addEventListener('click',e=>{if(e.target===ov)close();});
  }

  function _exportSetlist(){
    const d=JSON.stringify({version:2,playlist:{..._playlist,songs:_playlist.songs.map(s=>({...s,parts:s.parts.map(p=>({...p,audioUrl:null}))}))}},null,2);
    const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([d],{type:'application/json'}));
    a.download=(_playlist.name.replace(/\s+/g,'-'))+'-setlist.json'; a.click();
    Toast.info('Setlist exported — re-attach audio files after import');
  }

  function _importSetlist(){
    const inp=document.createElement('input'); inp.type='file'; inp.accept='.json';
    inp.addEventListener('change',async e=>{
      const f=e.target.files[0]; if(!f)return;
      try{const j=JSON.parse(await f.text());if(j.version>=2&&j.playlist){_playlist=j.playlist;_activePartId=null;_save();_refreshUI();Toast.success('Setlist "'+_playlist.name+'" imported — '+_flatParts().length+' parts');}else Toast.error('Unrecognised setlist format');}
      catch{Toast.error('Could not read setlist file');}
    }); inp.click();
  }

  function _sb(l,fn){const b=document.createElement('button');b.className='btn';b.style.cssText='font-size:8px;padding:3px 8px;color:var(--text-dim)';b.textContent=l;b.addEventListener('click',fn);return b;}
  function _tb(l,fn,t=''){const b=document.createElement('button');b.style.cssText='background:none;border:1px solid var(--border-dim);border-radius:3px;color:var(--text-dim);font-family:var(--font-mono);font-size:7px;padding:2px 5px;cursor:pointer';b.textContent=l;b.title=t;b.addEventListener('click',e=>{e.stopPropagation();fn();});return b;}

  return { init };
})();
