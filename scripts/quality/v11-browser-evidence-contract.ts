import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { commonSecretPatterns } from "./record-validator-common";

export const V11_JOURNEY_SCHEMA = "v11-browser-journey-evidence-v1" as const;
export const V11_ACCESSIBILITY_SCHEMA = "v11-accessibility-evidence-v1" as const;
export const V11_ACCESSIBILITY_OBSERVATION_SCHEMA = "v11-accessibility-observation-v1" as const;
export const V11_FIXTURE_SCHEMA = "v11-browser-fixture-manifest-v1" as const;

export const V11_JOURNEY_IDS = [
  "login",
  "dashboard",
  "timer-closeout",
  "review",
  "notes",
  "syllabus",
  "reports",
  "simulation",
  "update-center",
] as const;

export const V11_VIEWPORTS = ["desktop", "mobile"] as const;

export const V11_ACCESSIBILITY_CHECK_IDS = [
  "KBD-01", "KBD-02", "KBD-03", "KBD-04", "KBD-05",
  "FOCUS-01", "FOCUS-02", "FOCUS-03", "FOCUS-04",
  "SEM-01", "SEM-02",
  "LIVE-01", "LIVE-02", "LIVE-03", "LIVE-04", "LIVE-05", "LIVE-06",
  "COLOR-01",
  "ZOOM-01", "ZOOM-02", "ZOOM-03",
  "CANVAS-01", "CANVAS-02", "CANVAS-03",
] as const;

export const V11_ACCESSIBILITY_CATEGORIES = [
  "keyboard",
  "focus",
  "semantics",
  "live",
  "color",
  "zoom",
  "canvas",
] as const;

export const V11_ACCESSIBILITY_PROFILES = [
  "desktop",
  "mobile-portrait",
  "mobile-landscape",
  "native-zoom-200",
] as const;

export const V11_ACCESSIBILITY_PROFILE_CONTRACT = {
  desktop: {
    id: "desktop",
    kind: "emulated-viewport",
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    zoomPercent: 100,
  },
  "mobile-portrait": {
    id: "mobile-portrait",
    kind: "emulated-viewport",
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    zoomPercent: 100,
  },
  "mobile-landscape": {
    id: "mobile-landscape",
    kind: "emulated-viewport",
    width: 844,
    height: 390,
    deviceScaleFactor: 1,
    zoomPercent: 100,
  },
  "native-zoom-200": {
    id: "native-zoom-200",
    kind: "native-window",
    width: 1440,
    height: 1000,
    deviceScaleFactor: null,
    zoomPercent: 200,
  },
} as const;

const expectedLiteral = <const T extends V11RedactedValue>(value: T) => ({ kind: "literal", value }) as const;
const expectedInteger = (min: number, max: number) => ({ kind: "integer", min, max }) as const;
const expectedShortToken = { kind: "short-token" } as const;
const expectedRoute = { kind: "route" } as const;
const equalsAssertion = <const T extends V11RedactedValue>(id: string, value: T) => ({
  id,
  predicate: "equals" as const,
  expected: expectedLiteral(value),
});
const dynamicIntegerAssertion = (id: string, min = 0, max = Number.MAX_SAFE_INTEGER) => ({
  id,
  predicate: "equals" as const,
  expected: expectedInteger(min, max),
});
const dynamicTokenAssertion = (id: string) => ({
  id,
  predicate: "equals" as const,
  expected: expectedShortToken,
});
const dynamicRouteAssertion = (id: string) => ({
  id,
  predicate: "equals" as const,
  expected: expectedRoute,
});
const gteAssertion = (id: string, expected: number) => ({
  id,
  predicate: "gte" as const,
  expected: expectedLiteral(expected),
});
const rangeAssertion = (id: string, min: number, max: number) => ({
  id,
  predicate: "between-inclusive" as const,
  expected: expectedLiteral({ min, max }),
});

