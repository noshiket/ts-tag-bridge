import type { AmzProfile } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useState, type Dispatch, type SetStateAction } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AmzProfileRow } from './AmzProfileRow';
import { AmzProfileForm } from './form/AmzProfileForm';
import { Card } from '../parts';
import { useViewNode } from '../../../lib/state/viewNode';
import { Plus } from '../../../ui/parts/Icons';
import { SectionTitle } from '../../../ui/parts/SectionTitle';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

/** プロファイル / profiles: 一覧（見る・編集・別名で保存・名前を変える・消す）と追加 */
export function AmzProfiles({ profiles, setProfiles, loading }: {
  profiles: AmzProfile[]; setProfiles: Dispatch<SetStateAction<AmzProfile[]>>; loading: boolean;
}) {
  const { t: tx } = useT();
  const api = useApi();
  const { theme } = useTheme();
  const { viewNode } = useViewNode();
  const [showAdd, setShowAdd] = useState(false);
  return (
    <>
      <SectionTitle>{tx('settings.amzProfiles.profilesProfiles')}</SectionTitle>
      <Card>
        {profiles.length === 0 && !loading && <T size={12} dim style={styles.none}>{tx('settings.amzProfiles.noProfiles')}</T>}
        {profiles.map((p, i) => (
          <AmzProfileRow key={p.name || i} profile={p} last={i === profiles.length - 1}
            onSave={(name, upd) => api.amatsukaze.updateProfile(name, upd, viewNode).then(() => setProfiles((prev) => prev.map((x) => (x.name === name ? upd : x))))}
            onSaveAs={(newName, upd) => api.amatsukaze.addProfile({ ...upd, name: newName }, viewNode).then(() => setProfiles((prev) => [...prev, { ...upd, name: newName }]))}
            onRename={(oldName, newName, prof) => api.amatsukaze.updateProfile(newName, { ...prof, name: newName }, viewNode)
              .then(() => api.amatsukaze.deleteProfile(oldName, viewNode))
              .then(() => setProfiles((prev) => prev.map((x) => (x.name === oldName ? { ...prof, name: newName } : x))))}
            onDelete={(name) => api.amatsukaze.deleteProfile(name, viewNode).then(() => setProfiles((prev) => prev.filter((x) => x.name !== name)))} />
        ))}
      </Card>
      {!showAdd ? (
        <Pressable onPress={() => setShowAdd(true)} style={[styles.add, { borderColor: theme.frame }]}>
          <Plus s={14} c={theme.ink} w={2.5} />
          <T size={12} w={700}>{tx('settings.amzProfiles.addProfile')}</T>
        </Pressable>
      ) : (
        <View style={styles.mb16}>
          <AmzProfileForm isNew onCancel={() => setShowAdd(false)}
            onSave={(p) => api.amatsukaze.addProfile(p, viewNode).then(() => { setProfiles((prev) => [...prev, p]); setShowAdd(false); })} />
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  none: { padding: 20, textAlign: 'center' },
  add: { padding: 12, borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 16 },
  mb16: { marginBottom: 16 },
});
