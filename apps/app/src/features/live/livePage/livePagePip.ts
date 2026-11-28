// ライブのページの JavaScript の一部: 小窓（PiP）。
// livePageJs.ts がこの順につないで1つにする（関数の途中では切っていない。中で ` と ${ を使わないこと）

export const PART = String.raw`    // ── PiP（小窓）。元と同じく、ブラウザは小窓のウィンドウ（Document PiP）へ映像ごと移して字幕・弾幕も出す。
    // 無ければ映像・弾幕・字幕を合成した別の映像を小窓にする（元と同じ）。WebKit は下の字幕トラック方式 ──
    var pipWin = null, pipBack = null, pipVideo = null, pipCanvas = null, pipLoop = 0, pipTimer = 0, pipDrawn = 0;
    function pipActive() {
      return !!(pipWin || document.pictureInPictureElement ||
        (pipVideo && pipVideo.webkitPresentationMode === 'picture-in-picture') || video.webkitPresentationMode === 'picture-in-picture');
    }
    function pipChanged() { send('pip', { active: pipActive() }); }
    function drawPip() {
      if (!pipCanvas || !video.videoWidth) return;
      pipDrawn = Date.now();
      var W = video.videoWidth, H = video.videoHeight;
      if (pipCanvas.width !== W) pipCanvas.width = W;
      if (pipCanvas.height !== H) pipCanvas.height = H;
      var ctx = pipCanvas.getContext('2d');
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      try { ctx.drawImage(video, 0, 0, W, H); } catch (e) { return; }
      var dc = dan.querySelector('canvas');
      if (dc && commentsOn) {
        var s = window.CommentUtils ? window.CommentUtils.getSettings() : {};
        ctx.globalAlpha = s.comment_opacity != null ? s.comment_opacity : 0.5;
        try { ctx.drawImage(dc, 0, 0, dc.width, dc.height, 0, 0, W, H); } catch (e) {}
        ctx.globalAlpha = 1;
      }
      if (captionOn && captionRaw && captionRaw.width) { try { ctx.drawImage(captionRaw, 0, 0, captionRaw.width, captionRaw.height, 0, 0, W, H); } catch (e) {} }
    }
    function stopPipLoop() {
      if (pipTimer) { clearInterval(pipTimer); pipTimer = 0; }
      if (!pipLoop) return;
      if (video.cancelVideoFrameCallback) { try { video.cancelVideoFrameCallback(pipLoop); } catch (e) {} }
      try { cancelAnimationFrame(pipLoop); } catch (e) {}
      pipLoop = 0;
    }
    function pipStep() {
      drawPip();
      // 映像のコマごとに描く（あれば。裏でも再生中は届く）
      pipLoop = video.requestVideoFrameCallback ? video.requestVideoFrameCallback(pipStep) : requestAnimationFrame(pipStep);
    }
    function startPipLoop() {
      stopPipLoop();
      pipStep();
      // アプリが裏に回るとコマごとの呼び出しが止まる（iOS の WebView）。止まっている間はタイマーで描く
      pipTimer = setInterval(function () { if (Date.now() - pipDrawn > 100) drawPip(); }, 33);
    }
    function leaveCanvasPip() {
      stopPipLoop();
      if (pipVideo && pipVideo.srcObject) { try { pipVideo.srcObject.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} pipVideo.srcObject = null; }
      pipChanged();
    }
    function enterVideoPip(v) {
      // WebKit（Safari・iOS のアプリ）は独自の切り替えで入る。標準の requestPictureInPicture は利用者の操作の直後でないと
      // 断られ、アプリのボタンから WebView へ送った命令は操作に数えられない。メタデータが揃うまでは待つ（元と同じ）
      if (typeof v.webkitSetPresentationMode === 'function') {
        var enter = function () { try { v.webkitSetPresentationMode('picture-in-picture'); } catch (e) {} };
        if (v.readyState >= 1) enter(); else v.addEventListener('loadedmetadata', enter, { once: true });
        return Promise.resolve();
      }
      if (typeof v.requestPictureInPicture === 'function' && document.pictureInPictureEnabled) return v.requestPictureInPicture();
      return Promise.reject(new Error('PiP に対応していません'));
    }
    function canvasPip() {
      if (!video.videoWidth) return;
      if (!pipVideo) {
        pipVideo = document.createElement('video');
        pipVideo.muted = true; pipVideo.playsInline = true; pipVideo.setAttribute('playsinline', '');
        // 本体の映像の後ろに同じ大きさで置く（WebKit は見えない大きさ・透明の動画の自動再生を止め、小窓に入れない）
        pipVideo.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none;';
        pipVideo.addEventListener('enterpictureinpicture', pipChanged);
        pipVideo.addEventListener('leavepictureinpicture', leaveCanvasPip);
        pipVideo.addEventListener('webkitpresentationmodechanged', function () { if (pipVideo.webkitPresentationMode !== 'picture-in-picture') leaveCanvasPip(); else pipChanged(); });
        wrap.insertBefore(pipVideo, video);
      }
      if (!pipCanvas) pipCanvas = document.createElement('canvas');
      drawPip(); startPipLoop();
      try {
        pipVideo.srcObject = pipCanvas.captureStream(30);
        pipVideo.play().catch(function () {});  // 待たない（Safari は操作の直後でないと小窓に入れないため）
        enterVideoPip(pipVideo).catch(function (e) { console.warn('[live] canvas PiP failed', e); leaveCanvasPip(); });
      } catch (e) { console.warn('[live] canvas PiP failed', e); leaveCanvasPip(); }
    }
    function closePip() {
      if (pipWin) { try { pipWin.close(); } catch (e) {} return true; }
      if (document.pictureInPictureElement) { document.exitPictureInPicture().catch(function () {}); return true; }
      if (pipVideo && pipVideo.webkitPresentationMode === 'picture-in-picture') { try { pipVideo.webkitSetPresentationMode('inline'); } catch (e) {} return true; }
      if (video.webkitPresentationMode === 'picture-in-picture') { try { video.webkitSetPresentationMode('inline'); } catch (e) {} return true; }
      return false;
    }
    // ── WebKit（iOS のアプリ・Safari）の小窓: 映像そのものを小窓にし、字幕とコメントは字幕トラックで重ねる。
    // 合成した絵を小窓にすると、アプリが裏に回った時に元の映像が止められて絵も音も止まるため。
    // コメントは流せないので、届いたものを上から数行に並べて少しの間出す ──
    var useTrackPip = typeof video.webkitSetPresentationMode === 'function';
    var capTrack = null, danTrack = null, capCue = null, capLast = '', danSlot = 0, capPoll = 0;
    if (useTrackPip) {
      capTrack = video.addTextTrack('captions', '字幕', 'ja'); capTrack.mode = 'hidden';
      danTrack = video.addTextTrack('subtitles', 'コメント', 'ja'); danTrack.mode = 'hidden';
      // 字幕の書体（指定しないと日本語が出ない）
      var cueStyle = document.createElement('style');
      cueStyle.textContent = "video::cue { font-family: 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', sans-serif; background: rgba(0,0,0,0.6); }"
        + " video::cue(.c) { background: transparent; text-shadow: 0 0 3px #000, 0 0 3px #000; }";
      document.head.appendChild(cueStyle);
    }
    function trackPipOn() { return useTrackPip && video.webkitPresentationMode === 'picture-in-picture'; }
    function applyTrackModes() {
      if (!useTrackPip) return;
      var on = trackPipOn();
      capTrack.mode = on && captionOn ? 'showing' : 'hidden';
      danTrack.mode = on && commentsOn ? 'showing' : 'hidden';
    }
    var cueEsc = function (t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
    function cueComment(c) {
      if (!trackPipOn() || !commentsOn || !c || !c.text) return;
      var t = video.currentTime;
      // 上から 5 行を順に使う。1 本 4 秒
      var cue = new VTTCue(t, t + 4, '<c.c>' + cueEsc(c.text) + '</c>');
      cue.line = danSlot; cue.snapToLines = true; cue.align = 'end'; cue.position = 98; cue.size = 70;
      danSlot = (danSlot + 1) % 5;
      try { danTrack.addCue(cue); } catch (e) {}
      // 終わったものは捨てる
      try { var old = Array.prototype.slice.call(danTrack.cues || []); old.forEach(function (x) { if (x.endTime < t - 1) danTrack.removeCue(x); }); } catch (e) {}
    }
    function pollCaption() {
      if (!trackPipOn()) return;
      var text = (captionText && captionText.text) || '';
      if (text === capLast) return;
      capLast = text;
      var t = video.currentTime;
      if (capCue) { try { capCue.endTime = t; } catch (e) {} capCue = null; }
      try { Array.prototype.slice.call(capTrack.cues || []).forEach(function (x) { if (x.endTime < t - 1) capTrack.removeCue(x); }); } catch (e) {}
      if (text.trim()) {
        capCue = new VTTCue(t, t + 3600, cueEsc(text));
        try { capTrack.addCue(capCue); } catch (e) {}
      }
    }
    function onTrackPipChange() {
      applyTrackModes();
      if (trackPipOn()) { capLast = null; pollCaption(); if (!capPoll) capPoll = setInterval(pollCaption, 200); }
      else if (capPoll) { clearInterval(capPoll); capPoll = 0; }
    }

`;