export const V11_JOURNEY_CONTRACTS = {
  login: {
    startPath: "/login",
    terminalPath: "/today",
    mutation: { method: "POST", path: "/api/auth/login", status: 200, requestCount: 1 },
    oraclePath: "/api/dashboard/today", beforeStatus: 401, afterStatus: 200,
    beforeAssertions: [equalsAssertion("unauthenticated-before", 401)],
    afterAssertions: [
      equalsAssertion("authenticated-after", 200),
      equalsAssertion("dashboard-present", true),
    ],
    terminalAssertions: [
      equalsAssertion("today-heading", true),
      equalsAssertion("authenticated-route", true),
    ],
  },
  dashboard: {
    startPath: "/today",
    terminalPath: "/focus/:sessionId?returnTo=%2Ftoday",
    mutation: { method: "POST", path: "/api/study-sessions/start", status: 201, requestCount: 1 },
    oraclePath: "/api/study-sessions/active", beforeStatus: 200, afterStatus: 200,
    beforeAssertions: [
      equalsAssertion("active-session-before-status", 200),
      equalsAssertion("active-session-before", false),
    ],
    afterAssertions: [
      equalsAssertion("active-session-after-status", 200),
      equalsAssertion("active-session-after", true),
      equalsAssertion("active-session-after-identity", true),
    ],
    terminalAssertions: [
      equalsAssertion("focus-route", true),
      equalsAssertion("focus-heading", true),
    ],
  },
  "timer-closeout": {
    startPath: "/focus/:sessionId?returnTo=%2Ftoday",
    terminalPath: "/focus/:sessionId?returnTo=%2Ftoday",
    mutation: { method: "POST", path: "/api/study-sessions/:sessionId/end", status: 200, requestCount: 1 },
    oraclePath: "/api/study-sessions/active", beforeStatus: 200, afterStatus: 200,
    beforeAssertions: [
      equalsAssertion("fixture-session-active-status", 200),
      equalsAssertion("fixture-session-active", true),
      equalsAssertion("fixture-session-active-identity", true),
    ],
    afterAssertions: [
      equalsAssertion("fixture-session-closed-status", 200),
      equalsAssertion("fixture-session-closed", false),
    ],
    terminalAssertions: [
      equalsAssertion("evidence-relay-visible", true),
      equalsAssertion("session-status-ended", true),
    ],
  },
  review: {
    startPath: "/review/daily",
    terminalPath: "/review/daily",
    mutation: { method: "POST", path: "/api/daily-reviews", status: 201, requestCount: 1 },
    oraclePath: "/api/reviews/today", beforeStatus: 200, afterStatus: 200,
    beforeAssertions: [
      equalsAssertion("review-get-before-status", 200),
      equalsAssertion("review-absent-before", true),
    ],
    afterAssertions: [
      equalsAssertion("review-get-after-status", 200),
      equalsAssertion("review-created", true),
      equalsAssertion("review-identity-matches", true),
    ],
    terminalAssertions: [
      equalsAssertion("review-success-visible", true),
      equalsAssertion("review-success-live-region", true),
    ],
  },
  notes: {
    startPath: "/knowledge/notes",
    terminalPath: "/knowledge/notes",
    mutation: { method: "POST", path: "/api/notes", status: 201, requestCount: 1 },
    oraclePath: "/api/notes", beforeStatus: 200, afterStatus: 200,
    beforeAssertions: [
      equalsAssertion("notes-before-status", 200),
      equalsAssertion("notes-before", 0),
    ],
    afterAssertions: [
      equalsAssertion("notes-after-status", 200),
      equalsAssertion("notes-count-after", 1),
      equalsAssertion("created-note-present", true),
    ],
    terminalAssertions: [
      equalsAssertion("created-note-visible", true),
      equalsAssertion("note-form-cleared", true),
    ],
  },
  syllabus: {
    startPath: "/knowledge/syllabus",
    terminalPath: "/knowledge/syllabus?subjectId=synthetic-id",
    mutation: { method: "POST", path: "/api/syllabus/nodes", status: 201, requestCount: 1 },
    oraclePath: "/api/syllabus", beforeStatus: 200, afterStatus: 200,
    beforeAssertions: [
      equalsAssertion("syllabus-count-before-status", 200),
      equalsAssertion("syllabus-count-before", 1),
    ],
    afterAssertions: [
      equalsAssertion("syllabus-after-status", 200),
      equalsAssertion("syllabus-count-after", 2),
      equalsAssertion("created-syllabus-node-present", true),
    ],
    terminalAssertions: [
      equalsAssertion("created-node-visible", true),
      equalsAssertion("syllabus-form-cleared", true),
    ],
  },
  reports: {
    startPath: "/review/reports?tab=current&period=week",
    terminalPath: "/review/reports?tab=current&period=week",
    mutation: { method: "POST", path: "/api/reports/:reportId/confirm", status: 201, requestCount: 1 },
    oraclePath: "/api/reports/current?period=week", beforeStatus: 200, afterStatus: 200,
    beforeAssertions: [
      equalsAssertion("report-before-status", 200),
      equalsAssertion("report-undecided-before", true),
    ],
    afterAssertions: [
      equalsAssertion("report-after-status", 200),
      equalsAssertion("report-confirmed-after", "confirmed"),
    ],
    terminalAssertions: [
      equalsAssertion("report-confirmed-visible", true),
      equalsAssertion("report-boundary-visible", true),
    ],
  },
  simulation: {
    startPath: "/test/simulations",
    terminalPath: "/test/simulations/:examId",
    mutation: { method: "POST", path: "/api/simulation/exams", status: 201, requestCount: 1 },
    oraclePath: "/api/simulation/exams", beforeStatus: 200, afterStatus: 200,
    beforeAssertions: [
      equalsAssertion("exams-before-status", 200),
      equalsAssertion("exams-before", 0),
    ],
    afterAssertions: [
      equalsAssertion("exams-after-status", 200),
      equalsAssertion("exams-count-after", 1),
      equalsAssertion("created-exam-present", true),
    ],
    terminalAssertions: [
      equalsAssertion("simulation-detail-route", true),
      equalsAssertion("simulation-detail-heading", true),
    ],
  },
  "update-center": {
    startPath: "/settings/system",
    terminalPath: "/settings/system",
    mutation: { method: "POST", path: "/api/system/update-requests", status: 202, requestCount: 1 },
    oraclePath: "/api/system/update-status", beforeStatus: 200, afterStatus: 200,
    beforeAssertions: [
      equalsAssertion("update-status-before", 200),
      equalsAssertion("queue-count-known-before", true),
    ],
    afterAssertions: [
      equalsAssertion("update-status-after", 200),
      equalsAssertion("queue-count-increased", true),
    ],
    terminalAssertions: [
      equalsAssertion("system-settings-route", true),
      equalsAssertion("version-center-visible", true),
      equalsAssertion("check-request-notice-visible", true),
    ],
  },
} as const satisfies Record<typeof V11_JOURNEY_IDS[number], V11JourneyContract>;

