/**
 * json-rpc2-implementer.
 * JSON-RPC2実装モジュール。
 *
 * See below for JSON-RPC2 specifications.
 * JSON-RPC2 の仕様については以下を参照。
 * https://www.jsonrpc.org/specification
 *
 * In this module, the input format is loosely, however the output format is strictly.
 * 本モジュールでは、基本的に入力は緩く受け付け、逆に出力は規格に厳密に行う。
 * @module ./index
 */

/** JSON-RPC2 Protocol Version. フォーマットのバージョン */
export const VERSION: "2.0" = "2.0";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | {
  [key: string]: JsonValue;
};
export type JsonRpc2Params = JsonValue[] | Record<string, JsonValue>;
export type JsonRpc2IdNotNull = string | number;
export type JsonRpc2Id = JsonRpc2IdNotNull | null;

/** JSON-RPC2 Request format. リクエストJSON */
export interface JsonRpc2Request<
  P extends JsonRpc2Params,
  I extends JsonRpc2IdNotNull | JsonRpc2Id | never,
> {
  jsonrpc: typeof VERSION;
  method: string;
  params?: P;
  id?: I;
}

export type JsonRpc2Notification<P extends JsonRpc2Params> = JsonRpc2Request<
  P,
  never
>;

/** JSON-RPC2 Response format. レスポンスJSON */
export type JsonRpc2Response<
  R extends JsonValue,
  I extends JsonRpc2IdNotNull | JsonRpc2Id | never,
  E extends JsonValue | never,
> = {
  jsonrpc: typeof VERSION;
  result: R;
  id: I;
} | {
  jsonrpc: typeof VERSION;
  error: JsonRpc2ResponseError<E>;
  id: I;
};

/** JSON-RPC2 Response error format. レスポンスJSONのエラー情報 */
export interface JsonRpc2ResponseError<E extends JsonValue> {
  code: ErrorCode | number;
  message: string;
  data?: E;
}

/**
 * JSON-RPC2 standard error codes.
 * JSON-RPC2規定のエラーコード。
 *
 * * Since -32768 to -32000 is reserved, careful not to use with your apps.
 * ※ -32768 から -32000 は予約されているようなので通常のアプリで使わないよう注意
 */
export enum ErrorCode {
  ParseError = -32700,
  InvalidRequest = -32600,
  MethodNotFound = -32601,
  InvalidParams = -32602,
  InternalError = -32603,
}

/** Starting code range of JSON-RPC2 standard server error. サーバーエラーのコード範囲開始 */
const ServerErrorSince = -32000;
/** Code range of JSON-RPC2 standard server error end. サーバーエラーのコード範囲終了 */
const ServerErrorUntil = -32099;
/** Maximum value of 32-bit integer. 32bit整数の最大値 */
const MAX_INT32 = 2147483647;

/**
 * Exception class compatible with JSON-RPC2 error format.
 * JSON-RPC2のエラー情報と互換性を持たせた例外クラス。
 */
export class JsonRpcError<E extends JsonValue> extends Error
  implements JsonRpc2ResponseError<E> {
  /** Error code. エラーコード */
  readonly code: ErrorCode | number;
  /** Additional Data. 例外追加情報 */
  readonly data?: E;

  /**
	 * Generate an exception.
	 * 例外を生成する。
	 * @param code Error code. エラーコード。
	 * @param message Error message. 例外エラーメッセージ。
	 * @param data Additional Data. 例外追加情報。
	 */
  constructor(
    code: number = ErrorCode.InternalError,
    message?: string,
    data?: E,
  ) {
    super(message ?? makeDefaultErrorMessage(code));
    this.name = "JsonRpcError";
    this.code = code;
    this.data = data;
  }

  /**
	 * Generate JSON-RPC2 error information.
	 * JSON-RPC2エラー情報形式のJSONを生成する。
	 * @returns Generated error information. JSON-RPC2エラー情報。
	 */
  toJSON(): JsonRpc2ResponseError<E> {
    const json: JsonRpc2ResponseError<E> = {
      code: this.code,
      message: this.message,
    };
    if (this.data !== undefined) {
      json.data = this.data;
    }
    return json;
  }

  /**
	 * Convert the error to JSON-RPC2 exception.
	 * 形式不明のエラー情報をJSON-RPC2用エラーに変換する。
	 * @param error Error. エラー情報。
	 * @returns Converted exception. 生成したエラー。
	 */
  // deno-lint-ignore no-explicit-any
  static convert<E extends JsonValue>(
    error?: JsonRpcError<E> | Error | any,
  ): JsonRpcError<E> {
    if (error instanceof JsonRpcError) {
      return error as JsonRpcError<E>;
    }
    return new JsonRpcError(
      error?.code,
      error instanceof Error ? error?.message : String(error),
      error?.data,
    );
  }
}

