// ライブのページの JavaScript の一部: 実況と弾幕・キャプチャ。
// livePageJs.ts がこの順につないで1つにする（関数の途中では切っていない。中で ` と ${ を使わないこと）

export const PART = String.raw`    // ── 実況（NX-Jikkyo）と弾幕 ──
    function drawDanmaku(c) {
      cueComment(c);
      if (!danmaku || video.paused) return;
      var s = window.CommentUtils.getSettings();
      // KonomiTV(DPlayer) と同じ: 幅に比例した大きさ × 文字の倍率。big/small は ×1.25 / ×0.8
      var base = 34 * ((dan.clientWidth || 640) / 1024) * 1.25 * (s.comment_font_scale || 1.0);
      var px = Math.round(c.size === 'big' ? base * 1.25 : c.size === 'small' ? base * 0.8 : base);
      try {
        danmaku.emit({ text: c.text, mode: c.position === 'top' ? 'top' : c.position === 'bottom' ? 'bottom' : 'rtl',
          style: { font: '600 ' + px + "px 'Hiragino Sans','Noto Sans JP',sans-serif", fillStyle: c.color, strokeStyle: 'rgba(0,0,0,0.9)',
            lineWidth: Math.max(2, Math.round(px / 8)), textBaseline: 'bottom' } });
      } catch (e) {}
    }
    function applyDanOpacity() {
      var s = window.CommentUtils ? window.CommentUtils.getSettings() : {};
      dan.style.opacity = String(s.comment_opacity != null ? s.comment_opacity : 0.5);
      dan.style.display = commentsOn ? 'block' : 'none';
    }
    function stopComments() {
      if (danRO) { danRO.disconnect(); danRO = null; }
      if (manager) { try { manager.destroy(); } catch (e) {} manager = null; }
      if (danmaku) { try { danmaku.destroy(); } catch (e) {} danmaku = null; }
    }
    function startComments() {
      stopComments();
      if (!window.Danmaku || !window.LiveCommentManager) return;
      var wsInfoUrl = apiBase + '/streams/live/' + channelId + '/jikkyo';
      fetch(wsInfoUrl, { credentials: 'same-origin' }).then(function (r) { return r.json(); }).catch(function () { return null; }).then(function (info) {
        if (destroyed) return;
        if (!info || !info.watch_session_url) { send('commentSupported', { supported: false, notice: 'このチャンネルは実況に対応していません' }); return; }
        send('commentSupported', { supported: true });
        // canvas の弾幕（コメント付きキャプチャで drawImage するため）。media に video を渡すと停止・再生と揃う
        danmaku = new window.Danmaku({ container: dan, media: video, engine: 'canvas' });
        manager = new window.LiveCommentManager({
          wsInfoUrl: wsInfoUrl, video: video,
          onComment: function (c, meta) { send('comment', { comment: c, initial: !!(meta && meta.isInitial) }); if (!(meta && meta.isInitial) && commentsOn) drawDanmaku(c); },
          onNotice: function (message) { send('notice', { message: message }); },
        });
        manager.init();
        danRO = new ResizeObserver(function () { try { danmaku && danmaku.resize(); } catch (e) {} });
        danRO.observe(dan);
        applyDanOpacity();
      });
    }

    // キャプチャ: 映像 +（任意で）弾幕・字幕を映像の解像度で重ねる
    function capture(o) {
      if (!video.videoWidth) return { ok: false, error: '映像がありません' };
      var W = video.videoWidth, H = video.videoHeight;
      var c = document.createElement('canvas'); c.width = W; c.height = H;
      var ctx = c.getContext('2d');
      try { ctx.drawImage(video, 0, 0, W, H); } catch (e) { return { ok: false, error: '映像の取得に失敗しました' }; }
      var dc = dan.querySelector('canvas');
      if (o.includeComment && dc && commentsOn) {
        var s = window.CommentUtils.getSettings();
        ctx.globalAlpha = s.comment_opacity != null ? s.comment_opacity : 0.5;
        try { ctx.drawImage(dc, 0, 0, dc.width, dc.height, 0, 0, W, H); } catch (e) {}
        ctx.globalAlpha = 1;
      }
      if (o.includeCaption && captionOn && captionRaw && captionRaw.width) {
        try { ctx.drawImage(captionRaw, 0, 0, captionRaw.width, captionRaw.height, 0, 0, W, H); } catch (e) {}
      }
      try { return { ok: true, image: c.toDataURL('image/jpeg', 0.9) }; } catch (e) { return { ok: false, error: '画像の生成に失敗しました' }; }
    }

`;
