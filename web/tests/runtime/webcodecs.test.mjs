import assert from "node:assert/strict";
import test from "node:test";

import {
  renderOutputSequence,
  WebCodecsInputAdapter,
} from "../../runtime/vapoursynth/webcodecs.mjs";

test("renderOutputSequence renders an inclusive bounded range in order", async () => {
  const calls = [];
  const client = {
    renderOutput(index, frame, options) {
      calls.push({ index, frame, options });
      return Promise.resolve({ width: 2, height: 1, rgba: new ArrayBuffer(8) });
    },
  };

  const frames = await renderOutputSequence(client, 3, {
    startFrame: 1,
    endFrame: 3,
    metadata: { numFrames: 4, fpsNum: 24, fpsDen: 1 },
  });

  assert.deepEqual(calls.map(({ index, frame }) => [index, frame]), [[3, 1], [3, 2], [3, 3]]);
  assert.deepEqual(calls.map(({ options }) => options), [
    { transport: "rgba8", timestamp: 41667, duration: 41667 },
    { transport: "rgba8", timestamp: 83333, duration: 41667 },
    { transport: "rgba8", timestamp: 125000, duration: 41667 },
  ]);
  assert.equal(frames.length, 3);
});

test("renderOutputSequence accumulates variable frame durations", async () => {
  const timings = [];
  let frameNumber = 0;
  const client = {
    renderOutput() {
      const duration = [40000, 20000, 80000][frameNumber++];
      return Promise.resolve({
        width: 1,
        height: 1,
        timestamp: 0,
        timestampKnown: false,
        duration,
        durationKnown: true,
        videoFrame: { close() {} },
      });
    },
  };

  await renderOutputSequence(client, 0, {
    endFrame: 2,
    metadata: { numFrames: 3, fpsNum: 0, fpsDen: 0 },
    transport: "video-frame",
    onFrame(frame) {
      timings.push([frame.timestamp, frame.duration]);
      return false;
    },
  });

  assert.deepEqual(timings, [[0, 40000], [40000, 20000], [60000, 80000]]);
});

test("renderOutputSequence retimes VideoFrames with synthesized timestamps", async () => {
  const previousVideoFrame = globalThis.VideoFrame;
  const observed = [];
  let frameNumber = 0;
  globalThis.VideoFrame = class {
    constructor(source, options) {
      this.timestamp = options.timestamp;
      this.duration = options.duration;
      this.copyTo = source.copyTo;
      this.close = () => {};
    }
  };
  try {
    await renderOutputSequence({
      renderOutput() {
        const duration = [40000, 20000][frameNumber++];
        return Promise.resolve({
          width: 1,
          height: 1,
          timestamp: 0,
          timestampKnown: false,
          duration,
          durationKnown: true,
          videoFrame: { copyTo() {}, close() {} },
        });
      },
    }, 0, {
      endFrame: 1,
      metadata: { numFrames: 2, fpsNum: 0, fpsDen: 0 },
      transport: "video-frame",
      onFrame(frame) {
        observed.push(frame.videoFrame.timestamp);
        return false;
      },
    });
  } finally {
    if (previousVideoFrame === undefined) {
      delete globalThis.VideoFrame;
    } else {
      globalThis.VideoFrame = previousVideoFrame;
    }
  }
  assert.deepEqual(observed, [0, 40000]);
});

test("renderOutputSequence closes retimed frames when callbacks fail", async () => {
  const previousVideoFrame = globalThis.VideoFrame;
  let sourceClosed = false;
  let retimedClosed = false;
  globalThis.VideoFrame = class {
    constructor(source, options) {
      this.timestamp = options.timestamp;
      this.duration = options.duration;
      this.copyTo = source.copyTo;
    }

    close() {
      retimedClosed = true;
    }
  };
  const sourceFrame = {
    copyTo() {},
    close() {
      sourceClosed = true;
    },
  };

  try {
    await assert.rejects(
      renderOutputSequence({
        renderOutput() {
          return {
            width: 1,
            height: 1,
            timestamp: 0,
            timestampKnown: false,
            duration: 1000,
            durationKnown: true,
            videoFrame: sourceFrame,
          };
        },
      }, 0, {
        endFrame: 0,
        metadata: { numFrames: 1, fpsNum: 0, fpsDen: 0 },
        transport: "video-frame",
        onFrame() {
          throw new Error("callback failed");
        },
      }),
      /callback failed/,
    );
  } finally {
    if (previousVideoFrame === undefined) {
      delete globalThis.VideoFrame;
    } else {
      globalThis.VideoFrame = previousVideoFrame;
    }
  }
  assert.equal(sourceClosed, true);
  assert.equal(retimedClosed, true);
});

test("renderOutputSequence closes unretained callback frames", async () => {
  const videoFrame = {
    codedWidth: 1,
    codedHeight: 1,
    copyTo() {},
    close() {
      this.closed = true;
    },
  };
  const client = {
    renderOutput() {
      return Promise.resolve({ width: 1, height: 1, rgba: new ArrayBuffer(4), videoFrame });
    },
  };

  const retained = await renderOutputSequence(client, 0, {
    startFrame: 0,
    endFrame: 0,
    transport: "video-frame",
    onFrame: () => false,
  });

  assert.deepEqual(retained, []);
  assert.equal(videoFrame.closed, true);
});

