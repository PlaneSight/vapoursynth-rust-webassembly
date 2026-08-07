import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const specDirectory = dirname(fileURLToPath(import.meta.url));
const fixtureDirectory = resolve(specDirectory, "../../../native/tests/vectors");
const lockPath = resolve(specDirectory, "../../../third_party/lock.toml");
const FORMAT_NAMES = Object.freeze({ 537395200: "RGB24" });
const EXPECTED_NATIVE_OPTIONS = Object.freeze(["enable_x86_asm=false", "enable_arm_asm=false"]);

function renderNumber(value, kind) {
  if (kind.startsWith("float")) {
    return Number.isInteger(value) ? `${value}.0` : String(value);
  }
  return String(value);
}

function authorScript(plan) {
  const assignments = [];
  const variables = new Map();
  for (const operation of plan.operations) {
    const positional = [];
    const keyword = [];
    for (const argument of operation.arguments) {
      if (argument.kind === "node") {
        const reference = variables.get(argument.value);
        if (!reference) throw new Error(`fixture: operation ${operation.id} references unknown node ${argument.value}`);
        positional.push(reference);
      } else if (argument.kind === "nodeArray") {
        const references = argument.value.map((id) => {
          const reference = variables.get(id);
          if (!reference) throw new Error(`fixture: operation ${operation.id} references unknown node ${id}`);
          return reference;
        });
        keyword.push(`${argument.key}=[${references.join(", ")}]`);
      } else if (argument.key === "format") {
        const format = FORMAT_NAMES[argument.value];
        if (!format) throw new Error(`fixture uses unsupported format id ${argument.value}`);
        keyword.push(`format=vs.${format}`);
      } else if (argument.kind === "data") {
        const value = typeof argument.value === "string"
          ? argument.value
          : new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(argument.value));
        keyword.push(`${argument.key}=${JSON.stringify(value)}`);
      } else if (argument.kind === "intArray" || argument.kind === "floatArray") {
        keyword.push(`${argument.key}=[${argument.value.map((value) => renderNumber(value, argument.kind)).join(", ")}]`);
      } else if (argument.kind === "int" || argument.kind === "float") {
        keyword.push(`${argument.key}=${renderNumber(argument.value, argument.kind)}`);
      } else {
        throw new Error(`fixture uses unsupported argument kind ${argument.kind}`);
      }
    }
    const namespace = operation.namespace === "std" ? "vs.core.std" : `vs.core.${operation.namespace}`;
    const variable = `clip${operation.id}`;
    assignments.push(`${variable} = ${namespace}.${operation.function}(${[...positional, ...keyword].join(", ")})`);
    variables.set(operation.id, variable);
  }
  const outputs = plan.outputs.map((output) => {
    if (output.index !== 0) throw new Error(`fixture output ${output.index} is not supported by the production UI`);
    const variable = variables.get(output.node);
    if (!variable) throw new Error(`fixture output references unknown node ${output.node}`);
    return `${variable}.set_output()`;
  });
  return `import vapoursynth as vs

${assignments.join("\n")}
${outputs.join("\n")}
`;
}

function lockedProvenance() {
  const lock = readFileSync(lockPath, "utf8");
  const commit = lock.match(/commit\s*=\s*"([0-9a-f]{40})"/)?.[1];
  const patch = lock.match(/patches\s*=\s*\["([^"]+)"\]/)?.[1];
  if (!commit || !patch) throw new Error("third_party/lock.toml has no complete VapourSynth provenance");
  return {
    repository: "https://github.com/vapoursynth/vapoursynth.git",
    commit,
    nativePatches: [],
    browserPatches: [patch],
    nativeMesonOptions: [...EXPECTED_NATIVE_OPTIONS],
  };
}

function assertManifest(manifest) {
  if (!manifest || manifest.schemaVersion !== 1 || !Array.isArray(manifest.cases)) {
    throw new Error("conformance.json must have schemaVersion 1 and a cases array");
  }
  const expectedUpstream = lockedProvenance();
  if (JSON.stringify(manifest.upstream) !== JSON.stringify(expectedUpstream)) {
    throw new Error("conformance.json provenance does not match third_party/lock.toml");
  }
  const names = new Set();
  const plans = new Set();
  for (const entry of manifest.cases) {
    if (!entry || typeof entry.name !== "string" || typeof entry.plan !== "string" || names.has(entry.name) || plans.has(entry.plan)) {
      throw new Error("conformance.json contains duplicate or malformed case names");
    }
    names.add(entry.name);
    plans.add(entry.plan);
    if (entry.plan !== `${entry.name}.json`) throw new Error(`case ${entry.name} does not name its canonical plan`);
    const planPath = join(fixtureDirectory, entry.plan);
    const plan = JSON.parse(readFileSync(planPath, "utf8"));
    if (plan.version !== 1 || !Array.isArray(plan.operations) || !Array.isArray(plan.outputs)) {
      throw new Error(`case ${entry.name} has an invalid plan`);
    }
    if (entry.outcome === "frame") {
      if (!Array.isArray(entry.outputs) || entry.outputs.length !== 1 || entry.outputs[0].index !== 0) {
        throw new Error(`case ${entry.name} requires exactly one output at index 0 for the production UI`);
      }
      const output = entry.outputs[0];
      if (output.format !== "RGB24" || !Array.isArray(output.strides) || output.strides.length !== 1 || output.strides[0] !== output.width * 4) {
        throw new Error(`case ${entry.name} has unsupported format or stride metadata`);
      }
      const bytes = readFileSync(join(fixtureDirectory, output.rgba));
      if (bytes.length !== output.strides[0] * output.height) throw new Error(`case ${entry.name} has inconsistent frame dimensions`);
      if (createHash("sha256").update(bytes).digest("hex") !== output.sha256) throw new Error(`case ${entry.name} has a stale RGBA digest`);
      if (plan.outputs.length !== 1 || plan.outputs[0].expected !== output.rgba) throw new Error(`case ${entry.name} plan/output mismatch`);
    } else if (entry.outcome === "error") {
      if (!entry.error || plan.expectedFailure === undefined || JSON.stringify(plan.expectedFailure) !== JSON.stringify(entry.error)) {
        throw new Error(`case ${entry.name} has a stale expected failure`);
      }
    } else {
      throw new Error(`case ${entry.name} has unsupported outcome ${entry.outcome}`);
    }
  }
  const planFiles = readdirSync(fixtureDirectory).filter((name) => name.endsWith(".plan.json")).sort();
  if (planFiles.length !== plans.size || planFiles.some((name) => !plans.has(name))) {
    throw new Error("conformance.json does not cover exactly every checked-in plan");
  }
  return manifest.cases.slice().sort((left, right) => left.name.localeCompare(right.name)).map((entry) => ({
    ...entry,
    plan: JSON.parse(readFileSync(join(fixtureDirectory, entry.plan), "utf8")),
  }));
}

