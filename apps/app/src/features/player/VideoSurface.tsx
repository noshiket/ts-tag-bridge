// Web の映像（hls.js + <video>）。元の Web 版と同じ組み合わせ（Safari は <video> がそのまま HLS を読む）
import Hls from 'hls.js';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { View } from 'react-native';

import type { VideoSurfaceHandle, VideoSurfaceProps } from './surface';

export const VideoSurface = forwardRef<VideoSurfaceHandle, VideoSurfaceProps>(function VideoSurface(props, ref) {
  const { source, startAt, muted, volume, rate, style } = props;
  const cb = useRef(props);
  cb.current = props;
  const videoRef = useRef<HTMLVideoElement>(null);
  const startRef = useRef(startAt);
  startRef.current = startAt;

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !source) return;
    cb.current.onStatus('loading');
    const start = startRef.current > 1 ? startRef.current : 0;
    let hls: Hls | null = null;
    const isHls = /\/playlist(\?|$)/.test(source.uri);
    if (isHls && Hls.isSupported()) {
      // 録画はその場でエンコードするので、まだ無いセグメントを待てるよう長めに待つ（元の設定と同じ）。
      // 続きの位置へは頭から読み始めてから飛ぶ（元と同じ）。startPosition で途中から読み始めると、
      // 後で頭の方へ戻した時に hls.js が頭のセグメントを違う時刻に置き、そこから先へ進まなくなった
      hls = new Hls({ fragLoadingTimeOut: 60000, manifestLoadingTimeOut: 30000, maxBufferLength: 30, maxMaxBufferLength: 60 });
      hls.on(Hls.Events.ERROR, (_e, d) => { if (d.fatal) cb.current.onStatus('error', d.details); });
      hls.attachMedia(v);
      hls.loadSource(source.uri);
    } else {
      v.src = source.uri;
    }
    v.addEventListener('loadedmetadata', () => { if (start > 0) v.currentTime = start; }, { once: true });
    const onCanPlay = () => { cb.current.onStatus('ready'); v.play().catch(() => {}); };
    v.addEventListener('canplay', onCanPlay, { once: true });
    return () => {
      v.removeEventListener('canplay', onCanPlay);
      hls?.destroy();
      v.removeAttribute('src');
      v.load();
    };
  }, [source?.uri]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const time = () => {
      const b = v.buffered.length ? v.buffered.end(v.buffered.length - 1) : 0;
      cb.current.onTime({ current: v.currentTime, duration: Number.isFinite(v.duration) ? v.duration : 0, buffered: b });
    };
    const play = () => cb.current.onPlayingChange(true);
    const pause = () => cb.current.onPlayingChange(false);
    const ended = () => cb.current.onEnded();
    const waiting = () => cb.current.onStatus('loading');
    const playing = () => cb.current.onStatus('ready');
    const size = () => { if (v.videoWidth && v.videoHeight) cb.current.onVideoSize?.({ width: v.videoWidth, height: v.videoHeight }); };
    v.addEventListener('timeupdate', time);
    v.addEventListener('progress', time);
    v.addEventListener('play', play);
    v.addEventListener('pause', pause);
    v.addEventListener('ended', ended);
    v.addEventListener('waiting', waiting);
    v.addEventListener('playing', playing);
    v.addEventListener('loadedmetadata', size);
    v.addEventListener('resize', size);
    return () => {
      v.removeEventListener('loadedmetadata', size);
      v.removeEventListener('resize', size);
      v.removeEventListener('timeupdate', time);
      v.removeEventListener('progress', time);
      v.removeEventListener('play', play);
      v.removeEventListener('pause', pause);
      v.removeEventListener('ended', ended);
      v.removeEventListener('waiting', waiting);
      v.removeEventListener('playing', playing);
    };
  }, []);

  useEffect(() => { if (videoRef.current) videoRef.current.muted = muted; }, [muted]);
  useEffect(() => { if (videoRef.current) videoRef.current.volume = volume; }, [volume]);
  useEffect(() => { if (videoRef.current) videoRef.current.playbackRate = rate; }, [rate]);

  useImperativeHandle(ref, () => ({
    play: () => { void videoRef.current?.play().catch(() => {}); },
    pause: () => videoRef.current?.pause(),
    seek: (t) => { if (videoRef.current) videoRef.current.currentTime = Math.max(0, t); },
    now: () => videoRef.current?.currentTime ?? 0,
    // Web（hls.js）は同じファイルの中の音声トラックを選び替えられないので空（音声は ?audio= で受け直す）
    audioTracks: () => [],
    currentAudioTrack: () => null,
    selectAudioTrack: () => {},
    startPictureInPicture: () => { void videoRef.current?.requestPictureInPicture?.().catch(() => {}); },
    grabFrame: async () => {
      const v = videoRef.current;
      if (!v || !v.videoWidth) return null;
      // 再生中は次のコマが出るまで待ってから写す（待たずに描くと真っ黒になることがある。元と同じ）
      if (!v.paused && typeof v.requestVideoFrameCallback === 'function') {
        await new Promise<void>((res) => {
          const id = v.requestVideoFrameCallback(() => res());
          setTimeout(() => { v.cancelVideoFrameCallback(id); res(); }, 300);
        });
      }
      // 位置は写す前に読む（画像にする間に進んだ分ずれないように。元と同じ）
      const time = v.currentTime;
      const canvas = document.createElement('canvas');
      canvas.width = v.videoWidth;
      canvas.height = v.videoHeight;
      canvas.getContext('2d')!.drawImage(v, 0, 0);
      return { canvas, time };
    },
  }), []);

  return (
    <View style={style}>
      <video ref={videoRef} playsInline style={webVideo} />
    </View>
  );
});

const webVideo = { width: '100%', height: '100%', objectFit: 'contain', background: '#000', display: 'block' } as const;