export const V11_ACCESSIBILITY_CHECK_CONTRACTS = {
  "KBD-01": {
    checkKey: "login-tab-enter", category: "keyboard", route: "/login", target: "login-form", profile: "desktop", mechanism: "keyboard",
    assertions: [equalsAssertion("email-reached-by-tab", true), equalsAssertion("password-reached-by-tab", true), equalsAssertion("enter-submitted-login", 200), equalsAssertion("keyboard-login-terminal-route", "/today")],
  },
  "KBD-02": {
    checkKey: "main-navigation-enter", category: "keyboard", route: "/today", target: "main-navigation", profile: "desktop", mechanism: "keyboard",
    assertions: [equalsAssertion("quick-create-trigger-focused", true), equalsAssertion("quick-create-opened-by-enter", true), equalsAssertion("quick-create-exposes-five-actions", 5), equalsAssertion("quick-create-escape-returned-focus", true), equalsAssertion("nav-link-focused", true), equalsAssertion("enter-activated-navigation", "/knowledge/overview")],
  },
  "KBD-03": {
    checkKey: "modal-open-keyboard", category: "keyboard", route: "/today", target: "subject-shortcut-modal", profile: "desktop", mechanism: "keyboard",
    assertions: [equalsAssertion("trigger-focused", true), equalsAssertion("enter-opened-modal", true)],
  },
  "KBD-04": {
    checkKey: "modal-focus-trap", category: "keyboard", route: "/today", target: "subject-shortcut-modal", profile: "desktop", mechanism: "keyboard",
    assertions: [gteAssertion("modal-has-focusable-controls", 2), equalsAssertion("modal-initial-focus-first", true), equalsAssertion("shift-tab-wraps-to-last", true), equalsAssertion("tab-wraps-to-first", true)],
  },
  "KBD-05": {
    checkKey: "canvas-arrow-command", category: "keyboard", route: "/knowledge/canvas", target: "canvas-layout-command", profile: "desktop", mechanism: "keyboard",
    assertions: [equalsAssertion("arrow-command-saved-layout", 200), equalsAssertion("arrow-command-focused-operated-node", true)],
  },
  "FOCUS-01": {
    checkKey: "modal-initial-focus", category: "focus", route: "/today", target: "subject-shortcut-modal", profile: "desktop", mechanism: "dom",
    assertions: [equalsAssertion("modal-received-focus", true)],
  },
  "FOCUS-02": {
    checkKey: "modal-trigger-return", category: "focus", route: "/today", target: "subject-shortcut-trigger", profile: "desktop", mechanism: "keyboard",
    assertions: [equalsAssertion("escape-closed-modal", 0), equalsAssertion("focus-returned-to-trigger", true)],
  },
  "FOCUS-03": {
    checkKey: "detail-and-save-focus", category: "focus", route: "/knowledge/notes/:noteId", target: "detail-heading-and-save-result", profile: "desktop", mechanism: "keyboard",
    assertions: [equalsAssertion("detail-link-focused-before-enter", true), equalsAssertion("detail-heading-received-focus", "H1"), equalsAssertion("detail-heading-programmatic-tabindex", -1), equalsAssertion("syllabus-save-status", 200), equalsAssertion("syllabus-save-result-is-live", true), equalsAssertion("syllabus-save-returned-to-edit", true)],
  },
  "FOCUS-04": {
    checkKey: "canvas-operation-and-return-focus", category: "focus", route: "/knowledge/canvas?view=list", target: "canvas-node-and-list-row", profile: "desktop", mechanism: "dom",
    assertions: [equalsAssertion("canvas-operation-focus-retained", true), equalsAssertion("hide-focus-used-deterministic-exception", true), equalsAssertion("canvas-list-link-focused-before-enter", true), equalsAssertion("canvas-detail-heading-focused", true), dynamicRouteAssertion("canvas-return-url-restored"), equalsAssertion("canvas-list-row-focus-restored", true)],
  },
  "SEM-01": {
    checkKey: "route-landmark-heading", category: "semantics", route: "/today", target: "main-heading-navigation", profile: "desktop", mechanism: "cdp",
    assertions: [equalsAssertion("unique-dom-main", 1), equalsAssertion("unique-page-h1", 1), equalsAssertion("unique-ax-main", 1), gteAssertion("named-navigation-present", 1)],
  },
  "SEM-02": {
    checkKey: "dialog-accessible-name", category: "semantics", route: "/today", target: "subject-shortcut-modal", profile: "desktop", mechanism: "cdp",
    assertions: [equalsAssertion("dialog-is-modal", "true"), equalsAssertion("dialog-has-label-reference", true), equalsAssertion("single-dialog-in-accessibility-tree", 1), equalsAssertion("dialog-accessible-name-resolves", true)],
  },
  "LIVE-01": {
    checkKey: "login-error-assertive", category: "live", route: "/login", target: "login-error", profile: "desktop", mechanism: "dom",
    assertions: [equalsAssertion("invalid-login-status", 401), equalsAssertion("alert-is-assertive", "assertive"), equalsAssertion("alert-is-atomic", "true"), equalsAssertion("alert-has-message", true)],
  },
  "LIVE-02": {
    checkKey: "timer-status-assertive", category: "live", route: "/focus/:sessionId", target: "focus-timer-status", profile: "desktop", mechanism: "dom",
    assertions: [equalsAssertion("timer-status-has-text", true), equalsAssertion("timer-status-assertive", "assertive"), equalsAssertion("timer-status-atomic", "true")],
  },
  "LIVE-03": {
    checkKey: "timer-transition-assertive", category: "live", route: "/focus/:sessionId", target: "focus-timer-transition", profile: "desktop", mechanism: "dom",
    assertions: [equalsAssertion("pause-ui-mutation-status", 200), equalsAssertion("pause-announced", true), equalsAssertion("pause-terminal-control-visible", true)],
  },
  "LIVE-04": {
    checkKey: "notification-fallback-polite", category: "live", route: "/settings/notifications", target: "notification-test-fallback", profile: "desktop", mechanism: "dom",
    assertions: [equalsAssertion("notification-test-status", 200), equalsAssertion("notification-fallback-visible", true), equalsAssertion("notification-fallback-polite", "polite"), equalsAssertion("notification-fallback-atomic", "true")],
  },
  "LIVE-05": {
    checkKey: "canvas-layout-polite", category: "live", route: "/knowledge/canvas", target: "canvas-layout-status", profile: "desktop", mechanism: "dom",
    assertions: [gteAssertion("layout-announcement-present", 1), equalsAssertion("layout-announcement-polite", "polite")],
  },
  "LIVE-06": {
    checkKey: "review-save-and-recovery-live", category: "live", route: "/review/daily", target: "daily-review-save-and-recovery", profile: "desktop", mechanism: "dom",
    assertions: [equalsAssertion("review-save-status", 201), equalsAssertion("review-success-live-region", true), equalsAssertion("review-success-polite", "polite"), equalsAssertion("network-error-alert-visible", true), equalsAssertion("network-error-has-message", true), gteAssertion("failed-review-draft-retained", 1)],
  },
  "COLOR-01": {
    checkKey: "status-not-color-only", category: "color", route: "/today", target: "global-status-indicators", profile: "desktop", mechanism: "dom",
    assertions: [equalsAssertion("five-status-indicators", 5), equalsAssertion("all-statuses-have-text", 5), equalsAssertion("all-statuses-have-accessible-name", 5), gteAssertion("computed-colors-observed", 1)],
  },
  "ZOOM-01": {
    checkKey: "native-browser-zoom-200", category: "zoom", route: "/today", target: "nine-journey-routes", profile: "native-zoom-200", mechanism: "viewport",
    assertions: [equalsAssertion("native-zoom-setting-before", "1"), equalsAssertion("native-zoom-setting-after", "2"), dynamicIntegerAssertion("native-window-width-fixed", 1, 20_000), dynamicIntegerAssertion("native-window-height-fixed", 1, 20_000), equalsAssertion("native-visual-scale-remains-one", 1), rangeAssertion("native-css-viewport-ratio-is-two", 1.9, 2.1), rangeAssertion("native-device-pixel-ratio-doubles", 1.9, 2.1), equalsAssertion("nine-journey-routes-covered", 9), equalsAssertion("native-zoom-route-reflow", { routeCount: 9, failures: [] }), equalsAssertion("native-zoom-metrics-captured", true)],
  },
  "ZOOM-02": {
    checkKey: "portrait-reflow-390", category: "zoom", route: "/today", target: "today-route", profile: "mobile-portrait", mechanism: "viewport",
    assertions: [equalsAssertion("mobile-css-width", 390), equalsAssertion("mobile-no-horizontal-overflow", true), equalsAssertion("mobile-controls-reachable", true)],
  },
  "ZOOM-03": {
    checkKey: "landscape-reflow-844", category: "zoom", route: "/settings/system", target: "system-settings-route", profile: "mobile-landscape", mechanism: "viewport",
    assertions: [equalsAssertion("landscape-width-observed", 844), equalsAssertion("landscape-height-observed", 390), equalsAssertion("landscape-no-horizontal-overflow", true), equalsAssertion("landscape-controls-reachable", true)],
  },
  "CANVAS-01": {
    checkKey: "canvas-api-list-parity", category: "canvas", route: "/knowledge/canvas?view=list", target: "canvas-equivalent-list", profile: "desktop", mechanism: "api",
    assertions: [equalsAssertion("equivalent-list-named", true), gteAssertion("equivalent-list-nonempty", 1), dynamicIntegerAssertion("equivalent-list-matches-api", 1), gteAssertion("equivalent-list-has-open-link", 1), dynamicTokenAssertion("relation-filter-kind-selected"), dynamicIntegerAssertion("relation-filter-matches-api-edges"), equalsAssertion("subject-filter-request-status", 200), equalsAssertion("subject-filter-has-two-subjects", 2), dynamicIntegerAssertion("subject-filter-matches-api", 1), equalsAssertion("subject-filter-reduces-list", true), dynamicTokenAssertion("subject-filter-bound-in-url")],
  },
  "CANVAS-02": {
    checkKey: "canvas-mobile-equivalent-list", category: "canvas", route: "/knowledge/canvas?view=list", target: "canvas-equivalent-list", profile: "mobile-portrait", mechanism: "keyboard",
    assertions: [equalsAssertion("mobile-layout-buttons-disabled", true), equalsAssertion("mobile-reset-layout-absent", 0), gteAssertion("mobile-equivalent-list-open-link", 1), equalsAssertion("mobile-list-opened-canonical-detail", true), equalsAssertion("mobile-detail-heading-focused", true)],
  },
  "CANVAS-03": {
    checkKey: "canvas-layout-and-return-oracle", category: "canvas", route: "/knowledge/canvas", target: "canvas-layout-and-detail-return", profile: "desktop", mechanism: "api",
    assertions: [equalsAssertion("second-keyboard-layout-status", 200), equalsAssertion("layout-get-before-status", 200), equalsAssertion("layout-get-after-status", 200), equalsAssertion("layout-get-oracle-changed", true), equalsAssertion("keyboard-operation-focus-still-retained", true), equalsAssertion("hide-layout-status", 200), equalsAssertion("hide-focus-moved-to-restore-control", true), equalsAssertion("hide-announcement-names-focus-destination", true), equalsAssertion("restore-layout-status", 200), equalsAssertion("reset-layout-status", 200), equalsAssertion("reset-layout-get-status", 200), equalsAssertion("reset-layout-get-oracle-changed", true), equalsAssertion("reset-layout-announced", true), equalsAssertion("reset-layout-focus-returned", true), equalsAssertion("conflict-baseline-layout-status", 200), equalsAssertion("stale-layout-conflict-status", 409), equalsAssertion("conflict-modal-received-focus", true), equalsAssertion("conflict-modal-retained-local-copy", true), equalsAssertion("conflict-modal-blocked-escape", true), equalsAssertion("conflict-explicit-retry-status", 200), equalsAssertion("conflict-focus-returned-to-trigger", true)],
  },
} as const satisfies Record<typeof V11_ACCESSIBILITY_CHECK_IDS[number], {
  checkKey: string;
  category: V11AccessibilityCategory;
  route: string;
  target: string;
  profile: typeof V11_ACCESSIBILITY_PROFILES[number];
  mechanism: V11AccessibilityMechanism;
  assertions: readonly V11AssertionContract[];
}>;

