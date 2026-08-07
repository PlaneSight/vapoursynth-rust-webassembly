const SCHEMA_VERSION = 1;

const SUPPORTED_TRANSPORTS = new Set(["rgba8", "video-frame"]);
const MAX_RGBA_BYTES = 16 * 1024 * 1024;
const MICROSECONDS_PER_SECOND = 1_000_000;

export function createWorkerHandler(session) {
  if (!session || typeof session.status !== "function" || typeof session.execute_graph !== "function" || typeof session.render_output !== "function") {
    throw new TypeError("session must provide status(), execute_graph(), and render_output()");
  }

  return async function handleWorkerMessage(message) {
    const request = validateRequest(message);

    try {
      switch (request.type) {
        case "status":
          return success(request.requestId, "status", parseJson(session.status()));
        case "executeGraph":
          return success(
            request.requestId,
            "outputs",
            await callSession(session, "execute_graph", request),
          );
        case "renderOutput": {
          const frame = await callSession(session, "render_output", request);
          return encodeFrameResponse(request, frame);
        }
        case "resetGraph":
          await callSession(session, "reset_graph", request);
          return success(request.requestId, "reset", {});
        default:
          throw protocolError(request.requestId, "unsupported-request", `unsupported request type: ${request.type}`);
      }
    } catch (error) {
      return failure(request.requestId, normalizeError(error));
    }
  };
}

function validateRequest(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    throw protocolError(0, "invalid-request", "worker request must be an object");
  }

  const requestId = message.requestId;
  if (!Number.isInteger(requestId) || requestId <= 0 || requestId > 0xffff_ffff) {
    throw protocolError(0, "invalid-request", "requestId must be a non-zero u32");
  }

  if (typeof message.type !== "string" || message.type.length === 0) {
    throw protocolError(requestId, "invalid-request", "type must be a non-empty string");
  }

  switch (message.type) {
    case "executeGraph":
      return {
        requestId,
        type: message.type,
        plan: requirePlan(message.plan, requestId),
      };
    case "renderOutput": {
      const request = {
        requestId,
        type: message.type,
        index: requireOutputIndex(message.index, requestId),
        frame: requireOutputIndex(message.frame, requestId),
      };
      if (message.transport !== undefined) {
        request.transport = requireTransport(message.transport, requestId);
      }
      if (message.timestamp !== undefined) {
        request.timestamp = requireTimestamp(message.timestamp, requestId);
      }
      if (message.duration !== undefined) {
        request.duration = requireDuration(message.duration, requestId);
      }
      return request;
    }
    default:
      return { requestId, type: message.type };
  }
}

function requirePlan(value, requestId) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw protocolError(requestId, "invalid-plan", "plan must be an object");
  }
  return value;
}

function requireOutputIndex(value, requestId) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw protocolError(requestId, "invalid-output", "output index must be a u32");
  }
  return value;
}

function requireDimension(value, requestId, name) {
  if (!Number.isInteger(value) || value <= 0 || value > 0xffff_ffff) {
    throw protocolError(requestId, "runtime-protocol", `${name} must be a non-zero u32`);
  }
  return value;
}

async function callSession(session, methodName, request) {
  const method = session[methodName];
  if (typeof method !== "function") {
    throw protocolError(
      request.requestId,
      "unsupported-request",
      `the worker runtime does not implement ${request.type}`,
    );
  }

  switch (request.type) {
    case "executeGraph":
      return method.call(session, request.requestId, request.plan);
    case "renderOutput":
      if (request.transport === undefined) {
        return method.call(session, request.requestId, request.index, request.frame);
      }
      return method.call(session, request.requestId, request.index, request.frame, request.transport);
    case "resetGraph":
      return method.call(session, request.requestId);
    default:
      throw protocolError(request.requestId, "unsupported-request", `unsupported request type: ${request.type}`);
  }
}
function requireTransport(value, requestId) {
  if (typeof value !== "string" || !SUPPORTED_TRANSPORTS.has(value)) {
    throw protocolError(
      requestId,
      "invalid-transport",
      `transport must be one of: ${[...SUPPORTED_TRANSPORTS].join(", ")}`,
    );
  }
  return value;
}

