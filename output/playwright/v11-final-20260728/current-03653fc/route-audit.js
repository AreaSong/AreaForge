async (page) => {
  const routes = [
    ["today", "/today"],
    ["today-plan", "/today/plan"],
    ["task-detail", "/today/tasks/cms4okahr000401pl0gh6upoa"],
    ["today-inbox", "/today/inbox"],
    ["inbox-detail", "/today/inbox/cms4okaiq000601pll9ym2aah"],
    ["canvas", "/knowledge/canvas"],
    ["knowledge-overview", "/knowledge/overview"],
    ["imports", "/knowledge/imports"],
    ["import-detail", "/knowledge/imports/cms4okaqt000q01pllgminvlf"],
    ["syllabus", "/knowledge/syllabus"],
    ["syllabus-detail", "/knowledge/syllabus/cms4okagz000201ply3y3cu3s"],
    ["notes", "/knowledge/notes"],
    ["note-detail", "/knowledge/notes/cms4okam2000e01plac6l0t9h"],
    ["mistakes", "/knowledge/mistakes"],
    ["mistake-detail", "/knowledge/mistakes/cms4okapf000o01plr5wx1ndn"],
    ["resources", "/knowledge/resources"],
    ["resource-detail", "/knowledge/resources/cms4okaon000k01pldng1ex85"],
    ["resource-preview", "/knowledge/resources/cms4okaon000k01pldng1ex85/preview"],
    ["reviews", "/knowledge/reviews"],
    ["review-detail", "/knowledge/reviews/cms4okamn000g01plhk2itx2g"],
    ["daily-review", "/review/daily"],
    ["reports", "/review/reports"],
    ["report-history", "/review/reports/history/cms4mri1w001301v2vgqgv68z"],
    ["stage-overview", "/stage/overview"],
    ["simulations", "/stage/simulation"],
    ["simulation-detail", "/stage/simulation/cms4okavl000w01plgc5uvwc7"],
    ["analytics", "/stage/analytics"],
    ["profile", "/settings/profile"],
    ["workspace", "/settings/workspace"],
    ["ai", "/settings/ai"],
    ["experience", "/settings/experience"],
    ["notifications", "/settings/notifications"],
    ["system", "/settings/system"],
    ["focus", "/focus/cms4okajj000801pl7k2r7a4u"],
    ["quick-review", "/quick-review/cms4okamn000g01plhk2itx2g"],
  ];
  const viewport = page.viewportSize();
  const prefix = viewport.width <= 500 ? "mobile" : "desktop";

  const results = [];
  let currentKey = "init";
  const consoleErrors = [];
  const pageErrors = [];
  const requestFailures = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push({ key: currentKey, text: message.text() });
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push({ key: currentKey, text: String(error) });
  });
  page.on("requestfailed", (request) => {
    requestFailures.push({
      key: currentKey,
      url: request.url(),
      failure: request.failure()?.errorText ?? "unknown",
    });
  });

  for (const [index, [key, path]] of routes.entries()) {
    currentKey = key;
    const beforeConsole = consoleErrors.length;
    const beforePage = pageErrors.length;
    const beforeRequests = requestFailures.length;
    try {
      const response = await page.goto(`http://127.0.0.1:3109${path}`, {
        waitUntil: "networkidle",
        timeout: 20_000,
      });
      await page.waitForTimeout(250);
      const layout = await page.evaluate(() => ({
        viewportWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        bodyText: (document.body.innerText || "").slice(0, 500),
        h1: document.querySelector("h1")?.textContent?.trim() ?? null,
      }));
      const finalPath = await page.evaluate(() => window.location.pathname);
      const sequence = String(index + 1).padStart(2, "0");
      await page.screenshot({ path: `${prefix}-${sequence}-${key}.png`, fullPage: true });
      const routeRequestFailures = requestFailures.slice(beforeRequests).filter((failure) => {
        return !(failure.failure === "net::ERR_ABORTED" && failure.url.includes("_rsc="));
      });
      results.push({
        key,
        path,
        finalPath,
        status: response?.status() ?? null,
        title: await page.title(),
        h1: layout.h1,
        overflow: layout.scrollWidth > layout.viewportWidth + 1,
        loginShown: /进入行动中心/.test(layout.bodyText),
        consoleErrors: consoleErrors.slice(beforeConsole),
        pageErrors: pageErrors.slice(beforePage),
        requestFailures: routeRequestFailures,
      });
    } catch (error) {
      results.push({
        key,
        path,
        error: String(error),
        consoleErrors: consoleErrors.slice(beforeConsole),
        pageErrors: pageErrors.slice(beforePage),
        requestFailures: requestFailures.slice(beforeRequests),
      });
    }
  }

  return results;
}
