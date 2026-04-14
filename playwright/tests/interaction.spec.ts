import { expect, test } from "../fixtures/test";

test.describe("single-page interactions", () => {
  test("selector moves existing rectangle", async ({
    boardPage,
    server,
    page,
  }) => {
    await server.writeBoard(server.dataPath, "selector-test", {
      "seed-rect": {
        type: "rect",
        id: "seed-rect",
        tool: "Rectangle",
        x: 100,
        y: 100,
        x2: 160,
        y2: 140,
        color: "#123456",
        size: 4,
      },
    });

    await boardPage.gotoBoard("selector-test");
    await expect(boardPage.tool("Hand")).toBeVisible();
    await expect(page.locator("#seed-rect")).toBeVisible();
    await boardPage.selectTool("Hand");

    const result = await boardPage.moveSelection(
      "seed-rect",
      { x: 110, y: 110 },
      { x: 150, y: 135 },
    );
    expect(result.selectorActive).toBe(true);
    expect(result.translation.e).toBe(40);
    expect(result.translation.f).toBe(25);

    await server.waitForStoredBoard(
      server.dataPath,
      "selector-test",
      (storedBoard) => {
        const rect = storedBoard["seed-rect"];
        return rect?.transform?.e === 40 && rect?.transform?.f === 25;
      },
    );
    await page.reload();
    await expect(page.locator("#seed-rect")).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const rect = document.getElementById("seed-rect");
          const transform = rect?.getAttribute("transform") ?? "";
          const values = (transform.match(/matrix\(([^)]+)\)/)?.[1] ?? "")
            .split(/[ ,]+/)
            .filter(Boolean)
            .map(Number);
          return {
            e: values[4],
            f: values[5],
          };
        }),
      )
      .toMatchObject({ e: 40, f: 25 });
  });

  test("zoom clicks in and out", async ({ boardPage }) => {
    await boardPage.gotoBoard("zoom-test");
    await expect(boardPage.tool("Zoom")).toBeVisible();
    await boardPage.selectTool("Zoom");

    const result = await boardPage.zoomClickInAndOut({ x: 200, y: 200 });
    expect(Math.abs(result.scaleAfterZoomIn - 1.5)).toBeLessThan(0.01);
    expect(Math.abs(result.scaleAfterZoomOut - 0.75)).toBeLessThan(0.01);
  });

  test("draw tools disable at giant shape zoom threshold", async ({
    boardPage,
    server,
  }) => {
    await boardPage.gotoBoard("zoom-threshold-test");
    await expect(boardPage.tool("Hand")).toBeVisible();
    await expect(boardPage.tool("Pencil")).toBeVisible();
    await boardPage.selectTool("Pencil");
    await boardPage.expectCurrentTool("Pencil");

    const result = await boardPage.verifyZoomThresholdBehavior();
    expect(result.initialState.currentTool).toBe("Hand");
    expect(result.initialState.pencilDisabled).toBe(true);
    expect(result.initialState.rectDisabled).toBe(true);
    expect(result.giantShapeState.currentTool).toBe("Rectangle");
    expect(result.giantShapeState.changeResult).toBe(true);
    expect(result.giantShapeState.rectPresent).toBe(true);
    expect(result.finalState.currentTool).toBe("Rectangle");
    expect(result.finalState.blockedChangeResult).toBe(false);
    expect(result.finalState.pencilDisabled).toBe(false);

    await boardPage.selectTool("Pencil");
    await boardPage.expectCurrentTool("Pencil");
    expect(
      Object.keys(
        await server.readStoredBoard(server.dataPath, "zoom-threshold-test"),
      ),
    ).toHaveLength(0);
  });

  test("download exports SVG content", async ({ boardPage, server }) => {
    await server.writeBoard(server.dataPath, "download-test", {
      "download-rect": {
        type: "rect",
        id: "download-rect",
        tool: "Rectangle",
        x: 100,
        y: 100,
        x2: 160,
        y2: 140,
        color: "#123456",
        size: 4,
      },
    });

    await boardPage.gotoBoard("download-test");
    await expect(boardPage.tool("Download")).toBeVisible();
    await expect(boardPage.page.locator("#download-rect")).toBeVisible();
    await boardPage.installDownloadCapture();
    await boardPage.tool("Download").click();

    await expect
      .poll(() => boardPage.readDownloadCapture())
      .toMatchObject({
        clicks: 1,
        href: "blob:test-download",
        download: "download-test.svg",
        hasSvgTag: true,
        hasRect: true,
        hasBoardStyles: true,
      });
  });

  test("selector duplicate and delete persist", async ({
    boardPage,
    server,
    page,
  }) => {
    await server.writeBoard(server.dataPath, "selector-advanced-test", {
      "seed-rect": {
        type: "rect",
        id: "seed-rect",
        tool: "Rectangle",
        x: 100,
        y: 100,
        x2: 160,
        y2: 140,
        color: "#123456",
        size: 4,
      },
    });

    await boardPage.gotoBoard("selector-advanced-test");
    await expect(boardPage.tool("Hand")).toBeVisible();
    await expect(page.locator("#seed-rect")).toBeVisible();
    await boardPage.selectTool("Hand");

    const result = await boardPage.duplicateSelectionAndDelete("seed-rect");
    expect(result.afterDuplicate).toHaveLength(2);
    expect(result.afterDuplicate.includes("seed-rect")).toBe(true);
    expect(result.afterDelete).toHaveLength(1);
    expect(result.afterDelete[0]).not.toBe("seed-rect");

    await server.waitForStoredBoard(
      server.dataPath,
      "selector-advanced-test",
      (storedBoard) => {
        const ids = Object.keys(storedBoard).filter(
          (id) => id !== "__wbo_meta__",
        );
        return ids.length === 1 && ids[0] !== "seed-rect";
      },
    );
    await page.reload();
    await expect(page.locator("#drawingArea rect")).toHaveCount(1);
    await expect(page.locator("#seed-rect")).toHaveCount(0);
  });
});