export const V11_DOES_NOT_PROVE = [
  "signed Release",
  "production apply",
  "residual closure",
] as const;

export const V11_VIEWPORT_CONTRACT = {
  desktop: { width: 1440, height: 1000, deviceScaleFactor: 1 },
  mobile: { width: 390, height: 844, deviceScaleFactor: 1 },
} as const;

export function canonicalV11JourneyScreenshotName(viewport: V11ViewportId, journey: V11JourneyId): string {
  return `${viewport}-${journey}.png`;
}

export const V11_CATEGORY_COUNTS = {
  keyboard: 5,
  focus: 4,
  semantics: 2,
  live: 6,
  color: 1,
  zoom: 3,
  canvas: 3,
} as const;

export const V11_EVIDENCE_KEYS = {
  TOP_COMMON: ["schemaVersion", "generatedAt", "environment", "runtimeIdentityEvidence", "fixtureEvidence", "summary", "doesNotProve", "safetyFacts"],
  ENVIRONMENT: ["kind", "baseUrl", "browserName", "browserVersion", "playwrightVersion"],
  RUNTIME: ["request", "runtimeIdentity", "responseSha256"],
  REQUEST: ["method", "path", "status"],
  FIXTURE: [
    "schemaVersion", "fixtureSetId", "generatedAt", "contentClassification", "isolation",
    "journeyAccountCount", "accessibilityAccountCount", "accounts", "manifestSha256",
  ],
  FIXTURE_ACCOUNT: ["accountRef", "purpose", "viewport", "journeyId"],
  SAFETY: [
    "localBaseUrl", "localDatabase", "explicitWriteOptIn", "passwordSource", "productionWriteAttempted",
    "serverCommandAttempted", "backupRestoreAttempted", "migrationAttempted", "destructiveActionAttempted",
    "updaterApplyAttempted", "releaseCreated", "secretValuePrinted", "realStudyContentIncluded", "residualLedgerUpdated",
  ],
  JOURNEY: [
    "id", "journey", "viewport", "accountRef", "startPath", "terminalPath", "mutation", "oracle",
    "terminalAssertions", "screenshot", "telemetry", "startedAt", "finishedAt", "durationMs", "result",
  ],
  VIEWPORT: ["id", "width", "height", "deviceScaleFactor"],
  MUTATION: ["initiatedBy", "uiOriginatedMutation", "method", "path", "status", "requestCount"],
  ORACLE: ["method", "path", "before", "after"],
  ORACLE_STATE: ["status", "responseSha256", "assertions"],
  ASSERTION: ["id", "predicate", "expected", "actual", "passed"],
  SCREENSHOT: ["path", "sha256", "width", "height", "syntheticContent"],
  TELEMETRY: ["consoleErrors", "pageErrors", "requestFailures", "httpFailures", "unexplainedFailureCount"],
  A11Y_CHECK: ["id", "checkKey", "category", "route", "target", "profile", "mechanism", "assertions", "artifact", "result"],
  PROFILE: ["id", "kind", "width", "height", "deviceScaleFactor", "zoomPercent"],
  ARTIFACT: ["kind", "path", "sha256", "observationCount"],
  OBSERVATION: ["schemaVersion", "recordedAt", "checkId", "checkKey", "route", "target", "profile", "mechanism", "assertions"],
  CATEGORY_SUMMARY: ["category", "total", "passed", "failed", "skipped"],
} as const;