/**
 * Make default error message from the error code.
 * エラーコードからデフォルトエラーメッセージを生成する。
 * @param code Error code. エラーコード。
 * @return Error message. エラーメッセージ。
 */
function makeDefaultErrorMessage(code: ErrorCode | number): string {
  switch (code) {
    case ErrorCode.ParseError:
      return "Parse error";
    case ErrorCode.InvalidRequest:
      return "Invalid Request";
    case ErrorCode.MethodNotFound:
      return "Method not found";
    case ErrorCode.InvalidParams:
      return "Invalid params";
    case ErrorCode.InternalError:
      return "Internal error";
  }
  if (code >= ServerErrorSince && code <= ServerErrorUntil) {
    return "Server error";
  }
  return "Unknown Error";
}

export type Batch<
  T extends JsonRpc2Request<P, I> | JsonRpc2Response<P, I, E>,
  P extends JsonRpc2Params,
  I extends JsonRpc2IdNotNull | JsonRpc2Id | never,
  E extends JsonValue | never,
> = T[];

/**
 * Symbol for "no response".
 * レスポンス不要を通知するためのシンボル。
 */
export const NoResponse = Symbol("NoResponse");

type JsonRpc2RequestWithId<
  P extends JsonRpc2Params,
  I extends JsonRpc2IdNotNull,
> = JsonRpc2Request<P, I> & { id: JsonRpc2IdNotNull };

/**
 * JSON-RPC2 implementation class.
 * JSON-RPC2実装クラス。
 */
export class JsonRpc2Implementer {
  /** RPC sender. RPC送信処理 */
  sender: (message: string) => JsonValue | Promise<JsonValue>;
  /** Method handler. メソッド呼び出し処理 */
  methodHandler: (
    method: string,
    params?: JsonRpc2Params,
    id?: JsonRpc2Id,
  ) => JsonValue | Promise<JsonValue>;
  /** Timeout for the call method (msec). callのタイムアウト時間（ミリ秒） */
  timeout = 60000;

  /** JSON-RPC2 request ID counter. JSON-RPC2リクエストID採番用カウンター */
  protected idCounter = 0;
  /** Callback for the call method's Promise. callのPromise用マップ */
  protected callbackMap: Map<
    JsonRpc2IdNotNull,
    { resolve: Function; reject: Function }
  > = new Map();

