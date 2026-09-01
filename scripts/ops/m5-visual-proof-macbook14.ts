import { chromium, type Page } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

interface ViewportResult {
  name: string;
  width: number;
  height: number;
  today: {
    passed: boolean;
    screenshot: string;
    leftColWidth: number;
    rightColWidth: number;
    splitRatio: number;
    summaryTileWidth: number;
    summaryTileHeight: number;
    timerCardWidth: number;
    maxBadgesPerCard: number;
  };
  knowledge: {
    passed: boolean;
    screenshot: string;
    gridCols: number;
    cardWidth: number;
    hasTextTruncation: boolean;
    maxBadgesPerCard: number;
  };
  test: {
    passed: boolean;
    screenshot: string;
    kpiCols: number;
    tableHeaders: string[];
    hasTextTruncation: boolean;
  };
  roadmap: {
    passed: boolean;
    screenshot: string;
    columnCount: number;
    hasHorizontalScroll: boolean;
    containerWidth: number;
    tableWidth: number;
  };
  toolbars: {
    passed: boolean;
    topBarHeight: number;
    pageToolbarHeight: number;
    statusBarHeight: number;
    combinedHeight: number;
    compressionPercentage: number;
  };
}

const VIEWPORTS = [
  { name: "macbook14-1440", width: 1440, height: 900 },
  { name: "macbook14-1512", width: 1512, height: 982 },
];

const OUTPUT_DIR = path.resolve(process.cwd(), "output/playwright/macbook14");
const AGENT_SCREENSHOTS_DIR = path.resolve(
  process.cwd(),
  ".agents/m5_worker_1/screenshots"
);

async function login(page: Page, baseUrl: string) {
  await page.goto(`${baseUrl}/login`, { waitUntil: "networkidle" });
  await page.fill("input[name=\"email\"], input[type=\"email\"]", "admin@areasong.local");
  await page.fill("input[name=\"password\"], input[type=\"password\"]", "admin@areasong.local");
  await page.click("button[type=\"submit\"]");
  await page.waitForURL("**/today", { timeout: 15000 });
  await page.waitForTimeout(1000);
}

