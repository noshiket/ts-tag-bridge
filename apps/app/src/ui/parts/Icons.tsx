// 元の Web 版のアイコン（legacy/web-jsx/src/helpers.jsx の I）と同じ線
import Svg, { Circle, Path, Rect } from 'react-native-svg';

type P = { s?: number; c: string };

const ROT = { right: 0, left: 180, down: 90, up: -90 } as const;

export function Chev({ s = 14, c, d = 'right' }: P & { d?: keyof typeof ROT }) {
  return (
    <Svg width={s} height={s} viewBox="0 0 16 16" style={{ transform: [{ rotate: `${ROT[d]}deg` }] }}>
      <Path d="M6 3l5 5-5 5" stroke={c} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function More({ s = 16, c }: P) {
  return (
    <Svg width={s} height={s} viewBox="0 0 16 16">
      <Circle cx={3} cy={8} r={1.4} fill={c} />
      <Circle cx={8} cy={8} r={1.4} fill={c} />
      <Circle cx={13} cy={8} r={1.4} fill={c} />
    </Svg>
  );
}

export function File({ s = 16, c }: P) {
  return (
    <Svg width={s} height={s} viewBox="0 0 16 16">
      <Path d="M4 1h6l4 4v10H2V1z" stroke={c} strokeWidth={1.4} fill="none" strokeLinejoin="round" />
      <Path d="M10 1v4h4" stroke={c} strokeWidth={1.4} fill="none" />
    </Svg>
  );
}

// 下のタブ（元の I.Cal / I.Tag / I.Hist / I.Queue / I.Gear）
export const Cal = ({ s = 20, c }: P) => (
  <Svg width={s} height={s} viewBox="0 0 20 20">
    <Rect x={2} y={4} width={16} height={14} rx={2} stroke={c} strokeWidth={1.6} fill="none" />
    <Path d="M2 8h16M6 2v4M14 2v4" stroke={c} strokeWidth={1.6} strokeLinecap="round" />
  </Svg>
);
export const TagIcon = ({ s = 20, c }: P) => (
  <Svg width={s} height={s} viewBox="0 0 14 14">
    <Path d="M7 1H1v6l6 6 6-6z" stroke={c} strokeWidth={1.4} fill="none" strokeLinejoin="round" />
    <Circle cx={3.5} cy={3.5} r={0.8} fill={c} />
  </Svg>
);
export const Hist = ({ s = 20, c }: P) => (
  <Svg width={s} height={s} viewBox="0 0 20 20">
    <Circle cx={10} cy={10} r={7.5} stroke={c} strokeWidth={1.6} fill="none" />
    <Path d="M10 5v5l3 2M2 4l2 4M18 4l-2 4" stroke={c} strokeWidth={1.6} fill="none" strokeLinecap="round" />
  </Svg>
);
/** サーバー（下のタブの切り替え。新しいアプリで追加） */
export const ServerIcon = ({ s = 20, c }: P) => (
  <Svg width={s} height={s} viewBox="0 0 20 20">
    <Rect x={3} y={3} width={14} height={6} rx={1.5} stroke={c} strokeWidth={1.6} fill="none" />
    <Rect x={3} y={11} width={14} height={6} rx={1.5} stroke={c} strokeWidth={1.6} fill="none" />
    <Path d="M6 6h1M6 14h1" stroke={c} strokeWidth={1.8} strokeLinecap="round" />
  </Svg>
);
export const Queue = ({ s = 20, c }: P) => (
  <Svg width={s} height={s} viewBox="0 0 20 20">
    <Path d="M4 5h12M4 10h12M4 15h8" stroke={c} strokeWidth={1.8} strokeLinecap="round" />
  </Svg>
);
export const Gear = ({ s = 20, c }: P) => (
  <Svg width={s} height={s} viewBox="0 0 20 20">
    <Circle cx={10} cy={10} r={2.5} stroke={c} strokeWidth={1.6} fill="none" />
    <Path d="M10 1v3M10 16v3M19 10h-3M4 10H1M16.4 3.6l-2.1 2.1M5.7 14.3l-2.1 2.1M16.4 16.4l-2.1-2.1M5.7 5.7L3.6 3.6" stroke={c} strokeWidth={1.5} strokeLinecap="round" />
  </Svg>
);

export const Plus = ({ s = 16, c, w = 2 }: P & { w?: number }) => (
  <Svg width={s} height={s} viewBox="0 0 16 16"><Path d="M8 2v12M2 8h12" stroke={c} strokeWidth={w} strokeLinecap="round" /></Svg>
);
export const Refresh = ({ s = 16, c }: P) => (
  <Svg width={s} height={s} viewBox="0 0 16 16">
    <Path d="M13 2v4h-4M3 14v-4h4" stroke={c} strokeWidth={1.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M12.5 7a5 5 0 00-9.3-0.5M3.5 9a5 5 0 009.3 0.5" stroke={c} strokeWidth={1.6} fill="none" strokeLinecap="round" />
  </Svg>
);
export const Alert = ({ s = 22, c }: P) => (
  <Svg width={s} height={s} viewBox="0 0 22 22">
    <Path d="M11 3l10 17H1L11 3z" stroke={c} strokeWidth={1.6} fill="none" strokeLinejoin="round" />
    <Path d="M11 9v5" stroke={c} strokeWidth={1.6} strokeLinecap="round" />
    <Circle cx={11} cy={17} r={1} fill={c} />
  </Svg>
);
export const Trash = ({ s = 14, c }: P) => (
  <Svg width={s} height={s} viewBox="0 0 14 14">
    <Path d="M2 4h10M5 4V2h4v2M5.5 6v5M8.5 6v5M3 4l.8 8h6.4l.8-8" stroke={c} strokeWidth={1.3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);
export const Skip = ({ s = 16, c }: P) => (
  <Svg width={s} height={s} viewBox="0 0 16 16">
    <Circle cx={8} cy={8} r={6.5} stroke={c} strokeWidth={1.5} fill="none" />
    <Path d="M4 4l8 8" stroke={c} strokeWidth={1.5} strokeLinecap="round" />
  </Svg>
);
export const Tv = ({ s = 16, c }: P) => (
  <Svg width={s} height={s} viewBox="0 0 16 16">
    <Rect x={2} y={3} width={12} height={9} rx={1.5} stroke={c} strokeWidth={1.5} fill="none" />
    <Path d="M5 14h6M8 12v2" stroke={c} strokeWidth={1.5} strokeLinecap="round" />
  </Svg>
);
export const Lock = ({ s = 14, c }: P) => (
  <Svg width={s} height={s} viewBox="0 0 14 14">
    <Rect x={2} y={6} width={10} height={7} rx={1.5} stroke={c} strokeWidth={1.3} fill="none" />
    <Path d="M4 6V4a3 3 0 016 0v2" stroke={c} strokeWidth={1.3} fill="none" />
    <Circle cx={7} cy={9.5} r={1} fill={c} />
  </Svg>
);
export const Search = ({ s = 14, c }: P) => (
  <Svg width={s} height={s} viewBox="0 0 16 16">
    <Circle cx="7" cy="7" r="5" stroke={c} strokeWidth={1.6} fill="none" />
    <Path d="M11 11l3.5 3.5" stroke={c} strokeWidth={1.6} strokeLinecap="round" />
  </Svg>
);
export const Spark = ({ s = 16, c }: P) => (
  <Svg width={s} height={s} viewBox="0 0 16 16"><Path d="M8 1v6M8 9v6M1 8h6M9 8h6" stroke={c} strokeWidth={1.5} strokeLinecap="round" /></Svg>
);
export const Check = ({ s = 16, c, w = 2.2 }: P & { w?: number }) => (
  <Svg width={s} height={s} viewBox="0 0 16 16"><Path d="M3 8l3.5 3.5L13 5" stroke={c} strokeWidth={w} fill="none" strokeLinecap="round" strokeLinejoin="round" /></Svg>
);
/** 繰り返し（one: 1曲。右上に 1） */
export const Repeat = ({ s = 14, c, one }: P & { one?: boolean }) => (
  <Svg width={s} height={s} viewBox="0 0 16 16">
    <Path d="M3 7V6a2 2 0 012-2h8M11 2l2 2-2 2M13 9v1a2 2 0 01-2 2H3M5 14l-2-2 2-2" stroke={c} strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    {one && <Path d="M7.4 7.2L8.4 6.6V10" stroke={c} strokeWidth={1.3} fill="none" strokeLinecap="round" strokeLinejoin="round" />}
  </Svg>
);
/** シャッフル（交差する2本の矢印） */
export const Shuffle = ({ s = 14, c }: P) => (
  <Svg width={s} height={s} viewBox="0 0 16 16">
    <Path d="M2 4h2.5c1.5 0 2.3.7 3 2l1 2c.7 1.3 1.5 2 3 2H14M2 12h2.5c1.2 0 2-.5 2.6-1.3M9 5.3C9.6 4.5 10.4 4 11.5 4H14M12 2l2 2-2 2M12 8l2 2-2 2" stroke={c} strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);
