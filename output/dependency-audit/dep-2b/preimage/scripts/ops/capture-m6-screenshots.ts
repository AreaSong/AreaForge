import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium, type BrowserContext, type Page } from "playwright-core";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:43171";
const SCREENSHOT_DIR = path.resolve(process.cwd(), ".agents/worker_m6/screenshots");

const VIEWPORTS = [
  { name: "1080p", width: 1920, height: 1080 },
  { name: "900p", width: 1440, height: 900 },
  { name: "768p", width: 1024, height: 768 },
] as const;

const TARGET_ROUTES = [
  { path: "/today", name: "today", title: "今日行动中心" },
  { path: "/knowledge", name: "knowledge", title: "知识沉淀与全景总览" },
  { path: "/test", name: "test", title: "全真模考与实战检验" },
  { path: "/roadmap", name: "roadmap", title: "长期路线与阶段规划" },
  { path: "/settings", name: "settings", title: "系统设置与控制台" },
] as const;

interface CaptureMetric {
  route: string;
  routeName: string;
  viewport: string;
  width: number;
  height: number;
  screenshotPath: string;
  documentTitle: string;
  rootOverflow: number;
  mainVisible: boolean;
  cardsCount: number;
  textLength: number;
  passed: boolean;
}

function chromeExecutablePath(): string {
  const configured = process.env.CHROME_EXECUTABLE_PATH;
  if (configured) return configured;
  const bundled = chromium.executablePath();
  if (existsSync(bundled)) return bundled;
  // Mac default paths
  const macPaths = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ];
  for (const p of macPaths) {
    if (existsSync(p)) return p;
  }
  throw new Error("No chrome executable found");
}

async function authenticate(page: Page): Promise<void> {
  console.log(`[Auth] Navigating to ${BASE_URL}/login...`);
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);

  const demoButton = page.getByRole("button", { name: "填入本地演示账号" });
  if (await demoButton.isVisible()) {
    await demoButton.click();
    await page.waitForTimeout(300);
  }

  const submitButton = page.getByRole("button", { name: "登录并继续学习" });
  await submitButton.click();
  await page.waitForURL((url) => url.pathname === "/today", { timeout: 15000 });
  console.log("[Auth] Successfully logged in and landed on /today");
}

async function main() {
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  console.log(`[Start] Output directory: ${SCREENSHOT_DIR}`);
  console.log(`[Start] Base URL: ${BASE_URL}`);

  const execPath = chromeExecutablePath();
  console.log(`[Browser] Chrome executable: ${execPath}`);

  const browser = await chromium.launch({
    headless: true,
    executablePath: execPath,
  });

  const metrics: CaptureMetric[] = [];

  try {
    // 1. Initial auth context
    const authContext = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      colorScheme: "dark",
      timezoneId: "Asia/Shanghai",
      locale: "zh-CN",
    });
    const authPage = await authContext.newPage();
    await authenticate(authPage);
    const storageState = await authContext.storageState();
    await authContext.close();

    // 2. Iterate viewports and routes
    for (const vp of VIEWPORTS) {
      console.log(`\n========================================`);
      console.log(`Capture Suite for Viewport: ${vp.name} (${vp.width}x${vp.height})`);
      console.log(`========================================`);

      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        colorScheme: "dark",
        timezoneId: "Asia/Shanghai",
        locale: "zh-CN",
        storageState,
      });

      for (const route of TARGET_ROUTES) {
        const page = await context.newPage();
        const targetUrl = `${BASE_URL}${route.path}`;
        console.log(`[Nav] Loading ${route.name} (${route.path}) at ${vp.width}x${vp.height}...`);

        try {
          await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 20000 });
          await page.waitForTimeout(1000); // Allow animations & micro-charts to settle

          // Evaluate page layout metrics
          const pageMetrics = await page.evaluate(() => {
            const docEl = document.documentElement;
            const rootOverflow = Math.max(0, docEl.scrollWidth - docEl.clientWidth);
            const mainEl = document.querySelector("main");
            const mainVisible = Boolean(mainEl && mainEl.clientHeight > 0);
            const cardsCount = document.querySelectorAll("[data-card], .rounded-2xl, .rounded-xl").length;
            const textLength = mainEl?.textContent?.trim().length ?? 0;
            return {
              documentTitle: document.title,
              rootOverflow,
              mainVisible,
              cardsCount,
              textLength,
            };
          });

          const filename = `${route.name}_${vp.width}x${vp.height}.png`;
          const filePath = path.join(SCREENSHOT_DIR, filename);

          await page.screenshot({ path: filePath, fullPage: true });
          console.log(`[Capture] Saved: ${filename} (rootOverflow=${pageMetrics.rootOverflow}px, cards=${pageMetrics.cardsCount}, chars=${pageMetrics.textLength})`);

          metrics.push({
            route: route.path,
            routeName: route.name,
            viewport: vp.name,
            width: vp.width,
            height: vp.height,
            screenshotPath: filePath,
            documentTitle: pageMetrics.documentTitle,
            rootOverflow: pageMetrics.rootOverflow,
            mainVisible: pageMetrics.mainVisible,
            cardsCount: pageMetrics.cardsCount,
            textLength: pageMetrics.textLength,
            passed: pageMetrics.mainVisible && pageMetrics.rootOverflow <= 1,
          });
        } catch (err) {
          console.error(`[Error] Failed to capture ${route.path} at ${vp.width}x${vp.height}:`, err);
        } finally {
          await page.close();
        }
      }

      await context.close();
    }
  } finally {
    await browser.close();
  }

  // Save metrics summary JSON
  const summaryPath = path.join(SCREENSHOT_DIR, "capture-summary.json");
  await writeFile(summaryPath, JSON.stringify(metrics, null, 2), "utf8");
  console.log(`\n[Summary] Metrics saved to ${summaryPath}`);
  console.log(`[Summary] Total captures: ${metrics.length}, Passed: ${metrics.filter((m) => m.passed).length}/${metrics.length}`);
}

main().catch((err) => {
  console.error("Fatal error during screenshot execution:", err);
  process.exit(1);
});