  /**
	 * Send a JSON-RPC2 request.
	 * JSON-RPC2リクエストを送信する。
	 *
	 * * Must register this.sender before use this method (if not registered, throw error).
	 * ※ 事前に this.sender の登録が必要（未登録の場合エラー）。
	 * @param method Method name. メソッド名。
	 * @param params Arguments. 引数。
	 * @param id ID. If not specified, generate a sequence number. ID。未指定時は連番で自動生成。
	 * @return Method result. メソッドの処理結果。
	 */
  call(
    method: string,
    params?: JsonRpc2Params,
    id?: JsonRpc2Id,
  ): Promise<JsonValue> {
    // Send a request and save the callback for receiving to the map.
    // Callback is executed indirectly by receiving response.
    // リクエストを送信するとともに、結果受け取り用のコールバックをマップに保存する。
    // コールバックは、receiveがレスポンスを受信することで間接的に実行される。
    return new Promise<JsonValue>((resolve, reject) => {
      const req: JsonRpc2Request<JsonRpc2Params, JsonRpc2IdNotNull> = this
        .createRequest(method, params, id);
      this.callbackMap.set(req.id, { resolve, reject });

      /**
		 * The ID is erased from the callback map and Promise ends with an error.
		 * コールバック用マップからIDを消去しPromiseをエラーで終わる。
		 * @param e Error. エラー情報。
		 */
      const removeIdAndReject = (e: any): void => {
        this.callbackMap.delete(req.id);
        reject(e);
      };

      try {
        const result: JsonValue | Promise<JsonValue> = this.sender(
          JSON.stringify(req),
        );
        if (isPromise(result)) {
          result.catch(removeIdAndReject);
        }
        // Check timeout. タイムアウト処理
        if (this.timeout > 0) {
          setTimeout(() => {
            if (this.callbackMap.has(req.id)) {
              const e = new Error(
                `RPC response timed out. (${JSON.stringify(req)})`,
              );
              e.name = "TimeoutError";
              removeIdAndReject(e);
            }
          }, this.timeout);
        }
      } catch (e) {
        removeIdAndReject(e);
      }
    });
  }

  /**
	 * Send JSON-RPC2 notification request.
	 * JSON-RPC2通知リクエストを送信する。
	 *
	 * * Must registor this.sender before use this method (if not registered, throw error).
	 * ※ 事前に this.sender の登録が必要（未登録の場合エラー）。
	 * @param method Method name. メソッド名。
	 * @param params Arguments. 引数。
	 * @return Promise. 処理状態。
	 */
  async notify<P extends JsonRpc2Params>(
    method: string,
    params?: P,
  ): Promise<void> {
    const req: JsonRpc2Notification<P> = this.createNotification(
      method,
      params,
    );
    const result = this.sender(JSON.stringify(req));
    if (isPromise(result)) {
      await result;
    }
  }

  /**
	 * Receive JSON-RPC2 request / response.
	 * JSON-RPC2リクエスト/レスポンスを受け取る。
	 *
	 * * Must registor this.sender before use this method (if not registered, throw error).
	 * ※ 事前に this.sender の登録が必要（未登録の場合エラー）。
	 * @param message Request / Response JSON string. リクエスト/レスポンスのJSON文字列。
	 * @return Promise. 処理状態。
	 */
  async receive(message: string): Promise<void> {
    let res;
    try {
      res = await this.doMethodOrCallback(this.parse(message));
    } catch (e) {
      res = this.createResponse(null, null, e);
    }
    if (res) {
      const result = this.sender(JSON.stringify(res));
      if (isPromise(result)) {
        await result;
      }
    }
  }

  /**
	 * Process JSON-RPC2 request / response.
	 * JSON-RPC2リクエスト/レスポンスを処理する。
	 * @param json Request / Response JSON object. リクエスト/レスポンスのJSON。
	 * @return Response JSON Object. If the request is batch type, return Array. If the request is notification type, return null.
	 *         レスポンスのJSONオブジェクト。バッチリクエストの場合は配列。通知やレスポンスの場合はnull。
	 */
  async doMethodOrCallback(
    json:
      | JsonRpc2Request
      | JsonRpc2Request[]
      | JsonRpc2Response
      | JsonRpc2Response[],
  ): Promise<JsonRpc2Response | JsonRpc2Response[]> {
    // If the json is response, judge it is a response. If not response, judge it is a request.
    // レスポンスの条件を満たす場合だけレスポンス、後は全てリクエストとして処理。
    if (!Array.isArray(json)) {
      // Normal request / response
      // 通常のリクエスト/レスポンス
      if (this.isResponse(json)) {
        this.doCallback(<JsonRpc2Response> json);
      } else {
        return this.doMethod(<JsonRpc2Request> json);
      }
    } else {
      // Batch request / response
      // バッチリクエスト/レスポンス
      const responses = [];
      for (let j of json) {
        if (this.isResponse(j)) {
          this.doCallback(<JsonRpc2Response> j);
        } else {
          const res = await this.doMethod(<JsonRpc2Request> j);
          if (res) {
            responses.push(res);
          }
        }
      }
      if (responses.length > 0) {
        return responses;
      }
    }
  }

