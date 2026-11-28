// ライブのページの JavaScript の一部: プレイヤー（アプリとの受け渡し・配置・字幕・プレイヤーの作り直し・サーバーの状態・遅れの追従）。
// livePageJs.ts がこの順につないで1つにする（関数の途中では切っていない。中で ` と ${ を使わないこと）

export const PART = String.raw`  function create(root, post, opts) {
    var apiBase = opts.apiBase;
    var channelId = opts.channelId;
    var quality = opts.quality;
    var destroyed = false, restarting = false, manualPause = false, prebuffering = false, softTried = false;
    var captionText = null;
    var player = null, caption = null, captionRaw = null, captionRO = null, danmaku = null, manager = null, danRO = null, es = null;
    var captionOn = opts.captionOn !== false, commentsOn = opts.commentsOn !== false, audioTrack = opts.audioTrack || 'main';
    var status = { status: 'Offline', detail: '接続待ち…' };

    root.innerHTML = '';
    // 配置（親いっぱい）は外側が決める。ここで position を書き換えると高さが 0 になって映らない
    if (getComputedStyle(root).position === 'static') root.style.position = 'relative';
    root.style.background = '#000'; root.style.overflow = 'hidden';
    var wrap = document.createElement('div');
    wrap.style.cssText = 'position:absolute;inset:0;';
    var video = document.createElement('video');
    video.setAttribute('playsinline', ''); video.playsInline = true;
    video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;';
    wrap.appendChild(video);
    var still = document.createElement('img');   // 立て直しの間に出す、止まる直前のコマ
    still.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:none;pointer-events:none;';
    wrap.appendChild(still);
    var dan = document.createElement('div');      // 弾幕（映像の矩形に限る＝黒帯に出さない）
    dan.style.cssText = 'position:absolute;pointer-events:none;';
    wrap.appendChild(dan);
    root.appendChild(wrap);

    function send(type, data) { try { post(Object.assign({ type: type }, data || {})); } catch (e) {} }
    function state() {
      var buf = 0;
      if (video.buffered.length >= 1) buf = Math.max(0, video.buffered.end(video.buffered.length - 1) - video.currentTime);
      send('state', { paused: video.paused, buffering: prebuffering || (video.readyState <= 2 && !video.paused), bufferSec: buf,
        width: video.videoWidth, height: video.videoHeight });
    }
    video.addEventListener('play', state); video.addEventListener('pause', state);
    video.addEventListener('waiting', state); video.addEventListener('playing', function () { still.style.display = 'none'; state(); });

    // 映像が実際に出ている矩形へ弾幕の層を合わせる
    function layout() {
      var cw = wrap.clientWidth, ch = wrap.clientHeight, vw = video.videoWidth || 16, vh = video.videoHeight || 9;
      var ar = vw / vh, w, h, l, t;
      if (cw / ch > ar) { h = ch; w = ch * ar; l = (cw - w) / 2; t = 0; } else { w = cw; h = cw / ar; l = 0; t = (ch - h) / 2; }
      dan.style.left = Math.round(l) + 'px'; dan.style.top = Math.round(t) + 'px';
      dan.style.width = Math.round(w) + 'px'; dan.style.height = Math.round(h) + 'px';
      if (danmaku) { try { danmaku.resize(); } catch (e) {} }
    }
    var layoutRO = new ResizeObserver(layout); layoutRO.observe(wrap);
    video.addEventListener('loadedmetadata', layout); video.addEventListener('resize', layout);

    // ── 字幕（aribb24.js）。表示用は表示の大きさ、キャプチャ用は映像の解像度で描く ──
    function teardownCaption() {
      if (caption) { try { caption.detachMedia(); } catch (e) {} }
      if (captionRO) { try { captionRO.disconnect(); } catch (e) {} }
      caption = null; captionRaw = null; captionRO = null; captionText = null;
    }
    function setupCaption(p) {
      if (!window.aribb24js) return;
      try {
        var renderer = new aribb24js.CanvasMainThreadRenderer({ color: { stroke: 'black', foreground: null, background: null } });
        var raw = new aribb24js.CanvasMainThreadRenderer({ color: { stroke: 'black', foreground: null, background: null }, resize: { target: 'video' } });
        var feeder = new aribb24js.MPEGTSFeeder();
        var ctl = new aribb24js.Controller();
        ctl.attachFeeder(feeder); ctl.attachRenderer(renderer); ctl.attachRenderer(raw); ctl.attachMedia(video, wrap);
        // 小窓（WebKit）の字幕トラックへ流すための文字
        if (aribb24js.TextRenderer) { captionText = new aribb24js.TextRenderer(); ctl.attachRenderer(captionText); }
        if (captionOn) ctl.show(); else ctl.hide();
        if (raw.canvas) { raw.canvas.style.display = 'none'; captionRaw = raw.canvas; }
        // 表示用の字幕を細かく描く（Controller の自動の大きさは container×dpr で潰れる）
        try { ctl.resize_observer && ctl.resize_observer.disconnect(); } catch (e) {}
        var sizeDisp = function () {
          var cw = wrap.clientWidth || 1, ch = wrap.clientHeight || 1, dpr = window.devicePixelRatio || 1;
          var f = Math.min(6, Math.max(dpr, (video.videoHeight || 1080) / ch));
          try { renderer.onContainerResize(Math.round(cw * f), Math.round(ch * f)); } catch (e) {}
        };
        sizeDisp();
        captionRO = new ResizeObserver(sizeDisp); captionRO.observe(wrap);
        var sizeRaw = function () { if (video.videoWidth) { try { raw.onVideoResize(video.videoWidth, video.videoHeight); } catch (e) {} } };
        sizeRaw(); video.addEventListener('resize', sizeRaw); video.addEventListener('loadedmetadata', sizeRaw);
        caption = ctl;
        // ARIB 字幕は PES private data、tsreadex -x 変換後は timed_id3 で届く
        p.on(mpegts.Events.PES_PRIVATE_DATA_ARRIVED, function (d) { try { feeder.feedB24(d.data, (d.pts != null ? d.pts : d.nearest_pts) / 1000, (d.dts != null ? d.dts : d.nearest_pts) / 1000); } catch (e) {} });
        p.on(mpegts.Events.TIMED_ID3_METADATA_ARRIVED, function (d) { try { feeder.feedID3(d.data, (d.pts != null ? d.pts : d.nearest_pts) / 1000, (d.dts != null ? d.dts : d.nearest_pts) / 1000); } catch (e) {} });
      } catch (e) { console.warn('[live] caption setup failed', e); }
    }

    function destroyPlayer() {
      teardownCaption();
      if (player) {
        try { player.pause(); } catch (e) {}
        try { player.unload(); } catch (e) {}
        try { player.detachMediaElement(); } catch (e) {}
        try { player.destroy(); } catch (e) {}
        player = null;
      }
    }

    function createPlayer() {
      if (destroyed) return;
      if (!window.mpegts || !mpegts.isSupported()) { send('error', { message: 'この環境は MPEG-TS の再生に対応していません' }); return; }
      destroyPlayer();
      send('error', { message: null });
      var p = mpegts.createPlayer({ type: 'mpegts', isLive: true, url: location.origin + apiBase + '/streams/live/' + channelId + '/' + quality + '/mpegts' }, {
        enableWorker: true, enableWorkerForMSE: true, enableStashBuffer: true, stashInitialSize: 2048 * 1024,
        // 遅れの追従は使わない（安定を優先。KonomiTV の通常モードと同じ）
        liveSync: false, liveSyncMinBufferSize: 3.9,
      });
      p.attachMediaElement(video);
      setupCaption(p);
      p.load();
      p.play().catch(function () {});
      player = p;
      // 作り直した後: 選んでいる音声を当て直し、目標ぶん貯まるまで止めてから流す（薄いバッファですぐ詰まるのを避ける）
      video.addEventListener('canplay', function () {
        if (audioTrack === 'sub') { try { p.switchSecondaryAudio(); } catch (e) { console.warn('[live] audio re-apply failed', e); } }
        if (manualPause) return;
        prebuffering = true; state();
        video.playbackRate = 0;
        var t0 = Date.now();
        var iv = setInterval(function () {
          if (destroyed || player !== p) { clearInterval(iv); return; }
          var ahead = video.buffered.length ? video.buffered.end(video.buffered.length - 1) - video.currentTime : 0;
          if (ahead >= LIVE_BUFFER_SEC || Date.now() - t0 > 8000) {
            clearInterval(iv);
            prebuffering = false;
            if (!manualPause) { video.playbackRate = 1; video.play().catch(function () {}); }
            state();
          }
        }, 100);
      }, { once: true });
      p.on(mpegts.Events.ERROR, function (type, detail) {
        console.warn('[mpegts] error:', type, detail);
        if (type === mpegts.ErrorTypes.NETWORK_ERROR || type === mpegts.ErrorTypes.OTHER_ERROR) restartPlayer();
      });
    }

    // 作り直す間の黒い画面を避けるため、止まる直前のコマを出しておく
    function captureFrame() {
      if (!video.videoWidth) return;
      try {
        var c = document.createElement('canvas'); c.width = video.videoWidth; c.height = video.videoHeight;
        c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
        still.src = c.toDataURL('image/jpeg', 0.7); still.style.display = 'block';
      } catch (e) {}
    }
    function restartPlayer() {
      if (destroyed || restarting) return;
      restarting = true;
      console.warn('[live] PlayerRestartRequired');
      captureFrame();
      destroyPlayer();
      setTimeout(function () { if (destroyed) return; createPlayer(); restarting = false; }, 500);
    }
    function softRecover() {
      if (manualPause) return;
      try { video.pause(); } catch (e) {}
      setTimeout(function () { if (!manualPause && !destroyed) video.play().catch(function () {}); }, 250);
    }

    // サーバーの状態（SSE）。Restart の時だけ作り直す（Idling は自分の切断の副作用なので反応しない）
    function connectEvents() {
      if (destroyed) return;
      es = new EventSource(apiBase + '/streams/live/' + channelId + '/' + quality + '/events');
      es.onmessage = function (e) {
        try { status = JSON.parse(e.data); send('status', { status: status }); if (status.status === 'Restart') restartPlayer(); } catch (err) {}
      };
      es.onerror = function () { if (es.readyState === EventSource.CLOSED) setTimeout(connectEvents, 3000); };
    }

    // 遅れの追従（再生速度で滑らかに）とバッファ切れの見張り（8秒で軽い立て直し、15秒で作り直し）
    var stalledAt = null;
    var monitor = setInterval(function () {
      if (!player) return;
      state();
      if (prebuffering) { stalledAt = null; return; }
      var buf = video.buffered.length ? Math.max(0, video.buffered.end(video.buffered.length - 1) - video.currentTime) : 0;
      if (!video.paused && !manualPause) {
        if (buf > LIVE_BUFFER_SEC + 3) { if (video.playbackRate !== 1.1) video.playbackRate = 1.1; }
        else if (buf <= LIVE_BUFFER_SEC + 0.5 && video.playbackRate !== 1) video.playbackRate = 1;
      }
      if (status.status !== 'ONAir') { stalledAt = null; softTried = false; return; }
      if (video.readyState <= 2 && !video.paused) {
        stalledAt = stalledAt || Date.now();
        var dur = Date.now() - stalledAt;
        if (dur > 8000 && !softTried) { softTried = true; softRecover(); }
        else if (dur > 15000) { restartPlayer(); stalledAt = null; softTried = false; }
      } else { stalledAt = null; softTried = false; }
    }, 1000);

`;