export type V11JourneySchema = typeof V11_JOURNEY_SCHEMA;
export type V11AccessibilitySchema = typeof V11_ACCESSIBILITY_SCHEMA;
export type V11EvidenceSchema = V11JourneySchema | V11AccessibilitySchema;
export type V11JourneyId = typeof V11_JOURNEY_IDS[number];
export type V11ViewportId = typeof V11_VIEWPORTS[number];
export type V11AccessibilityCheckId = typeof V11_ACCESSIBILITY_CHECK_IDS[number];
export type V11AccessibilityCategory = typeof V11_ACCESSIBILITY_CATEGORIES[number];
export type V11AccessibilityProfileId = typeof V11_ACCESSIBILITY_PROFILES[number];
export type V11AccessibilityMechanism = "keyboard" | "dom" | "cdp" | "viewport" | "api";

export type V11AssertionPredicate =
  | "equals"
  | "not-equals"
  | "gte"
  | "lte"
  | "between-inclusive"
  | "contains-all";

export type V11AssertionExpectedContract =
  | { kind: "literal"; value: V11RedactedValue }
  | { kind: "integer"; min: number; max: number }
  | { kind: "short-token" }
  | { kind: "route" };

export type V11AssertionContract = {
  id: string;
  predicate: V11AssertionPredicate;
  expected: V11AssertionExpectedContract;
};

export type V11JourneyContract = {
  startPath: string;
  terminalPath: string;
  mutation: {
    method: "POST" | "PUT" | "PATCH";
    path: string;
    status: number;
    requestCount: 1;
  };
  oraclePath: string;
  beforeStatus: number;
  afterStatus: number;
  beforeAssertions: readonly V11AssertionContract[];
  afterAssertions: readonly V11AssertionContract[];
  terminalAssertions: readonly V11AssertionContract[];
};

export type V11ValidationIssue = { field: string; message: string };

export type V11SafeFile = { relativePath: string; bytes: Buffer; sha256: string };

export type V11EvidenceValidationResult = {
  valid: boolean;
  schemaVersion: V11EvidenceSchema | null;
  itemCount: number;
  issues: V11ValidationIssue[];
};

