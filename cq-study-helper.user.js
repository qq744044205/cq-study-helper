// ==UserScript==
// @name         重庆培训网学习助手（开源播放版）
// @namespace    https://example.org/cq-study-helper
// @version      0.4.4
// @description  在课程页面自动尝试播放视频，并在结束时提示下一章节。
// @match        https://cqrl.21tb.com/*
// @match        https://www.cqrspx.cn/*
// @noframes
// @grant        none
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

(() => {
  'use strict';
  if (window.top !== window.self) return;
  const KEY = 'open_cq_study_enabled';
  let enabled = localStorage.getItem(KEY) === '1';
  const watched = new WeakSet();
  let lastAttempt = 0;
  let status, stateLabel, startButton, stopButton, videoLabel, positionLabel, bar;
  let currentVideo = null;
  let finishingCourse=false;
  let lastNextAttempt=0;
  let strictMode = localStorage.getItem('open_cq_strict_mode') === '1';
  let alertText = '';
  let dismissedAlert = '';
  let alertTimer = 0;

  let logBox, currentCourseLabel, currentChapterLabel, lastLogged='';
  function setStatus(message) {
    if (status) status.textContent = message;
    if (message !== lastLogged) { lastLogged=message; appendLog(message); }
  }
  function appendLog(message) {
    if (!logBox) return;
    const row=document.createElement('div'); row.className='chapter small';
    row.textContent=`${new Date().toLocaleTimeString('zh-CN', {hour12:false})} ${message}`;
    logBox.prepend(row); while(logBox.children.length>50) logBox.lastChild.remove();
  }
  function currentCourseId() {
    const m=location.pathname.match(/\/courseSetting\/coursePlay\/(.+)/);
    if (!m) return '';
    try { return decodeURIComponent(m[1]).split('&')[0]; } catch (_) { return ''; }
  }
  function currentChapterName() {
    if (!currentVideo) return '未识别';
    const explicit=currentVideo.getAttribute('title') || currentVideo.getAttribute('aria-label') || currentVideo.dataset.resourceName || currentVideo.dataset.chapterName;
    if (explicit && explicit.trim()) return explicit.trim();
    const doc=currentVideo.ownerDocument;
    const params=new URLSearchParams(doc.location.search + '&' + doc.location.hash.replace(/^#.*?\?/,''));
    const id=params.get('resourceId') || params.get('resourceRelId');
    if(id) {
      for(const detail of catalog.details.values()) { const resource=detail.resources?.find(r=>r.id===id); if(resource?.name) return resource.name; }
    }
    const selectors=['[data-resource-id][aria-current="true"]','[data-resource-id][aria-selected="true"]','[data-resource-id].active','[data-chapter-id][aria-current="true"]','[data-chapter-id][aria-selected="true"]','[data-chapter-id].active','.chapter-item.active','.chapter-item.current','.resource-item.active','.resource-item.current'];
    for(const selector of selectors) {
      const item=doc.querySelector(selector);
      if(!item) continue;
      const name=item.dataset.resourceName || item.dataset.chapterName || item.getAttribute('title') || item.textContent;
      if(name && name.trim()) return name.trim().replace(/\s+/g,' ').slice(0,120);
    }
    return '未识别';
  }
  function updateCurrent() {
    const id=currentCourseId(), c=catalog.queue.find(x=>x.id===id) || catalog.courses.find(x=>x.id===id);
    if(currentCourseLabel) currentCourseLabel.textContent=c?.name || (id ? '当前课程' : '无');
    if(currentChapterLabel) currentChapterLabel.textContent=currentChapterName();
  }
  function updateControls() {
    stateLabel.textContent = alertText ? '需要处理提示' : enabled ? (strictMode ? '正常速度' : '运行中') : '已停止';
    stateLabel.classList.toggle('active', enabled);
    startButton.disabled = false;
    startButton.textContent = currentVideo && !currentVideo.paused && !currentVideo.ended ? '▶ 正在播放' : currentVideo ? '▶ 开始播放' : '▶ 打开所选课程';
    stopButton.disabled = !enabled;
  }
  function setEnabled(value) {
    if (value && alertText) { setStatus('请先处理平台提示，再点击开始'); return; }
    enabled = value;
    localStorage.setItem(KEY, value ? '1' : '0');
    updateControls();
    setStatus(value ? '正在寻找视频' : '自动播放已停止');
    if (value) scan();
  }
  function formatTime(seconds) {
    if (!Number.isFinite(seconds)) return '--:--';
    const n = Math.floor(seconds);
    return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
  }
  function updateVideo(video) {
    currentVideo = video;
    if (video) video.title && (videoLabel.title = video.title);
    renderStats();
    if (startButton) updateControls();
    updateCurrent();
  }
  function mount() {
    if (!document.body || document.getElementById('open-cq-helper')) return;
    const host = document.createElement('div');
    host.id = 'open-cq-helper';
    Object.assign(host.style, {position:'fixed', right:'16px', bottom:'16px', zIndex:'2147483647'});
    const root = host.attachShadow({mode:'open'});
    root.innerHTML = `<style>
      *{box-sizing:border-box} .panel{width:360px;max-width:calc(100vw - 24px);color:#172b4d;background:#f3f6fb;border:1px solid #cbdaf0;border-radius:14px;box-shadow:0 8px 28px #213b5d38;font:13px/1.45 system-ui,sans-serif;overflow:hidden}
      header{display:flex;align-items:center;gap:10px;padding:12px;background:linear-gradient(110deg,#fff6e6,#f9eacc);cursor:move;user-select:none;touch-action:none} .logo{width:36px;height:36px;border-radius:12px;display:grid;place-items:center;background:white;font-size:21px;box-shadow:0 1px 5px #0002} .heading{flex:1;min-width:0} .title{font-size:15px;font-weight:800;color:#9a3412} .badge{display:inline-block;margin-left:4px;padding:1px 5px;background:#e9f1fb;color:#4a6380;border-radius:5px;font-size:10px} .subtitle{font-size:11px;color:#596b80;margin-top:3px} .min{border:0;background:#fff;border-radius:50%;width:28px;height:28px;font-size:18px;color:#61758d;cursor:pointer}
      .body{padding:8px;display:grid;gap:7px} .card{background:white;border:1px solid #d4e1f1;border-radius:10px;padding:10px} .row{display:flex;justify-content:space-between;gap:12px;align-items:center} .label{color:#7186a2} .state{border:1px solid #d9e3ef;border-radius:16px;padding:1px 8px;color:#6b7789;font-weight:700;font-size:11px} .state.active{color:#16a34a;border-color:#bbebca} .progress{height:6px;margin-top:8px;border-radius:8px;background:#e2eaf5;overflow:hidden}.progress span{display:block;height:100%;width:0;background:linear-gradient(90deg,#2563eb,#0ea5e9);transition:width .3s}
      .detail{margin-top:7px}.detail span:last-child{text-align:right;font-weight:600}.actions{display:flex;gap:8px}.actions button{flex:1;border:0;border-radius:8px;padding:9px;color:white;font-weight:700;cursor:pointer}.start{background:#16a34a}.stop{background:#ef4444}.actions button:disabled{background:#cbd5e1;color:#718096;cursor:default}.notice{background:#fff8e8;border-color:#fbd69a;color:#845c22;font-size:12px}.collapsed .body{display:none}.collapsed .min{transform:rotate(45deg)}
    </style><div class="panel"><header><div class="logo">📚</div><div class="heading"><div class="title">重庆培训网学习助手 <span class="badge">v0.4.4</span></div><div class="subtitle">视频播放 · 学习状态</div></div><button class="min" type="button" title="收起或展开" aria-label="收起或展开">−</button></header><div class="body"><section class="card"><div class="row"><span class="label">运行状态</span><span class="state"></span></div><div class="row detail"><span class="video"></span><span class="position"></span></div><div class="progress"><span></span></div></section><section class="card"><div class="row"><span class="label">当前课程</span><span class="current-course">无</span></div><div class="row detail"><span class="label">当前章节</span><span class="current-chapter">无</span></div><div class="row detail"><span class="label">当前任务</span><span class="status"></span></div></section><section class="card actions"><button class="start" type="button">▶ 开始</button><button class="stop" type="button">■ 停止</button></section><section class="card notice">视频结束后尝试点击平台的“下一节”；课程完成后尝试打开队列中的下一门。</section></div></div>`;
    document.body.appendChild(host);
    const panel = root.querySelector('.panel');
    status = root.querySelector('.status'); currentCourseLabel=root.querySelector('.current-course'); currentChapterLabel=root.querySelector('.current-chapter'); stateLabel = root.querySelector('.state');
    startButton = root.querySelector('.start'); stopButton = root.querySelector('.stop');
    videoLabel = root.querySelector('.video'); positionLabel = root.querySelector('.position'); bar = root.querySelector('.progress span');
    startButton.addEventListener('click', () => {
      if (alertText) { setStatus('请先处理平台提示，再点击开始'); return; }
      if (!currentVideo) {
        const selected = catalog.queue[0];
        if (!selected) { setStatus('请先勾选课程'); return; }
        setEnabled(true);
        setStatus('正在打开所选课程');
        location.assign('https://cqrl.21tb.com/courseSetting/coursePlay/' + encodeURIComponent(selected.id + '&cqrl&' + selected.id));
        return;
      }
      setEnabled(true);
      lastAttempt = 0;
      scan();
    });
    stopButton.addEventListener('click', () => setEnabled(false));
    try { const pos=JSON.parse(localStorage.getItem('open_cq_panel_pos') || 'null'); if(pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {host.style.left=`${Math.max(0,Math.min(innerWidth-40,pos.x))}px`;host.style.top=`${Math.max(0,Math.min(innerHeight-40,pos.y))}px`;host.style.right='auto';host.style.bottom='auto';} } catch (_) {}
    panel.classList.toggle('collapsed',localStorage.getItem('open_cq_panel_collapsed')==='1');
    root.querySelector('.min').addEventListener('click', () => { panel.classList.toggle('collapsed'); localStorage.setItem('open_cq_panel_collapsed',panel.classList.contains('collapsed')?'1':'0'); });
    const header = root.querySelector('header');
    header.addEventListener('pointerdown', event => {
      if (event.target.closest('button')) return;
      const rect = host.getBoundingClientRect();
      const dx = event.clientX - rect.left, dy = event.clientY - rect.top;
      host.style.left = `${rect.left}px`; host.style.top = `${rect.top}px`;
      host.style.right = 'auto'; host.style.bottom = 'auto';
      header.setPointerCapture(event.pointerId);
      const move = e => {
        host.style.left = `${Math.max(0, Math.min(window.innerWidth - host.offsetWidth, e.clientX - dx))}px`;
        host.style.top = `${Math.max(0, Math.min(window.innerHeight - header.offsetHeight, e.clientY - dy))}px`;
      };
      const end = () => { localStorage.setItem('open_cq_panel_pos',JSON.stringify({x:host.offsetLeft,y:host.offsetTop})); header.removeEventListener('pointermove', move); header.removeEventListener('pointerup', end); header.removeEventListener('pointercancel', end); };
      header.addEventListener('pointermove', move); header.addEventListener('pointerup', end); header.addEventListener('pointercancel', end);
    });
    installCoursePanel(root);
    updateControls(); updateVideo(null);
    setStatus(enabled ? '正在寻找视频' : '自动播放已停止');
  }
  function findVideos(doc, visited = new Set()) {
    if (visited.has(doc)) return [];
    visited.add(doc);
    const videos = [...doc.querySelectorAll('video')];
    for (const frame of doc.querySelectorAll('iframe')) {
      try { if (frame.contentDocument) videos.push(...findVideos(frame.contentDocument, visited)); } catch (_) { /* Cross-origin frames are inaccessible. */ }
    }
    return videos;
  }
  function scan() {
    const videos = findVideos(document);
    const video = videos.find(v => !v.ended) || videos[0] || null;
    updateVideo(video);
    if (!enabled) return;
    if (!video) { setStatus('请打开课程播放页'); return; }
    if (strictMode && video.playbackRate !== 1) video.playbackRate = 1;
    if (!watched.has(video)) {
      watched.add(video);
      video.addEventListener('ended', () => { if (enabled && video === currentVideo) void handleVideoEnded(); });
      video.addEventListener('playing', () => { if (enabled && video === currentVideo) { setStatus('正在播放'); updateControls(); } });
    }
    if (video.ended) { if(Date.now()-lastNextAttempt>15000) void handleVideoEnded(); return; }
    if (!video.paused) setStatus('正在播放');
    if (video.paused && Date.now() - lastAttempt > 5000) {
      lastAttempt = Date.now();
      const result = video.play();
      if (result && typeof result.catch === 'function') result.catch(() => setStatus('请手动点击视频播放'));
    }
  }

  function isVisible(element) {
    if (!element.isConnected || !element.getClientRects().length) return false;
    const style=element.ownerDocument.defaultView.getComputedStyle(element);
    return style.display!=='none' && style.visibility!=='hidden' && Number(style.opacity)!==0;
  }
  function platformAlert() {
    const selectors='[role="alert"], [role="alertdialog"], [role="dialog"], .el-message-box, .el-notification, .ant-modal, .ant-notification-notice, .layui-layer-dialog, .modal-dialog';
    const docs=new Set([document]);
    for(const v of findVideos(document)) docs.add(v.ownerDocument);
    for(const doc of docs) for(const element of doc.querySelectorAll(selectors)) {
      if (!isVisible(element)) continue;
      const text=(element.innerText || element.textContent || '').replace(/\s+/g,' ').trim();
      if(text && text.length<=500 && /学习异常|行为异常|异常行为|学习行为.{0,12}异常|请按要求学习|学习进度异常|防刷|学霸君/.test(text)) return text;
    }
    return '';
  }
  function checkPlatformAlerts() {
    const found=platformAlert();
    if (!found) { if(alertText) {alertText='';updateControls();setStatus('平台提示已关闭，请手动点击开始继续');} dismissedAlert=''; return; }
    if (found===alertText || found===dismissedAlert) return;
    alertText=found; strictMode=true; localStorage.setItem('open_cq_strict_mode','1');
    enabled=false; localStorage.setItem(KEY,'0');
    if(currentVideo) {try {currentVideo.playbackRate=1;currentVideo.pause();} catch (_) {}}
    updateControls(); setStatus(`检测到平台提示：${found.slice(0,100)}；已暂停，请处理后手动继续`);
  }
  function watchPlatformAlerts() {
    const observe=()=>{
      clearTimeout(alertTimer);
      alertTimer=setTimeout(checkPlatformAlerts,250);
    };
    const observer=new MutationObserver(observe);
    observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style','hidden','aria-hidden']});
    setInterval(checkPlatformAlerts,5000);
    checkPlatformAlerts();
  }

  function findNextButton() {
    const docs=new Set([document]);
    for(const video of findVideos(document)) docs.add(video.ownerDocument);
    for(const doc of docs) for(const el of doc.querySelectorAll('button, a, [role="button"], input[type="button"]')) {
      const text=String(el.innerText || el.value || el.getAttribute('aria-label') || '').replace(/\s+/g,'').trim();
      if(!/^(下一节|下一章节|下一个章节)$/.test(text)) continue;
      if(!isVisible(el) || el.disabled || el.getAttribute('aria-disabled')==='true') continue;
      return el;
    }
    return null;
  }
  async function handleVideoEnded() {
    if(finishingCourse || !enabled || alertText) return;
    finishingCourse=true;
    lastNextAttempt=Date.now();
    try {
      for(let i=0;i<5 && enabled && !alertText;i++) {
        const nextButton=findNextButton();
        if(nextButton) {
          setStatus('正在打开下一节');
          nextButton.click();
          lastAttempt=0;
          return;
        }
        await new Promise(resolve=>setTimeout(resolve,1000));
      }
      if(!enabled || alertText) return;
      const id=currentCourseId();
      if (!id) {setStatus('视频结束，请选择下一章节');return;}
      setStatus('视频结束，正在核对平台课程进度');
      let rate=0;
      for(let i=0;i<3 && enabled;i++) {
        try {const raw=unpack(await rms('/tbc-rms/record/getStudyRate',id)); rate=Number(raw); if(Number.isFinite(rate) && rate>=99.5) break;} catch (_) {}
        if(i<2) await new Promise(resolve=>setTimeout(resolve,3000));
      }
      if(!enabled) return;
      if(!(rate>=99.5)) {setStatus('视频结束，请在平台选择下一章节');return;}
      const index=catalog.queue.findIndex(c=>c.id===id);
      const next=index>=0 ? catalog.queue[index+1] : null;
      if(!next) {setStatus('平台已确认课程完成，队列没有下一门');return;}
      setStatus(`课程完成，正在打开：${next.name}`);
      location.assign('https://cqrl.21tb.com/courseSetting/coursePlay/'+encodeURIComponent(next.id+'&cqrl&'+next.id));
    } finally {finishingCourse=false;}
  }

  // All catalog requests go to the current platform origin and use its login session.
  const catalog = { projects: [], stages: [], courses: [], details: new Map(), queue: readQueue(), generation: 0, kind:'all' };
  function readQueue() {
    try { const v = JSON.parse(localStorage.getItem('open_cq_course_queue') || '[]'); return Array.isArray(v) ? v.filter(x => x && x.id && x.name) : []; }
    catch (_) { return []; }
  }
  function saveQueue() { localStorage.setItem('open_cq_course_queue', JSON.stringify(catalog.queue)); }
  function unpack(data) { return data?.bizResult ?? data?.result ?? data?.data ?? data; }
  function listOf(data, keys) {
    if (Array.isArray(data)) return data;
    for (const k of keys) if (Array.isArray(data?.[k])) return data[k];
    const unwrapped = unpack(data);
    if (unwrapped !== data) return listOf(unwrapped, keys);
    return [];
  }
  let cachedSid = '';
  function sid() {
    const match = document.cookie.match(/(?:^|;\s*)eln_session_id=([^;]*)/);
    const url = new URLSearchParams(location.search).get('eln_session_id');
    const hash = (location.hash + location.search).match(/eln_session_id=([^&]+)/);
    try { return cachedSid || decodeURIComponent(match?.[1] || url || hash?.[1] || ''); } catch (_) { return ''; }
  }
  async function request(path, params, body) {
    if (location.hostname !== 'cqrl.21tb.com') throw new Error('请在 cqrl.21tb.com 登录后加载课程');
    const u = new URL(path, location.origin);
    if (params) Object.entries(params).forEach(([k,v]) => u.searchParams.set(k, String(v)));
    const options = { credentials: 'include', headers: { Accept: 'application/json' } };
    if (body) { options.method = 'POST'; options.headers['Content-Type'] = 'application/json'; options.headers['-local'] = 'zh_CN'; options.body = JSON.stringify(body); }
    const response = await fetch(u, options);
    if (!response.ok) throw new Error(`平台请求失败（${response.status}）`);
    const text = await response.text();
    try { return JSON.parse(text); } catch (_) { if (path.includes('provider.elnSessionId.do') && !text.includes('<')) return text; throw new Error('平台未返回课程数据，请确认已登录'); }
  }
  async function nms(path, params = {}) {
    if (!sid()) {
      try {
        const result = await request('/nms/html/login/provider.elnSessionId.do', {corpCode:'cqrl'});
        const value = typeof result === 'string' ? result : result?.elnSessionId || result?.eln_session_id || result?.data || result?.result;
        if (typeof value === 'string') cachedSid = value.trim();
      } catch (_) { /* Existing cookie-based authentication may still work. */ }
    }
    return request(path, { corpCode:'cqrl', eln_session_id:sid(), ...params });
  }
  async function catalogProjects() {
    const tree = await request('/nms/html/courseStudy/loadCategroyTree.do', {corpCode:'cqrl', eln_session_id:sid()}, {});
    const data = unpack(tree);
    const roots = Array.isArray(data) ? data : data?.children ? [data] : [];
    const people = roots[0]?.children?.length ? roots[0].children : roots;
    const pairs = [];
    for (const person of people) {
      if (!person?.id || !Array.isArray(person.children)) continue;
      for (const category of person.children) if (category?.id) pairs.push({oneCategoryId:person.id,twoCategoryId:category.id, label:String(category.text || category.name || category.title || '')});
    }
    if (!pairs.length) throw new Error('平台未返回项目分类，请回到培训项目页后重试');
    const results = await Promise.allSettled(pairs.map(pair => nms('/nms/html/courseStudy/loadCoursePage.do', {oneCategoryId:pair.oneCategoryId,twoCategoryId:pair.twoCategoryId,assignType:'BUY',projectName:'',pageNo:1,pageSize:100})));
    const projects = [];
    for (const [i,result] of results.entries()) if (result.status === 'fulfilled') for (const x of listOf(result.value,['rows','list'])) {
      const id=String(x.roadMapId || x.rmRoadMapId || '');
      if (id) projects.push({id,name:String(x.projectName || x.name || x.title || x.roadMapName || '未命名项目'),kind:projectKind(pairs[i].label)});
    }
    if (results.every(x=>x.status==='rejected')) throw new Error('项目目录读取失败，请确认登录后重试');
    return projects;
  }
  function projectKind(text) { return /公需/.test(text)?'gongxu':/岗前/.test(text)?'gangqian':/管理.*在岗|事业.*在岗/.test(text)?'syguanli':/专业|工程技术/.test(text)?'zhuanye':'other'; }
  function rms(path, id) { return request(path, null, { courseId:id, sourceId:id, providerCorpCode:'cqrl' }); }
  function option(select, value, label) { const el = document.createElement('option'); el.value = value; el.textContent = label; select.appendChild(el); }
  function showError(error) { catalogMessage.textContent = error?.message || String(error); }
  let catalogMessage, projectSelect, stageSelect, courseBox, chapterBox, queueCount;
  function installCoursePanel(root) {
    const style = document.createElement('style');
    style.textContent = `.catalog select[hidden]{display:none}.catalog select{width:100%;margin:4px 0;padding:6px;border:1px solid #cbdaf0;border-radius:7px;color:#243850;background:white}.catalog .tabs{display:flex;gap:6px;margin-bottom:6px}.catalog .tabs button,.catalog .reload{flex:1;border:1px solid #cadbf0;border-radius:8px;background:#f5f8fc;color:#334b69;padding:6px;cursor:pointer}.catalog .tabs button.active{background:#2563eb;color:white}.catalog-list{max-height:190px;overflow:auto}.item{display:flex;gap:7px;align-items:flex-start;padding:8px;border:1px solid #e1eaf5;border-radius:8px;margin:5px 0}.item input{margin-top:3px}.item-content{flex:1;min-width:0}.item-name{font-weight:700;overflow-wrap:anywhere}.small{font-size:11px;color:#6c809b}.catalog-msg{color:#a56112;font-size:11px;margin-top:5px}.chapter{padding:6px;border-bottom:1px solid #edf2f7}.queue-count{font-size:11px;color:#607994}.kinds{display:flex;gap:3px;flex-wrap:wrap;margin:4px 0}.kinds button{border:1px solid #cadbf0;border-radius:5px;background:#fff;padding:3px 5px;font-size:11px;color:#345}.kinds button.active{background:#2563eb;color:white}.course-bar{height:4px;background:#e2e8f0;border-radius:4px;margin-top:4px}.course-bar span{display:block;height:100%;background:#2563eb;border-radius:4px}.current{border-color:#16a34a;background:#f0fdf4}`;
    root.appendChild(style);
    const card = document.createElement('section'); card.className = 'card catalog';
    card.innerHTML = `<div class="tabs"><button class="courses-tab active" type="button">课程列表</button><button class="chapters-tab" type="button">章节预览</button><button class="logs-tab" type="button">运行日志</button><button class="reload" type="button">刷新</button></div><div class="course-pane"><div class="kinds"><button data-kind="all" class="active">全部</button><button data-kind="gongxu">公需课</button><button data-kind="zhuanye">专业课</button><button data-kind="gangqian">岗前培训</button><button data-kind="syguanli">事业在岗</button></div><select class="project" aria-label="培训项目"></select><select class="stage" aria-label="项目阶段"></select><div class="catalog-list courses"></div></div><div class="chapter-pane" hidden><div class="catalog-list chapters"></div></div><div class="log-pane" hidden><button class="clear-log" type="button">清空日志</button><div class="catalog-list logs"></div></div><div class="row"><span class="queue-count"></span><span class="catalog-msg"></span></div>`;
    root.querySelector('.body').insertBefore(card, root.querySelector('.body').children[1]);
    projectSelect=card.querySelector('.project'); stageSelect=card.querySelector('.stage'); courseBox=card.querySelector('.courses'); chapterBox=card.querySelector('.chapters'); catalogMessage=card.querySelector('.catalog-msg'); queueCount=card.querySelector('.queue-count');
    logBox=card.querySelector('.logs'); card.querySelector('.clear-log').addEventListener('click',()=>logBox.replaceChildren());
    card.querySelectorAll('[data-kind]').forEach(btn=>btn.addEventListener('click',()=>{catalog.kind=btn.dataset.kind;card.querySelectorAll('[data-kind]').forEach(b=>b.classList.toggle('active',b===btn));renderProjects();loadStages();}));
    card.querySelector('.reload').addEventListener('click', loadProjects);
    card.querySelector('.courses-tab').addEventListener('click', () => switchTab('course'));
    card.querySelector('.chapters-tab').addEventListener('click', () => { switchTab('chapter'); refreshSelected(); });
    card.querySelector('.logs-tab').addEventListener('click',()=>switchTab('log'));
    projectSelect.addEventListener('change', loadStages); stageSelect.addEventListener('change', loadCourses);
    function switchTab(tab) { for(const [key,pane,button] of [['course','.course-pane','.courses-tab'],['chapter','.chapter-pane','.chapters-tab'],['log','.log-pane','.logs-tab']]) {card.querySelector(pane).hidden=tab!==key;card.querySelector(button).classList.toggle('active',tab===key);} }
    renderQueue(); loadProjects(); scheduleSelectedRefresh();
  }
  async function loadProjects() {
    const generation=++catalog.generation;
    catalogMessage.textContent='正在加载项目…'; projectSelect.replaceChildren(); stageSelect.replaceChildren(); stageSelect.hidden=true; courseBox.replaceChildren();
    try {
      let raw=[];
      try { raw=await nms('/nms/html/login/login.roadMapList.do'); } catch (_) { /* Try the project directory independently. */ }
      if(generation!==catalog.generation) return;
      const roads=listOf(raw,['roadMapList','list','rows']).map(x => ({id:String(x.roadMapId || x.id || x.rmRoadMapId || ''), name:String(x.projectName || x.rmProjectName || x.roadMapName || x.name || x.title || '未命名项目')})).filter(x=>x.id);
      catalogMessage.textContent='正在读取项目目录…';
      let directory=[]; let directoryError='';
      try { directory=await catalogProjects(); } catch(e) { directoryError=e.message || '目录读取失败'; }
      if(generation!==catalog.generation) return;
      const projects=new Map();
      for (const project of [...directory,...roads]) if(!projects.has(project.id)) projects.set(project.id,project);
      catalog.projects=[...projects.values()];
      if (!catalog.projects.length) { catalogMessage.textContent=directoryError || '两个项目接口均未返回项目，请确认登录及已购买课程'; return; }
      renderProjects();
      await loadStages();
    } catch(e) { if(generation===catalog.generation) showError(e); }
  }
  function renderProjects() {
    projectSelect.replaceChildren();
    const projects=catalog.projects.filter(x=>catalog.kind==='all' || (x.kind || projectKind(x.name))===catalog.kind);
    projects.forEach(x=>option(projectSelect,x.id,x.name));
    if(!projects.length) option(projectSelect,'','该分类暂无项目');
  }
  async function loadStages() {
    if(!projectSelect.value) {stageSelect.hidden=true;courseBox.replaceChildren();catalogMessage.textContent='该分类暂无项目';return;}

    const generation=++catalog.generation;
    stageSelect.replaceChildren(); stageSelect.hidden=true; courseBox.replaceChildren(); catalogMessage.textContent='正在加载阶段…';
    try {
      const raw=await nms('/nms/html/courseStudy/getRmStageByProjectId.do',{roadMapId:projectSelect.value});
      if(generation!==catalog.generation) return;
      catalog.stages=listOf(raw,['stageList','list','rows']).map(x=>({id:String(x.stageId || x.id || ''),name:String(x.stageName || x.name || x.title || '未命名阶段')})).filter(x=>x.id);
      if (!catalog.stages.length) { catalogMessage.textContent='项目中没有找到阶段'; return; }
      catalog.stages.forEach(x=>option(stageSelect,x.id,x.name)); stageSelect.hidden = catalog.stages.length <= 1; await loadCourses();
    } catch(e) { if(generation===catalog.generation) showError(e); }
  }
  async function loadCourses() {
    const generation=++catalog.generation; courseBox.replaceChildren(); catalogMessage.textContent='正在加载课程…';
    try {
      const found=new Map();
      for(const type of ['MUST','SELECTIVE']) {
        for(let page=1;page<=80;page++) {
          let raw;
          try { raw=await nms('/nms/html/courseStudy/getCourseDetailByProjectId.do',{pageNo:page,pageSize:8,courseStatus:'ALL',stageId:stageSelect.value,courseType:type,'courseInfo.categoryId':''}); }
          catch(e) { if(type==='SELECTIVE') break; throw e; }
          if(generation!==catalog.generation) return;
          const rows=listOf(raw,['rows','courseList','list']);
          for(const x of rows) { const info=x.courseInfo || {}; const id=String(info.courseId || x.courseId || x.rmCourseId || ''); if(id && !found.has(id)) found.set(id,{id,name:String(info.courseTitle || info.courseName || x.courseName || x.title || id),type,standard:String(info.courseStandard || x.courseStandard || ''),rate:x.currentStepRate ?? x.studyRate ?? x.studyProgress ?? x.progress}); }
          if(!rows.length || rows.length<8 || raw.hasNext===false || (Number(raw.totalPages)>0 && page>=Number(raw.totalPages))) break;
        }
      }
      catalog.courses=[...found.values()]; renderCourses(); catalogMessage.textContent=catalog.courses.length ? '' : '该阶段没有找到课程';
    } catch(e) { if(generation===catalog.generation) showError(e); }
  }
  function renderCourses() {
    courseBox.replaceChildren();
    for(const course of catalog.courses) {
      const label=document.createElement('label'); label.className='item'; if(course.id===currentCourseId()) label.classList.add('current');
      const checkbox=document.createElement('input'); checkbox.type='checkbox'; checkbox.checked=catalog.queue.some(x=>x.id===course.id);
      const content=document.createElement('div'); content.className='item-content';
      const title=document.createElement('div'); title.className='item-name'; title.textContent=`${course.type==='MUST'?'必修':'选修'}${/THREE/i.test(course.standard)?' · 三屏':/TWOSCREEN/i.test(course.standard)?' · 双屏':''} · ${course.name}`;
      const progress=document.createElement('div'); progress.className='small'; progress.textContent=course.rate == null ? '进度：以平台为准' : `进度：${String(course.rate)}`;
      checkbox.addEventListener('change',()=>{ if(checkbox.checked && !catalog.queue.some(x=>x.id===course.id)) catalog.queue.push({id:course.id,name:course.name}); if(!checkbox.checked) catalog.queue=catalog.queue.filter(x=>x.id!==course.id); saveQueue(); renderQueue(); scheduleSelectedRefresh(); });
      content.append(title,progress); const rawRate=catalog.details.get(course.id)?.rate ?? course.rate; const num=Number.parseFloat(rawRate); if(Number.isFinite(num)){const track=document.createElement('div');track.className='course-bar';const fill=document.createElement('span');fill.style.width=`${Math.min(100,Math.max(0,num))}%`;track.appendChild(fill);content.appendChild(track);progress.textContent=`进度：${num.toFixed(1)}%`;} label.append(checkbox,content); courseBox.appendChild(label);
    }
  }
  function renderStats() {
    if (!videoLabel || !positionLabel || !bar) return;
    let total=0, done=0, pending=0;
    for (const course of catalog.queue) {
      const detail=catalog.details.get(course.id);
      if (!detail || detail.error) { pending++; continue; }
      for (const r of detail.resources) {
        total++;
        const rec=detail.records.find(x=>String(x.resourceId)===r.id);
        if (rec && (rec.confirmFinish===1 || rec.confirmFinish===true || rec.confirmFinish==='1' || (r.duration>0 && Number(rec.currentPosition || 0)>=r.duration-1))) done++;
      }
    }
    const pct=total ? Math.round(done/total*100) : 0;
    videoLabel.textContent = `${done}/${total} 视频已学习`;
    positionLabel.textContent = `${pct}%`;
    bar.style.width = `${pct}%`;
    videoLabel.title = pending ? `${pending} 门课程的章节尚未加载或加载失败，统计暂不完整` : '按已选课程的平台章节记录统计';
  }
  function renderQueue() { queueCount.textContent=`已选 ${catalog.queue.length} 门课程`; renderChapters(); renderStats(); }
  function renderChapters() {
    chapterBox.replaceChildren();
    if(!catalog.queue.length) { chapterBox.textContent='请先勾选课程'; return; }
    for(const course of catalog.queue) {
      const title=document.createElement('div'); title.className='item-name chapter'; title.textContent=course.name; chapterBox.appendChild(title);
      const detail=catalog.details.get(course.id);
      if(!detail) { const d=document.createElement('div'); d.className='small chapter'; d.textContent='等待加载'; chapterBox.appendChild(d); continue; }
      if(detail.error || !detail.resources.length) { const d=document.createElement('div'); d.className='small chapter'; d.textContent=detail.error || '未找到章节'; chapterBox.appendChild(d); continue; }
      for(const resource of detail.resources) {
        const rec=detail.records.find(r=>String(r.resourceId)===resource.id);
        let progress='未获取进度';
        if(rec?.confirmFinish===1 || rec?.confirmFinish===true || rec?.confirmFinish==='1') progress='已完成';
        else if(resource.duration>0 && rec) progress=`${Math.min(100,Math.round(Number(rec.currentPosition || 0)/resource.duration*100))}%`;
        const row=document.createElement('div'); row.className='chapter small'; row.textContent=`${resource.name} · ${progress}`; chapterBox.appendChild(row);
      }
    }
  }
  let refreshBusy=false, refreshAgain=false, refreshTimer=0;
  function scheduleSelectedRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer=setTimeout(() => refreshSelected(), 250);
  }
  async function refreshSelected() {
    if (refreshBusy) { refreshAgain=true; return; }
    refreshBusy=true;
    const selected=[...catalog.queue]; catalogMessage.textContent='正在加载章节…';
    for(const course of selected) {
      if(!catalog.queue.some(x=>x.id===course.id)) continue;
      try {
        const chapters=await rms('/tbc-rms/course/showCourseChapter',course.id);
        const records=await rms('/tbc-rms/record/getStudyRecordList',course.id);
        let rate=null; try {const result=unpack(await rms('/tbc-rms/record/getStudyRate',course.id));if(Number.isFinite(Number(result))) rate=Number(result);} catch (_) {}
        const resources=[];
        for(const chapter of listOf(chapters,['chapters','list','rows'])) for(const r of (chapter.resourceDTOS || chapter.resources || [])) {
          const id=String(r.resourceId || r.id || ''); if(!id) continue;
          const type=String(r.type || r.resourceType || 'video').toLowerCase();
          if (/doc|document|pdf|text|exam|test|html|scorm|ppt|audio|mp3/.test(type)) continue;
          const duration=Number(r.timeToFinish || r.duration || r.videoDuration || 0); const factor=Number(chapter.finishPercent ?? r.finishPercent ?? 1);
          resources.push({id,name:String(r.resourceName || r.name || r.title || id),duration:duration*(factor>0?factor:1)});
        }
        const recordList=listOf(records,['recordList','list','rows']);
        if(!resources.length) for(const rec of recordList) {const id=String(rec.resourceId || rec.resourceRelId || ''); const type=String(rec.type || rec.resourceType || 'video').toLowerCase(); if(id && !/doc|pdf|text|exam|test|html|scorm|ppt|audio|mp3/.test(type) && !resources.some(r=>r.id===id)) resources.push({id,name:String(rec.resourceName || rec.chapterName || rec.name || id),duration:Number(rec.timeToFinish || rec.duration || 0)});}
        catalog.details.set(course.id,{resources,records:recordList,rate});
      } catch(e) { catalog.details.set(course.id,{resources:[],records:[],error:e.message || '加载失败'}); }
      renderChapters(); renderStats(); renderCourses();
    }
    catalogMessage.textContent='';
    refreshBusy=false;
    if (refreshAgain) { refreshAgain=false; scheduleSelectedRefresh(); }
  }

  mount(); scan(); watchPlatformAlerts(); setInterval(scan, 3000);
  setInterval(() => { if (enabled && catalog.queue.length) refreshSelected(); }, 12000);
})();

