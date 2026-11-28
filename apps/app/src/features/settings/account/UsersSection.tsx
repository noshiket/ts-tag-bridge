import { STATUS_LABEL, type AdminUser, type UserStatus } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { UserPermEditor } from './UserPermEditor';
import { confirmAsync, notify } from '../../../lib/device/confirm';
import { oklch } from '../../../ui/theme/oklch';
import { SectionTitle } from '../../../ui/parts/SectionTitle';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { Card } from '../parts';
import { useT } from '../../../ui/i18n/I18n';

const STATUS_COLOR: Record<string, string> = {
  approved: oklch(0.6, 0.2, 145), pending: oklch(0.7, 0.19, 65), rejected: oklch(0.6, 0.22, 25),
};
const RED = oklch(0.6, 0.22, 25);
const GREEN = oklch(0.6, 0.2, 145);

/** 承認待ちと利用者の管理（管理者だけ）: 承認（続けて権限を開く）・却下・権限・管理者にする/外す・削除 */
export function UsersSection({ meId }: { meId: number }) {
  const { t: tx } = useT();
  const api = useApi();
  const qc = useQueryClient();
  const { theme } = useTheme();
  const users = useQuery({ queryKey: ['admin', 'users'], queryFn: () => api.admin.users() });
  const [busy, setBusy] = useState<number | null>(null);
  const [editPerms, setEditPerms] = useState<number | null>(null);
  const update = (id: number, patch: Partial<AdminUser> | null) =>
    qc.setQueryData<AdminUser[]>(['admin', 'users'], (u) => (patch ? u?.map((x) => (x.id === id ? { ...x, ...patch } : x)) : u?.filter((x) => x.id !== id)));

  const setStatus = async (id: number, status: UserStatus) => {
    setBusy(id);
    try { update(id, await api.admin.setStatus(id, status)); return true; } catch (e) { notify(e instanceof Error ? e.message : tx('settings.usersSection.couldntChange')); return false; } finally { setBusy(null); }
  };
  // 管理者にする・外す（自分自身は変えない。管理者を外す時は、外される人の画面からサーバーの設定が消える）
  const setAdmin = async (u: AdminUser) => {
    const on = !u.is_admin;
    if (!(await confirmAsync(tx(on ? 'settings.usersSection.makeAdminConfirm' : 'settings.usersSection.removeAdminConfirm', { name: u.username }),
      tx(on ? 'settings.usersSection.makeAdmin' : 'settings.usersSection.removeAdmin')))) return;
    setBusy(u.id);
    try { update(u.id, await api.admin.setAdmin(u.id, on)); } catch (e) { notify(e instanceof Error ? e.message : tx('settings.usersSection.couldntChange')); } finally { setBusy(null); }
  };
  const remove = async (id: number) => {
    if (!(await confirmAsync(tx('settings.usersSection.deleteUser'), tx('reservations.list.sheet.delete')))) return;
    setBusy(id);
    try { await api.admin.removeUser(id); update(id, null); } catch { /* 元と同じく黙る */ } finally { setBusy(null); }
  };
  const pending = (users.data ?? []).filter((u) => u.status === 'pending');
  const btn = (label: string, color: string, onPress: () => void, id: number, filled?: boolean) => (
    <Pressable onPress={onPress} disabled={busy === id}
      style={[styles.btn, { borderColor: filled ? 'transparent' : color, backgroundColor: filled ? color : 'transparent', opacity: busy === id ? 0.5 : 1 }]}>
      <T mono size={10} w={700} color={filled ? '#fff' : color}>{label}</T>
    </Pressable>
  );

  return (
    <>
      {pending.length > 0 && (
        <>
          <SectionTitle>{tx('settings.usersSection.pendingApproval', { v0: pending.length })}</SectionTitle>
          <T mono size={9} dim style={styles.pendingNote}>{tx('settings.usersSection.approvingAloneShowsNothing')}</T>
          <Card color={STATUS_COLOR.pending}>
            {pending.map((u, i) => (
              <View key={u.id} style={[styles.row, i < pending.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.line }]}>
                <View style={styles.grow}>
                  <T mono size={12} w={700}>{u.username}</T>
                  <T mono size={9} dim>{tx('settings.usersSection.idRequested', { v0: u.id, v1: (u.created_at || '').slice(0, 16) })}</T>
                </View>
                {btn(tx('settings.usersSection.approve'), GREEN, () => void setStatus(u.id, 'approved').then((ok) => ok && setEditPerms(u.id)), u.id, true)}
                {btn(tx('settings.usersSection.reject'), theme.mute, () => void setStatus(u.id, 'rejected'), u.id)}
              </View>
            ))}
          </Card>
        </>
      )}
      <SectionTitle>{tx('settings.usersSection.users')}</SectionTitle>
      <Card>
        {!users.data ? <T mono size={10} dim style={styles.loading}>{users.error ? users.error.message : tx('common.loading')}</T>
          : users.data.map((u, i) => (
            <View key={u.id} style={i < users.data.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.line }}>
              <View style={styles.row}>
                <View style={styles.grow}>
                  <T mono size={12} w={700}>{`${u.username}${u.is_admin ? ' ★' : ''}`}</T>
                  <T mono size={9} dim>{`ID:${u.id} · ${u.is_admin ? 'admin' : 'user'} · ${(u.created_at || '').slice(0, 10)}`}</T>
                </View>
                <View style={[styles.status, { borderColor: STATUS_COLOR[u.status] ?? theme.line }]}>
                  <T mono size={9} w={700} color={STATUS_COLOR[u.status] ?? theme.mute}>{STATUS_LABEL[u.status] ?? (u.status || '-')}</T>
                </View>
                {u.id !== meId && u.status !== 'approved' && btn(tx('settings.usersSection.approve'), GREEN, () => void setStatus(u.id, 'approved'), u.id)}
                {u.id !== meId && !u.is_admin && (
                  <Pressable onPress={() => setEditPerms(editPerms === u.id ? null : u.id)}
                    style={[styles.btn, { borderColor: theme.line, backgroundColor: editPerms === u.id ? theme.ink : 'transparent' }]}>
                    <T mono size={10} w={700} color={editPerms === u.id ? theme.onInk : theme.mute}>{tx('settings.usersSection.permissions')}</T>
                  </Pressable>
                )}
                {u.id !== meId && u.status === 'approved' &&
                  btn(tx(u.is_admin ? 'settings.usersSection.removeAdmin' : 'settings.usersSection.makeAdmin'), theme.mute, () => void setAdmin(u), u.id)}
                {u.id !== meId && btn(tx('reservations.list.sheet.delete'), RED, () => void remove(u.id), u.id)}
              </View>
              {editPerms === u.id && <UserPermEditor user={u} onClose={() => setEditPerms(null)} />}
            </View>
          ))}
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  pendingNote: { marginTop: -6, marginBottom: 6, marginHorizontal: 2 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 13, gap: 8 },
  grow: { flex: 1, minWidth: 0 },
  btn: { paddingVertical: 4, paddingHorizontal: 9, borderRadius: 6, borderWidth: 1 },
  status: { paddingVertical: 2, paddingHorizontal: 7, borderRadius: 5, borderWidth: 1 },
  loading: { paddingVertical: 12, paddingHorizontal: 13 },
});
