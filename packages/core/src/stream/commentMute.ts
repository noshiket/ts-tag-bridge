// 実況コメントのミュート（元の Web 版 jikkyo.jsx の CommentUtils。もとは KonomiTV の CommentUtils.ts、MIT License）。
// 録画のコメントには投稿者の番号・大きさ・プレミアムが無いので、その判定は効かない（元と同じ）
import type { Comment } from './comments';

export type KeywordMatch = 'partial' | 'forward' | 'backward' | 'exact' | 'regex';

export interface MuteSettings {
  muted_niconico_user_ids: string[];
  muted_comment_keywords: { match: KeywordMatch; pattern: string }[];
  mute_comment_keywords_normalize_alphanumeric_width_case: boolean;
  mute_fixed_comments: boolean;
  mute_colored_comments: boolean;
  mute_big_size_comments: boolean;
  mute_vulgar_comments: boolean;
  mute_abusive_discriminatory_prejudiced_comments: boolean;
  mute_consecutive_same_characters_comments: boolean;
  /** 弾幕の表示（ミュートと一緒に保存する） */
  comment_opacity: number;
  comment_font_scale: number;
  comment_max_onscreen: number;
}

/** 端末に保存する名前（元と同じ） */
export const MUTE_SETTINGS_KEY = 'jikkyo_mute_settings';

export const DEFAULT_MUTE_SETTINGS: MuteSettings = {
  muted_niconico_user_ids: [],
  muted_comment_keywords: [],
  mute_comment_keywords_normalize_alphanumeric_width_case: true,
  mute_fixed_comments: false,
  mute_colored_comments: false,
  mute_big_size_comments: false,
  mute_vulgar_comments: false,
  mute_abusive_discriminatory_prejudiced_comments: false,
  mute_consecutive_same_characters_comments: false,
  comment_opacity: 0.5,
  comment_font_scale: 1.0,
  comment_max_onscreen: 100,
};

/** 保存してある文字列から読む（壊れていたら既定） */
export function parseMuteSettings(raw: string | null): MuteSettings {
  if (!raw) return { ...DEFAULT_MUTE_SETTINGS };
  try { return { ...DEFAULT_MUTE_SETTINGS, ...(JSON.parse(raw) as Partial<MuteSettings>) }; } catch { return { ...DEFAULT_MUTE_SETTINGS }; }
}