  /**
	 * Call the method handler.
	 * メソッドハンドラーを実行する。
	 * @param request Request. リクエスト情報。
	 * @returns Response. レスポンス情報。
	 */
  protected async doMethod(
    request: JsonRpc2Request,
  ): Promise<JsonRpc2Response> {
    // Call the method handler to make the results as JSON-RPC2 responses.
    // メソッドハンドラーをコールして、その結果をJSON-RPC2のレスポンスにする。
    try {
      if (!this.methodHandler) {
        throw new JsonRpcError(ErrorCode.MethodNotFound);
      }
      let result = this.methodHandler(
        request.method,
        request.params,
        request.id,
      );
      if (isPromise(result)) {
        result = await result;
      }
      // Create a response when there is an ID because If there is no ID, it is no response.
      // ID無しは応答不要なので、IDがある場合のみレスポンスを返す。
      if (
        result !== NoResponse && request.id !== undefined && request.id !== null
      ) {
        return this.createResponse(request.id, result);
      }
    } catch (e) {
      // If catched an error, a response is returned always.
      // エラー時はリクエストIDの有無にかかわらず返す。
      return this.createResponse(request.id, null, e);
    }
    return null;
  }

  /**
	 * Call the callback for response.
	 * レスポンスのコールバックを実行する。
	 * @param response Response. レスポンス情報。
	 */
  protected doCallback(response: JsonRpc2Response): void {
    // Call the callback by the response ID.
    // 該当IDのコールバックを実行する。
    const cb = this.callbackMap.get(response.id);
    if (!cb) {
      return;
    }
    this.callbackMap.delete(response.id);
    if (response.error) {
      cb.reject(
        new JsonRpcError(
          response.error.code,
          response.error.message,
          response.error.data,
        ),
      );
    } else {
      cb.resolve(response.result);
    }
  }

  /**
	 * Generate a JSON-RPC2 request.
	 * JSON-RPC2のリクエストを生成する。
	 * @param method Method name. メソッド名。
	 * @param params Arguments. 引数。
	 * @param id ID. If not specified, generate a sequence number. ID。未指定時は連番で自動生成。
	 * @returns Request JSON object. リクエストJSONオブジェクト。
	 */
  createRequest<P extends JsonRpc2Params>(
    method: string,
    params?: P,
    id?: JsonRpc2Id,
  ): JsonRpc2RequestWithId<P, JsonRpc2IdNotNull> {
    return {
      jsonrpc: VERSION,
      method,
      params,
      id: id ?? this.generateId(),
    };
  }

  /**
	 * Generate a JSON-RPC2 response.
	 * JSON-RPC2レスポンスを生成する。
	 * @param id Request ID. If the request parsing is failure, use null. リクエストのID。リクエストのパース失敗などではnull。
	 * @param result Request result. リクエストの処理結果。
	 * @param error Error when request is an error. リクエストがエラーの場合のエラー情報。
	 * @returns Generated response. 生成したレスポンス。
	 */
  createResponse<
    R extends JsonValue,
    I extends JsonRpc2IdNotNull | JsonRpc2Id | never,
    E extends JsonValue | never,
  >(
    result: R,
    id: I,
    error?: E | JsonRpc2ResponseError<E>,
  ): JsonRpc2Response<R, I, E> {
    if (error) {
      const convertedError: JsonRpcError<E> = JsonRpcError.convert(error);
      return {
        jsonrpc: VERSION,
        id,
        error: convertedError,
      };
    }

    return {
      jsonrpc: VERSION,
      id,
      result: result ?? null,
    };
  }

