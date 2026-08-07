import { expect, test } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const specDirectory = dirname(fileURLToPath(import.meta.url));
const fixtureDirectory = resolve(specDirectory, "../../../native/tests/vectors");

// RGB24 is the only browser-runtime format; the corpus carries its preset id.
const FORMAT_NAMES = Object.freeze({ 537395200: "RGB24" });

function renderNumber(value, kind) {
  if (kind.startsWith("float")) {
    // Integer-looking values must stay floats: Python ints would drain as an
    // int array and upstream float[] arguments (e.g. BlankClip color) reject
    // a strict type mismatch.
    return Number.isInteger(value) ? `${value}.0` : String(value);
  }
  return String(value);
}

/**
 * Turns one corpus plan into a .vpy script using only the documented
 * browser authoring surface (sync VideoNode calls, set_output).
 */
function authorScript(plan) {
  const assignments = [];
  const variables = new Map();
  for (const operation of plan.operations) {
    const positional = [];
    const keyword = [];
    for (const argument of operation.arguments) {
      if (argument.kind === "node") {
        const reference = variables.get(argument.value);
        if (!reference) {
          throw new Error(
            `fixture: operation ${operation.id} references unassigned node operation ${argument.value}`,
          );
        }
        positional.push(reference);
      } else if (argument.kind === "nodeArray") {
        const references = argument.value.map((id) => {
          const reference = variables.get(id);
          if (!reference) {
            throw new Error(
              `fixture: operation ${operation.id} references unassigned node operation ${id}`,
            );
          }
          return reference;
        });
        keyword.push(`${argument.key}=[${references.join(", ")}]`);
      } else if (argument.key === "format") {
        const format = FORMAT_NAMES[argument.value];
        if (!format) {
          throw new Error(`fixture uses unsupported format id ${argument.value}`);
        }
        keyword.push(`format=vs.${format}`);
      } else if (argument.kind === "data") {
        const value =
          typeof argument.value === "string"
            ? argument.value
            : new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(argument.value));
        keyword.push(`${argument.key}=${JSON.stringify(value)}`);
      } else if (argument.kind === "intArray" || argument.kind === "floatArray") {
        keyword.push(
          `${argument.key}=[${argument.value.map((value) => renderNumber(value, argument.kind)).join(", ")}]`,
        );
      } else if (argument.kind === "int" || argument.kind === "float") {
        keyword.push(`${argument.key}=${renderNumber(argument.value, argument.kind)}`);
      } else {
        throw new Error(`fixture uses unsupported argument kind ${argument.kind}`);
      }
    }
    const call = `vs.core.std.${operation.function}(${[...positional, ...keyword].join(", ")})`;
    const variable = `clip${operation.id}`;
    assignments.push(`${variable} = ${call}`);
    variables.set(operation.id, variable);
  }

  const outputs = plan.outputs.map((output) => `${variables.get(output.node)}.set_output()`);
  return `import vapoursynth as vs

${assignments.join("\n")}
${outputs.join("\n")}
`;
}

function loadPlans() {
  const plans = [];
  for (const name of readdirSync(fixtureDirectory)) {
    if (!name.endsWith(".plan.json")) {
      continue;
    }
    const plan = JSON.parse(readFileSync(join(fixtureDirectory, name), "utf8"));
    if (plan.version !== 1) {
      throw new Error(`fixture ${name} must be a version 1 plan`);
    }
    const outputEntry = plan.outputs[0];
    const expected = readFileSync(join(fixtureDirectory, outputEntry.expected ?? `${name.slice(0, -10)}.rgba.bin`));
    plans.push({ name: name.slice(0, -".plan.json".length), plan, expected });
  }
  plans.sort((a, b) => a.name.localeCompare(b.name));
  if (plans.length === 0) {
    throw new Error(`no corpus plans found under ${fixtureDirectory}`);
  }
  return plans;
}

const CORPUS = loadPlans();

test.describe("production browser VapourSynth", () => {
  for (const { name, plan, expected } of CORPUS) {
    test(`executes corpus vector ${name} through Pyodide, RPC, Emscripten, and canvas`, async ({ page }) => {
      const consoleErrors = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      page.on("pageerror", (error) => consoleErrors.push(String(error)));

      // GitHub Pages serves the project site under a repository subpath;
      // visit the app there, not at the origin root.
      await page.goto("/web/app/");

      // 1. Wait for Pyodide and the VapourSynth worker to be ready.
      const runtimeStatus = page.locator("[data-runtime-status]");
      await expect(runtimeStatus).toHaveAttribute("data-state", "ready", { timeout: 90_000 });
      const runButton = page.locator(".run-button");
      await expect(runButton).toBeEnabled();

      // 2. Author the plan-derived script in the editor.
      const source = page.locator("textarea");
      await source.fill(authorScript(plan));

      // 3. Run it through the production worker path.
      await runButton.click();
      const outputState = page.locator("[data-output-state]");
      await expect(outputState).toHaveAttribute("data-state", "ready", { timeout: 90_000 });

      // 4. Confirm the frame reached the canvas with byte-exact plan pixels.
      const dimensions = await page.evaluate(() => {
        const canvas = document.querySelector("canvas");
        const context = canvas.getContext("2d");
        return {
          width: canvas.width,
          height: canvas.height,
          pixels: Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data),
        };
      });
      // The golden fixture is row-major RGBA for the exact output frame, so a
      // byte-exact compare also pins the frame geometry (crops, borders,
      // transposes, and stacks all change dimensions).
      expect(dimensions.pixels.length).toBe(expected.length);

      let firstDifference = -1;
      for (let index = 0; index < dimensions.pixels.length; index += 1) {
        if (dimensions.pixels[index] !== expected[index]) {
          firstDifference = index;
          break;
        }
      }
      expect(
        firstDifference,
        firstDifference === -1
          ? undefined
          : `canvas pixel mismatch at byte ${firstDifference} (got ${dimensions.pixels[firstDifference]}, expected ${expected[firstDifference]})`,
      ).toBe(-1);

      // 5. Verify worker logs surfaced and no page errors occurred.
      expect(consoleErrors).toEqual([]);
    });
  }
});