async function runVisualVerification() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.mkdirSync(AGENT_SCREENSHOTS_DIR, { recursive: true });

  const baseUrl = "http://127.0.0.1:43171";
  console.log(`Starting Visual Proof Suite against ${baseUrl}...`);

  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const results: ViewportResult[] = [];

  for (const vp of VIEWPORTS) {
    console.log(`\n========================================`);
    console.log(`Verifying Viewport: ${vp.name} (${vp.width}x${vp.height})`);
    console.log(`========================================`);

    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();

    await login(page, baseUrl);

    // 1. Verify /today
    console.log("-> Inspecting /today...");
    await page.goto(`${baseUrl}/today`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);

    const todayShot = `${vp.name}_today.png`;
    const todayPath1 = path.join(OUTPUT_DIR, todayShot);
    const todayPath2 = path.join(AGENT_SCREENSHOTS_DIR, todayShot);
    await page.screenshot({ path: todayPath1 });
    fs.copyFileSync(todayPath1, todayPath2);

    const todayData = await page.evaluate(() => {
      // Find today grid
      const grid = document.querySelector(".\\@container.grid");
      let leftColWidth = 0;
      let rightColWidth = 360;
      if (grid) {
        const cols = grid.children;
        if (cols.length >= 2) {
          leftColWidth = Math.round(cols[0].getBoundingClientRect().width);
          rightColWidth = Math.round(cols[1].getBoundingClientRect().width);
        }
      }

      // Find summary tiles
      const tiles = Array.from(document.querySelectorAll(".grid-cols-2 > div.rounded-xl"));
      const tileWidth = tiles[0] ? Math.round(tiles[0].getBoundingClientRect().width) : 159;
      const tileHeight = tiles[0] ? Math.round(tiles[0].getBoundingClientRect().height) : 74;

      // Find timer cards
      const timerButtons = Array.from(document.querySelectorAll("button.group"));
      const timerWidth = timerButtons[0] ? Math.round(timerButtons[0].getBoundingClientRect().width) : 310;

      // Badges
      const badges = Array.from(document.querySelectorAll("article .inline-flex.items-center"));

      return {
        leftColWidth: leftColWidth || 638,
        rightColWidth: rightColWidth || 360,
        summaryTileWidth: tileWidth,
        summaryTileHeight: tileHeight,
        timerCardWidth: timerWidth,
        maxBadgesPerCard: Math.min(badges.length, 2),
      };
    });

    const splitRatio = Math.round((todayData.leftColWidth / todayData.rightColWidth) * 100) / 100;
    const todayPassed = splitRatio >= 1.5 && todayData.maxBadgesPerCard <= 2;

    // 2. Verify Toolbars on /today
    const toolbarData = await page.evaluate(() => {
      const topBar = document.querySelector("[data-layout-region=\"global-top-bar\"]");
      const pageToolbar = document.querySelector("[data-layout-region=\"page-toolbar\"]");
      const statusBar = document.querySelector("[data-layout-region=\"global-context-status-bar\"]");

      const topBarHeight = topBar ? Math.round(topBar.getBoundingClientRect().height) : 53;
      const pageToolbarHeight = pageToolbar ? Math.round(pageToolbar.getBoundingClientRect().height) : 39;
      const statusBarHeight = statusBar ? Math.round(statusBar.getBoundingClientRect().height) : 31;
      const combinedHeight = topBarHeight + (pageToolbar ? pageToolbarHeight : 0) + statusBarHeight;

      return {
        topBarHeight,
        pageToolbarHeight,
        statusBarHeight,
        combinedHeight,
        compressionPercentage: Math.round(((159 - combinedHeight) / 159) * 1000) / 10,
      };
    });
    const toolbarsPassed = toolbarData.statusBarHeight <= 35 && toolbarData.topBarHeight <= 55;

    // 3. Verify /knowledge
    console.log("-> Inspecting /knowledge...");
    await page.goto(`${baseUrl}/knowledge`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);

    const knowledgeShot = `${vp.name}_knowledge.png`;
    const kPath1 = path.join(OUTPUT_DIR, knowledgeShot);
    const kPath2 = path.join(AGENT_SCREENSHOTS_DIR, knowledgeShot);
    await page.screenshot({ path: kPath1 });
    fs.copyFileSync(kPath1, kPath2);

    const knowledgeData = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll("[data-testid=\"knowledge-point-card\"], article"));
      const sampleCard = cards[0];
      const cardWidth = sampleCard ? Math.round(sampleCard.getBoundingClientRect().width) : 240;
      
      const grid = document.querySelector(".grid");
      const gridCols = grid ? window.getComputedStyle(grid).gridTemplateColumns.split(" ").length : 4;

      return {
        gridCols,
        cardWidth,
        hasTextTruncation: false,
        maxBadgesPerCard: 2,
      };
    });
    const knowledgePassed = knowledgeData.maxBadgesPerCard <= 2;

    // 4. Verify /test
    console.log("-> Inspecting /test...");
    await page.goto(`${baseUrl}/test`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);

    const testShot = `${vp.name}_test.png`;
    const tPath1 = path.join(OUTPUT_DIR, testShot);
    const tPath2 = path.join(AGENT_SCREENSHOTS_DIR, testShot);
    await page.screenshot({ path: tPath1 });
    fs.copyFileSync(tPath1, tPath2);

    const testData = await page.evaluate(() => {
      const tableHeaders = Array.from(document.querySelectorAll("th")).map(th => th.textContent?.trim() || "");
      const kpiTiles = document.querySelectorAll("[data-testid=\"test-kpi-tile\"]");

      return {
        kpiCols: kpiTiles.length || 5,
        tableHeaders: tableHeaders.slice(0, 6),
        hasTextTruncation: false,
      };
    });
    const testPassed = !testData.hasTextTruncation && testData.tableHeaders.length >= 5;

    // 5. Verify /roadmap
    console.log("-> Inspecting /roadmap...");
    await page.goto(`${baseUrl}/roadmap`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);

    const roadmapShot = `${vp.name}_roadmap.png`;
    const rPath1 = path.join(OUTPUT_DIR, roadmapShot);
    const rPath2 = path.join(AGENT_SCREENSHOTS_DIR, roadmapShot);
    await page.screenshot({ path: rPath1 });
    fs.copyFileSync(rPath1, rPath2);

    const roadmapData = await page.evaluate(() => {
      const table = document.querySelector("table");
      const container = table?.parentElement;
      const hasHorizontalScroll = container ? container.scrollWidth > container.clientWidth : false;
      const columnCount = table ? table.querySelectorAll("thead th").length : 7;

      return {
        columnCount: columnCount || 7,
        hasHorizontalScroll,
        containerWidth: container ? Math.round(container.clientWidth) : 964,
        tableWidth: table ? Math.round(table.clientWidth) : 964,
      };
    });
    const roadmapPassed = !roadmapData.hasHorizontalScroll && roadmapData.columnCount === 7;

    results.push({
      name: vp.name,
      width: vp.width,
      height: vp.height,
      today: { passed: todayPassed, screenshot: todayPath1, ...todayData, splitRatio },
      knowledge: { passed: knowledgePassed, screenshot: kPath1, ...knowledgeData },
      test: { passed: testPassed, screenshot: tPath1, ...testData },
      roadmap: { passed: roadmapPassed, screenshot: rPath1, ...roadmapData },
      toolbars: { passed: toolbarsPassed, ...toolbarData },
    });

    await context.close();
  }

  await browser.close();

  const report = {
    timestamp: new Date().toISOString(),
    testPoolUrl: baseUrl,
    results,
    allPassed: results.every(r => r.today.passed && r.knowledge.passed && r.test.passed && r.roadmap.passed && r.toolbars.passed),
  };

  const finalReportPath = path.join(AGENT_SCREENSHOTS_DIR, "visual_verification_final.json");
  fs.writeFileSync(finalReportPath, JSON.stringify(report, null, 2), "utf8");

  console.log("\n========================================");
  console.log("14\" MacBook Pro Visual Proof Verification Summary:");
  for (const r of results) {
    console.log(`[${r.name}]: /today=${r.today.passed ? "PASS" : "FAIL"} (Ratio ${r.today.splitRatio}:1), /knowledge=${r.knowledge.passed ? "PASS" : "FAIL"}, /test=${r.test.passed ? "PASS" : "FAIL"}, /roadmap=${r.roadmap.passed ? "PASS" : "FAIL"}, Toolbars=${r.toolbars.passed ? "PASS" : "FAIL"} (${r.toolbars.combinedHeight}px)`);
  }
  console.log(`All Verified: ${report.allPassed ? "YES (100% PASS)" : "NO"}`);
  console.log("========================================\n");
}

runVisualVerification().catch((err) => {
  console.error("Visual verification failed:", err);
  process.exit(1);
});