export type V11EvidenceBinding = {
  root: string;
  expectedCommit: string;
  expectedVersion: string;
  expectedSourceHash: string;
};

export type V11BrowserEvidenceCli = {
  evidencePath: string;
  expectedCommit?: string;
  expectedVersion?: string;
};

export type V11Viewport = {
  id: V11ViewportId;
  width: number;
  height: number;
  deviceScaleFactor: number;
};

export type V11AccessibilityProfile = (typeof V11_ACCESSIBILITY_PROFILE_CONTRACT)[V11AccessibilityProfileId];

export type V11RedactedValue = string | number | boolean | null
  | V11RedactedValue[]
  | { [key: string]: V11RedactedValue };

export type V11Assertion = {
  id: string;
  predicate: V11AssertionPredicate;
  expected: V11RedactedValue;
  actual: V11RedactedValue;
  passed: boolean;
};

export function matchesV11AssertionExpectedContract(
  value: unknown,
  contract: V11AssertionExpectedContract,
): boolean {
  if (contract.kind === "literal") {
    try { return canonicalSha256(value) === canonicalSha256(contract.value); }
    catch { return false; }
  }
  if (contract.kind === "integer") {
    return typeof value === "number" && Number.isSafeInteger(value)
      && value >= contract.min && value <= contract.max;
  }
  if (contract.kind === "short-token") return isV11ShortToken(value);
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")
    || value.includes("\\") || value.includes("#") || value.length > 500) return false;
  try {
    const route = new URL(value, "http://areaforge.invalid");
    return route.origin === "http://areaforge.invalid" && !route.username && !route.password;
  } catch { return false; }
}

export function assertV11AssertionListContract(
  assertions: readonly V11Assertion[],
  contract: readonly V11AssertionContract[],
  scope: string,
): void {
  if (assertions.length !== contract.length) {
    throw new Error(`${scope} emitted ${assertions.length} assertions; expected ${contract.length}`);
  }
  const ids = new Set<string>();
  assertions.forEach((assertion, index) => {
    const expected = contract[index];
    if (!expected) throw new Error(`${scope} has no contract for assertion ${index}`);
    if (ids.has(assertion.id)) throw new Error(`${scope} emitted duplicate assertion ${assertion.id}`);
    ids.add(assertion.id);
    if (assertion.id !== expected.id) {
      throw new Error(`${scope} assertion ${index} ID ${assertion.id} does not match ${expected.id}`);
    }
    if (assertion.predicate !== expected.predicate) {
      throw new Error(`${scope} assertion ${assertion.id} predicate does not match the contract`);
    }
    if (!matchesV11AssertionExpectedContract(assertion.expected, expected.expected)) {
      throw new Error(`${scope} assertion ${assertion.id} expected value does not match the contract`);
    }
  });
}

export type V11RuntimeIdentity = {
  schemaVersion: 1;
  status: "verified";
  appVersion: string;
  gitCommit: string;
  sourceFingerprintSchema: "ux-source-v2";
  productExperienceSourceHash: string;
  buildId: string;
  runtimeMode: "production-build";
  identityHash: string;
  observedAt: string;
  reasonCode: "NONE";
};

export type V11RuntimeIdentityEvidence = {
  request: { method: "GET"; path: "/api/health"; status: 200 };
  runtimeIdentity: V11RuntimeIdentity;
  responseSha256: string;
};

export type V11FixtureAccount = {
  accountRef: string;
  purpose: "journey" | "accessibility";
  viewport: V11ViewportId | "suite";
  journeyId: V11JourneyId | null;
};

export type V11FixtureEvidence = {
  schemaVersion: typeof V11_FIXTURE_SCHEMA;
  fixtureSetId: string;
  generatedAt: string;
  contentClassification: "synthetic-only";
  isolation: "one-user-per-viewport-journey";
  journeyAccountCount: 18;
  accessibilityAccountCount: 1;
  accounts: V11FixtureAccount[];
  manifestSha256: string;
};

export type V11EvidenceEnvironment = {
  kind: "local-production-mode" | "staging";
  baseUrl: string;
  browserName: "chrome" | "chromium";
  browserVersion: string;
  playwrightVersion: string;
};

export type V11SafetyFacts = {
  localBaseUrl: boolean;
  localDatabase: boolean;
  explicitWriteOptIn: boolean;
  passwordSource: "restricted-file";
  productionWriteAttempted: false;
  serverCommandAttempted: false;
  backupRestoreAttempted: false;
  migrationAttempted: false;
  destructiveActionAttempted: false;
  updaterApplyAttempted: false;
  releaseCreated: false;
  secretValuePrinted: false;
  realStudyContentIncluded: false;
  residualLedgerUpdated: false;
};

export type V11JourneyEvidenceItem = {
  id: string;
  journey: V11JourneyId;
  viewport: V11Viewport;
  accountRef: string;
  startPath: string;
  terminalPath: string;
  mutation: {
    initiatedBy: "page-ui";
    uiOriginatedMutation: true;
    method: "POST" | "PUT" | "PATCH";
    path: string;
    status: number;
    requestCount: number;
  };
  oracle: {
    method: "GET";
    path: string;
    before: { status: number; responseSha256: string; assertions: V11Assertion[] };
    after: { status: number; responseSha256: string; assertions: V11Assertion[] };
  };
  terminalAssertions: V11Assertion[];
  screenshot: {
    path: string;
    sha256: string;
    width: number;
    height: number;
    syntheticContent: true;
  };
  telemetry: {
    consoleErrors: unknown[];
    pageErrors: unknown[];
    requestFailures: unknown[];
    httpFailures: unknown[];
    unexplainedFailureCount: 0;
  };
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  result: "pass" | "fail";
};