// 「露骨な表現」「ネガティブ・差別的・政治的に偏った表現」の正規表現（KonomiTV からそのまま。base64 の UTF-8）
const VULGAR_B64 = 'XChpXCl8XChVXCl8cHJwcnzvvZDvvZLvvZDvvZJ8U0VYfFPjgIdYfFPil69YfFPil4tYfFPil49YfO+8s++8pe+8uHzvvLPjgIfvvLh877yz4pev77y4fO+8s+KXi++8uHzvvLPil4/vvLh844Ki44OA44Or44OIfOOCouOCveOCs3zjgqLjg4rjgqV844Ki44OK44OrfOOCpOOCq+iHrXzjgqTjgY9844Kk44Oz44OdfOOBhuOCk+OBk3zjgqbjg7PjgrN844GG44KT44GhfOOCpuODs+ODgXzjgqjjgq3jg5t844GI44Gh44GI44GhfOOBiOOBo+OBoXzjgqjjg4Pjg4F844GI44Gj44KNfOOCqOODg+ODrXxe44GI44KNfOOBiOOCjeOBhHzjgqjjg6185bel5Y+jfOOCquOCq+OCunzjgYrjgZXjgo/jgorjgb7jgpN844GK44GX44Gj44GTfOOCquOCt+ODg+OCs3zjgqrjg4PjgrXjg7N844GK44Gj44Gx44GEfOOCquODg+ODkeOCpHzjgqrjg4rjg4vjg7x844GK44Gq44G7fOOCquODiuODm3zjgYrjgbHjgYR844Kq44OR44KkfO+9te++iu++n++9snzjgYrjgb7jgZ9844Kq44Oe44K/fO+9te++j+++gHzjgYrjgoHjgZN844Kq44Oh44KzfO+9te++ku+9unzjgYpwfOOBiu+9kHzjgqrjg5Xjg5HjgrN844Ks44OB44Og44OBfOOCreODoeOCu+OCr3zjgq3jg7Pjgr/jg55844GP44Gx44GCfOOBj+OBseOBgXzjgq/jg6rjg4jjg6rjgrl844Kv44Oz44OLfOOBlOOBj+OBlOOBj+OBlOOBj+OBlOOBj3zjgrPjg7Pjg4njg7zjg6B844GR44Gk44GC44GqfOOCseODhOOCouODinzjgrHjg4TnqbR844K244O844Oh44OzfOOCt+OCs3zjgZfjgZPjgZfjgZN844K344KzfOOBmeOBkeOBmeOBkXzjgZvjgYTjgYjjgY1844Gb44GE44KKfOOBm+ODvOOCinzjgZnjgYXjgYXjgYV844GZ44GG44GG44GGfOOCu+OCr+ODreOCuXzjgrvjg4Pjgq/jgrl844K744OV44OsfOOBoeOBo+OBseOBhHzjgaHjgaPjg5HjgqR844OB44OD44OR44KkfOOBoeOCk+OBk3zjgaHjgIfjgZN844Gh4pev44GTfOOBoeKXi+OBk3zjgaHil4/jgZN844OB44Oz44KzfOODgeOAh+OCs3zjg4Hil6/jgrN844OB4peL44KzfOODgeKXj+OCs3zjgaHjgpPjgb1844Gh44CH44G9fOOBoeKXr+OBvXzjgaHil4vjgb1844Gh4peP44G9fOODgeODs+ODnXzjg4HjgIfjg51844OB4pev44OdfOODgeKXi+ODnXzjg4Hil4/jg51844Gh44KT44Gh44KTfOODgeODs+ODgeODs3zjgaHjg7zjgpN844Gh44Cc44KTfOODgeOAnOODs3zjgabjgYPjgpPjgabjgYPjgpN844OG44Kj44Oz44OG44Kj44OzfOOBpuOBg+OCk+OBvXzjg4bjgqPjg7Pjg51844OH44Kr44GEfOODh+OCq+ODgeODs3zjg4fjg6rjg5jjg6t844Ga44KL44KA44GRfOOCuuODq+ODoOOCsXzjgarjgYvjgaDjgZd844Gq44GL44CH44GXfOOBquOBi+KXr+OBl3zjgarjgYvil4vjgZd844Gq44GL4peP44GXfOiEseOBknzjg4zjgYR844OM44GLfOODjOOCq3zjg4zjgY1844OM44KtfOODjOOBj3zjg4zjgq9844OM44GRfOODjOOCsXzjg4zjgZN844OM44KzfOOBseOBhOOCguOBv3zjgbHjgYTjgZrjgop844OR44Oz44OG44KjfOODkeOCpOOCuuODqnzjg5HjgqTjg5Hjg7N844OQ44Kk44OWfOODkeODkea0u3zjg4/jg6F844OU44K544OI44OzfOODk+ODg+ODgXzjgbXjgYbjg7t844G144GG4oCmfOOBteOBhXzvvozvval844G144GP44KJ44G/fOOBteOBj+OCieOCk+OBp3zjgbrjgaPjgZ9844G644KN44G644KNfOODmuODreODmuODrXzvvo3vvp/vvpvvvo3vvp/vvpt844OV44Kn44OpfOOBu+OBhuOBkeOBhHzjgbzjgaPjgY1844Od44Or44OOfOOBvOOCjeOCk3zjg5zjg63jg7N8776O776e776b776dfOOBveOCjeOCinzjg53jg63jg6p8776O776f776b776YfOOBvuODvOOCk3zjgb7jgJzjgpN844Oe44Cc44OzfOODnuODs+OBjeOBpHzjg57jg7Pjgq3jg4R844G+44KT44GTfOOBvuOAh+OBk3zjgb7il6/jgZN844G+4peL44GTfOOBvuKXj+OBk3zjg57jg7PjgrN844Oe44CH44KzfOODnuKXr+OCs3zjg57il4vjgrN844Oe4peP44KzfOOBvuOCk+OBleOCk3zjgoLjgaPjgZPjgop844Oi44OD44Kz44OqfOOCguOBv+OCguOBv3zjg6Ljg5/jg6Ljg59844Ok44Gj44GffOODpOOBo+OBpnzjg6Tjgol844KE44KJ44Gb44KNfOODpOOCinzjg6Tjg6p844Ok44Oq44OB44OzfOODpOODquODnuODs3zjg6Tjgot844Ok44KMfOODpOOCjXzjg6njg5bjg5t844Ov44Os44OhfOaEm+a2snzlkqV85ZaYfOmZsOaguHzpmbDojI586Zmw5ZSHfOa3q3zpmqDmr5t86Zmw5q+bfOeUo+OCgeOCi3zlpbPjga7lrZDjga7ml6V85rGa44Gj44GV44KTfOiyneWQiHzlp6Z86LKr6YCafOmojuS5l+S9jXzlt6jkubN85beo5qC5fOW3qOWwu3zlt6jjg4Hjg7N85beo54+NfOmHkeeOiXzmnIjntYx85b6M6IOM5L2NfOWtkOeornzlrZDkvZzjgop85bCE57K+fOa9ruWQuXzkv6HogIV857K+5rayfOmAj+OBkXzmgKfkuqR857K+5a2QfOato+W4uOS9jXzmgKflvrR85oCn55qEfOeUn+eQhnzntbblgKt85a+45q2i44KBfOe0oOadkHzmirHjgYR85oqx44GLfOaKseOBjXzmirHjgY985oqx44GRfOaKseOBk3zkvZPmtrJ85Lmz6aaWfOaBpeWeonznj43mo5J85Lit44Gg44GXfOS4reWHuuOBl3zlsL985oqc44GEfOaKnOOBkeOBquOBhHzmipzjgZHjgot85oqc44GR44KMfOaOkuS+v3zniq/nj4186Iao44KJfOWMheiMjnzli4Potbd86IacfOaRqee+hXzprZTnvoV85o+J44G+fOaPieOBv3zmj4njgoB85o+J44KBfOa8q+a5lnzjgIfvvZ584pev772efOKXi++9nnzil4/vvZ5844CHfnzil69+fOKXi3584pePfnzjgIfjg4Pjgq/jgrl84pev44OD44Kv44K5fOKXi+ODg+OCr+OCuXzil4/jg4Pjgq/jgrk=';
const ABUSIVE_B64 = '44CCfOOCouODi+ODl+ODrHzjgqLjgrnjg5p844GC44G7fOOCouODm3zpmL/lkYZ844Kk44Kr44KMfOOBhOOBvuOBhOOBoXzjgqTjg57jgqTjg4F844Kk44Op44Gk44GPfOOCpuOCuHzjgqbjg7zjg6h844Km44OofOOCpuODqOOCr3zjgqbjg7J844GG44KL44Gb44GIfOOCruOCueOCruOCuXzvvbfvvp7vvb3vvbfvvp7vvb1844GN44Gj44Gf44Gt44GIfOOBjeOBo+OBn+OBreOBh3zjgY3jgZ/jga3jgYh844GN44Gf44Gt44GHfOaxmuOBreOBiHzmsZrjga3jgYd844GN44KC44GEfOOCreODouOCpHzjgq3jg6LjgYR844KtL+ODoC/jg4F844Ks44Kk44K4fO+9tu++nu+9su+9vO++nnzjgqzjgqTjgrjjg7N844Ks44KtfOOCq+OCuXzjgq3jg4Pjgrp844GN44Gh44GM44GEfOOCreODgeOCrOOCpHzjgq3jg6Djg4F844GN44KJ44GEfOOCreODqeOCpHzlq4zjgYR8XuiPjCR844Kv44K9fOeznnzjgrfjg4p844K544OG44OefOOBpOOBvuOCieOBqnzjgaTjgb7jgonjgpN844OB44On44OD44OR44OqfOODgeODp+ODs3zljYPjg6fjg7N844Gk44G+44KJ44GqfOOBpOOCk+OBvHzjg4Tjg7Pjg5x844ON44OI44Km44OofOOBq+OBoOOBguOBgnzjg4vjg4B85LqM44OAfO++hu++gO++nnzjg5Hjg7zjg6h844OR44OofOODkeODqOOCr3zjg5Ljg4njgYR844OS44OJ44KkfF7jgbTjg7wkfF7jg5Tjg7wkfOOBtuOBo+OBlXzjg5bjg4PjgrV844G244GV44GEfOODluOCteOCpHzjg5jjgqTjg4jjgrnjg5Tjg7zjg4F844Ob44OifOOBvuOBrOOBkXzjg6Hjgq/jg6l844OQ44KrfOODkeOCr3zjg6DjgqvjgaTjgY986I2S44KJ44GXfOm6u+eUn+OCu+ODoeODs+ODiHzlj7Pnv7x85rGa54mpfOmdoueZveOBj+OBqnzmhbDlronlqaZ85a6z5YWQfOWkluWtl3zlp6blm7186Z+T5Zu9fOmfk+S4rXzpn5Pml6V85Z+65Zyw5aSWfOawl+eLguOBhHzmsJfpgZHjgYR85YiH44Gj44GffOWIh+OBo+OBpnzmsJfmjIHjgaHmgqp86IetfOWxkXzlt6XkvZzlk6F85Zu95Lqk5pat57W2fOWbveexjXzlm73jgavluLDjgox85Zu944G45biw44KMfOW3pue/vHzmrrp86aCDfOmgg+OBl3zpoIPjgZl86aCD44GbfF7lnKh85Zyo5pelfOWcqOaXpeeJueaoqXzlnKjnibnkvJp85Y+C5pS/5qipfOeyvuelnueVsOW4uOiAhXzmrbvjga185rCP44GtfO++gO++i3zmrbnljJV85q2544OSfOatu+WIkXzjgrfjgrHjgqR844GX44GR44GEfOWksemAn3zpmpzlrrN844K544OG44OefOWkp+adseS6nHzmlq3kuqR86YCa5ZCNfOS4remfk3zmnJ3prq585b6044Go44Gn44KLfOW+sOeUqOWxgHzlo7p85aO3fOWjvHzml6Xpn5N85pel5bidfOeymOedgHzljYrlspt85Y+N5pelfOWPjeawkeaXj3znpbXprbV855m655GefOeZuumPgnzmnLR85aOy5Zu9fOW+rOWmmXzkuI3lv6t85L2155CHfOmWk+aKnOOBkXzvvZHvvbjvvZHvvbh844Og44Kv44Og44KvfOeEoeiDvXzmvI/jgol85ryP44KMfOaWh+WPpXzpnZblm71856aP6YeO';
const CONSECUTIVE_SAME_CHARS = /(.)\1{7,}/;
const SPECIAL_COMMAND = /^\/[a-z][a-z0-9_-]*(?:\s|$)/;
/** 迷惑な統計コメント（設定に関わらず弾く） */
const ANNOYING_STATISTICAL = /最高\d+米\/|計\d+ＩＤ|総\d+米/;
/** ハイフン・ダッシュ・長音のような文字（照合の時は - にそろえる） */
const HYPHEN_LIKE = new Set([0x02d7, 0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2043, 0x2212, 0x23af, 0x23e4, 0x2500, 0x2501, 0x2e3a, 0x2e3b, 0x30fc, 0xff70, 0x007e, 0xff5e, 0x301c]);
/** 色の指定なし（白）とみなす色。ライブは #FFEAEA、録画はサーバーが #FFFFFF を付ける */
const DEFAULT_COLORS = new Set(['#FFEAEA', '#FFFFFF']);

