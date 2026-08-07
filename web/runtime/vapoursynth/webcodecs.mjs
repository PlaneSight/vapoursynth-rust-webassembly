const MAX_RGBA_BYTES = 16 * 1024 * 1024;
const MAX_SEQUENCE_FRAMES = 4_096;
const U32_MAX = 0xffff_ffff;
const MICROSECONDS_PER_SECOND = 1_000_000;

/**
 * Render an inclusive frame range through a worker client. Frames are fetched
 * sequentially so native leases and browser VideoFrames remain bounded. Without
 * `onFrame`, the caller owns every returned frame; with `onFrame`, only frames
 * explicitly retained by the callback are returned and the rest are closed.
 */
export async function renderOutputSequence(
  client,
  index,
  {
    startFrame = 0,
    endFrame,
    metadata,
    transport = "rgba8",
    signal,
    onFrame,
  } = {},
) {
  if (!client || typeof client.renderOutput !== "function") {
    throw featureError("invalid-client", "a worker client with renderOutput() is required");
  }
  requireTransport(transport);
  validateMetadata(metadata);
  if (endFrame === undefined) {
    endFrame = metadata?.numFrames === undefined ? startFrame : metadata.numFrames - 1;
  }
  if (!Number.isSafeInteger(startFrame) || !Number.isSafeInteger(endFrame) || startFrame < 0 || endFrame < startFrame) {
    throw featureError("invalid-sequence", "startFrame/endFrame must be non-negative integers with endFrame >= startFrame");
  }
  if (endFrame - startFrame + 1 > MAX_SEQUENCE_FRAMES) {
    throw featureError("sequence-too-large", `frame sequences may contain at most ${MAX_SEQUENCE_FRAMES} frames`);
  }
  if (metadata?.numFrames !== undefined && endFrame >= metadata.numFrames) {
    throw featureError("invalid-frame", "requested frame range exceeds output metadata");
  }
  if (onFrame !== undefined && typeof onFrame !== "function") {
    throw featureError("invalid-callback", "onFrame must be a function");
  }

  const rendered = [];
  let nextTimestamp = 0;
  try {
    for (let frameNumber = startFrame; frameNumber <= endFrame; frameNumber += 1) {
      throwIfAborted(signal);
      const requestTiming = sequenceTiming(frameNumber, metadata);
      let frame;
      let timedFrame;
      try {
        frame = await client.renderOutput(index, frameNumber, {
          transport,
          ...(requestTiming ?? {}),
        });
        const sourceTimestampUnknown = frame?.timestampKnown === false;
        timedFrame = addFallbackTiming(frame, frameNumber, metadata, nextTimestamp);
        if (sourceTimestampUnknown) {
          timedFrame = retimeVideoFrame(timedFrame);
        }
        if (timedFrame?.duration !== undefined && timedFrame?.timestamp !== undefined) {
          nextTimestamp = timedFrame.timestamp + timedFrame.duration;
        }
        let retained = !onFrame;
        if (onFrame) {
          const callbackResult = await onFrame(timedFrame, frameNumber, metadata);
          retained = callbackResult === true || callbackResult?.retain === true || callbackResult === timedFrame.videoFrame;
        }
        if (retained) {
          rendered.push(timedFrame);
        } else {
          closeVideoFrame(timedFrame?.videoFrame ?? (isVideoFrameLike(timedFrame) ? timedFrame : undefined));
        }
      } catch (error) {
        closeVideoFrame(timedFrame?.videoFrame ?? (isVideoFrameLike(timedFrame) ? timedFrame : undefined));
        if (timedFrame === undefined) {
          closeVideoFrame(frame?.videoFrame ?? (isVideoFrameLike(frame) ? frame : undefined));
        }
        throw error;
      }
    }
    return rendered;
  } catch (error) {
    for (const retained of rendered) {
      closeVideoFrame(retained?.videoFrame ?? (isVideoFrameLike(retained) ? retained : undefined));
    }
    rendered.length = 0;
    throw error;
  }
}

/**
 * Owns one native RGB24 source node populated from browser RGBA8 frames.
 * It accepts either (runtime, coreToken, options) or one options object with
 * runtime and coreToken properties.
 */
export class WebCodecsInputAdapter {
  #runtime;
  #requestId;
  #nodeToken;
  #closed = false;
  #width;
  #height;
  #numFrames;
  #fpsNum;
  #fpsDen;
  #nextFrame = 0;
  #closeInputFrames;

