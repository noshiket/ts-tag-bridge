import { describe, expect, it } from 'vitest';

import {
  audioJobKind, audioJobNote, audioJobState, audioJobTitle, configValue, federationRole, intervalOptions, logLink, moveItem, pairRows, rowsToPairs, toolChoice,
  tmpBaseListOf, verifyTls,
} from '../src';

const cfg = { port: 8082, https: { enabled: true }, federation: { node_id: 'a', fed_token: '********' }, volumes: [{ host: '/mnt' }], tmp_base: '/tmp' };

describe('サーバー設定の編集', () => {
  it('今の値は変えた値か、深い所の値', () => {
    expect(configValue(cfg, {}, 'https.enabled')).toBe(true);
    expect(configValue(cfg, { 'https.enabled': 'false' }, 'https.enabled')).toBe('false');
    expect(configValue(cfg, {}, 'streaming.encoder')).toBe('');
  });
  it('間隔は候補から選ぶ。候補に無い今の値は消さずに足す', () => {
    expect(intervalOptions(60).find(([v]) => v === '60')?.[1]).toBe('1分');
    expect(intervalOptions(45)[0]).toEqual(['45', '45秒（今の値）']);
    expect(intervalOptions('').some(([, l]) => l.includes('今の値'))).toBe(false);
  });
  it('ffmpeg は同梱版・システム・指定のどれか', () => {
    const cand = { bundled: '/s/thirdparty/FFmpeg/ffmpeg', system: '/usr/bin/ffmpeg' };
    expect(toolChoice('/s/thirdparty/FFmpeg/ffmpeg', cand)).toBe('bundled');
    expect(toolChoice('/usr/bin/ffmpeg', cand)).toBe('system');
    expect(toolChoice('/opt/ffmpeg', cand)).toBe('custom');
    expect(toolChoice('', { bundled: '', system: '' })).toBe('custom');
  });
  it('名前と値の組は行にして戻せる（名前が空の行は捨てる）', () => {
    expect(pairRows({ ext: '.mp4', n: 1 })).toEqual([['ext', '.mp4'], ['n', '1']]);
    expect(pairRows(null)).toEqual([]);
    expect(rowsToPairs([['ext', '.mp4'], [' ', 'x'], [' a ', 'b']])).toEqual({ ext: '.mp4', a: 'b' });
  });
  it('作業ディレクトリは無ければ tmp_base 1つ・並べ替え', () => {
    expect(tmpBaseListOf(cfg, {})).toEqual(['/tmp']);
    expect(tmpBaseListOf({ ...cfg, tmp_base_list: ['/a', '/b'] }, {})).toEqual(['/a', '/b']);
    expect(moveItem(['/a', '/b', '/c'], 2, -1)).toEqual(['/a', '/c', '/b']);
    expect(moveItem(['/a'], 0, -1)).toEqual(['/a']);
  });
  it('連携の役割とペアの設定', () => {
    const get = (o: Record<string, unknown>) => (k: string) => o[k];
    expect(federationRole(get({ 'federation.library_peer.url': 'https://x', 'federation.library_peer.name': 'lark' })).label).toContain('「lark」へ送ります');
    expect(federationRole(get({ 'federation.fed_token': 't' })).role).toBe('receiver');
    expect(federationRole(get({})).role).toBe('off');
    expect([verifyTls('false'), verifyTls(false), verifyTls(''), verifyTls(true)]).toEqual([false, false, true, true]);
  });
});

describe('ログと音声解析', () => {
  it('ログから予約・録画へ', () => {
    expect([logLink('skip reserve 123 done'), logLink('x recording_id=45'), logLink('nothing')])
      .toEqual([{ kind: 'reserve', id: 123 }, { kind: 'recording', id: 45 }, null]);
  });
  it('解析の表示', () => {
    const j = { id: '1', state: 'queued', queue_position: 2, kind: 'audio_only', title: 'A', episode_number: '5', source_name: 'MX', last_log: '[02:04:02] 待ち' };
    expect([audioJobState(j), audioJobKind(j).label, audioJobTitle(j), audioJobNote(j)]).toEqual(['順番待ち2', '音声のみ取り込み', 'A #5 ← MX', '待ち']);
    expect(audioJobNote({ ...j, state: 'error', error: 'x' })).toBe('x');
  });
});

describe('Amatsukaze', () => {
  it('プロファイルの編集の始め・まとめ', async () => {
    const { amzEncoderOption, amzFilterSummary, initAmzProfileForm } = await import('../src');
    const p = { name: 'A', encoderType: 'QSVEnc', qsvEncOption: '--cqp 20', filterOption: 'Setting', filterSetting: { enableDeinterlace: true, enableResize: true }, bitrate: { a: 1, b: 2, h264: 3 }, extra: 'keep' };
    const f = initAmzProfileForm(p);
    expect(f).toMatchObject({ name: 'A', outputFormat: 'MKV', extra: 'keep', bitrate: { a: 1, b: 2, h264: 3 } });
    expect(f.filterSetting).toMatchObject({ enableDeinterlace: true, enableResize: true, deinterlaceAlgorithm: 'KFM' });
    expect(initAmzProfileForm(null).name).toBe('');
    expect(amzEncoderOption(p)).toEqual({ key: 'qsvEncOption', value: '--cqp 20' });
    expect(amzEncoderOption({ name: 'B', encoderType: 'x264' })).toBeNull();
    expect(amzFilterSummary(p)).toBe('Setting (deint+resize)');
    expect(amzFilterSummary({ name: 'C' })).toBe('None');
  });
  it('同じボリュームのディスクは1つ', async () => {
    const { amzDiskUsed, uniqueAmzDisks } = await import('../src');
    const d = (path: string, cap: number) => ({ path, capacityBytes: cap, freeBytes: cap / 4, usedBytes: (cap * 3) / 4 });
    expect(uniqueAmzDisks([d('/a', 100), d('/b', 100), d('/c', 200)]).map((x) => x.path)).toEqual(['/a', '/c']);
    expect(amzDiskUsed(d('/a', 100))).toBe(0.75);
    expect(amzDiskUsed({ capacityBytes: 0, freeBytes: 0, usedBytes: 0 })).toBe(0);
  });
});
