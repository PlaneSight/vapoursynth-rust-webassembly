import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const [modulePath] = process.argv.slice(2);
if (!modulePath) {
  throw new Error("expected Emscripten module path");
}

const { default: createModule } = await import(pathToFileURL(modulePath));
const module = await createModule();
const width = 37;
const height = 19;
const byteLength = width * height * 4;
const output = module._malloc(byteLength);
assert.notEqual(output, 0);

try {
  const status = module._vs_rust_render_inverted_blank(
    width,
    height,
    output,
    byteLength,
  );
  assert.equal(status, 0);

  const rgba = module.HEAPU8.slice(output, output + byteLength);
  assert.equal(rgba.length, byteLength);
  for (const channel of rgba) {
    assert.equal(channel, 255);
  }
} finally {
  module._free(output);
}

console.log("Emscripten ES module produced the verified upstream RGBA frame");
