/** 確かめてから進める（元の Web 版と同じ confirm） */
export function confirmAsync(message: string, _okLabel?: string): Promise<boolean> {
  return Promise.resolve(window.confirm(message));
}

/** 知らせるだけ（元の Web 版と同じ alert） */
export function notify(message: string) {
  window.alert(message);
}