const MANIFEST = JSON.parse(readFileSync(join(fixtureDirectory, "conformance.json"), "utf8"));
const CORPUS = assertManifest(MANIFEST);
const THREADED_ARTIFACT = ["1", "true"].includes((process.env.VS_BROWSER_THREADED ?? "").toLowerCase());
const CROSS_ORIGIN_ISOLATED = process.env.BROWSER_CROSS_ORIGIN_ISOLATION === "1";

async function openRuntime(page) {
  const consoleErrors = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(String(error)));
  await page.goto("/web/app/");
  const runtimeStatus = page.locator("[data-runtime-status]");
  await expect(runtimeStatus).toHaveAttribute("data-state", "ready", { timeout: 90_000 });
  const expectedThreading = THREADED_ARTIFACT
    ? (CROSS_ORIGIN_ISOLATED ? "threaded active" : "threaded unavailable · cross-origin-isolation-required")
    : "single-thread active · single-thread fallback";
  await expect(page.locator("[data-threading-status]")).toHaveText(expectedThreading);
  await expect(page.locator(".run-button")).toBeEnabled();
  return { consoleErrors, runtimeStatus };
}

test.describe("production browser VapourSynth native differential corpus", () => {
  test("serves the scheduler isolation contract", async ({ request }) => {
    const response = await request.get("/web/app/");
    expect(response.ok()).toBe(true);
    const headers = response.headers();
    if (CROSS_ORIGIN_ISOLATED) {
      expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
      expect(headers["cross-origin-embedder-policy"]).toBe("require-corp");
      expect(headers["cross-origin-resource-policy"]).toBe("same-origin");
    } else {
      expect(headers["cross-origin-opener-policy"] ?? "").toBe("");
      expect(headers["cross-origin-embedder-policy"] ?? "").toBe("");
      expect(headers["cross-origin-resource-policy"] ?? "").toBe("");
    }
  });

  test("reports unavailable threaded artifacts before module creation", async ({ page }) => {
    test.skip(!THREADED_ARTIFACT || CROSS_ORIGIN_ISOLATED, "only applies to an unisolated threaded artifact");
    await page.goto("/web/app/");
    await expect(page.locator("[data-runtime-status]")).toHaveAttribute("data-state", "idle", { timeout: 90_000 });
    await expect(page.locator("[data-threading-status]")).toHaveText("threaded unavailable · cross-origin-isolation-required");
    await expect(page.locator(".run-button")).toBeDisabled();
  });

  test("rejects stale native provenance", () => {
    const stale = structuredClone(MANIFEST);
    stale.upstream.commit = "0000000000000000000000000000000000000000";
    expect(() => assertManifest(stale)).toThrow("provenance does not match");
  });

  for (const entry of CORPUS) {
    test(`${entry.outcome} corpus vector ${entry.name}`, async ({ page }) => {
      const { consoleErrors, runtimeStatus } = await openRuntime(page);
      await page.locator("textarea").fill(authorScript(entry.plan));
      await page.locator(".run-button").click();
      if (entry.outcome === "error") {
        await expect(runtimeStatus).toHaveAttribute("data-state", "error", { timeout: 90_000 });
        const expectedMessage = entry.error.message || `VapourSynth upstream operation failed with status ${entry.error.status}`;
        await expect(page.locator("[data-status-text]")).toHaveText(`${entry.error.code}: ${expectedMessage}`);
        await expect(page.locator("[data-output-state]"), "failure must not produce a ready output").not.toHaveAttribute("data-state", "ready");
      } else {
        await expect(page.locator("[data-output-state]")).toHaveAttribute("data-state", "ready", { timeout: 90_000 });
        const dimensions = await page.evaluate(() => {
          const canvas = document.querySelector("canvas");
          const context = canvas.getContext("2d");
          return { width: canvas.width, height: canvas.height, pixels: Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data) };
        });
        const output = entry.outputs[0];
        expect(dimensions.width).toBe(output.width);
        expect(dimensions.height).toBe(output.height);
        const expected = Array.from(readFileSync(join(fixtureDirectory, output.rgba)));
        expect(dimensions.pixels.length).toBe(expected.length);
        let firstDifference = -1;
        for (let index = 0; index < expected.length; index += 1) {
          if (dimensions.pixels[index] !== expected[index]) { firstDifference = index; break; }
        }
        expect(firstDifference, firstDifference === -1 ? undefined : `canvas pixel mismatch at byte ${firstDifference}`).toBe(-1);
      }
      expect(consoleErrors).toEqual([]);
    });
  }
});