  constructor(runtimeOrOptions, coreToken, options = {}) {
    const config = normalizeAdapterArguments(runtimeOrOptions, coreToken, options);
    this.#runtime = config.runtime;
    this.#requestId = requireRequestId(config.requestId ?? 1);
    this.#width = requireDimension(config.width, "width");
    this.#height = requireDimension(config.height, "height");
    checkedRgbaSize(this.#width, this.#height);
    this.#numFrames = requireCount(config.numFrames ?? 1, "numFrames");
    this.#fpsNum = requireSafeInteger(config.fpsNum ?? 0, "fpsNum");
    this.#fpsDen = requireSafeInteger(config.fpsDen ?? (this.#fpsNum > 0 ? 1 : 0), "fpsDen");
    if ((this.#fpsNum === 0) !== (this.#fpsDen === 0) || this.#fpsNum < 0 || this.#fpsDen < 0) {
      throw featureError("invalid-timing", "fpsNum/fpsDen must be 0/0 or a positive rational rate");
    }
    this.#closeInputFrames = config.closeInputFrames !== false;

    if (!this.#runtime || typeof this.#runtime !== "object") {
      throw new TypeError("runtime is required");
    }
    if (typeof this.#runtime.source_create !== "function") {
      throw featureError("unsupported-source", "the native runtime does not implement source_create()");
    }
    if (typeof this.#runtime.source_upload_rgba !== "function") {
      throw featureError("unsupported-source", "the native runtime does not implement source_upload_rgba()");
    }
    if (typeof this.#runtime.node_release !== "function") {
      throw featureError("unsupported-source", "the native runtime does not implement node_release()");
    }
    if (!config.coreToken || typeof config.coreToken !== "object") {
      throw featureError("invalid-handle", "a live core token is required");
    }

    this.#nodeToken = this.#runtime.source_create(
      this.#requestId,
      config.coreToken,
      this.#width,
      this.#height,
      this.#numFrames,
      this.#fpsNum,
      this.#fpsDen,
    );
    if (!this.#nodeToken || typeof this.#nodeToken !== "object") {
      throw featureError("runtime-protocol", "native source_create() returned an invalid node token");
    }
  }

  get nodeToken() {
    return this.#nodeToken;
  }

  get width() {
    return this.#width;
  }

  get height() {
    return this.#height;
  }

  get numFrames() {
    return this.#numFrames;
  }

  async uploadFrame(frame, frameNumber = this.#nextFrame, timing = {}) {
    this.#assertOpen();
    if (frameNumber && typeof frameNumber === "object" && !Array.isArray(frameNumber)) {
      timing = frameNumber;
      frameNumber = timing.frameNumber ?? this.#nextFrame;
    }
    if (!timing || typeof timing !== "object" || Array.isArray(timing)) {
      throw featureError("invalid-timing", "upload timing must be an object");
    }
    frameNumber = requireFrameNumber(frameNumber);
    if (frameNumber >= this.#numFrames) {
      throw featureError("invalid-frame", `frame number ${frameNumber} exceeds the source frame count`);
    }

    const shouldCloseInput = this.#closeInputFrames && isVideoFrameLike(frame);
    try {
      const rgba = await this.#copyRgba(frame);
      const durationNum = timing.durationNum ?? (this.#fpsNum > 0 ? this.#fpsDen : 0);
      const durationDen = timing.durationDen ?? (this.#fpsNum > 0 ? this.#fpsNum : 0);
      const absoluteTime = timing.absoluteTime === undefined ? null : timing.absoluteTime;
      requireSafeInteger(durationNum, "durationNum");
      requireSafeInteger(durationDen, "durationDen");
      if ((durationNum === 0) !== (durationDen === 0) || durationNum < 0 || durationDen < 0) {
        throw featureError("invalid-timing", "durationNum/durationDen must be 0/0 or non-negative/positive");
      }
      if (absoluteTime !== null && (typeof absoluteTime !== "number" || !Number.isFinite(absoluteTime))) {
        throw featureError("invalid-timing", "absoluteTime must be finite or null");
      }
      const uploadArguments = [
        this.#requestId,
        this.#nodeToken,
        frameNumber,
        rgba,
        durationNum,
        durationDen,
      ];
      if (absoluteTime !== null) {
        uploadArguments.push(absoluteTime);
      }
      this.#runtime.source_upload_rgba(...uploadArguments);
      this.#nextFrame = Math.max(this.#nextFrame, frameNumber + 1);
      return { frameNumber, width: this.#width, height: this.#height };
    } finally {
      if (shouldCloseInput) {
        closeVideoFrame(frame);
      }
    }
  }

  close() {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    const token = this.#nodeToken;
    this.#nodeToken = null;
    if (token) {
      this.#runtime.node_release(this.#requestId, token);
    }
  }

  free() {
    this.close();
  }

  async #copyRgba(frame) {
    const expectedSize = checkedRgbaSize(this.#width, this.#height);
    if (frame instanceof ArrayBuffer) {
      if (frame.byteLength !== expectedSize) {
        throw featureError("invalid-frame", "RGBA8 buffer dimensions do not match the source");
      }
      return new Uint8Array(frame.slice(0));
    }
    if (ArrayBuffer.isView(frame)) {
      if (frame.byteLength !== expectedSize) {
        throw featureError("invalid-frame", "RGBA8 buffer dimensions do not match the source");
      }
      return new Uint8Array(frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength));
    }
    if (!isVideoFrameLike(frame)) {
      throw featureError("invalid-frame", "uploadFrame expects a VideoFrame or RGBA8 buffer");
    }

    const frameWidth = frame.codedWidth ?? frame.displayWidth;
    const frameHeight = frame.codedHeight ?? frame.displayHeight;
    if (frameWidth !== this.#width || frameHeight !== this.#height) {
      throw featureError("invalid-frame", "VideoFrame dimensions do not match the source");
    }
    const visibleRect = frame.visibleRect;
    if (
      visibleRect &&
      (visibleRect.x !== 0 ||
        visibleRect.y !== 0 ||
        visibleRect.width !== this.#width ||
        visibleRect.height !== this.#height)
    ) {
      throw featureError("invalid-frame", "VideoFrame visibleRect must cover the full source");
    }
    const output = new Uint8Array(expectedSize);
    try {
      const copied = await frame.copyTo(output, { format: "RGBA" });
      if (copied !== undefined && !Array.isArray(copied)) {
        copyReturnedBytes(copied, output);
      }
    } catch (error) {
      if (frame.copyTo.length >= 2) {
        throw error;
      }
      const copied = await frame.copyTo({ format: "RGBA" });
      copyReturnedBytes(copied, output);
    }
    return output;
  }

  #assertOpen() {
    if (this.#closed || !this.#nodeToken) {
      throw featureError("runtime-closed", "the WebCodecs input adapter is closed");
    }
  }
}


function sequenceTiming(frameNumber, metadata) {
  if (!metadata || metadata.fpsNum <= 0 || metadata.fpsDen <= 0) {
    return undefined;
  }
  const duration = rationalMicroseconds(metadata.fpsDen, metadata.fpsNum);
  const exactTimestamp = (frameNumber * metadata.fpsDen * MICROSECONDS_PER_SECOND) / metadata.fpsNum;
  if (duration === undefined || !Number.isFinite(exactTimestamp)) {
    return undefined;
  }
  return {
    timestamp: Math.round(exactTimestamp),
    duration,
  };
}

function addFallbackTiming(frame, frameNumber, metadata, fallbackTimestamp) {
  if (!frame || typeof frame !== "object" || !metadata) {
    return frame;
  }
  const duration = frame.durationKnown === false
    ? undefined
    : frame.duration ?? rationalMicroseconds(metadata.fpsDen, metadata.fpsNum);
  let timestamp = frame.timestampKnown === false ? undefined : frame.timestamp;
  if (timestamp === undefined && duration !== undefined) {
    timestamp = metadata.fpsNum > 0 && metadata.fpsDen > 0
      ? Math.round((frameNumber * metadata.fpsDen * MICROSECONDS_PER_SECOND) / metadata.fpsNum)
      : fallbackTimestamp;
  }
  if (duration === undefined && timestamp === undefined) {
    return frame;
  }
  return {
    ...frame,
    ...(timestamp === undefined ? {} : { timestamp }),
    ...(duration === undefined ? {} : { duration }),
    timestampKnown: timestamp !== undefined,
    durationKnown: duration !== undefined,
  };
}

function retimeVideoFrame(frame) {
  if (!frame || typeof frame !== "object" || !isVideoFrameLike(frame.videoFrame) || frame.timestamp === undefined) {
    return frame;
  }
  const VideoFrameConstructor = globalThis.VideoFrame;
  if (typeof VideoFrameConstructor !== "function") {
    throw featureError("unsupported-codec", "VideoFrame is unavailable for timestamp correction");
  }
  const options = { timestamp: frame.timestamp };
  if (frame.duration !== undefined) {
    options.duration = frame.duration;
  }
  let videoFrame;
  try {
    videoFrame = new VideoFrameConstructor(frame.videoFrame, options);
  } catch (error) {
    throw featureError("unsupported-codec", `could not retime VideoFrame: ${error?.message ?? String(error)}`);
  }
  frame.videoFrame.close?.();
  return { ...frame, videoFrame };
}

function validateMetadata(metadata) {
  if (metadata === undefined || metadata === null) {
    return;
  }
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw featureError("invalid-metadata", "output metadata must be an object");
  }
  if (metadata.width !== undefined) {
    requireDimension(metadata.width, "metadata width");
  }
  if (metadata.height !== undefined) {
    requireDimension(metadata.height, "metadata height");
  }
  if (metadata.numFrames !== undefined) {
    requireCount(metadata.numFrames, "metadata numFrames");
  }
  if (metadata.width !== undefined && metadata.height !== undefined) {
    checkedRgbaSize(metadata.width, metadata.height);
  }
}

function normalizeAdapterArguments(runtimeOrOptions, coreToken, options) {
  if (runtimeOrOptions && typeof runtimeOrOptions === "object" && runtimeOrOptions.runtime) {
    return { ...runtimeOrOptions };
  }
  if (coreToken && typeof coreToken === "object" && !isToken(coreToken) && coreToken.coreToken) {
    return { runtime: runtimeOrOptions, ...coreToken };
  }
  return { runtime: runtimeOrOptions, coreToken, ...options };
}

function copyReturnedBytes(value, output) {
  let bytes;
  if (value instanceof ArrayBuffer) {
    bytes = new Uint8Array(value);
  } else if (ArrayBuffer.isView(value)) {
    bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  } else {
    throw featureError("invalid-frame", "VideoFrame.copyTo() returned a non-byte payload");
  }
  if (bytes.byteLength !== output.byteLength) {
    throw featureError("invalid-frame", "VideoFrame.copyTo() returned an unexpected RGBA8 size");
  }
  output.set(bytes);
}

function checkedRgbaSize(width, height) {
  const size = width * height * 4;
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_RGBA_BYTES) {
    throw featureError("frame-too-large", "RGBA8 frames must fit within the 16 MiB browser budget");
  }
  return size;
}

function requireRequestId(value) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > U32_MAX) {
    throw featureError("invalid-request", "requestId must be a non-zero u32");
  }
  return value;
}

