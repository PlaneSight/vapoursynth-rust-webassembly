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

  test("plots a reference-only function as a dashed draft", async ({ page }) => {
    await page.locator("[data-library-search]").fill("Text");
    await page.locator('[data-library-function="Text"]').click();
    await page.locator("[data-add-graph]").click();
    const draft = page.locator('[data-graph-node="Text"]');
    await expect(draft).toHaveCount(1);
    await expect(draft).toHaveClass(/is-draft/);
    await expect(page.locator("textarea")).toHaveValue(/# Reference: vs\.core\.std\.Text\(…\)/);
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
});
