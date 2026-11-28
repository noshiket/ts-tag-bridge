import { Fragment } from 'react';

import { T } from './T';
import { useTheme } from '../theme/Tweaks';

/**
 * 番組の説明。行頭の [出演者] のような見出しだけを大きく・色付きで出す（元の ProgramText）
 */
export function ProgramText({ text, size = 13 }: { text: string; size?: number }) {
  const { accent } = useTheme();
  const lines = text.split('\n');
  return (
    <T range size={size} style={{ lineHeight: size * 1.6 }}>
      {lines.map((line, i) => {
        const m = line.match(/^\[([^\]]+)\]([\s\S]*)/);
        return (
          <Fragment key={i}>
            {m ? <><T size={size * 1.15} w={700} color={accent.primary}>{m[1]}</T>{m[2]}</> : line}
            {i < lines.length - 1 && '\n'}
          </Fragment>
        );
      })}
    </T>
  );
}