function requireTimestamp(value, requestId) {
  if (!Number.isSafeInteger(value)) {
    throw protocolError(requestId, "invalid-timing", "timestamp must be a safe integer in microseconds");
  }
  return value;
}

function requireDuration(value, requestId) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw protocolError(requestId, "invalid-timing", "duration must be a non-negative safe integer in microseconds");
  }
  return value;
}

function encodeFrameResponse(request, frame) {

  const width = requireDimension(frame?.width, request.requestId, "runtime frame width");
  const height = requireDimension(frame?.height, request.requestId, "runtime frame height");
  const rgba = normalizeBytes(frame?.rgba);
  const expectedSize = width * height * 4;
  if (!Number.isSafeInteger(expectedSize) || expectedSize > MAX_RGBA_BYTES || rgba.byteLength !== expectedSize) {
    throw protocolError(
      request.requestId,
      "runtime-protocol",
      "runtime returned an RGBA8 payload with invalid dimensions or byte length",
    );
  }

  if (request.transport === "video-frame") {
    return encodeVideoFrameResponse(request, frame, width, height, rgba);
  }

  const timing = deriveFrameTiming(frame, request.frame, request);
  const response = success(request.requestId, "frame", {
    width,
    height,
    rgba: rgba.buffer,
    ...(timing.hasTimestamp ? { timestamp: timing.timestamp } : {}),
    ...(timing.hasDuration ? { duration: timing.duration } : {}),
    ...(timing.hasTimestamp || timing.hasDuration
      ? { timestampKnown: timing.hasTimestamp, durationKnown: timing.hasDuration }
      : {}),
  });
  response.transfer.push(rgba.buffer);
  return response;
}

function encodeVideoFrameResponse(request, frame, width, height, rgba) {
  const VideoFrameConstructor = globalThis.VideoFrame;
  if (typeof VideoFrameConstructor !== "function") {
    throw protocolError(
      request.requestId,
      "unsupported-codec",
      "VideoFrame is not available in this worker",
    );
  }

  const timing = deriveFrameTiming(frame, request.frame, request);
  let videoFrame;
  try {
    videoFrame = new VideoFrameConstructor(rgba, {
      format: "RGBA",
      codedWidth: width,
      codedHeight: height,
      timestamp: timing.timestamp,
      duration: timing.duration,
    });
  } catch (error) {
    const unsupported = new Error(`could not construct an RGBA8 VideoFrame: ${error?.message ?? String(error)}`);
    unsupported.code = "unsupported-codec";
    throw unsupported;
  }

  const response = success(request.requestId, "frame", {
    width,
    height,
    timestamp: timing.timestamp,
    duration: timing.duration,
    timestampKnown: timing.hasTimestamp,
    durationKnown: timing.hasDuration,
    videoFrame,
  });
  response.transfer.push(videoFrame);
  return response;
}