test("WebCodecsInputAdapter uploads packed RGBA and releases its source node", async () => {
  const calls = [];
  const runtime = {
    source_create(...args) {
      calls.push(["create", ...args.slice(1)]);
      return { slot: 7, generation: 9 };
    },
    source_upload_rgba(...args) {
      calls.push(["upload", ...args.slice(1)]);
    },
    node_release(...args) {
      calls.push(["release", ...args.slice(1)]);
    },
  };

  const adapter = new WebCodecsInputAdapter(runtime, { slot: 1, generation: 2 }, {
    requestId: 5,
    width: 2,
    height: 1,
    numFrames: 2,
  });
  await adapter.uploadFrame(new Uint8Array(8), 1);
  adapter.close();

  assert.deepEqual(calls[0], ["create", { slot: 1, generation: 2 }, 2, 1, 2, 0, 0]);
  assert.equal(calls[1][0], "upload");
  assert.equal(calls[1][1].slot, 7);
  assert.equal(calls[1][2], 1);
  assert.deepEqual(calls[1][3], new Uint8Array(8));
  assert.deepEqual(calls[1].slice(4), [0, 0]);
  assert.deepEqual(calls[2], ["release", { slot: 7, generation: 9 }]);
});

test("WebCodecsInputAdapter copies and closes a VideoFrame with timing", async () => {
  const calls = [];
  const runtime = {
    source_create() {
      return { slot: 4, generation: 5 };
    },
    source_upload_rgba(...args) {
      calls.push(args.slice(2));
    },
    node_release() {},
  };
  const frame = {
    codedWidth: 1,
    codedHeight: 1,
    async copyTo(output, options) {
      assert.deepEqual(options, { format: "RGBA" });
      output.set([1, 2, 3, 255]);
    },
    close() {
      this.closed = true;
    },
  };
  const adapter = new WebCodecsInputAdapter(runtime, { slot: 1, generation: 2 }, {
    requestId: 6,
    width: 1,
    height: 1,
    numFrames: 1,
    fpsNum: 0,
    fpsDen: 0,
  });
  await adapter.uploadFrame(frame, 0, { durationNum: 1, durationDen: 24, absoluteTime: 0 });

  assert.deepEqual(calls, [[0, new Uint8Array([1, 2, 3, 255]), 1, 24, 0]]);
  assert.equal(frame.closed, true);
  adapter.close();
});

test("WebCodecsInputAdapter defers node release until an awaited upload finishes", async () => {
  const calls = [];
  const nodeToken = { slot: 4, generation: 5 };
  const runtime = {
    source_create(...args) {
      calls.push(["create", ...args.slice(1)]);
      return nodeToken;
    },
    source_upload_rgba(...args) {
      calls.push(["upload", ...args.slice(1)]);
    },
    node_release(...args) {
      calls.push(["release", ...args.slice(1)]);
    },
  };
  let startCopy;
  const copyStarted = new Promise((resolve) => {
    startCopy = resolve;
  });
  let finishCopy;
  const copyGate = new Promise((resolve) => {
    finishCopy = resolve;
  });
  const frame = {
    codedWidth: 1,
    codedHeight: 1,
    async copyTo(output, options) {
      assert.deepEqual(options, { format: "RGBA" });
      startCopy();
      await copyGate;
      output.set([1, 2, 3, 255]);
    },
    close() {
      this.closed = true;
    },
  };
  const adapter = new WebCodecsInputAdapter(runtime, { slot: 1, generation: 2 }, {
    requestId: 8,
    width: 1,
    height: 1,
    numFrames: 1,
  });

  const upload = adapter.uploadFrame(frame);
  await copyStarted;
  adapter.close();
  adapter.close();

  assert.equal(adapter.nodeToken, null);
  assert.equal(frame.closed, undefined);
  assert.deepEqual(calls.map(([name]) => name), ["create"]);
  await assert.rejects(
    adapter.uploadFrame(new Uint8Array(4)),
    (error) => error.code === "runtime-closed",
  );

  finishCopy();
  await upload;
  adapter.close();
  adapter.free();

  assert.equal(frame.closed, true);
  assert.deepEqual(calls.map(([name]) => name), ["create", "upload", "release"]);
  assert.deepEqual(calls[1][1], nodeToken);
  assert.deepEqual(calls[1][3], new Uint8Array([1, 2, 3, 255]));
  assert.deepEqual(calls[2], ["release", nodeToken]);
});

test("WebCodecsInputAdapter rejects cropped VideoFrames", async () => {
  const runtime = {
    source_create() {
      return { slot: 8, generation: 9 };
    },
    source_upload_rgba() {},
    node_release() {},
  };
  const frame = {
    codedWidth: 2,
    codedHeight: 1,
    visibleRect: { x: 1, y: 0, width: 1, height: 1 },
    copyTo() {
      throw new Error("copyTo should not run");
    },
    close() {
      this.closed = true;
    },
  };
  const adapter = new WebCodecsInputAdapter(runtime, { slot: 1, generation: 2 }, {
    requestId: 7,
    width: 2,
    height: 1,
    numFrames: 1,
  });

  await assert.rejects(
    adapter.uploadFrame(frame),
    (error) => error.code === "invalid-frame",
  );
  assert.equal(frame.closed, true);
  adapter.close();
});

test("renderOutputSequence stops before requesting an aborted frame", async () => {
  const controller = new AbortController();
  const requested = [];
  const client = {
    async renderOutput(_index, frame) {
      requested.push(frame);
      if (frame === 1) controller.abort();
      return { width: 1, height: 1, rgba: new ArrayBuffer(4) };
    },
  };

  await assert.rejects(
    renderOutputSequence(client, 0, { startFrame: 0, endFrame: 3, signal: controller.signal }),
    (error) => error.code === "aborted" && error.name === "AbortError",
  );
  assert.deepEqual(requested, [0, 1]);
});