const b64utf8 = (b64: string) => new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
let vulgar: RegExp | null = null;
let abusive: RegExp | null = null;

/** 照合用にそろえる: NFKC、全角英数記号→半角、全角空白→半角、ハイフンの仲間→ -、英字は小文字 */
export function normalizeCommentKeyword(text: string): string {
  let out = '';
  for (const ch of text.normalize('NFKC')) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0x3000) out += ' ';
    else if (cp >= 0xff01 && cp <= 0xff5d) out += String.fromCodePoint(cp - 0xfee0);
    else if (HYPHEN_LIKE.has(cp)) out += '-';
    else out += ch;
  }
  return out.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

export interface MuteTarget {
  text: string;
  color: string;
  /** right（流れる）/ top / bottom */
  position: string;
  userId?: string | null;
  size?: string | null;
  premium?: string | number | null;
}

export function isMutedComment(s: MuteSettings, c: MuteTarget): boolean {
  const norm = s.mute_comment_keywords_normalize_alphanumeric_width_case;
  const forMatch = norm ? normalizeCommentKeyword(c.text) : c.text;
  if (c.userId != null && s.muted_niconico_user_ids.includes(c.userId)) return true;
  // ニコ生の特殊コマンド付き（運営のコメント）
  if (SPECIAL_COMMAND.test(c.text) && c.premium != null && `${c.premium}` === '3') return true;
  if (s.mute_fixed_comments && (c.position === 'top' || c.position === 'bottom')) return true;
  if (s.mute_colored_comments && !DEFAULT_COLORS.has((c.color || '#FFEAEA').toUpperCase())) return true;
  if (s.mute_big_size_comments && c.size === 'big') return true;
  if (s.mute_vulgar_comments && (vulgar ??= new RegExp(b64utf8(VULGAR_B64))).test(c.text)) return true;
  if (s.mute_abusive_discriminatory_prejudiced_comments && (abusive ??= new RegExp(b64utf8(ABUSIVE_B64))).test(c.text)) return true;
  if (s.mute_consecutive_same_characters_comments && CONSECUTIVE_SAME_CHARS.test(c.text)) return true;
  for (const kw of s.muted_comment_keywords) {
    if (kw.pattern === '') continue;
    const pat = norm ? normalizeCommentKeyword(kw.pattern) : kw.pattern;
    switch (kw.match) {
      case 'partial': if (forMatch.includes(pat)) return true; break;
      case 'forward': if (forMatch.startsWith(pat)) return true; break;
      case 'backward': if (forMatch.endsWith(pat)) return true; break;
      case 'exact': if (forMatch === pat) return true; break;
      case 'regex': if (new RegExp(kw.pattern).test(c.text)) return true; break;
    }
  }
  return ANNOYING_STATISTICAL.test(c.text);
}

/** 録画の実況から、弾幕に流さないものを除く（一覧には全部出す。元と同じ） */
export const unmutedComments = (comments: Comment[], s: MuteSettings) =>
  comments.filter((c) => !isMutedComment(s, { text: c.text || '', color: c.color || '#FFEAEA', position: c.type || 'right' }));
