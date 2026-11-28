import { configList, configValue, tmpBaseListOf, type Config, type ConfigDirty, type ToolCandidates } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Platform, Share } from 'react-native';

import { confirmAsync, notify } from '../../../lib/device/confirm';
import { useViewNode } from '../../../lib/state/viewNode';
import { useT } from '../../../ui/i18n/I18n';

export type Item = Record<string, unknown>;
export type Disk = { path: string; mounted: boolean; free?: number; total?: number };
export type TestBody = Parameters<ReturnType<typeof useApi>['settings']['testConnection']>[0];
type SyncResult = Record<string, { ok: boolean; sids: number; error?: string }> | { error: string };

/**
 * サーバーの設定（config.yml）の編集の状態と操作: 読み込み、変えた項目（dirty）と JSON の誤り、保存、再起動、
 * 接続テスト、秘密の値の生成、保存先の空き、ペア設定の生成と写し、パターンの一括同期。見ているサーバーのもの
 */
export function useConfigEditor() {
  const { t: tx } = useT();
  const api = useApi();
  const qc = useQueryClient();
  const { viewNode } = useViewNode();
  const [cfg, setCfg] = useState<Config | null>(null);
  const [dirty, setDirty] = useState<ConfigDirty>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [needsRestart, setNeedsRestart] = useState(false);
  const [changed, setChanged] = useState<string[]>([]);
  const [restarting, setRestarting] = useState<'no' | 'waiting' | 'failed'>('no');
  const [tests, setTests] = useState<Record<string, { status: 'running' | 'ok' | 'error'; msg?: string }>>({});
  const [secretBusy, setSecretBusy] = useState<Record<string, boolean>>({});
  const [disk, setDisk] = useState<Record<string, Disk>>({});
  const [diskLoading, setDiskLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  // 詳細設定（ふだん触らない項目と、設定の名前）を出すか
  const [detail, setDetail] = useState(false);

  const load = () => api.settings.config(viewNode).then((c) => { setCfg(c); setDirty({}); }).catch(() => {});
  useEffect(() => { void load(); }, [viewNode]); // eslint-disable-line react-hooks/exhaustive-deps

  const val = (k: string) => configValue(cfg, dirty, k);
  const set = (k: string, v: unknown) => { setDirty((p) => ({ ...p, [k]: v })); setSaved(false); setNeedsRestart(false); };
  const hasDirty = Object.keys(dirty).length > 0;

  const save = async () => {
    setSaving(true);
    try {
      const r = await api.settings.saveConfig(dirty, viewNode);
      await load();
      setSaved(true);
      setNeedsRestart(!!r.restart_required);
      setChanged(r.changed ?? []);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      notify(tx('common.saveFailed', { v0: e instanceof Error ? e.message : e }));
    }
    setSaving(false);
  };
  const restart = async () => {
    const base = changed.includes('jwt_secret')
      ? tx('settings.useConfigEditor.restartServerAfterRestart')
      : tx('settings.useConfigEditor.restartServer');
    // エンコード・取り込みの途中なら、それを先に知らせる（止まる・やり直しになるため）
    const busy = await api.settings.restartBusy(viewNode).catch(() => null);
    const msg = busy && (busy.encoding || busy.scanning)
      ? `${tx('settings.useConfigEditor.busyWarning', { enc: busy.encoding, scan: busy.scanning })}\n\n${base}`
      : base;
    if (!(await confirmAsync(msg, tx('settings.useConfigEditor.restart')))) return;
    setRestarting('waiting');
    try { await api.settings.restart(viewNode); } catch { /* 答える前に切れることがある */ }
    const startedAt = Date.now();
    // 動き出したら全部読み直す（元はページを読み直していた）
    const poll = () => {
      api.settings.status(viewNode).then(() => { setRestarting('no'); setNeedsRestart(false); void qc.invalidateQueries(); void load(); })
        .catch(() => (Date.now() - startedAt > 90_000 ? setRestarting('failed') : setTimeout(poll, 2000)));
    };
    setTimeout(poll, 2000);
  };
  const test = (key: string, body: TestBody) => {
    setTests((p) => ({ ...p, [key]: { status: 'running' } }));
    api.settings.testConnection(body, viewNode)
      .then((r) => setTests((p) => ({ ...p, [key]: { status: r.ok ? 'ok' : 'error', msg: r.ok ? r.detail : r.error } })))
      .catch((e: Error) => setTests((p) => ({ ...p, [key]: { status: 'error', msg: e.message || tx('reservations.list.alert.error') } })));
  };
  const generate = async (key: string) => {
    setSecretBusy((p) => ({ ...p, [key]: true }));
    try { const r = await api.settings.generateSecret(viewNode); set(key, r.value); return r.value; } catch { return null; } finally { setSecretBusy((p) => ({ ...p, [key]: false })); }
  };

  const encodeDirs = configList<string>(cfg, dirty, 'encode_dir_list');
  const tmpBases = tmpBaseListOf(cfg, dirty);
  const refreshDisk = async () => {
    const paths = [...encodeDirs, ...tmpBases].filter(Boolean);
    if (!paths.length) return;
    setDiskLoading(true);
    try { setDisk(Object.fromEntries((await api.settings.diskStatus(paths, viewNode)).map((d) => [d.path, d]))); } catch { /* 出さない */ } finally { setDiskLoading(false); }
  };
  // 相手のサーバーから見たこのサーバーの URL。サーバーが教える物（Tailscale を先に。家の外からも届く）、
  // 無ければ今開いている場所。127.0.0.1 などは相手から届かないので使わない
  const accessUrls = (cfg?.access_urls ?? []) as string[];
  const base = api.client.url('').replace(/\/$/, '');
  const opened = base.startsWith('http') ? base : Platform.OS === 'web' ? window.location.origin : '';
  const thisUrl = accessUrls.find((u) => u.includes('//100-')) ?? accessUrls[0]
    ?? (/\/\/(127\.|localhost)/.test(opened) ? '' : opened);
  /** 文字を写す（相手のサーバーに入れる合言葉・URL など）。key は「写しました」を出す所 */
  const copy = async (key: string, text: string) => {
    // iOS は共有のシートから写す（クリップボードの部品はこのアプリに入れていない）
    if (Platform.OS === 'web') { try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(null), 1500); } catch { /* 写せなかった */ } }
    else await Share.share({ message: text });
  };
  const syncPatterns = async () => {
    setSyncing(true);
    setSyncResult(null);
    try { setSyncResult(await api.settings.syncAllPatterns(viewNode)); } catch (e) { setSyncResult({ error: e instanceof Error ? e.message : String(e) }); } finally { setSyncing(false); }
  };

  return {
    cfg, dirty, val, set, detail, setDetail,
    tools: (cfg?.tool_paths ?? {}) as Record<string, ToolCandidates>, hasDirty, save, saving, saved, needsRestart, restart, restarting, setRestarting,
    tests, test, secretBusy, generate, disk, diskLoading, refreshDisk, encodeDirs, tmpBases,
    edcbServers: configList<Item>(cfg, dirty, 'edcb_servers'), amzServers: configList<Item>(cfg, dirty, 'amatsukaze_servers'),
    remoteNodes: configList<Item>(cfg, dirty, 'federation.remote_nodes'),
    thisUrl, copied, copy, syncing, syncResult, syncPatterns,
  };
}

export type ConfigEditorState = ReturnType<typeof useConfigEditor>;