export type V11JourneyEvidence = {
  schemaVersion: V11JourneySchema;
  generatedAt: string;
  environment: V11EvidenceEnvironment;
  runtimeIdentityEvidence: V11RuntimeIdentityEvidence;
  fixtureEvidence: V11FixtureEvidence;
  summary: {
    total: 18;
    passed: 18;
    failed: 0;
    skipped: 0;
    desktop: 9;
    mobile: 9;
    uiOriginatedMutations: 18;
    getOnlyOracles: 18;
    unexplainedFailureCount: 0;
  };
  journeys: V11JourneyEvidenceItem[];
  doesNotProve: [...typeof V11_DOES_NOT_PROVE];
  safetyFacts: V11SafetyFacts;
};

export type V11AccessibilityCheck = {
  id: V11AccessibilityCheckId;
  checkKey: string;
  category: V11AccessibilityCategory;
  route: string;
  target: string;
  profile: V11AccessibilityProfile;
  mechanism: V11AccessibilityMechanism;
  assertions: V11Assertion[];
  artifact: {
    kind: "keyboard-trace" | "focus-trace" | "accessibility-tree" | "live-region-trace"
      | "computed-style" | "reflow-measurement" | "canvas-equivalence";
    path: string;
    sha256: string;
    observationCount: number;
  };
  result: "pass" | "fail";
};

export type V11AccessibilityObservation = {
  schemaVersion: typeof V11_ACCESSIBILITY_OBSERVATION_SCHEMA;
  recordedAt: string;
  checkId: V11AccessibilityCheckId;
  checkKey: string;
  route: string;
  target: string;
  profile: V11AccessibilityProfile;
  mechanism: V11AccessibilityCheck["mechanism"];
  assertions: V11Assertion[];
};

export type V11AccessibilityEvidence = {
  schemaVersion: V11AccessibilitySchema;
  generatedAt: string;
  environment: V11EvidenceEnvironment;
  runtimeIdentityEvidence: V11RuntimeIdentityEvidence;
  fixtureEvidence: V11FixtureEvidence;
  summary: {
    total: 24;
    passed: 24;
    failed: 0;
    skipped: 0;
    categories: Array<{
      category: V11AccessibilityCategory;
      total: number;
      passed: number;
      failed: 0;
      skipped: 0;
    }>;
  };
  checks: V11AccessibilityCheck[];
  doesNotProve: [...typeof V11_DOES_NOT_PROVE];
  safetyFacts: V11SafetyFacts;
};

export function categoryForCheck(id: string): V11AccessibilityCategory | null {
  if (id.startsWith("KBD-")) return "keyboard";
  if (id.startsWith("FOCUS-")) return "focus";
  if (id.startsWith("SEM-")) return "semantics";
  if (id.startsWith("LIVE-")) return "live";
  if (id.startsWith("COLOR-")) return "color";
  if (id.startsWith("ZOOM-")) return "zoom";
  if (id.startsWith("CANVAS-")) return "canvas";
  return null;
}

export function canonicalSha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableStringify(value)).digest("hex")}`;
}

export function computeFixtureManifestHash(value: Omit<V11FixtureEvidence, "manifestSha256">): string {
  return canonicalSha256({ domain: "areaforge.v11-browser-fixture.v1", ...value });
}

export function computeRuntimeResponseHash(runtimeIdentity: V11RuntimeIdentity): string {
  return canonicalSha256({ ok: true, service: "AreaForge", version: runtimeIdentity.appVersion, runtimeIdentity });
}

export function readV11SafeRepoFile(rootInput: string, relativeInput: string, maxBytes: number): V11SafeFile {
  const root = path.resolve(rootInput);
  const relativePath = normalizeRelativePath(relativeInput);
  if (!relativePath) throw new Error("path must be canonical, repo-relative, and must not contain traversal");
  if (relativePath.split("/").some((part) => /^(?:\.env(?:\..*)?|secrets?|tokens?|passwords?|private[-_]?keys?|database[-_]?dumps?)$/i.test(part))) {
    throw new Error("path contains a forbidden sensitive component");
  }
  const absolute = path.resolve(root, relativePath);
  if (!isWithin(root, absolute)) throw new Error("path escapes the repository");
  const realRoot = realpathSync(root);
  let current = root;
  for (const part of relativePath.split("/")) {
    current = path.join(current, part);
    let stat;
    try { stat = lstatSync(current); } catch { throw new Error("referenced file is missing or unreadable"); }
    if (stat.isSymbolicLink()) throw new Error("path or parent directory must not be a symlink");
  }
  if (!isWithin(realRoot, realpathSync(absolute))) throw new Error("resolved path escapes the repository");
  const before = lstatSync(absolute);
  if (!before.isFile()) throw new Error("referenced path must be a regular file");
  if (before.size < 1 || before.size > maxBytes) throw new Error(`referenced file must be from 1 to ${maxBytes} bytes`);
  const descriptor = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) throw new Error("referenced file changed during safe open");
    const bytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (count === 0) break;
      offset += count;
    }
    const after = fstatSync(descriptor);
    if (offset !== bytes.length || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) throw new Error("referenced file changed while being read");
    return { relativePath, bytes, sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}` };
  } finally { closeSync(descriptor); }
}

const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");
const PNG_CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

