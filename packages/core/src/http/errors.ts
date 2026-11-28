/** サーバーが答えたが、成功ではなかった（4xx / 5xx）。message はサーバーの error 欄。 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** ログインが切れている・していない（401）。 */
export class UnauthorizedError extends ApiError {
  constructor() {
    super(401, 'Unauthorized');
    this.name = 'UnauthorizedError';
  }
}

/** 決めた時間内に答えが無かった。 */
export class TimeoutError extends Error {
  constructor(readonly path: string) {
    super(`応答がありません: ${path}`);
    this.name = 'TimeoutError';
  }
}
