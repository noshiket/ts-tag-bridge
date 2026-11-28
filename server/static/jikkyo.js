/*
 * This file is derived from KonomiTV (https://github.com/tsukumijima/KonomiTV)
 * Original Copyright (c) 2021-2026 tsukumi
 * Licensed under the MIT License
 *
 * Modifications by encode_auto project
 *
 * 移植元:
 *   - client/src/services/player/managers/LiveCommentManager.ts
 *   - client/src/utils/CommentUtils.ts
 * NX-Jikkyo 専用のため、niconico アカウント連携・DPlayer・Pinia 依存は除去している。
 * React 非依存の素 JS として window.CommentUtils / window.LiveCommentManager をエクスポートする。
 */
/* global atob, TextDecoder */
(function () {
  'use strict';

  // ────────────────── helpers ──────────────────

  // base64 → UTF-8 文字列 (KonomiTV の Buffer.from(b64,'base64').toString() 相当)
  function b64utf8(b64) {
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function sleep(sec) {
    return new Promise((resolve) => setTimeout(resolve, sec * 1000));
  }

  // Date → 'HH:mm:ss'
  function formatHMS(date) {
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    return `${h}:${m}:${s}`;
  }

  // 4時未満を 24〜27時表記にする (28時間時計)
  function apply28HourClock(hms) {
    const [h, m, s] = hms.split(':').map(Number);
    const hh = h < 4 ? h + 24 : h;
    return `${String(hh).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  // ────────────────── CommentUtils ──────────────────

  const MUTE_SETTINGS_KEY = 'jikkyo_mute_settings';

  const DEFAULT_MUTE_SETTINGS = {
    muted_niconico_user_ids: [],
    muted_comment_keywords: [], // [{ match: 'partial'|'forward'|'backward'|'exact'|'regex', pattern: string }]
    mute_comment_keywords_normalize_alphanumeric_width_case: true,
    mute_fixed_comments: false,
    mute_colored_comments: false,
    mute_big_size_comments: false,
    mute_vulgar_comments: false,
    mute_abusive_discriminatory_prejudiced_comments: false,
    mute_consecutive_same_characters_comments: false,
    // ── 弾幕の表示設定(ミュートと同じキーでlocalStorageにキャッシュ) ──
    comment_opacity: 0.5,        // 弾幕レイヤーの不透明度(KonomiTV既定0.5)
    comment_font_scale: 1.0,     // フォントサイズ倍率(基準: 34px×幅比)
    comment_max_onscreen: 100,   // 画面に同時に出る流れるコメント数の上限(top/bottom固定は対象外)
  };

  // 「露骨な表現を含むコメントをミュートする」のフィルタ正規表現 (KonomiTV から verbatim コピー)
  const VULGAR_B64 = 'XChpXCl8XChVXCl8cHJwcnzvvZDvvZLvvZDvvZJ8U0VYfFPjgIdYfFPil69YfFPil4tYfFPil49YfO+8s++8pe+8uHzvvLPjgIfvvLh877yz4pev77y4fO+8s+KXi++8uHzvvLPil4/vvLh844Ki44OA44Or44OIfOOCouOCveOCs3zjgqLjg4rjgqV844Ki44OK44OrfOOCpOOCq+iHrXzjgqTjgY9844Kk44Oz44OdfOOBhuOCk+OBk3zjgqbjg7PjgrN844GG44KT44GhfOOCpuODs+ODgXzjgqjjgq3jg5t844GI44Gh44GI44GhfOOBiOOBo+OBoXzjgqjjg4Pjg4F844GI44Gj44KNfOOCqOODg+ODrXxe44GI44KNfOOBiOOCjeOBhHzjgqjjg6185bel5Y+jfOOCquOCq+OCunzjgYrjgZXjgo/jgorjgb7jgpN844GK44GX44Gj44GTfOOCquOCt+ODg+OCs3zjgqrjg4PjgrXjg7N844GK44Gj44Gx44GEfOOCquODg+ODkeOCpHzjgqrjg4rjg4vjg7x844GK44Gq44G7fOOCquODiuODm3zjgYrjgbHjgYR844Kq44OR44KkfO+9te++iu++n++9snzjgYrjgb7jgZ9844Kq44Oe44K/fO+9te++j+++gHzjgYrjgoHjgZN844Kq44Oh44KzfO+9te++ku+9unzjgYpwfOOBiu+9kHzjgqrjg5Xjg5HjgrN844Ks44OB44Og44OBfOOCreODoeOCu+OCr3zjgq3jg7Pjgr/jg55844GP44Gx44GCfOOBj+OBseOBgXzjgq/jg6rjg4jjg6rjgrl844Kv44Oz44OLfOOBlOOBj+OBlOOBj+OBlOOBj+OBlOOBj3zjgrPjg7Pjg4njg7zjg6B844GR44Gk44GC44GqfOOCseODhOOCouODinzjgrHjg4TnqbR844K244O844Oh44OzfOOCt+OCs3zjgZfjgZPjgZfjgZN844K344KzfOOBmeOBkeOBmeOBkXzjgZvjgYTjgYjjgY1844Gb44GE44KKfOOBm+ODvOOCinzjgZnjgYXjgYXjgYV844GZ44GG44GG44GGfOOCu+OCr+ODreOCuXzjgrvjg4Pjgq/jgrl844K744OV44OsfOOBoeOBo+OBseOBhHzjgaHjgaPjg5HjgqR844OB44OD44OR44KkfOOBoeOCk+OBk3zjgaHjgIfjgZN844Gh4pev44GTfOOBoeKXi+OBk3zjgaHil4/jgZN844OB44Oz44KzfOODgeOAh+OCs3zjg4Hil6/jgrN844OB4peL44KzfOODgeKXj+OCs3zjgaHjgpPjgb1844Gh44CH44G9fOOBoeKXr+OBvXzjgaHil4vjgb1844Gh4peP44G9fOODgeODs+ODnXzjg4HjgIfjg51844OB4pev44OdfOODgeKXi+ODnXzjg4Hil4/jg51844Gh44KT44Gh44KTfOODgeODs+ODgeODs3zjgaHjg7zjgpN844Gh44Cc44KTfOODgeOAnOODs3zjgabjgYPjgpPjgabjgYPjgpN844OG44Kj44Oz44OG44Kj44OzfOOBpuOBg+OCk+OBvXzjg4bjgqPjg7Pjg51844OH44Kr44GEfOODh+OCq+ODgeODs3zjg4fjg6rjg5jjg6t844Ga44KL44KA44GRfOOCuuODq+ODoOOCsXzjgarjgYvjgaDjgZd844Gq44GL44CH44GXfOOBquOBi+KXr+OBl3zjgarjgYvil4vjgZd844Gq44GL4peP44GXfOiEseOBknzjg4zjgYR844OM44GLfOODjOOCq3zjg4zjgY1844OM44KtfOODjOOBj3zjg4zjgq9844OM44GRfOODjOOCsXzjg4zjgZN844OM44KzfOOBseOBhOOCguOBv3zjgbHjgYTjgZrjgop844OR44Oz44OG44KjfOODkeOCpOOCuuODqnzjg5HjgqTjg5Hjg7N844OQ44Kk44OWfOODkeODkea0u3zjg4/jg6F844OU44K544OI44OzfOODk+ODg+ODgXzjgbXjgYbjg7t844G144GG4oCmfOOBteOBhXzvvozvval844G144GP44KJ44G/fOOBteOBj+OCieOCk+OBp3zjgbrjgaPjgZ9844G644KN44G644KNfOODmuODreODmuODrXzvvo3vvp/vvpvvvo3vvp/vvpt844OV44Kn44OpfOOBu+OBhuOBkeOBhHzjgbzjgaPjgY1844Od44Or44OOfOOBvOOCjeOCk3zjg5zjg63jg7N8776O776e776b776dfOOBveOCjeOCinzjg53jg63jg6p8776O776f776b776YfOOBvuODvOOCk3zjgb7jgJzjgpN844Oe44Cc44OzfOODnuODs+OBjeOBpHzjg57jg7Pjgq3jg4R844G+44KT44GTfOOBvuOAh+OBk3zjgb7il6/jgZN844G+4peL44GTfOOBvuKXj+OBk3zjg57jg7PjgrN844Oe44CH44KzfOODnuKXr+OCs3zjg57il4vjgrN844Oe4peP44KzfOOBvuOCk+OBleOCk3zjgoLjgaPjgZPjgop844Oi44OD44Kz44OqfOOCguOBv+OCguOBv3zjg6Ljg5/jg6Ljg59844Ok44Gj44GffOODpOOBo+OBpnzjg6Tjgol844KE44KJ44Gb44KNfOODpOOCinzjg6Tjg6p844Ok44Oq44OB44OzfOODpOODquODnuODs3zjg6Tjgot844Ok44KMfOODpOOCjXzjg6njg5bjg5t844Ov44Os44OhfOaEm+a2snzlkqV85ZaYfOmZsOaguHzpmbDojI586Zmw5ZSHfOa3q3zpmqDmr5t86Zmw5q+bfOeUo+OCgeOCi3zlpbPjga7lrZDjga7ml6V85rGa44Gj44GV44KTfOiyneWQiHzlp6Z86LKr6YCafOmojuS5l+S9jXzlt6jkubN85beo5qC5fOW3qOWwu3zlt6jjg4Hjg7N85beo54+NfOmHkeeOiXzmnIjntYx85b6M6IOM5L2NfOWtkOeornzlrZDkvZzjgop85bCE57K+fOa9ruWQuXzkv6HogIV857K+5rayfOmAj+OBkXzmgKfkuqR857K+5a2QfOato+W4uOS9jXzmgKflvrR85oCn55qEfOeUn+eQhnzntbblgKt85a+45q2i44KBfOe0oOadkHzmirHjgYR85oqx44GLfOaKseOBjXzmirHjgY985oqx44GRfOaKseOBk3zkvZPmtrJ85Lmz6aaWfOaBpeWeonznj43mo5J85Lit44Gg44GXfOS4reWHuuOBl3zlsL985oqc44GEfOaKnOOBkeOBquOBhHzmipzjgZHjgot85oqc44GR44KMfOaOkuS+v3zniq/nj4186Iao44KJfOWMheiMjnzli4Potbd86IacfOaRqee+hXzprZTnvoV85o+J44G+fOaPieOBv3zmj4njgoB85o+J44KBfOa8q+a5lnzjgIfvvZ584pev772efOKXi++9nnzil4/vvZ5844CHfnzil69+fOKXi3584pePfnzjgIfjg4Pjgq/jgrl84pev44OD44Kv44K5fOKXi+ODg+OCr+OCuXzil4/jg4Pjgq/jgrk=';

  // 「ネガティブ・差別的・政治的に偏った表現を含むコメントをミュートする」のフィルタ正規表現 (KonomiTV から verbatim コピー)
  const ABUSIVE_B64 = '44CCfOOCouODi+ODl+ODrHzjgqLjgrnjg5p844GC44G7fOOCouODm3zpmL/lkYZ844Kk44Kr44KMfOOBhOOBvuOBhOOBoXzjgqTjg57jgqTjg4F844Kk44Op44Gk44GPfOOCpuOCuHzjgqbjg7zjg6h844Km44OofOOCpuODqOOCr3zjgqbjg7J844GG44KL44Gb44GIfOOCruOCueOCruOCuXzvvbfvvp7vvb3vvbfvvp7vvb1844GN44Gj44Gf44Gt44GIfOOBjeOBo+OBn+OBreOBh3zjgY3jgZ/jga3jgYh844GN44Gf44Gt44GHfOaxmuOBreOBiHzmsZrjga3jgYd844GN44KC44GEfOOCreODouOCpHzjgq3jg6LjgYR844KtL+ODoC/jg4F844Ks44Kk44K4fO+9tu++nu+9su+9vO++nnzjgqzjgqTjgrjjg7N844Ks44KtfOOCq+OCuXzjgq3jg4Pjgrp844GN44Gh44GM44GEfOOCreODgeOCrOOCpHzjgq3jg6Djg4F844GN44KJ44GEfOOCreODqeOCpHzlq4zjgYR8XuiPjCR844Kv44K9fOeznnzjgrfjg4p844K544OG44OefOOBpOOBvuOCieOBqnzjgaTjgb7jgonjgpN844OB44On44OD44OR44OqfOODgeODp+ODs3zljYPjg6fjg7N844Gk44G+44KJ44GqfOOBpOOCk+OBvHzjg4Tjg7Pjg5x844ON44OI44Km44OofOOBq+OBoOOBguOBgnzjg4vjg4B85LqM44OAfO++hu++gO++nnzjg5Hjg7zjg6h844OR44OofOODkeODqOOCr3zjg5Ljg4njgYR844OS44OJ44KkfF7jgbTjg7wkfF7jg5Tjg7wkfOOBtuOBo+OBlXzjg5bjg4PjgrV844G244GV44GEfOODluOCteOCpHzjg5jjgqTjg4jjgrnjg5Tjg7zjg4F844Ob44OifOOBvuOBrOOBkXzjg6Hjgq/jg6l844OQ44KrfOODkeOCr3zjg6DjgqvjgaTjgY986I2S44KJ44GXfOm6u+eUn+OCu+ODoeODs+ODiHzlj7Pnv7x85rGa54mpfOmdoueZveOBj+OBqnzmhbDlronlqaZ85a6z5YWQfOWkluWtl3zlp6blm7186Z+T5Zu9fOmfk+S4rXzpn5Pml6V85Z+65Zyw5aSWfOawl+eLguOBhHzmsJfpgZHjgYR85YiH44Gj44GffOWIh+OBo+OBpnzmsJfmjIHjgaHmgqp86IetfOWxkXzlt6XkvZzlk6F85Zu95Lqk5pat57W2fOWbveexjXzlm73jgavluLDjgox85Zu944G45biw44KMfOW3pue/vHzmrrp86aCDfOmgg+OBl3zpoIPjgZl86aCD44GbfF7lnKh85Zyo5pelfOWcqOaXpeeJueaoqXzlnKjnibnkvJp85Y+C5pS/5qipfOeyvuelnueVsOW4uOiAhXzmrbvjga185rCP44GtfO++gO++i3zmrbnljJV85q2544OSfOatu+WIkXzjgrfjgrHjgqR844GX44GR44GEfOWksemAn3zpmpzlrrN844K544OG44OefOWkp+adseS6nHzmlq3kuqR86YCa5ZCNfOS4remfk3zmnJ3prq585b6044Go44Gn44KLfOW+sOeUqOWxgHzlo7p85aO3fOWjvHzml6Xpn5N85pel5bidfOeymOedgHzljYrlspt85Y+N5pelfOWPjeawkeaXj3znpbXprbV855m655GefOeZuumPgnzmnLR85aOy5Zu9fOW+rOWmmXzkuI3lv6t85L2155CHfOmWk+aKnOOBkXzvvZHvvbjvvZHvvbh844Og44Kv44Og44KvfOeEoeiDvXzmvI/jgol85ryP44KMfOaWh+WPpXzpnZblm71856aP6YeO';

  // 8文字以上同じ文字が連続しているコメントのフィルタ正規表現
  const CONSECUTIVE_SAME_CHARS_PATTERN = /(.)\1{7,}/;

  // ニコ生の特殊コマンド付きコメントのフィルタ正規表現
  const SPECIAL_COMMAND_PATTERN = /^\/[a-z][a-z0-9_-]*(?:\s|$)/;

  // 迷惑な統計コメントのフィルタ正規表現
  const ANNOYING_STATISTICAL_PATTERN = /最高\d+米\/|計\d+ＩＤ|総\d+米/;

  // ハイフン・ダッシュ・長音系の文字を半角ハイフンマイナス (U+002D) に統一するマップ
  const HYPHEN_LIKE_CHAR_MAP = new Map([
    [0x02d7, '-'], [0x2010, '-'], [0x2011, '-'], [0x2012, '-'], [0x2013, '-'],
    [0x2014, '-'], [0x2015, '-'], [0x2043, '-'], [0x2212, '-'], [0x23af, '-'],
    [0x23e4, '-'], [0x2500, '-'], [0x2501, '-'], [0x2e3a, '-'], [0x2e3b, '-'],
    [0x30fc, '-'], [0xff70, '-'], [0x007e, '-'], [0xff5e, '-'], [0x301c, '-'],
  ]);

  // ニコニコの色指定を 16 進数カラーコードに置換するテーブル
  const COLOR_TABLE = {
    white: '#FFEAEA', red: '#F02840', pink: '#FD7E80', orange: '#FDA708',
    yellow: '#FFE133', green: '#64DD17', cyan: '#00D4F5', blue: '#4763FF',
    purple: '#D500F9', black: '#1E1310', white2: '#CCCC99', niconicowhite: '#CCCC99',
    red2: '#CC0033', truered: '#CC0033', pink2: '#FF33CC', orange2: '#FF6600',
    passionorange: '#FF6600', yellow2: '#999900', madyellow: '#999900',
    green2: '#00CC66', elementalgreen: '#00CC66', cyan2: '#00CCCC', blue2: '#3399FF',
    marineblue: '#3399FF', purple2: '#6633CC', nobleviolet: '#6633CC', black2: '#666666',
  };

  // 「色指定なし(白)」とみなす色。ライブ弾幕は COLOR_TABLE.white、録画コメントは
  // サーバが付与する #FFFFFF。色付きコメントのミュート判定でどちらも除外する。
  const DEFAULT_COMMENT_COLORS = new Set(['#FFEAEA', '#FFFFFF']);

  const CommentUtils = {
    // 遅延コンパイルする正規表現
    _vulgarPattern: null,
    _abusivePattern: null,

    // 高頻度呼び出し(弾幕emit毎・ミュート判定毎)されるためメモリキャッシュする。
    // saveSettings で無効化されるので同一タブ内は常に最新
    _settingsCache: null,
    getSettings() {
      if (this._settingsCache) return { ...this._settingsCache };
      try {
        const raw = localStorage.getItem(MUTE_SETTINGS_KEY);
        this._settingsCache = raw ? { ...DEFAULT_MUTE_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_MUTE_SETTINGS };
      } catch (e) {
        this._settingsCache = { ...DEFAULT_MUTE_SETTINGS };
      }
      return { ...this._settingsCache };
    },

    // 設定変更の購読(プレイヤーが弾幕へ即時反映するため)
    _settingsListeners: new Set(),
    subscribeSettings(fn) {
      this._settingsListeners.add(fn);
      return () => this._settingsListeners.delete(fn);
    },

    saveSettings(settings) {
      localStorage.setItem(MUTE_SETTINGS_KEY, JSON.stringify(settings));
      this._settingsCache = null;
      this._settingsListeners.forEach(fn => { try { fn(); } catch (e) {} });
    },

    getCommentColor(color) {
      if (/^#[0-9A-Fa-f]{6}$/.test(color)) return color;
      return COLOR_TABLE[color] || null;
    },

    getCommentPosition(position) {
      switch (position) {
        case 'ue': return 'top';
        case 'naka': return 'right';
        case 'shita': return 'bottom';
        default: return null;
      }
    },

    getCommentSize(size) {
      switch (size) {
        case 'big':
        case 'medium':
        case 'small': return size;
        default: return null;
      }
    },

    normalizeCommentKeyword(text) {
      const nfkc = text.normalize('NFKC');
      let normalized = '';
      for (const character of nfkc) {
        const cp = character.codePointAt(0);
        if (cp === undefined) {
          normalized += character;
        } else if (cp === 0x3000) {
          normalized += ' ';
        } else if (cp >= 0xff01 && cp <= 0xff5d) {
          normalized += String.fromCodePoint(cp - 0xfee0);
        } else if (HYPHEN_LIKE_CHAR_MAP.has(cp)) {
          normalized += HYPHEN_LIKE_CHAR_MAP.get(cp);
        } else {
          normalized += character;
        }
      }
      return normalized.replace(/[A-Z]/g, (c) => c.toLowerCase());
    },

    isSpecialCommandComment(comment, premium) {
      if (SPECIAL_COMMAND_PATTERN.test(comment) === false) return false;
      if (premium !== undefined && premium !== null) return `${premium}` === '3';
      return false;
    },

    parseCommentCommand(commentMail) {
      let color = '#FFEAEA';
      let position = 'right';
      let size = 'medium';
      if (commentMail !== undefined && commentMail !== null) {
        const commands = commentMail.replace('184', '').split(' ');
        for (const command of commands) {
          const parsedColor = this.getCommentColor(command);
          const parsedPosition = this.getCommentPosition(command);
          const parsedSize = this.getCommentSize(command);
          if (parsedColor !== null) color = parsedColor;
          if (parsedPosition !== null) position = parsedPosition;
          if (parsedSize !== null) size = parsedSize;
        }
      }
      return { color, position, size };
    },

    isMutedComment(comment, userId, color, position, size, premium) {
      const settings = this.getSettings();

      const shouldNormalize = settings.mute_comment_keywords_normalize_alphanumeric_width_case === true;
      const commentForMatching = shouldNormalize ? this.normalizeCommentKeyword(comment) : comment;

      // ユーザー ID ミュート
      if (settings.muted_niconico_user_ids.includes(userId)) return true;

      // ニコ生の特殊コマンド付きコメント
      if (this.isSpecialCommandComment(comment, premium)) return true;

      // 上下固定コメント
      if (settings.mute_fixed_comments === true && (position === 'top' || position === 'bottom')) return true;

      // 色付きコメント
      // 「色指定なし＝白」の既定値はライブ(COLOR_TABLE の white)が #FFEAEA、録画
      // (サーバ read_tsprogram/comments.py の _parse_comment_color)が #FFFFFF と異なるため、
      // どちらも「色なし」として扱う(これを揃えないと録画の白コメントが全て消える)。
      if (settings.mute_colored_comments === true
          && !DEFAULT_COMMENT_COLORS.has(String(color || '#FFEAEA').toUpperCase())) return true;

      // 大サイズコメント
      if (settings.mute_big_size_comments === true && size === 'big') return true;

      // 露骨な表現
      if (settings.mute_vulgar_comments === true) {
        if (this._vulgarPattern === null) this._vulgarPattern = new RegExp(b64utf8(VULGAR_B64));
        if (this._vulgarPattern.test(comment)) return true;
      }

      // ネガティブ・差別的・政治的に偏った表現
      if (settings.mute_abusive_discriminatory_prejudiced_comments === true) {
        if (this._abusivePattern === null) this._abusivePattern = new RegExp(b64utf8(ABUSIVE_B64));
        if (this._abusivePattern.test(comment)) return true;
      }

      // 8文字以上同じ文字が連続
      if (settings.mute_consecutive_same_characters_comments === true && CONSECUTIVE_SAME_CHARS_PATTERN.test(comment)) {
        return true;
      }

      // キーワードミュート
      for (const kw of settings.muted_comment_keywords) {
        if (kw.pattern === '') continue;
        const pat = shouldNormalize ? this.normalizeCommentKeyword(kw.pattern) : kw.pattern;
        switch (kw.match) {
          case 'partial': if (commentForMatching.includes(pat)) return true; break;
          case 'forward': if (commentForMatching.startsWith(pat)) return true; break;
          case 'backward': if (commentForMatching.endsWith(pat)) return true; break;
          case 'exact': if (commentForMatching === pat) return true; break;
          case 'regex': if (new RegExp(kw.pattern).test(comment)) return true; break;
        }
      }

      // 迷惑な統計コメント (デフォルトで弾く)
      if (ANNOYING_STATISTICAL_PATTERN.test(comment)) return true;

      return false;
    },

    // ミュート済みキーワード (完全一致) に追加
    addMutedKeyword(comment) {
      const settings = this.getSettings();
      const shouldNormalize = settings.mute_comment_keywords_normalize_alphanumeric_width_case === true;
      const normalized = shouldNormalize ? this.normalizeCommentKeyword(comment) : comment;
      for (const kw of settings.muted_comment_keywords) {
        const nk = shouldNormalize ? this.normalizeCommentKeyword(kw.pattern) : kw.pattern;
        if (kw.match === 'exact' && nk === normalized) return;
      }
      settings.muted_comment_keywords.push({ match: 'exact', pattern: comment });
      this.saveSettings(settings);
    },

    // ミュート済みニコニコユーザー ID に追加
    addMutedUserId(userId) {
      const settings = this.getSettings();
      if (settings.muted_niconico_user_ids.includes(userId)) return;
      settings.muted_niconico_user_ids.push(userId);
      this.saveSettings(settings);
    },
  };

  // ────────────────── LiveCommentManager ──────────────────

  // DPlayer 位置 → ニコニコ位置コマンド
  const POSITION_TABLE = { top: 'ue', right: 'naka', bottom: 'shita' };
  // 16進数カラー → ニコニコ色コマンド
  const COLOR_COMMAND_TABLE = {
    '#FFEAEA': 'white', '#F02840': 'red', '#FD7E80': 'pink', '#FDA708': 'orange',
    '#FFE133': 'yellow', '#64DD17': 'green', '#00D4F5': 'cyan', '#4763FF': 'blue',
  };

  /**
   * NX-Jikkyo からリアルタイムにコメントを受信し、コールバックで通知するマネージャ
   * 移植元: LiveCommentManager (niconico/DPlayer 依存を除去)
   */
  class LiveCommentManager {
    /**
     * @param {Object} opts
     * @param {string} opts.wsInfoUrl  WS 接続情報を返すサーバー API の URL (/api/streams/live/<ch>/jikkyo)
     * @param {HTMLVideoElement} opts.video  再生中の video 要素 (遅延補正・再生中判定に使用)
     * @param {(comment: Object, meta: {isInitial: boolean}) => void} opts.onComment  コメント受信コールバック
     * @param {(message: string, color?: string) => void} [opts.onNotice]  通知コールバック
     */
    constructor(opts) {
      this.wsInfoUrl = opts.wsInfoUrl;
      this.video = opts.video;
      this.onComment = opts.onComment;
      this.onNotice = opts.onNotice || (() => {});

      this.watch_session = null;
      this.comment_session = null;
      this.vpos_base_timestamp = 0;
      this.keep_seat_interval_id = null;
      this.abort_controller = new AbortController();
      this.reconnecting = false;
      this.destroyed = false;
      // 初期化失敗メッセージ (null 以外なら投稿不可)
      this.init_failed_message = null;
    }

    _notice(message, color) {
      this.onNotice(message, color);
    }

    async init() {
      this.destroyed = false;
      const watchInfo = await this.initWatchSession();
      if (watchInfo.is_success === false) {
        this.init_failed_message = watchInfo.detail;
        console.error(`[LiveCommentManager][WatchSession] Error: ${watchInfo.detail}`);
        if (watchInfo.detail !== 'このチャンネルは実況に対応していません。') {
          this._notice(watchInfo.detail, '#FF6F6A');
        }
        return;
      }
      this.initCommentSession(watchInfo);
      console.log('[LiveCommentManager] Initialized.');
    }

    async initWatchSession() {
      let isDisconnectReceived = false;

      // サーバーから NX-Jikkyo の WebSocket URL を取得
      let wsInfo;
      try {
        const res = await fetch(this.wsInfoUrl);
        wsInfo = await res.json();
      } catch (e) {
        return { is_success: false, detail: 'コメント受信用 WebSocket API の情報を取得できませんでした。' };
      }
      if (!wsInfo || wsInfo.watch_session_url === null || wsInfo.watch_session_url === undefined) {
        return { is_success: false, detail: 'このチャンネルは実況に対応していません。' };
      }

      const watchSessionUrl = wsInfo.watch_session_url;
      console.log(`[LiveCommentManager][WatchSession] Connecting to ${watchSessionUrl}`);
      this.watch_session = new WebSocket(watchSessionUrl);

      // 接続が開かれたら視聴セッションをリクエスト
      this.watch_session.addEventListener('open', () => {
        this.watch_session?.send(JSON.stringify({ type: 'startWatching', data: { reconnect: false } }));
      }, { signal: this.abort_controller.signal });

      // 接続が閉じられたとき
      const onClose = async (event) => {
        if (isDisconnectReceived === true) return;
        const code = event instanceof CloseEvent ? event.code : 'Error';
        this._notice(`NX-Jikkyo との接続が切断されました。(Code: ${code})`, '#FF6F6A');
        console.error(`[LiveCommentManager][WatchSession] Connection closed. (Code: ${code})`);
        await sleep(3);
        await this.reconnect();
      };
      this.watch_session.addEventListener('close', onClose, { signal: this.abort_controller.signal });
      this.watch_session.addEventListener('error', onClose, { signal: this.abort_controller.signal });

      // セッション維持・再接続のためのメッセージ処理
      this.watch_session.addEventListener('message', async (event) => {
        if (this.watch_session === null) return;
        const message = JSON.parse(event.data);
        switch (message.type) {
          case 'seat': {
            if (this.keep_seat_interval_id !== null) break;
            this.keep_seat_interval_id = window.setInterval(() => {
              if (this.watch_session && this.watch_session.readyState === WebSocket.OPEN) {
                this.watch_session.send(JSON.stringify({ type: 'keepSeat' }));
              } else {
                window.clearInterval(this.keep_seat_interval_id ?? 0);
              }
            }, message.data.keepIntervalSec * 1000);
            break;
          }
          case 'ping': {
            this.watch_session.send(JSON.stringify({ type: 'pong' }));
            break;
          }
          case 'error': {
            if (message.data.code === 'COMMENT_POST_NOT_ALLOWED' || message.data.code === 'INVALID_MESSAGE') break;
            let error = `NX-Jikkyo でエラーが発生しています。(Code: ${message.data.code})`;
            switch (message.data.code) {
              case 'CONNECT_ERROR': error = 'NX-Jikkyo のコメントサーバーに接続できません。'; break;
              case 'CONTENT_NOT_READY': error = 'NX-Jikkyo が配信できない状態です。'; break;
              case 'NO_THREAD_AVAILABLE': error = 'NX-Jikkyo のコメントスレッドを取得できません。'; break;
              case 'NO_ROOM_AVAILABLE': error = 'NX-Jikkyo のコメント部屋を取得できません。'; break;
              case 'NO_PERMISSION': error = 'NX-Jikkyo の API にアクセスする権限がありません。'; break;
              case 'NOT_ON_AIR': error = 'NX-Jikkyo が放送中ではありません。'; break;
              case 'BROADCAST_NOT_FOUND': error = 'NX-Jikkyo の配信情報を取得できません。'; break;
              case 'INTERNAL_SERVERERROR': error = 'NX-Jikkyo でサーバーエラーが発生しています。'; break;
            }
            this._notice(error, '#FF6F6A');
            console.error(`[LiveCommentManager][WatchSession] Error occurred. (Code: ${message.data.code})`);
            await sleep(3);
            await this.reconnect();
            break;
          }
          case 'reconnect': {
            await this.reconnect();
            break;
          }
          case 'disconnect': {
            isDisconnectReceived = true;
            let reason = `NX-Jikkyo との接続が切断されました。(${message.data.reason})`;
            switch (message.data.reason) {
              case 'TAKEOVER': reason = 'NX-Jikkyo の番組から追い出されました。'; break;
              case 'NO_PERMISSION': reason = 'NX-Jikkyo の番組の座席を取得できませんでした。'; break;
              case 'END_PROGRAM': reason = 'NX-Jikkyo がリセットされたか、番組が終了しました。'; break;
              case 'PING_TIMEOUT': reason = 'コメントサーバーとの接続生存確認に失敗しました。'; break;
              case 'TOO_MANY_CONNECTIONS': reason = 'NX-Jikkyo の同一ユーザからの接続数上限を越えています。'; break;
              case 'TOO_MANY_WATCHINGS': reason = 'NX-Jikkyo の同一ユーザからの視聴番組数上限を越えています。'; break;
              case 'CROWDED': reason = 'NX-Jikkyo の番組が満席です。'; break;
              case 'MAINTENANCE_IN': reason = 'NX-Jikkyo はメンテナンス中です。'; break;
              case 'SERVICE_TEMPORARILY_UNAVAILABLE': reason = 'NX-Jikkyo で一時的にサーバーエラーが発生しています。'; break;
            }
            this._notice(reason, '#FF6F6A');
            console.error(`[LiveCommentManager][WatchSession] Disconnected. (Reason: ${message.data.reason})`);
            await sleep(3);
            await this.reconnect();
            break;
          }
        }
      }, { signal: this.abort_controller.signal });

      // コメントサーバーへの接続情報を room / messageServer メッセージから取得
      return new Promise((resolve) => {
        this.watch_session.addEventListener('message', (event) => {
          const message = JSON.parse(event.data);
          // NX-Jikkyo は room メッセージを送信する
          if (message.type === 'room') {
            this.vpos_base_timestamp = new Date(message.data.vposBaseTime).getTime();
            console.log(`[LiveCommentManager][WatchSession] Connected.\nThread ID: ${message.data.threadId}`);
            resolve({
              is_success: true,
              detail: '視聴セッションを取得しました。',
              message_server_url: message.data.messageServer.uri,
              thread_id: message.data.threadId,
              your_post_key: message.data.yourPostKey ? message.data.yourPostKey : null,
            });
          // 新ニコ生互換の messageServer メッセージ (フォールバックでサーバー提供の comment_session_url を使う)
          } else if (message.type === 'messageServer') {
            this.vpos_base_timestamp = new Date(message.data.vposBaseTime).getTime();
            const hashedUserId = message.data.hashedUserId;
            console.log('[LiveCommentManager][WatchSession] Connected.');
            resolve({
              is_success: true,
              detail: '視聴セッションを取得しました。',
              message_server_url: wsInfo.comment_session_url,
              thread_id: '',
              your_post_key: `nicolive:${hashedUserId}`,
            });
          }
        }, { signal: this.abort_controller.signal });
      });
    }

    initCommentSession(info) {
      const initialBuffer = [];
      let initialReceived = false;

      this.comment_session = new WebSocket(info.message_server_url);

      this.comment_session.addEventListener('open', () => {
        if (this.comment_session === null) return;
        this.comment_session.send(JSON.stringify([
          { ping: { content: 'rs:0' } },
          { ping: { content: 'ps:0' } },
          {
            thread: {
              version: '20061206',
              thread: info.thread_id,
              threadkey: info.your_post_key,
              user_id: '',
              res_from: -100,
            },
          },
          { ping: { content: 'pf:0' } },
          { ping: { content: 'rf:0' } },
        ]));
      }, { signal: this.abort_controller.signal });

      const onClose = async (event) => {
        const code = event instanceof CloseEvent ? event.code : 'Error';
        this._notice(`NX-Jikkyo との接続が切断されました。(Code: ${code})`, '#FF6F6A');
        console.error(`[LiveCommentManager][CommentSession] Connection closed. (Code: ${code})`);
        await sleep(3);
        await this.reconnect();
      };
      this.comment_session.addEventListener('close', onClose, { signal: this.abort_controller.signal });
      this.comment_session.addEventListener('error', onClose, { signal: this.abort_controller.signal });

      this.comment_session.addEventListener('message', async (event) => {
        const message = JSON.parse(event.data);

        if (message.thread !== undefined) {
          if (message.thread.resultcode !== 0) {
            console.error(`[LiveCommentManager][CommentSession] Connection failed. (Code: ${message.thread.resultcode})`);
            return;
          }
        }

        // rf:0 を受信したら初期コメントの受信完了
        if (message.ping !== undefined && message.ping.content === 'rf:0') {
          initialReceived = true;
          if (this.destroyed === false) {
            for (const c of initialBuffer) this.onComment(c, { isInitial: true });
          }
          initialBuffer.length = 0;
          return;
        }

        const comment = message.chat;

        // 不正なコメント or 自分の投稿 (yourpost) は弾く
        if ((comment === undefined || comment.content === undefined || comment.content === '') ||
            (comment.yourpost && comment.yourpost === 1 && initialReceived === true)) {
          return;
        }

        // コメントコマンドをパース
        const { color, position, size } = CommentUtils.parseCommentCommand(comment.mail);

        // ミュート判定
        if (CommentUtils.isMutedComment(comment.content, comment.user_id, color, position, size, comment.premium ?? null)) {
          return;
        }

        const commentData = {
          id: comment.no,
          text: comment.content,
          time: apply28HourClock(formatHMS(new Date(comment.date * 1000))),
          color: color,
          position: position,
          size: size,
          user_id: comment.user_id,
          premium: comment.premium ?? null,
          my_post: false,
        };

        // 初期コメントはバッファに溜めて rf:0 でまとめて通知
        if (initialReceived === false) {
          initialBuffer.push(commentData);
          return;
        }

        // 配信遅延分待ってから通知 (danmaku と映像のタイミングを合わせる)
        let bufferedEnd = 0;
        if (this.video && this.video.buffered.length >= 1) {
          bufferedEnd = this.video.buffered.end(0);
        }
        const delay = this.video ? Math.max(bufferedEnd - this.video.currentTime, 0) : 0;
        await sleep(delay);

        if (this.destroyed === false) {
          this.onComment(commentData, { isInitial: false });
        }
      }, { signal: this.abort_controller.signal });
    }

    /**
     * NX-Jikkyo にコメントを送信する
     * @param {Object} options { text, color('#FFEAEA'), position('top'|'right'|'bottom'), size('big'|'medium'|'small') }
     * @returns {Promise<void>} 成功で resolve、失敗で reject(errorMessage)
     */
    sendComment(options) {
      return new Promise((resolve, reject) => {
        if (this.init_failed_message !== null) {
          reject(this.init_failed_message);
          return;
        }
        if (this.watch_session === null || this.watch_session.readyState !== WebSocket.OPEN) {
          console.error('[LiveCommentManager][WatchSession] Comment sending failed. (Connection is not established.)');
          reject('コメントの送信に失敗しました。WebSocket 接続が確立されていません。');
          return;
        }

        const vpos = Math.round((Date.now() - this.vpos_base_timestamp) / 10);
        this.watch_session.send(JSON.stringify({
          type: 'postComment',
          data: {
            text: options.text,
            color: COLOR_COMMAND_TABLE[(options.color || '#FFEAEA').toUpperCase()] || 'white',
            position: POSITION_TABLE[options.position || 'right'],
            size: options.size || 'medium',
            vpos: vpos,
            isAnonymous: true,
          },
        }));

        const abortController = new AbortController();
        this.watch_session.addEventListener('message', (event) => {
          const message = JSON.parse(event.data);
          switch (message.type) {
            case 'postCommentResult': {
              resolve();
              abortController.abort();
              break;
            }
            case 'error': {
              let error = `コメントの送信に失敗しました。(${message.data.code})`;
              switch (message.data.code) {
                case 'COMMENT_POST_NOT_ALLOWED': error = 'コメントが許可されていません。'; break;
                case 'INVALID_MESSAGE': error = 'コメント内容が無効です。'; break;
              }
              console.error(`[LiveCommentManager][WatchSession] Comment sending failed. (Code: ${message.data.code})`);
              reject(error);
              abortController.abort();
              break;
            }
          }
        }, { signal: abortController.signal });
      });
    }

    async reconnect() {
      const isWatchClosed = this.watch_session !== null &&
        (this.watch_session.readyState === WebSocket.CLOSING || this.watch_session.readyState === WebSocket.CLOSED);
      const isCommentClosed = this.comment_session !== null &&
        (this.comment_session.readyState === WebSocket.CLOSING || this.comment_session.readyState === WebSocket.CLOSED);
      if (this.reconnecting === true && isWatchClosed === false && isCommentClosed === false) return;

      this.reconnecting = true;
      console.warn('[LiveCommentManager] Reconnecting...');
      this._notice('NX-Jikkyo に再接続しています…');

      await this.destroy();

      const watchInfo = await this.initWatchSession();
      if (watchInfo.is_success === false) {
        this.init_failed_message = watchInfo.detail;
        console.error('[LiveCommentManager] Reconnection failed.');
        this._notice(watchInfo.detail, '#FF6F6A');
        this.reconnecting = false;
        return;
      }
      this.initCommentSession(watchInfo);
      this.destroyed = false;
      this.reconnecting = false;
      console.warn('[LiveCommentManager] Reconnected.');
    }

    async destroy() {
      this.abort_controller.abort();
      this.abort_controller = new AbortController();

      if (this.watch_session !== null) {
        this.watch_session.close();
        this.watch_session = null;
      }
      if (this.comment_session !== null) {
        this.comment_session.close();
        this.comment_session = null;
      }
      if (this.keep_seat_interval_id !== null) {
        window.clearInterval(this.keep_seat_interval_id);
        this.keep_seat_interval_id = null;
      }
      this.vpos_base_timestamp = 0;
      this.init_failed_message = null;
      this.destroyed = true;
      console.log('[LiveCommentManager] Destroyed.');
    }
  }

  window.CommentUtils = CommentUtils;
  window.LiveCommentManager = LiveCommentManager;
})();
