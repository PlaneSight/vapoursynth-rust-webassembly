import assert from "node:assert/strict";
import test from "node:test";

import { EmscriptenSession } from "./emscripten-session.mjs";

function fakeModule({ status = 0 } = {}) {
  const memory = new Uint8Array(1024);
  let freed = null;
  return {
    HEAPU8: memory,
    _malloc(size) {
      return size <= memory.length ? 16 : 0;
    },
    _free(pointer) {
      freed = pointer;
    },
    _vs_rust_render_inverted_blank(_width, _height, pointer, size) {
      memory.fill(255, pointer, pointer + size);
      return status;
    },
    get freed() {
      return freed;
    },
  };
}

test("copies upstream RGBA bytes out of Emscripten memory", () => {
  const module = fakeModule();
  const session = new EmscriptenSession(module);
  const rgba = session.render_blank_frame(1, 3, 2);

  assert.deepEqual(rgba, new Uint8Array(24).fill(255));
  assert.equal(module.freed, 16);
});

test("reports upstream status and closes deterministically", () => {
  const session = new EmscriptenSession(fakeModule());
  assert.equal(JSON.parse(session.status()).upstreamLinked, true);

  session.free();
  assert.equal(JSON.parse(session.status()).upstreamLinked, false);
  assert.throws(
    () => session.render_blank_frame(4, 1, 1),
    (error) => JSON.parse(error).error.code === "runtime-closed",
  );
});

test("frees temporary memory when upstream rendering fails", () => {
  const module = fakeModule({ status: 7 });
  const session = new EmscriptenSession(module);

  assert.throws(
    () => session.render_blank_frame(9, 1, 1),
    (error) => JSON.parse(error).error.code === "upstream-error",
  );
  assert.equal(module.freed, 16);
});
