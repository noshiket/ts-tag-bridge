import { StyleSheet, View } from 'react-native';

import { Chip } from '../../ui/inputs/Chip';
import { ProgramText } from '../../ui/parts/ProgramText';
import { SectionTitle } from '../../ui/parts/SectionTitle';
import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';
import { Card } from './Card';
import { useT } from '../../ui/i18n/I18n';

/** 録画詳細・予約詳細の「番組説明・詳細情報・ジャンル」（genre はカンマ区切り） */
export function ProgramInfo({ description, extendedInfo, genre }: { description?: string | null; extendedInfo?: string | null; genre?: string | null }) {
  const { t: tx } = useT();
  const { accent } = useTheme();
  const genres = (genre || '').split(',').map((g) => g.trim()).filter(Boolean);
  return (
    <>
      <View style={styles.section}>
        <SectionTitle>{tx('detail.programInfo.description')}</SectionTitle>
        <Card small>{description ? <ProgramText text={description} /> : <T size={13}>{tx('detail.programInfo.noDescription')}</T>}</Card>
      </View>
      {!!extendedInfo && (
        <View style={styles.sectionS}>
          <SectionTitle>{tx('detail.programInfo.details')}</SectionTitle>
          <Card small><ProgramText text={extendedInfo} size={12} /></Card>
        </View>
      )}
      <View style={styles.section}>
        <SectionTitle>{tx('detail.programInfo.genre')}</SectionTitle>
        <View style={styles.chips}>
          {genres.map((g, i) => <Chip key={g} active color={[accent.tertiary, accent.secondary][i % 2]}>{g}</Chip>)}
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 16 },
  sectionS: { marginTop: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
});
