import { expect, test } from "@playwright/test";

// Blueprint graph manipulation: create, move, delete, and stale-preview
// behavior. The corpus spec owns byte-exact rendering; this file owns the
// canvas interaction contract.
test.describe("blueprint graph interactions", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/web/app/");
    await expect(page.locator("[data-runtime-status]")).toHaveAttribute("data-state", "ready", { timeout: 90_000 });
  });

  test("adds a vector-validated function from the library with runnable arguments", async ({ page }) => {
    await page.locator('[data-library-function="AddBorders"]').click();
    await page.locator("[data-add-graph]").click();
    await expect(page.locator('[data-graph-node="AddBorders"]')).toHaveCount(1);
    await expect(page.locator("[data-graph-count]")).toHaveText("04");
    await expect(page.locator("textarea")).toHaveValue(/vs\.core\.std\.AddBorders\(clip, left=7, right=3, top=5, bottom=9/);
  });

  test("builds a filter call from typed inspector arguments", async ({ page }) => {
    await page.locator("[data-library-search]").fill("Text");
    await page.locator('[data-library-function="Text"]').click();
    const argumentsPanel = page.locator("[data-argument-controls]");
    await expect(argumentsPanel).toBeVisible();
    await page.locator("[data-add-argument]").click();
    const row = page.locator("[data-argument-row]").last();
    await row.locator("[data-argument-key]").fill("text");
    await row.locator("[data-argument-value]").fill("browser draft");
    await page.locator("[data-add-graph]").click();
    await expect(page.locator('[data-graph-node="Text"]')).not.toHaveClass(/is-draft/);
    await expect(page.locator("textarea")).toHaveValue(/std\.Text\(clip, text="browser draft"\)/);
  });

  test("runs a preset numeric filter through the worker", async ({ page }) => {
    await page.locator("[data-library-search]").fill("Levels");
    await page.locator('[data-library-function="Levels"]').click();
    await page.locator("[data-add-graph]").click();
    await expect(page.locator("textarea")).toHaveValue(/Levels\(clip, min_in=\[0\.0\], max_in=\[255\.0\]/);
    await page.locator(".run-button").click();
    await expect(page.locator("[data-output-state]")).toHaveAttribute("data-state", "ready", { timeout: 90_000 });
  });

  test("rejects invalid inspector argument names without changing the graph", async ({ page }) => {
    await page.locator("[data-library-search]").fill("Text");
    await page.locator('[data-library-function="Text"]').click();
    await page.locator("[data-add-argument]").click();
    const row = page.locator("[data-argument-row]").last();
    await row.locator("[data-argument-key]").fill("not valid");
    await row.locator("[data-argument-value]").fill("1");
    await page.locator("[data-add-graph]").click();
    await expect(page.locator("[data-inspector-note]")).toHaveText(/argument names must be Python identifiers/);
    await expect(page.locator("[data-graph-count]")).toHaveText("03");
  });

  test("rejects Python keywords and duplicate argument names", async ({ page }) => {
    await page.locator("[data-library-search]").fill("Text");
    await page.locator('[data-library-function="Text"]').click();
    await page.locator("[data-add-argument]").click();
    await page.locator("[data-add-argument]").click();
    const rows = page.locator("[data-argument-row]");
    await rows.nth(0).locator("[data-argument-key]").fill("class");
    await rows.nth(0).locator("[data-argument-value]").fill("first");
    await rows.nth(1).locator("[data-argument-key]").fill("text");
    await rows.nth(1).locator("[data-argument-value]").fill("second");
    await page.locator("[data-add-graph]").click();
    await expect(page.locator("[data-inspector-note]")).toHaveText(/Python identifiers/);
    await expect(page.locator("[data-graph-count]")).toHaveText("03");
    await rows.nth(0).locator("[data-argument-key]").fill("text");
    await page.locator("[data-add-graph]").click();
    await expect(page.locator("[data-inspector-note]")).toHaveText("argument names must be unique");
    await expect(page.locator("[data-graph-count]")).toHaveText("03");
  });

  test("hydrates typed arguments from a plotted source call", async ({ page }) => {
    const source = page.locator("textarea");
    await source.evaluate((element) => {
      element.value = element.value.replace(
        "clip.set_output()",
        "clip = vs.core.std.AddBorders(clip, left=11, right=3, top=5, bottom=9, color=[0.0, 0.0, 0.0])\nclip.set_output()",
      );
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.locator('[data-graph-node="AddBorders"]').click();
    await expect(page.locator('[data-graph-node="AddBorders"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("[data-argument-row]").first().locator("[data-argument-value]")).toHaveValue("11");
  });
  test("hydrates duplicate plotted filters from their own source calls", async ({ page }) => {
    const source = page.locator("textarea");
    await source.evaluate((element) => {
      element.value = element.value.replace(
        "clip = vs.core.std.Invert(clip)",
        "clip = vs.core.std.AddBorders(clip, left=11, right=3, top=5, bottom=9, color=[0.0, 0.0, 0.0])\n"
          + "clip = vs.core.std.AddBorders(clip, left=22, right=3, top=5, bottom=9, color=[0.0, 0.0, 0.0])",
      );
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const nodes = page.locator('[data-graph-node="AddBorders"]');
    await expect(nodes).toHaveCount(2);
    await nodes.nth(0).click();
    await expect(page.locator("[data-argument-row]").first().locator("[data-argument-value]")).toHaveValue("11");
    await nodes.nth(1).click();
    await expect(page.locator("[data-argument-row]").first().locator("[data-argument-value]")).toHaveValue("22");
  });


  test("keeps BlankClip dimensions synchronized with typed arguments", async ({ page }) => {
    await page.locator('[data-library-function="BlankClip"]').click();
    await page.locator("[data-argument-row]").first().locator("[data-argument-value]").fill("640");
    await expect(page.locator("[data-graph-width]")).toHaveValue("640");
    await expect(page.locator("textarea")).toHaveValue(/BlankClip\(width=640, height=180/);
  });

  test("inserts a reference note through the inspector", async ({ page }) => {
    await page.locator("[data-library-search]").fill("FrameEval");
    await page.locator('[data-library-function="FrameEval"]').click();
    await page.locator("[data-insert-note]").click();
    await expect(page.locator("textarea")).toHaveValue(/# Reference: vs\.core\.std\.FrameEval\(…\)/);
  });

  test("plots an unsupported function as a dashed draft", async ({ page }) => {
    await page.locator("[data-library-search]").fill("FrameEval");
    await page.locator('[data-library-function="FrameEval"]').click();
    await page.locator("[data-add-graph]").click();
    const draft = page.locator('[data-graph-node="FrameEval"]');
    await expect(draft).toHaveCount(1);
    await expect(draft).toHaveClass(/is-draft/);
    await expect(page.locator("textarea")).toHaveValue(/# Reference: vs\.core\.std\.FrameEval\(…\)/);
  });

  test("deletes a plotted node with the Delete key", async ({ page }) => {
    await page.locator('[data-library-function="AddBorders"]').click();
    await page.locator("[data-add-graph]").click();
    const node = page.locator('[data-graph-node="AddBorders"]');
    await node.focus();
    await page.keyboard.press("Delete");
    await expect(node).toHaveCount(0);
    await expect(page.locator("[data-graph-count]")).toHaveText("03");
    await expect(page.locator("textarea")).not.toHaveValue(/AddBorders/);
  });

  test("drag repositions a node and the layout survives a source edit", async ({ page }) => {
    const node = page.locator('[data-graph-node="Invert"]');
    const box = await node.boundingBox();
    await page.mouse.move(box.x + 40, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + 160, box.y + 90, { steps: 4 });
    await page.mouse.up();
    const leftAfterDrag = await node.evaluate((el) => el.style.left);
    expect(leftAfterDrag).not.toBe("35.5%");
    // A source touch re-renders the graph; the dragged layout must persist.
    await page.locator("textarea").evaluate((el) => {
      el.value = `${el.value}\n# layout check`;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const leftPersisted = await node.evaluate((el) => el.style.left);
    expect(leftPersisted).toBe(leftAfterDrag);
  });

  test("source edits after a render clear the stale preview", async ({ page }) => {
    await page.locator(".run-button").click();
    await expect(page.locator("[data-output-state]")).toHaveAttribute("data-state", "ready", { timeout: 90_000 });
    await page.locator("textarea").evaluate((el) => {
      el.value = `${el.value}\n# stale check`;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const outputState = page.locator("[data-output-state]");
    await expect(outputState).toHaveText("awaiting render");
    await expect(outputState).toHaveAttribute("data-state", "changed");
  });

  test("seeks and plays a bounded multi-frame output", async ({ page }) => {
    await page.locator("textarea").fill(
      "import vapoursynth as vs\n\n"
        + "clip = vs.core.std.BlankClip(width=8, height=6, format=vs.RGB24, color=[32.0, 96.0, 224.0], length=3)\n"
        + "clip.set_output()\n",
    );
    await page.locator(".run-button").click();
    await expect(page.locator("[data-frame-status]")).toHaveText("Frame 1 / 3", { timeout: 90_000 });

    const slider = page.locator("[data-frame-slider]");
    await expect(slider).toHaveAttribute("max", "2");
    await slider.fill("2");
    await expect(page.locator("[data-frame-status]")).toHaveText("Frame 3 / 3", { timeout: 90_000 });

    await slider.fill("0");
    await expect(page.locator("[data-frame-status]")).toHaveText("Frame 1 / 3", { timeout: 90_000 });
    const toggle = page.locator("[data-playback-toggle]");
    await toggle.click();
    await expect(page.locator("[data-frame-status]")).toHaveText("Frame 3 / 3", { timeout: 90_000 });
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  test("right-click menu deletes a node", async ({ page }) => {
    await page.locator('[data-library-function="AddBorders"]').click();
    await page.locator("[data-add-graph]").click();
    const node = page.locator('[data-graph-node="AddBorders"]');
    const box = await node.boundingBox();
    await page.mouse.click(box.x + 40, box.y + 20, { button: "right" });
    const menu = page.locator(".context-menu");
    await expect(menu).toBeVisible();
    await page.locator('.context-menu-item:has-text("Delete node")').click();
    await expect(node).toHaveCount(0);
    await expect(page.locator("textarea")).not.toHaveValue(/AddBorders/);
  });

  test("right-click menu copies a call", async ({ page }) => {
    const node = page.locator('[data-graph-node="Invert"]');
    const box = await node.boundingBox();
    await page.mouse.click(box.x + 40, box.y + 20, { button: "right" });
    await page.locator('.context-menu-item:has-text("Copy call")').click();
    await expect(page.locator("[data-inspector-note]")).toContainText("Invert(clip, planes=None)");
  });

  test("output node right-click disables delete", async ({ page }) => {
    const node = page.locator('[data-graph-node="Output"]');
    const box = await node.boundingBox();
    await page.mouse.click(box.x + 40, box.y + 20, { button: "right" });
    await expect(page.locator(".context-menu")).toBeVisible();
    await expect(page.locator('.context-menu-item:has-text("Delete node")')).toBeDisabled();
    // Escape closes the menu and restores focus to the node.
    await page.keyboard.press("Escape");
    await expect(page.locator(".context-menu")).toBeHidden();
    await expect(node).toHaveAttribute("aria-pressed", "true");
  });

  test("out-port drag rewires the script chain", async ({ page }) => {
    // Chain: BlankClip, Invert, AddBorders, FlipHorizontal, Output.
    await page.locator('[data-library-function="AddBorders"]').click();
    await page.locator("[data-add-graph]").click();
    await page.locator('[data-library-function="FlipHorizontal"]').click();
    await page.locator("[data-add-graph]").click();
    // Drag FlipHorizontal's output onto Invert: Flip must now feed Invert.
    const flip = page.locator('[data-graph-node="FlipHorizontal"]');
    const portBox = await flip.locator(".node-port.out").boundingBox();
    const invertBox = await page.locator('[data-graph-node="Invert"]').boundingBox();
    await page.mouse.move(portBox.x + portBox.width / 2, portBox.y + portBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(invertBox.x + 60, invertBox.y + 40, { steps: 8 });
    await expect(page.locator(".wire-rubber")).toBeVisible();
    await expect(page.locator('[data-graph-node="Invert"].is-connect-target')).toHaveCount(1);
    await page.mouse.up();
    await expect(page.locator("textarea")).toHaveValue(/FlipHorizontal\(clip\)[\s\S]*Invert\(clip\)[\s\S]*AddBorders\(clip, left=7/);
    await expect(page.locator('[data-graph-node="FlipHorizontal"][data-index="1"]')).toHaveCount(1);
    // A rewire is a source edit: a rendered preview goes stale.
    await page.locator(".run-button").click();
    await expect(page.locator("[data-output-state]")).toHaveAttribute("data-state", "ready", { timeout: 90_000 });
    // The run-button click can scroll the page; bring the port back into view.
    await page.locator('[data-graph-node="Invert"] .node-port.out').scrollIntoViewIfNeeded();
    const portBoxAfter = await page.locator('[data-graph-node="Invert"] .node-port.out').boundingBox();
    const flipBox = await page.locator('[data-graph-node="FlipHorizontal"]').boundingBox();
    await page.mouse.move(portBoxAfter.x + portBoxAfter.width / 2, portBoxAfter.y + portBoxAfter.height / 2);
    await page.mouse.down();
    await page.mouse.move(flipBox.x + 60, flipBox.y + 40, { steps: 6 });
    await page.mouse.up();
    await expect(page.locator("[data-output-state]")).toHaveAttribute("data-state", "changed");
  });

  test("in-port drag onto a node makes that node feed it", async ({ page }) => {
    // Chain: BlankClip, Invert, AddBorders, Output. Drag the Output in-port
    // onto Invert: Invert becomes the final stage before Output.
    await page.locator('[data-library-function="AddBorders"]').click();
    await page.locator("[data-add-graph]").click();
    const output = page.locator('[data-graph-node="Output"]');
    const portBox = await output.locator(".node-port.in").boundingBox();
    const invertBox = await page.locator('[data-graph-node="Invert"]').boundingBox();
    await page.mouse.move(portBox.x + portBox.width / 2, portBox.y + portBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(invertBox.x + 60, invertBox.y + 40, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator('[data-graph-node="Invert"][data-index="2"]')).toHaveCount(1);
    await expect(page.locator("textarea")).toHaveValue(/AddBorders\(clip, left=7, right=3, top=5, bottom=9[\s\S]*Invert\(clip\)[\s\S]*set_output/);
  });

  test("out-port drop on empty canvas moves the node to the end", async ({ page }) => {
    // Chain: BlankClip, Invert, AddBorders, Output. Drop Invert's output on
    // empty canvas: Invert appends after AddBorders, just before Output.
    await page.locator('[data-library-function="AddBorders"]').click();
    await page.locator("[data-add-graph]").click();
    const invert = page.locator('[data-graph-node="Invert"]');
    const portBox = await invert.locator(".node-port.out").boundingBox();
    const panel = page.locator("[data-graph-nodes]");
    const panelBox = await panel.boundingBox();
    await page.mouse.move(portBox.x + portBox.width / 2, portBox.y + portBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(panelBox.x + panelBox.width - 90, panelBox.y + panelBox.height - 70, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator('[data-graph-node="Invert"][data-index="2"]')).toHaveCount(1);
    await expect(page.locator("textarea")).toHaveValue(/AddBorders\(clip, left=7, right=3, top=5, bottom=9[\s\S]*Invert\(clip\)[\s\S]*set_output/);
  });

  test("wiring adjacent nodes is a no-op", async ({ page }) => {
    // Chain: BlankClip, Invert, AddBorders, Output. Invert already feeds
    // AddBorders, so that wire drag must not touch the source.
    await page.locator('[data-library-function="AddBorders"]').click();
    await page.locator("[data-add-graph]").click();
    const before = await page.locator("textarea").inputValue();
    const invert = page.locator('[data-graph-node="Invert"]');
    const portBox = await invert.locator(".node-port.out").boundingBox();
    const targetBox = await page.locator('[data-graph-node="AddBorders"]').boundingBox();
    await page.mouse.move(portBox.x + portBox.width / 2, portBox.y + portBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetBox.x + 60, targetBox.y + 40, { steps: 6 });
    await page.mouse.up();
    await expect(page.locator("textarea")).toHaveValue(before);
    await expect(page.locator("[data-output-state]")).not.toHaveAttribute("data-state", "changed");
  });
});