export function readV11PngDimensions(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 57 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("must contain a complete PNG file");
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = -1;
  let chunkIndex = 0;
  let idatBytes = 0;
  const idatChunks: Buffer[] = [];
  let ended = false;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error("PNG chunk header is truncated");
    const length = bytes.readUInt32BE(offset);
    const typeStart = offset + 4;
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (length > 20 * 1024 * 1024 || chunkEnd > bytes.length) throw new Error("PNG chunk is truncated or oversized");
    const type = bytes.subarray(typeStart, dataStart).toString("ascii");
    if (!/^[A-Za-z]{4}$/.test(type)) throw new Error("PNG chunk type is invalid");
    const declaredCrc = bytes.readUInt32BE(dataEnd);
    const actualCrc = pngCrc32(bytes.subarray(typeStart, dataEnd));
    if (declaredCrc !== actualCrc) throw new Error(`PNG ${type} chunk CRC is invalid`);
    if (chunkIndex === 0) {
      if (type !== "IHDR" || length !== 13) throw new Error("PNG must begin with a 13-byte IHDR chunk");
      width = bytes.readUInt32BE(dataStart);
      height = bytes.readUInt32BE(dataStart + 4);
      bitDepth = bytes[dataStart + 8] as number;
      colorType = bytes[dataStart + 9] as number;
      interlace = bytes[dataStart + 12] as number;
      const allowedDepths: Record<number, readonly number[]> = {
        0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16],
      };
      if (width < 1 || height < 1 || !allowedDepths[colorType]?.includes(bitDepth)) throw new Error("PNG IHDR dimensions or color format are invalid");
      if (bytes[dataStart + 10] !== 0 || bytes[dataStart + 11] !== 0 || interlace !== 0) {
        throw new Error("PNG IHDR compression, filter, or interlace method is invalid");
      }
    } else if (type === "IHDR") {
      throw new Error("PNG must contain exactly one IHDR chunk");
    }
    if (type === "IDAT") {
      idatBytes += length;
      idatChunks.push(bytes.subarray(dataStart, dataEnd));
    }
    if (type === "IEND") {
      if (length !== 0 || idatBytes === 0) throw new Error("PNG must contain image data before an empty IEND chunk");
      if (chunkEnd !== bytes.length) throw new Error("PNG must not contain trailing bytes after IEND");
      ended = true;
    }
    offset = chunkEnd;
    chunkIndex += 1;
    if (ended) break;
  }
  if (!ended) throw new Error("PNG is missing its terminal IEND chunk");
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colorType];
  const rowBytes = channels ? Math.ceil(width * channels * bitDepth / 8) : 0;
  const expectedInflatedBytes = (rowBytes + 1) * height;
  if (!channels || expectedInflatedBytes < 1 || expectedInflatedBytes > 64 * 1024 * 1024) {
    throw new Error("PNG decoded image size is invalid or oversized");
  }
  let inflated: Buffer;
  try {
    inflated = inflateSync(Buffer.concat(idatChunks, idatBytes), { maxOutputLength: expectedInflatedBytes + 1 });
  } catch {
    throw new Error("PNG IDAT stream is invalid");
  }
  if (inflated.length !== expectedInflatedBytes) throw new Error("PNG decoded image length does not match IHDR");
  for (let row = 0; row < height; row += 1) {
    if ((inflated[row * (rowBytes + 1)] as number) > 4) throw new Error("PNG scanline filter is invalid");
  }
  return { width, height };
}

export function hasV11ImageSignature(bytes: Buffer): boolean {
  try { readV11PngDimensions(bytes); return true; } catch { return false; }
}

function pngCrc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (PNG_CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function isV11Sha256(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value) && !/^sha256:0+$/.test(value);
}
export function isV11Commit(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{40}$/.test(value) && !/^0+$/.test(value);
}
export function isV11Version(value: unknown): value is string {
  return typeof value === "string" && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value);
}
export function isV11ShortToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(value);
}
export function isV11SafeScalar(value: unknown): value is string | number | boolean {
  if (typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  return typeof value === "string" && value.length <= 120 && /^(?:sha256:[a-f0-9]{64}|[A-Za-z0-9][A-Za-z0-9._:/-]{0,119})$/.test(value);
}

export function isV11RedactedValue(value: unknown, depth = 0): value is V11RedactedValue {
  if (depth > 5) return false;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") {
    return value.length <= 500 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
  }
  if (Array.isArray(value)) {
    return value.length <= 100 && value.every((item) => isV11RedactedValue(item, depth + 1));
  }
  if (!value || typeof value !== "object") return false;
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.length <= 100
    && entries.every(([key, nested]) => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(key)
      && isV11RedactedValue(nested, depth + 1));
}

export function containsV11SecretLikeText(raw: string): boolean {
  const extraPatterns = [
    /(?:authorization|set-cookie)\s*[:=]\s*[^\s"']+/i,
    /-----BEGIN (?:ENCRYPTED )?[A-Z ]*PRIVATE KEY-----/i,
  ];
  return [...commonSecretPatterns.map((item) => item.pattern), ...extraPatterns].some((pattern) => pattern.test(raw));
}

export function parseV11BrowserEvidenceCli(argv: string[]): V11BrowserEvidenceCli {
  if (argv.length < 1 || argv[0]?.startsWith("--")) throw new Error("evidence path is required");
  const parsed: V11BrowserEvidenceCli = { evidencePath: argv[0] as string };
  const seen = new Set<string>();
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag || !["--expected-commit", "--expected-version"].includes(flag) || !value || value.startsWith("--") || seen.has(flag)) throw new Error("invalid or duplicate option");
    seen.add(flag);
    if (flag === "--expected-commit") parsed.expectedCommit = value;
    else parsed.expectedVersion = value;
  }
  if (parsed.expectedCommit && !isV11Commit(parsed.expectedCommit)) throw new Error("--expected-commit must be a non-zero lowercase 40-character SHA");
  if (parsed.expectedVersion && !isV11Version(parsed.expectedVersion)) throw new Error("--expected-version must be a semantic version");
  return parsed;
}

export function safeV11Error(error: unknown): string {
  return error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 300) : "safe validation failed";
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizeRelativePath(value: string): string | null {
  if (!value || path.posix.isAbsolute(value) || value.includes("\\") || value.includes("\0")) return null;
  const normalized = path.posix.normalize(value);
  return normalized === value && normalized !== "." && !normalized.split("/").includes("..") ? normalized : null;
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