function deriveFrameTiming(frame, frameNumber, request = {}) {
  const directTimestamp = frame?.timestampKnown === false
    ? finiteNumber(request.timestamp)
    : finiteNumber(request.timestamp ?? frame?.timestamp);
  const directDuration = frame?.durationKnown === false
    ? finiteNumber(request.duration)
    : finiteNumber(request.duration ?? frame?.duration);
  let duration = directDuration;
  let timestamp = directTimestamp;
  const flags = finiteNumber(frame?.flags);
  const hasDurationFlag = flags === undefined || (Math.trunc(flags) & 1) !== 0;
  const hasAbsoluteTime = flags === undefined || (Math.trunc(flags) & 2) !== 0;
  if (duration === undefined && hasDurationFlag) {
    duration = rationalToMicroseconds(frame?.durationNum, frame?.durationDen);
  }
  if (timestamp === undefined && hasAbsoluteTime && frame?.absoluteTime !== undefined && frame?.absoluteTime !== null) {
    const seconds = finiteNumber(frame.absoluteTime);
    if (seconds !== undefined) {
      const exactTimestamp = Math.round(seconds * MICROSECONDS_PER_SECOND);
      if (Number.isSafeInteger(exactTimestamp)) {
        timestamp = exactTimestamp;
      }
    }
  }

  const fpsNum = finiteNumber(frame?.fpsNum);
  const fpsDen = finiteNumber(frame?.fpsDen);
  const hasConstantRate = fpsNum !== undefined && fpsNum > 0 && fpsDen !== undefined && fpsDen > 0;
  if (duration === undefined && hasConstantRate) {
    duration = rationalToMicroseconds(fpsDen, fpsNum);
  }
  if (timestamp === undefined && hasConstantRate && Number.isInteger(frameNumber) && frameNumber >= 0) {
    const exactTimestamp = (frameNumber * fpsDen * MICROSECONDS_PER_SECOND) / fpsNum;
    const roundedTimestamp = Math.round(exactTimestamp);
    if (Number.isSafeInteger(roundedTimestamp)) {
      timestamp = roundedTimestamp;
    }
  }
  const hasTimestamp = Number.isSafeInteger(timestamp);
  const hasDuration = Number.isSafeInteger(duration) && duration >= 0;
  return {
    timestamp: clampTimestamp(timestamp ?? 0),
    duration: clampDuration(duration ?? 0),
    hasTimestamp,
    hasDuration,
  };
}

function rationalToMicroseconds(numerator, denominator) {
  const num = finiteNumber(numerator);
  const den = finiteNumber(denominator);
  if (num === undefined || den === undefined || den <= 0) {
    return undefined;
  }
  const value = Math.round((num * MICROSECONDS_PER_SECOND) / den);
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function finiteNumber(value) {
  if (typeof value === "bigint") {
    const converted = Number(value);
    return Number.isFinite(converted) ? converted : undefined;
  }
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function clampTimestamp(value) {
  if (!Number.isSafeInteger(value)) {
    return 0;
  }
  return value;
}

function clampDuration(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    return 0;
  }
  return value;
}


function normalizeBytes(value) {
  if (value instanceof Uint8Array) {
    if (value.byteOffset === 0 && value.byteLength === value.buffer.byteLength) {
      return value;
    }
    return value.slice();
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }

  throw protocolError(0, "runtime-protocol", "runtime returned a non-byte frame payload");
}

function success(requestId, type, payload) {
  return {
    message: {
      schemaVersion: SCHEMA_VERSION,
      requestId,
      ok: true,
      type,
      payload,
    },
    transfer: [],
  };
}

function failure(requestId, error) {
  return {
    message: {
      schemaVersion: SCHEMA_VERSION,
      requestId,
      ok: false,
      error,
    },
    transfer: [],
  };
}

function protocolError(requestId, code, message) {
  return { requestId, code, message };
}

function normalizeError(error) {
  if (error && typeof error === "object") {
    if (typeof error.code === "string" && typeof error.message === "string") {
      return { code: error.code, message: error.message };
    }

    if (typeof error.message === "string") {
      const parsed = tryParseJson(error.message);
      if (parsed?.error?.code && parsed?.error?.message) {
        return {
          code: parsed.error.code,
          message: parsed.error.message,
        };
      }
      return { code: "runtime-error", message: error.message };
    }
  }

  if (typeof error === "string") {
    const parsed = tryParseJson(error);
    if (parsed?.error?.code && parsed?.error?.message) {
      return {
        code: parsed.error.code,
        message: parsed.error.message,
      };
    }
    return { code: "runtime-error", message: error };
  }

  return { code: "runtime-error", message: "unknown worker runtime failure" };
}

function parseJson(value) {
  const parsed = tryParseJson(value);
  if (parsed === undefined) {
    throw protocolError(0, "runtime-protocol", "runtime returned invalid JSON status");
  }
  return parsed;
}

function tryParseJson(value) {
  if (typeof value !== "string") {
    return undefined;
  }

  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
