export type ExternalRequestBudget = {
  limit: number;
  used: number;
};

export const REQUEST_OVERLOAD_MESSAGE =
  "请求过量了，高德或模型接口暂时没有返回可用结果。请等几十秒后再试，或者减少一次规划里的集合点/成员数量。";

export class RequestOverloadError extends Error {
  readonly code = "REQUEST_OVERLOAD";

  constructor(message = REQUEST_OVERLOAD_MESSAGE) {
    super(message);
    this.name = "RequestOverloadError";
  }
}

export function createExternalRequestBudget(limit = 45): ExternalRequestBudget {
  return { limit, used: 0 };
}

export function claimExternalRequest(budget?: ExternalRequestBudget) {
  if (!budget) return;
  if (budget.used + 1 > budget.limit) {
    throw new RequestOverloadError();
  }
  budget.used += 1;
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error || "");
}

export function isRequestOverloadError(error: unknown) {
  if (error instanceof RequestOverloadError) return true;
  const message = errorText(error);
  return /REQUEST_OVERLOAD|CUQPS|QPS|rate.?limit|too many|429|subrequest|高德请求失败|高德返回错误|DeepSeek 请求失败|fetch failed|network|timeout|HTTP 5\d\d/i.test(
    message
  );
}

export function toPublicErrorMessage(error: unknown) {
  if (isRequestOverloadError(error)) return REQUEST_OVERLOAD_MESSAGE;
  return errorText(error) || "请求处理失败，请检查行程清单后再试。";
}

export function toChatErrorMessage(_error: unknown) {
  return REQUEST_OVERLOAD_MESSAGE;
}