  /**
	 * Generate a JSON-RPC2 notification request.
	 * JSON-RPC2の通知リクエストを生成する。
	 * @param method Method name. メソッド名。
	 * @param params Arguments. 引数。
	 * @returns Request JSON object. リクエストJSONオブジェクト。
	 */
  createNotification<P extends JsonRpc2Params>(
    method: string,
    params?: P,
  ): JsonRpc2Notification<P> {
    return { jsonrpc: VERSION, method, params };
  }

  /**
	 * Parse the JSON-RPC2 request / response.
	 * JSON-RPC2リクエスト/レスポンスをパースする。
	 * @param message JSON string to parse. パースするJSON文字列。
	 * @returns Parsed request / response object (If the request is batch type, return Array). パースしたリクエスト/レスポンス（バッチ実行の場合配列）。
	 */
  parse<
    M extends
      | JsonRpc2Request<P, I>
      | Batch<JsonRpc2Request<P, I>, P, I, E>
      | JsonRpc2Response<R, I, E>
      | Batch<JsonRpc2Response<R, I, E>, R, I, E>,
    P extends JsonRpc2Params,
    R extends JsonValue,
    I extends JsonRpc2Id,
    E extends JsonValue,
  >(
    message: string,
  ): M {
    // If the json is response, judge it is a response. If not response, judge it is a request.
    // * This method is limited to parse JSON and check fatal error.
    //   (Because a batch type request / response can't be checked this logic.)
    // レスポンスの条件を満たす場合だけレスポンス、後は全てリクエストとして処理。
    // ※ 現状はJSONのパースと一括でエラーにできるチェックだけ。
    //    （ここで中身までみると、バッチが全部エラーになってしまうので）
    let json: JsonValue;
    try {
      json = JSON.parse(message);
    } catch (e) {
      throw new JsonRpcError(ErrorCode.ParseError);
    }
    if (!(json instanceof Object)) {
      throw new JsonRpcError(ErrorCode.InvalidRequest);
    }
    if (Array.isArray(json) && json.length === 0) {
      throw new JsonRpcError(ErrorCode.InvalidRequest);
    }
    return json as M;
  }

  /**
	 * Is the object a response JSON?
	 * オブジェクトはレスポンスか？
	 * @param json The object. チェックするオブジェクト。
	 * @returns True if it is a response. レスポンスの場合true。
	 */
  isResponse<R extends JsonValue, I extends JsonRpc2Id, E extends JsonValue>(
    json: any,
  ): json is JsonRpc2Response<R, I, E> {
    return typeof json?.result !== "undefined" ||
      typeof json?.error !== "undefined";
  }

  /**
	 * Generate request ID.
	 * リクエスト用のIDを発行する。
	 * @returns Generated ID. 生成したID。
	 */
  private generateId(): number {
    // Use the positive range of INT32 only for compatibility.
    // 安全のために、int32の正の範囲内だけ使用。
    if (this.idCounter >= MAX_INT32) {
      this.idCounter = 0;
    }
    return ++this.idCounter;
  }
}

/**
 * Is the object Promise?
 * オブジェクトはPromiseか？
 * @param obj The object. チェックするオブジェクト。
 * @returns True if it is Promise. Promiseの場合true。
 */
function isPromise<T>(obj: any): obj is Promise<T> {
  // If there are the bluebird, the instanceof is not working correctly.
  // bluebirdなどが有効な環境だと、instanceofだけでは正しく判定できないためその対処。
  // https://stackoverflow.com/questions/27746304/how-do-i-tell-if-an-object-is-a-promise
  return obj instanceof Promise || (obj && typeof obj.then === "function");
}