function requireDimension(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > U32_MAX) {
    throw featureError("invalid-dimension", `${label} must be a non-zero u32`);
  }
  return value;
}

function requireCount(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > U32_MAX) {
    throw featureError("invalid-count", `${label} must be a positive u32`);
  }
  return value;
}

function requireSafeInteger(value, label) {
  if (!Number.isSafeInteger(value)) {
    throw featureError("invalid-timing", `${label} must be a safe integer`);
  }
  return value;
}

function requireFrameNumber(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > U32_MAX) {
    throw featureError("invalid-frame", "frame number must be a non-negative u32");
  }
  return value;
}

function rationalMicroseconds(numerator, denominator) {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || numerator < 0 || denominator <= 0) {
    return undefined;
  }
  const value = Math.round((numerator * MICROSECONDS_PER_SECOND) / denominator);
  return Number.isSafeInteger(value) ? value : undefined;
}

function requireTransport(value) {
  if (value !== "rgba8" && value !== "video-frame") {
    throw featureError("invalid-transport", "transport must be rgba8 or video-frame");
  }
}

function isVideoFrameLike(value) {
  return !!value && typeof value === "object" && typeof value.copyTo === "function";
}

function isToken(value) {
  return !!value && typeof value === "object" && Object.hasOwn(value, "slot") && Object.hasOwn(value, "generation");
}

function throwIfAborted(signal) {
  if (!signal?.aborted) {
    return;
  }
  const error = new Error("WebCodecs rendering was aborted");
  error.name = "AbortError";
  error.code = "aborted";
  throw error;
}

function closeVideoFrame(frame) {
  if (frame && typeof frame.close === "function") {
    frame.close();
  }
}

function featureError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
