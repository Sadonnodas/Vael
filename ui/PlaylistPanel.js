/**
 * ui/PlaylistPanel.js — Concert setlist with song/part hierarchy
 */
const PlaylistPanel = (() => {
  let _setlist=null,_audio=null,_container=null,_playlist=null,_activePartId=null,_open=true,_root=null,_audioWatchTimer=null;
  const STORAGE_KEY='vael-playlist-v2';

  function _uid(){ return Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,6); }

  // Inline confirm — avoids confirm() which is blocked in Electron.
  function _inlineConfirm(anchorEl, message, onConfirm) {
    if (anchorEl.nextElementSibling?.dataset?.inlineConfirm) return;
    const row = document.createElement('div');
    row.dataset.inlineConfirm = '1';
    row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-top:4px;font-family:var(--font-mono);font-size:8px;color:var(--text-dim)';
    const msg = document.createElement('span'); msg.textContent = message; msg.style.flex = '1';
    const yes = document.createElement('button'); yes.className = 'btn'; yes.style.cssText = 'font-size:8px;padding:2px 8px;color:#ff4444;border-color:#ff4444'; yes.textContent = 'Delete';
    const no  = document.createElement('button'); no.className  = 'btn'; no.style.cssText  = 'font-size:8px;padding:2px 8px'; no.textContent = 'Cancel';
    row.append(msg, yes, no);
    anchorEl.insertAdjacentElement('afterend', row);
    yes.addEventListener('click', () => { row.remove(); onConfirm(); });
    no.addEventListener('click',  () => row.remove());
  }

  // Inline text-input helper — avoids prompt() which is blocked in Electron.
  // Inserts a small input row after anchorEl; calls onConfirm(value) on Enter/OK.
  function _inlineInput(anchorEl, placeholder, defaultVal, onConfirm) {
    if (anchorEl.nextElementSibling?.dataset?.inlineInput) return; // already open
    const row = document.createElement('div');
    row.dataset.inlineInput = '1';
    row.style.cssText = 'display:flex;gap:4px;margin-top:4px';
    const inp = document.createElement('input');
    inp.type = 'text'; inp.value = defaultVal || ''; inp.placeholder = placeholder;
    inp.style.cssText = 'flex:1;background:var(--bg);border:1px solid var(--border-dim);border-radius:4px;color:var(--text);font-family:var(--font-mono);font-size:9px;padding:4px 7px;outline:none';
    const ok = document.createElement('button'); ok.className = 'btn accent';
    ok.style.cssText = 'font-size:9px;padding:4px 8px;flex-shrink:0'; ok.textContent = 'OK';
    row.append(inp, ok);
    anchorEl.insertAdjacentElement('afterend', row);
    inp.focus(); inp.select();
    const done = () => { const v = inp.value.trim(); row.remove(); if (v) onConfirm(v); };
    ok.addEventListener('click', done);
    inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') done(); if (e.key === 'Escape') row.remove(); });
  }
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
    const part=_flatParts().find(p=>p.id===partId);
    if(!part)return;
    if(typeof SceneDirtyGuard!=='undefined'&&part.sceneName){
      SceneDirtyGuard.confirmSwitch(part.sceneName,()=>_doSelectPart(partId));
    } else {
      _doSelectPart(partId);
    }
  }

  function _doSelectPart(partId){
    _activePartId=partId;
    const part=_flatParts().find(p=>p.id===partId);
    if(!part)return;
    if(part.sceneName&&typeof PresetBrowser!=='undefined'){
      const preset=(PresetBrowser._getAll?PresetBrowser._getAll():[]).find(p=>p.name===part.sceneName);
      if(preset&&_setlist)_setlist.fadeToPreset(preset.data||preset);
    }
    if(part.audioUrl&&part.audioAutoPlay!==false&&_audio){
      if(_audioWatchTimer){clearInterval(_audioWatchTimer);_audioWatchTimer=null;}
      _audio.loadUrl(part.audioUrl,part.audioName||'audio').then(()=>{
        const inPt  = part.audioIn  ?? 0;
        const outPt = part.audioOut ?? 0;
        if(inPt>0) _audio._offset = inPt;
        _audio.volume = part.audioVolume ?? 1;
        _audio.loop   = !!(part.audioLoop && !(outPt>inPt));
        _audio.play();
        if(outPt>inPt){
          _audioWatchTimer=setInterval(()=>{
            if(!_audio.isPlaying){clearInterval(_audioWatchTimer);_audioWatchTimer=null;return;}
            if(_audio.currentTime>=outPt){
              if(part.audioLoop){_audio.seekTo(inPt);}
              else{_audio.pause();clearInterval(_audioWatchTimer);_audioWatchTimer=null;}
            }
          },100);
        }
      }).catch(()=>{});
    }
    _save(); _refreshUI();
    Toast.info('▶ '+part.songName+' — '+part.name);
  }

  function _save(){
    if(!_playlist)return;
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify({playlist:_playlist,activePartId:_activePartId}));}catch{}
    _broadcastState();
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

  function _refreshUI(){ if(_root)_renderRoot(); _broadcastState(); }

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

    const nameRow=document.createElement('div'); nameRow.style.cssText='display:none;gap:4px;margin-top:6px';
    const nameInput=document.createElement('input');
    nameInput.type='text'; nameInput.placeholder='e.g. Bearfeet @ Venue 2026';
    nameInput.style.cssText='flex:1;background:var(--bg);border:1px solid var(--border-dim);border-radius:4px;color:var(--text);font-family:var(--font-mono);font-size:9px;padding:4px 7px;outline:none';
    const confirmBtn=document.createElement('button'); confirmBtn.className='btn accent'; confirmBtn.style.cssText='font-size:9px;padding:4px 10px;flex-shrink:0'; confirmBtn.textContent='Create';
    nameRow.style.display='none'; nameRow.append(nameInput,confirmBtn); nameRow.style.cssText='display:none;flex-direction:row;gap:4px;margin-top:6px';

    const _doCreate=()=>{const n=nameInput.value.trim();if(!n)return;_playlist={name:n,songs:[]};_save();_refreshUI();};
    btn.addEventListener('click',()=>{btn.style.display='none';nameRow.style.display='flex';nameInput.focus();});
    confirmBtn.addEventListener('click',_doCreate);
    nameInput.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Enter')_doCreate();if(e.key==='Escape'){btn.style.display='';nameRow.style.display='none';}});

    container.appendChild(btn); container.appendChild(nameRow);
  }

  let _perfView=false;
  const _collapsedSongs = new Set(); // song IDs currently collapsed — persists across re-renders
  const _selectedSongs  = new Set(); // song IDs currently selected for bulk actions
  const SONG_COLORS = ['#e74c3c','#e67e22','#f1c40f','#2ecc71','#1abc9c','#3498db','#9b59b6','#e91e63','#ffffff'];

  function _renderPlaylist(container){
    const flat=_flatParts(),total=flat.length,activeIdx=flat.findIndex(p=>p.id===_activePartId);

    // ── Performance view toggle ───────────────────────────────────
    const perfToggle=document.createElement('button');
    perfToggle.className=`btn ${_perfView?'accent':''}`;
    perfToggle.style.cssText='width:100%;font-size:9px;margin-bottom:10px';
    perfToggle.textContent=_perfView?'✕ Exit Performance View':'⚡ Performance View';
    perfToggle.title='Flat grid of all parts for quick live navigation';
    perfToggle.addEventListener('click',()=>{_perfView=!_perfView;_refreshUI();});
    container.appendChild(perfToggle);

    if(_perfView){
      _renderPerfGrid(container,flat,activeIdx);
      return;
    }

    if(total>0){
      const prog=document.createElement('div'); prog.style.cssText='height:3px;background:var(--border-dim);border-radius:2px;margin-bottom:8px;overflow:hidden';
      const fill=document.createElement('div'); const pct=activeIdx>=0?Math.round(((activeIdx+1)/total)*100):0;
      fill.style.cssText=`height:100%;width:${pct}%;background:var(--accent);border-radius:2px;transition:width 0.3s`; prog.appendChild(fill); container.appendChild(prog);
      const info=document.createElement('div'); info.style.cssText='font-family:var(--font-mono);font-size:8px;color:var(--text-dim);margin-bottom:10px';
      info.textContent=activeIdx>=0?`Part ${activeIdx+1} of ${total} — ${_activePart()?.songName} · ${_activePart()?.name}`:`${total} parts · no selection`;
      container.appendChild(info);
    }

    // ── Bulk action bar (shown when ≥1 song is selected) ─────────────
    const _sep=()=>{const s=document.createElement('span');s.style.cssText='width:1px;height:12px;background:var(--border-dim);flex-shrink:0';return s;};
    if(_selectedSongs.size>0){
      const bar=document.createElement('div');
      bar.style.cssText='display:flex;align-items:center;gap:5px;padding:5px 8px;background:color-mix(in srgb,var(--accent) 8%,var(--bg-card));border:1px solid color-mix(in srgb,var(--accent) 25%,var(--border-dim));border-radius:5px;margin-bottom:8px;flex-wrap:wrap';
      const lbl=document.createElement('span');
      lbl.style.cssText='font-family:var(--font-mono);font-size:8px;color:var(--accent);min-width:58px';
      lbl.textContent=`${_selectedSongs.size} selected`;
      const allBtn =_tb('All',  ()=>{_playlist.songs.forEach(s=>_selectedSongs.add(s.id));_refreshUI();});
      const noneBtn=_tb('None', ()=>{_selectedSongs.clear();_refreshUI();});
      const openBtn=_tb('↓ Open',    ()=>{_selectedSongs.forEach(id=>_collapsedSongs.delete(id));_refreshUI();});
      const closeBtn=_tb('↑ Close',  ()=>{_selectedSongs.forEach(id=>_collapsedSongs.add(id));_refreshUI();});
      const colorBtn=_tb('● Color',()=>{
        const existing=bar.nextElementSibling?.dataset?.bulkPalette;
        if(existing){bar.nextElementSibling.remove();return;}
        const pal=document.createElement('div');
        pal.dataset.bulkPalette='1';
        pal.style.cssText='display:flex;gap:5px;padding:5px 8px;background:var(--bg-card);border:1px solid var(--border-dim);border-radius:5px;margin-bottom:8px;flex-wrap:wrap;align-items:center';
        SONG_COLORS.forEach(c=>{
          const sw=document.createElement('button');
          sw.style.cssText=`width:14px;height:14px;border-radius:50%;border:2px solid transparent;cursor:pointer;background:${c};padding:0;flex-shrink:0`;
          sw.addEventListener('click',()=>{_playlist.songs.forEach(s=>{if(_selectedSongs.has(s.id))s.color=c;});_save();_refreshUI();});
          pal.appendChild(sw);
        });
        const clrB=document.createElement('button');
        clrB.style.cssText='background:none;border:1px solid var(--border-dim);border-radius:3px;color:var(--text-dim);font-family:var(--font-mono);font-size:7px;padding:1px 5px;cursor:pointer';
        clrB.textContent='✕ Clear color';
        clrB.addEventListener('click',()=>{_playlist.songs.forEach(s=>{if(_selectedSongs.has(s.id))delete s.color;});_save();_refreshUI();});
        pal.appendChild(clrB);
        bar.insertAdjacentElement('afterend',pal);
      });
      const delBtn=_tb('✕ Delete',()=>_inlineConfirm(bar,`Delete ${_selectedSongs.size} song${_selectedSongs.size>1?'s':''}?`,()=>{
        _playlist.songs=_playlist.songs.filter(s=>!_selectedSongs.has(s.id));
        _selectedSongs.clear();_save();_refreshUI();
      })); delBtn.style.color='#ff4444';
      bar.append(lbl,allBtn,noneBtn,_sep(),openBtn,closeBtn,_sep(),colorBtn,_sep(),delBtn);
      container.appendChild(bar);
    }

    _playlist.songs.forEach((song,si)=>container.appendChild(_buildSong(song,si,flat)));

    const addBtn=document.createElement('button'); addBtn.className='btn'; addBtn.style.cssText='width:100%;font-size:9px;margin-top:8px;color:var(--accent)'; addBtn.textContent='+ Add song';
    addBtn.addEventListener('click',()=>_inlineInput(addBtn,'Song name','',n=>{_playlist.songs.push({id:_uid(),name:n,parts:[{id:_uid(),name:'Full song',audioUrl:null,audioName:null,sceneName:null,notes:''}]});_save();_refreshUI();}));
    container.appendChild(addBtn);

    if(total>0){
      const t=document.createElement('div'); t.style.cssText='display:flex;gap:6px;margin-top:10px';

      function _armableClick(action, fallback) {
        return function(e) {
          if (window._vaelLearnMode && window._vaelMidi) {
            e.stopPropagation();
            window._vaelMidi.startLearnGlobal(action);
            Toast.info(`Move a controller to map → ${action.replace('scene:','')}`);
            return;
          }
          fallback();
        };
      }

      const pb=document.createElement('button');
      pb.className='btn midi-armable'; pb.style.cssText='flex:1;font-size:9px';
      pb.textContent='← Prev'; pb.disabled=(!window._vaelLearnMode && activeIdx<=0);
      pb.title='Prev scene (click in MIDI Learn to arm)';
      pb.addEventListener('click', _armableClick('scene:prev', _prevPart));

      const nb=document.createElement('button');
      nb.className='btn accent midi-armable'; nb.style.cssText='flex:1;font-size:9px';
      nb.textContent='Next →'; nb.disabled=(!window._vaelLearnMode && activeIdx>=total-1);
      nb.title='Next scene (click in MIDI Learn to arm)';
      nb.addEventListener('click', _armableClick('scene:next', _nextPart));

      t.append(pb,nb); container.appendChild(t);

      // Play / Stop arm row — only shown as MIDI targets
      const t2=document.createElement('div'); t2.style.cssText='display:flex;gap:6px;margin-top:4px';

      const playBtn=document.createElement('button');
      playBtn.className='btn midi-armable'; playBtn.style.cssText='flex:1;font-size:9px';
      playBtn.textContent='▶ Play'; playBtn.title='Trigger current scene (click in MIDI Learn to arm)';
      playBtn.addEventListener('click', _armableClick('scene:play', ()=>{
        if(_activePartId) _selectPart(_activePartId);
        else { const p=_flatParts(); if(p.length>0) _selectPart(p[0].id); }
      }));

      const stopBtn=document.createElement('button');
      stopBtn.className='btn midi-armable'; stopBtn.style.cssText='flex:1;font-size:9px';
      stopBtn.textContent='⏹ Stop'; stopBtn.title='Stop playback (click in MIDI Learn to arm)';
      stopBtn.addEventListener('click', _armableClick('scene:stop', ()=>{
        if(_audio) { try { _audio.pause?.() || _audio.stop?.(); } catch(_){} }
        Toast.info('⏹ Stopped');
      }));

      t2.append(playBtn,stopBtn); container.appendChild(t2);
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
    const renameBtn=_sb('✎ Rename',()=>_inlineInput(renameBtn,_playlist.name,_playlist.name,n=>{_playlist.name=n;_save();_refreshUI();}));
    io.append(_sb('↓ Export',_exportSetlist),_sb('↑ Import',_importSetlist),renameBtn);
    const clr=_sb('✕ Clear',()=>_inlineConfirm(clr,'Delete entire setlist?',()=>{_playlist=null;_activePartId=null;_collapsedSongs.clear();_selectedSongs.clear();_save();_refreshUI();})); clr.style.color='#ff4444'; io.appendChild(clr);
    container.appendChild(io);

    const hint=document.createElement('p'); hint.style.cssText='font-family:var(--font-mono);font-size:8px;color:var(--text-dim);line-height:1.6;margin-top:8px';
    hint.innerHTML='Map MIDI buttons in <strong style="color:var(--text)">MIDI tab</strong> → Scene navigation to step through parts live';
    container.appendChild(hint);
  }

  function _renderPerfGrid(container,flat,activeIdx){
    // Progress bar
    if(flat.length>0){
      const prog=document.createElement('div'); prog.style.cssText='height:2px;background:var(--border-dim);border-radius:2px;margin-bottom:8px;overflow:hidden';
      const fill=document.createElement('div'); const pct=activeIdx>=0?Math.round(((activeIdx+1)/flat.length)*100):0;
      fill.style.cssText=`height:100%;width:${pct}%;background:var(--accent);border-radius:2px;transition:width 0.3s`; prog.appendChild(fill); container.appendChild(prog);
    }

    // Flat numbered setlist — color strip · number · name
    const list=document.createElement('div');
    list.style.cssText='display:flex;flex-direction:column;gap:1px';

    flat.forEach((p,i)=>{
      const isAct=p.id===_activePartId;
      const song=_playlist.songs.find(s=>s.id===p.songId);
      const clr=song?.color||null;

      const row=document.createElement('div');
      row.style.cssText=`display:flex;align-items:center;gap:0;border-radius:4px;overflow:hidden;cursor:pointer;background:${isAct?'color-mix(in srgb,var(--accent) 12%,var(--bg-card))':'transparent'};transition:background 0.1s`;

      // Color strip
      const strip=document.createElement('div');
      strip.style.cssText=`width:3px;align-self:stretch;flex-shrink:0;background:${clr||'transparent'}`;

      // Number
      const num=document.createElement('span');
      num.style.cssText=`font-family:var(--font-mono);font-size:8px;color:${isAct?'var(--accent)':'var(--text-dim)'};min-width:26px;text-align:right;padding:6px 6px 6px 5px;flex-shrink:0`;
      num.textContent=i+1;

      // Play arrow — visible only on active
      const arrow=document.createElement('span');
      arrow.style.cssText=`font-size:7px;color:var(--accent);flex-shrink:0;width:10px;opacity:${isAct?1:0}`;
      arrow.textContent='▶';

      // Name — show song name when part is the default "Full song"
      const displayName=p.name==='Full song'?p.songName:`${p.songName} · ${p.name}`;
      const name=document.createElement('span');
      name.style.cssText=`font-family:var(--font-mono);font-size:9px;flex:1;padding:6px 8px 6px 2px;color:${isAct?'var(--accent)':'var(--text)'};font-weight:${isAct?600:400};white-space:nowrap;overflow:hidden;text-overflow:ellipsis`;
      name.textContent=displayName;

      row.append(strip,num,arrow,name);
      row.addEventListener('click',()=>_selectPart(p.id));
      row.addEventListener('mouseenter',()=>{if(!isAct)row.style.background='var(--bg-card)';});
      row.addEventListener('mouseleave',()=>{if(!isAct)row.style.background='transparent';});
      list.appendChild(row);

      // Scroll active item into view after render
      if(isAct) requestAnimationFrame(()=>row.scrollIntoView({block:'nearest',behavior:'smooth'}));
    });

    container.appendChild(list);

    // Nav controls
    if(flat.length>0){
      const t=document.createElement('div'); t.style.cssText='display:flex;gap:6px;margin-top:10px';
      function _armableClick(action,fallback){return function(e){if(window._vaelLearnMode&&window._vaelMidi){e.stopPropagation();window._vaelMidi.startLearnGlobal(action);Toast.info(`Move a controller to map → ${action.replace('scene:','')}`);return;}fallback();};}
      const pb=document.createElement('button'); pb.className='btn midi-armable'; pb.style.cssText='flex:1;font-size:9px'; pb.textContent='← Prev'; pb.disabled=(!window._vaelLearnMode&&activeIdx<=0); pb.addEventListener('click',_armableClick('scene:prev',_prevPart));
      const nb=document.createElement('button'); nb.className='btn accent midi-armable'; nb.style.cssText='flex:1;font-size:9px'; nb.textContent='Next →'; nb.disabled=(!window._vaelLearnMode&&activeIdx>=flat.length-1); nb.addEventListener('click',_armableClick('scene:next',_nextPart));
      t.append(pb,nb); container.appendChild(t);
    }
  }

  function _buildSong(song,si,flat){
    const hasActive=song.parts.some(p=>p.id===_activePartId);
    const card=document.createElement('div');
    card.draggable=true;
    card.dataset.si=si;
    const _lbClr = song.color || (hasActive ? 'var(--accent)' : 'var(--border-dim)');
    card.style.cssText=`border:1px solid ${hasActive?'var(--accent)':'var(--border-dim)'};border-left:3px solid ${_lbClr};border-radius:6px;margin-bottom:6px;overflow:hidden;cursor:grab`;

    // Drag to reorder songs
    card.addEventListener('dragstart',e=>{e.dataTransfer.setData('song-idx',String(si));card.style.opacity='0.4';});
    card.addEventListener('dragend',()=>{card.style.opacity='1';});
    card.addEventListener('dragover',e=>{e.preventDefault();card.style.borderColor='var(--accent)';});
    card.addEventListener('dragleave',()=>{card.style.borderColor=hasActive?'var(--accent)':'var(--border-dim)';card.style.borderLeftColor=_lbClr;});
    card.addEventListener('drop',e=>{
      e.preventDefault(); card.style.borderColor=hasActive?'var(--accent)':'var(--border-dim)';card.style.borderLeftColor=_lbClr;
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
      inp.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Enter'){e.preventDefault();inp.blur();}if(e.key==='Escape'){_refreshUI();}});
    });

    const partCount=document.createElement('span');
    partCount.style.cssText='font-family:var(--font-mono);font-size:8px;color:var(--text-dim);flex-shrink:0';
    partCount.textContent=song.parts.length+'p';

    // Color dot — click to open inline color palette
    const colorDot=document.createElement('button');
    colorDot.title='Set song color';
    colorDot.style.cssText=`width:12px;height:12px;border-radius:50%;border:1px solid var(--border-dim);padding:0;cursor:pointer;flex-shrink:0;background:${song.color||'transparent'};outline:none`;
    colorDot.addEventListener('click',e=>{
      e.stopPropagation();
      const existing=card.querySelector('[data-color-palette]');
      if(existing){existing.remove();return;}
      const palette=document.createElement('div');
      palette.dataset.colorPalette='1';
      palette.style.cssText='display:flex;gap:5px;padding:5px 10px;background:var(--bg-card);border-top:1px solid var(--border-dim);flex-wrap:wrap;align-items:center';
      SONG_COLORS.forEach(c=>{
        const sw=document.createElement('button');
        sw.style.cssText=`width:14px;height:14px;border-radius:50%;border:2px solid ${c===song.color?'white':'transparent'};cursor:pointer;background:${c};flex-shrink:0;padding:0`;
        sw.addEventListener('click',ev=>{ev.stopPropagation();song.color=c;_save();_refreshUI();});
        palette.appendChild(sw);
      });
      const clrBtn=document.createElement('button');
      clrBtn.style.cssText='background:none;border:1px solid var(--border-dim);border-radius:3px;color:var(--text-dim);font-family:var(--font-mono);font-size:7px;padding:1px 5px;cursor:pointer';
      clrBtn.textContent='✕ Clear';
      clrBtn.addEventListener('click',ev=>{ev.stopPropagation();delete song.color;_save();_refreshUI();});
      palette.appendChild(clrBtn);
      sh.insertAdjacentElement('afterend',palette);
      setTimeout(()=>{
        const _close=ev=>{if(!palette.contains(ev.target)&&ev.target!==colorDot){palette.remove();document.removeEventListener('click',_close);}};
        document.addEventListener('click',_close);
      },0);
    });
    const cb=document.createElement('input');
    cb.type='checkbox'; cb.checked=_selectedSongs.has(song.id);
    cb.style.cssText='flex-shrink:0;cursor:pointer;accent-color:var(--accent);width:11px;height:11px;margin:0';
    cb.addEventListener('click',e=>e.stopPropagation());
    cb.addEventListener('change',()=>{cb.checked?_selectedSongs.add(song.id):_selectedSongs.delete(song.id);_refreshUI();});
    sh.append(cb,grip,arrow,nameSpan,partCount,colorDot);

    const pb=document.createElement('div');
    let ex=!_collapsedSongs.has(song.id);
    pb.style.display=ex?'block':'none';
    arrow.style.transform=ex?'rotate(90deg)':'rotate(0deg)';
    sh.addEventListener('click',e=>{
      if(e.target===nameSpan||e.target.tagName==='INPUT'||e.target===colorDot||e.target.closest?.('[data-color-palette]'))return;
      ex=!ex;
      ex?_collapsedSongs.delete(song.id):_collapsedSongs.add(song.id);
      pb.style.display=ex?'block':'none';
      sh.querySelector('.sa').style.transform=ex?'rotate(90deg)':'rotate(0deg)';
    });
    card.appendChild(sh);

    song.parts.forEach((p,pi)=>pb.appendChild(_buildPart(p,pi,song,flat)));

    // Song actions — inside collapsible body so they hide when song is collapsed
    const sa=document.createElement('div'); sa.style.cssText='display:flex;gap:4px;padding:4px 10px 5px;background:var(--bg-card);border-top:1px solid var(--border-dim)';
    const dl=_tb('✕ Delete song',()=>_inlineConfirm(dl,'Delete "'+song.name+'" and all parts?',()=>{_playlist.songs.splice(si,1);_save();_refreshUI();})); dl.style.color='#ff4444';
    const ap=_tb('+ Add part',()=>_inlineInput(ap,'Part name (e.g. Intro, Verse)','',n=>{song.parts.push({id:_uid(),name:n,audioUrl:null,audioName:null,sceneName:null,notes:''});_save();_refreshUI();})); ap.style.color='var(--accent)';
    sa.append(dl,ap); pb.appendChild(sa);

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
      inp.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Enter'){e.preventDefault();inp.blur();}if(e.key==='Escape'){_refreshUI();}});
    });

    const audioIcon=document.createElement('span');
    audioIcon.title='Audio'+(part.audioUrl?' — '+part.audioName:' — not set');
    audioIcon.style.cssText=`font-size:9px;opacity:${part.audioUrl?1:0.2};color:var(--accent2);flex-shrink:0`;
    audioIcon.textContent='♪';

    // Scene name badge — shown when a scene is linked
    const sceneTag=document.createElement('span');
    if(part.sceneName){
      sceneTag.style.cssText='font-family:var(--font-mono);font-size:7px;color:var(--accent);background:color-mix(in srgb,var(--accent) 12%,transparent);border:1px solid color-mix(in srgb,var(--accent) 30%,transparent);border-radius:3px;padding:1px 5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:80px;flex-shrink:0';
      sceneTag.textContent=part.sceneName;
      sceneTag.title='Scene: '+part.sceneName;
    }

    const eb=document.createElement('button');
    eb.style.cssText='background:none;border:1px solid var(--border-dim);border-radius:3px;color:var(--text-dim);font-family:var(--font-mono);font-size:7px;padding:2px 6px;cursor:pointer;flex-shrink:0';
    eb.textContent='Edit'; eb.title='Edit this part (audio, scene, notes)';
    eb.addEventListener('click',e=>{e.stopPropagation();_partEditor(part,song,pi);});

    row.append(numSpan,playSpan,nameSpan,audioIcon);
    if(part.sceneName) row.appendChild(sceneTag);
    row.appendChild(eb);
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
        ${part.audioUrl?`
        <div style="background:var(--bg-card);border:1px solid var(--border-dim);border-radius:6px;padding:10px">
          <div style="font-size:8px;color:var(--text-dim);margin-bottom:9px;text-transform:uppercase;letter-spacing:1px">Audio settings</div>
          <div style="margin-bottom:9px">
            <div style="font-size:7px;color:var(--text-dim);margin-bottom:3px;display:flex;justify-content:space-between">
              <span>Volume</span><span id="avd">${Math.round((part.audioVolume??1)*100)}%</span>
            </div>
            <input id="av" type="range" min="0" max="1.5" step="0.01" value="${part.audioVolume??1}" style="width:100%;accent-color:var(--accent)">
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:9px">
            <div>
              <div style="font-size:7px;color:var(--text-dim);margin-bottom:3px">Start at (s)</div>
              <input id="ain" type="number" min="0" step="0.1" value="${part.audioIn??0}" style="width:100%;background:var(--bg);border:1px solid var(--border-dim);border-radius:4px;color:var(--text);font-family:var(--font-mono);font-size:9px;padding:5px 6px;box-sizing:border-box">
            </div>
            <div>
              <div style="font-size:7px;color:var(--text-dim);margin-bottom:3px">Stop at (s, 0 = end)</div>
              <input id="aout" type="number" min="0" step="0.1" value="${part.audioOut??0}" style="width:100%;background:var(--bg);border:1px solid var(--border-dim);border-radius:4px;color:var(--text);font-family:var(--font-mono);font-size:9px;padding:5px 6px;box-sizing:border-box">
            </div>
          </div>
          <div style="display:flex;gap:16px">
            <label style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim);display:flex;align-items:center;gap:5px;cursor:pointer">
              <input id="alp" type="checkbox" ${part.audioLoop?'checked':''}> Loop
            </label>
            <label style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim);display:flex;align-items:center;gap:5px;cursor:pointer">
              <input id="aap" type="checkbox" ${part.audioAutoPlay!==false?'checked':''}> Auto-play on activate
            </label>
          </div>
        </div>`:''}
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

    m.querySelector('#av')?.addEventListener('input',e=>{m.querySelector('#avd').textContent=Math.round(e.target.value*100)+'%';});
    m.querySelectorAll('input,textarea,select').forEach(el=>el.addEventListener('keydown',e=>e.stopPropagation()));
    m.querySelector('#mu')?.addEventListener('click',()=>{if(pi>0){[song.parts[pi-1],song.parts[pi]]=[song.parts[pi],song.parts[pi-1]];_save();close();_refreshUI();}});
    m.querySelector('#md')?.addEventListener('click',()=>{if(pi<song.parts.length-1){[song.parts[pi],song.parts[pi+1]]=[song.parts[pi+1],song.parts[pi]];_save();close();_refreshUI();}});
    m.querySelector('#dl')?.addEventListener('click',e=>{if(song.parts.length===1){Toast.warn('A song needs at least one part.');return;}_inlineConfirm(e.currentTarget,'Delete part "'+part.name+'"?',()=>{song.parts.splice(pi,1);if(_activePartId===part.id)_activePartId=null;_save();close();_refreshUI();});});
    m.querySelector('#sv').addEventListener('click',()=>{
      part.name=m.querySelector('#pn').value.trim()||part.name;
      part.sceneName=m.querySelector('#ps').value||null;
      part.notes=m.querySelector('#nt').value;
      if(part.audioUrl){
        part.audioVolume   = parseFloat(m.querySelector('#av')?.value)??1;
        part.audioIn       = parseFloat(m.querySelector('#ain')?.value)||0;
        part.audioOut      = parseFloat(m.querySelector('#aout')?.value)||0;
        part.audioLoop     = m.querySelector('#alp')?.checked??false;
        part.audioAutoPlay = m.querySelector('#aap')?.checked??true;
      }
      _save();close();_refreshUI();Toast.success('Part updated');
    });
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
      try{const j=JSON.parse(await f.text());if(j.version>=2&&j.playlist){_playlist=j.playlist;_activePartId=null;_collapsedSongs.clear();_selectedSongs.clear();_save();_refreshUI();Toast.success('Setlist "'+_playlist.name+'" imported — '+_flatParts().length+' parts');}else Toast.error('Unrecognised setlist format');}
      catch{Toast.error('Could not read setlist file');}
    }); inp.click();
  }

  function _sb(l,fn){const b=document.createElement('button');b.className='btn';b.style.cssText='font-size:8px;padding:3px 8px;color:var(--text-dim)';b.textContent=l;b.addEventListener('click',fn);return b;}
  function _tb(l,fn,t=''){const b=document.createElement('button');b.style.cssText='background:none;border:1px solid var(--border-dim);border-radius:3px;color:var(--text-dim);font-family:var(--font-mono);font-size:7px;padding:2px 5px;cursor:pointer';b.textContent=l;b.title=t;b.addEventListener('click',e=>{e.stopPropagation();fn();});return b;}

  function renameScene(oldName, newName) {
    if (!_playlist || !oldName || !newName || oldName === newName) return;
    let changed = false;
    _playlist.songs.forEach(s => s.parts.forEach(p => {
      if (p.sceneName === oldName) { p.sceneName = newName; changed = true; }
    }));
    if (changed) { _save(); _refreshUI(); }
  }

  // ── Setlist monitor broadcast ──────────────────────────────────
  // Opens a BroadcastChannel so an external setlist-monitor.html window
  // (on a different display) can receive live state and send navigation back.
  const _monitorCh = new BroadcastChannel('vael-setlist');

  function _broadcastState() {
    if (!_playlist) return;
    _monitorCh.postMessage({ type: 'state', playlist: _playlist, activePartId: _activePartId });
  }

  _monitorCh.onmessage = (e) => {
    const msg = e.data;
    if (msg.type === 'navigate' && msg.partId)  { _selectPart(msg.partId); return; }
    if (msg.type === 'next')                     { _nextPart(); return; }
    if (msg.type === 'prev')                     { _prevPart(); return; }
    if (msg.type === 'request-state')            { _broadcastState(); return; }
  };

  return { init, renameScene };
})();
