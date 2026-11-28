// ライブのページの JavaScript の一部: アプリからの命令・外へ出す口（IIFE の終わり）。
// livePageJs.ts がこの順につないで1つにする（関数の途中では切っていない。中で ` と ${ を使わないこと）

export const PART = String.raw`    function togglePip() {
      if (closePip()) return;
      if (useTrackPip) { enterVideoPip(video).catch(function (e) { send('notice', { message: String(e && e.message || e) }); }); return; }
      if ('documentPictureInPicture' in window) {
        window.documentPictureInPicture.requestWindow({ width: Math.round(wrap.clientWidth) || 480, height: Math.round(wrap.clientHeight) || 270 }).then(function (w) {
          pipWin = w;
          w.document.body.style.cssText = 'margin:0;background:#000;overflow:hidden;';
          pipBack = { parent: wrap.parentNode, next: wrap.nextSibling };
          w.document.body.appendChild(wrap);  // 映像・字幕・弾幕ごと小窓へ移す
          pipChanged();
          w.addEventListener('pagehide', function () {
            if (pipBack && pipBack.parent) { try { pipBack.parent.insertBefore(wrap, pipBack.next); } catch (e) {} }
            pipBack = null; pipWin = null;
            if (!destroyed) { video.play().catch(function () {}); pipChanged(); }
          }, { once: true });
        }).catch(function (e) { console.warn('[live] Document PiP failed, fallback to canvas PiP', e); canvasPip(); });
        return;
      }
      canvasPip();
    }
    video.addEventListener('enterpictureinpicture', pipChanged);
    video.addEventListener('leavepictureinpicture', pipChanged);
    video.addEventListener('webkitpresentationmodechanged', function () { onTrackPipChange(); pipChanged(); });
    send('pipSupported', { supported: !!(document.pictureInPictureEnabled || 'documentPictureInPicture' in window ||
      typeof video.webkitSetPresentationMode === 'function') });

    if (opts.settings && window.CommentUtils) { try { window.CommentUtils.saveSettings(Object.assign({}, window.CommentUtils.getSettings(), opts.settings)); } catch (e) {} }
    applyDanOpacity();
    video.volume = opts.volume != null ? opts.volume : 0.8;
    video.muted = !!opts.muted;
    connectEvents();
    createPlayer();
    if (commentsOn) startComments();

    return {
      command: function (m) {
        switch (m.type) {
          case 'play': manualPause = false; video.play().catch(function () {}); break;
          case 'pause': manualPause = true; video.pause(); break;
          case 'volume': video.volume = m.volume; video.muted = !!m.muted; break;
          case 'caption': captionOn = !!m.on; applyTrackModes(); if (caption) { try { m.on ? caption.show() : caption.hide(); } catch (e) {} } break;
          case 'comments': commentsOn = !!m.on; applyTrackModes(); applyDanOpacity(); if (commentsOn && !manager) startComments(); break;
          case 'audio':
            audioTrack = m.track;
            if (player) { try { m.track === 'sub' ? player.switchSecondaryAudio() : player.switchPrimaryAudio(); } catch (e) { console.warn('[live] audio switch failed', e); } }
            break;
          case 'settings': if (window.CommentUtils) { try { window.CommentUtils.saveSettings(Object.assign({}, window.CommentUtils.getSettings(), m.settings)); } catch (e) {} } applyDanOpacity(); break;
          case 'send': {
            if (!manager) { send('sent', { id: m.id, ok: false, error: '実況に繋がっていません' }); break; }
            Promise.resolve(manager.sendComment({ text: m.text, color: '#FFEAEA', position: 'right', size: 'medium' })).then(function () {
              var now = new Date(), pad = function (n) { return String(n).padStart(2, '0'); };
              var c = { id: Math.floor(Date.now() / 1000), text: m.text, time: pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds()),
                color: '#FFEAEA', position: 'right', size: 'medium', user_id: 'me', premium: null, my_post: true };
              send('comment', { comment: c, initial: false }); drawDanmaku(c);
              send('sent', { id: m.id, ok: true });
            }).catch(function (err) { send('sent', { id: m.id, ok: false, error: typeof err === 'string' ? err : 'コメント送信に失敗しました' }); });
            break;
          }
          case 'capture': send('captured', Object.assign({ id: m.id }, capture(m))); break;
          case 'restart': restartPlayer(); break;
          case 'pip': togglePip(); break;
        }
      },
      destroy: function () {
        destroyed = true;
        closePip(); stopPipLoop(); if (capPoll) clearInterval(capPoll);
        clearInterval(monitor);
        if (es) es.close();
        layoutRO.disconnect();
        stopComments();
        destroyPlayer();
        root.innerHTML = '';
      },
    };
  }

  window.TSTagLive = { loadLibs: loadLibs, create: create };
})();
`;
