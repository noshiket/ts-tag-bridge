// 再生画面の「チャプター」タブ（元の stream_right_tab_chapter.jsx）。tag.json の chapter_txt（OGM の書き方）を読み書きする

export interface ChapterMark { sec: number; name: string }

/** 'HH:MM:SS.sss' */
export function chapterTime(sec: number): string {
  const s = Math.max(0, sec || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor(s / 60) % 60;
  const ss = (s - h * 3600 - m * 60).toFixed(3).padStart(6, '0');
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${ss}`;
}

/** chapter_txt → 時刻の順の [{sec, name}] */
export function parseChapterTxt(txt: string | null | undefined): ChapterMark[] {
  const times: Record<string, number> = {};
  const names: Record<string, string> = {};
  for (const raw of String(txt || '').split('\n')) {
    const line = raw.trim();
    let m = line.match(/^CHAPTER(\d+)=(\d+):(\d+):(\d+(?:\.\d+)?)$/);
    if (m) { times[m[1]!] = Number(m[2]) * 3600 + Number(m[3]) * 60 + parseFloat(m[4]!); continue; }
    m = line.match(/^CHAPTER(\d+)NAME=(.*)$/);
    if (m) names[m[1]!] = m[2]!;
  }
  return Object.keys(times).sort((a, b) => times[a]! - times[b]!).map((k) => ({ sec: times[k]!, name: names[k] || '' }));
}

export const sortMarks = (l: ChapterMark[]) => [...l].sort((a, b) => a.sec - b.sec);

/** Amatsukaze の書き方に合わせた名前（英字 = ブロック。CM は A90Sec のように長さが付く） */
export const CHAPTER_PRESETS = ['A', 'B', 'C', 'D'];
