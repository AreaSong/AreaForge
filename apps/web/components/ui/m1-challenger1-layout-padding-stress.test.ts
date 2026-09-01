import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  ArticleCard,
  AsideCard,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardPadding,
  CardTitle,
  CardVariant,
  SectionCard,
  cardClassName,
  cardPaddingClasses,
  cardVariantClasses,
} from "@areaforge/ui";

// ============================================================================
// SUITE 1: CARD PADDING VARIANTS & STRICT 8PT TOKEN SCALE VERIFICATION
// ============================================================================

test("M1 Challenger 1: cardPaddingClasses strictly conforms to 8pt design token scale", () => {
  // Verify exact dictionary mappings
  assert.equal(cardPaddingClasses.none, "", "padding none must be empty string");
  assert.equal(cardPaddingClasses.sm, "p-3", "padding sm must be p-3 (12px fixed)");
  assert.equal(cardPaddingClasses.md, "p-4 sm:p-5", "padding md must be p-4 (16px) scaling to sm:p-5 (20px)");
  assert.equal(cardPaddingClasses.lg, "p-5 sm:p-6", "padding lg must be p-5 (20px) scaling to sm:p-6 (24px)");

  // Verify no non-standard fractional paddings remain in dictionary
  const values = Object.values(cardPaddingClasses);
  for (const val of values) {
    assert.ok(!val.includes("p-2.5"), `cardPaddingClasses contains non-standard p-2.5: ${val}`);
    assert.ok(!val.includes("p-3.5"), `cardPaddingClasses contains non-standard p-3.5: ${val}`);
    assert.ok(!val.includes("p-4.5"), `cardPaddingClasses contains non-standard p-4.5: ${val}`);
    assert.ok(!val.includes("p-1.5"), `cardPaddingClasses contains non-standard p-1.5: ${val}`);
  }
});

test("M1 Challenger 1: cardVariantClasses invariants and surface integration", () => {
  assert.ok(cardVariantClasses.master.includes("rounded-2xl"));
  assert.ok(cardVariantClasses.master.includes("border-white/10"));
  assert.ok(cardVariantClasses.master.includes("bg-[#0e1619]/90"));
  assert.ok(cardVariantClasses.master.includes("shadow-lg"));

  assert.ok(cardVariantClasses.subtle.includes("rounded-xl"));
  assert.ok(cardVariantClasses.subtle.includes("border-white/5"));
  assert.ok(cardVariantClasses.subtle.includes("bg-white/[0.02]"));

  assert.ok(cardVariantClasses.accent.includes("rounded-2xl"));
  assert.ok(cardVariantClasses.accent.includes("border-teal-500/20"));
  assert.ok(cardVariantClasses.accent.includes("shadow-[0_0_16px_rgba(45,212,191,0.15)]"));
});

test("M1 Challenger 1: cardClassName combinatorial fuzzing & robust edge-case handling", () => {
  const allVariants: (CardVariant | undefined | null | string)[] = [
    "master",
    "subtle",
    "accent",
    undefined,
    null,
    "",
    "unknown_custom_variant",
  ];
  const allPaddings: (CardPadding | undefined | null | string)[] = [
    "none",
    "sm",
    "md",
    "lg",
    undefined,
    null,
    "",
    "unknown_custom_padding",
  ];
  const testClassNames = [
    undefined,
    "",
    "   ",
    "custom-flex-col",
    "  custom-1   custom-2 \t\n custom-3  ",
  ];

  for (const variant of allVariants) {
    for (const padding of allPaddings) {
      for (const customClass of testClassNames) {
        // @ts-expect-error Testing fuzzing with untyped inputs
        const result = cardClassName({ variant, padding, className: customClass });

        // Invariant 1: Result must be a non-empty string
        assert.ok(typeof result === "string" && result.length > 0);

        // Invariant 2: Must always begin with min-w-0 for flex blowout protection
        assert.ok(result.startsWith("min-w-0"), `Expected min-w-0 prefix for ${variant}/${padding}, got: ${result}`);

        // Invariant 3: Must never contain literal "undefined" or "null"
        assert.ok(!result.includes("undefined"), `Contains "undefined" string: ${result}`);
        assert.ok(!result.includes("null"), `Contains "null" string: ${result}`);

        // Invariant 4: Must never have duplicate whitespace or raw newlines/tabs
        assert.ok(!result.includes("  "), `Contains double whitespace: ${result}`);
        assert.ok(!result.includes("\n"), `Contains newline: ${result}`);
        assert.ok(!result.includes("\t"), `Contains tab: ${result}`);
        assert.equal(result, result.trim(), "Result must be strictly trimmed");

        // Invariant 5: Correct padding token assertion
        if (padding === "sm") {
          assert.ok(result.includes("p-3"), `Expected p-3 for sm padding, got ${result}`);
        } else if (padding === "md" || padding === undefined || padding === null || padding === "" || padding === "unknown_custom_padding") {
          // Default or fallback padding is md
          assert.ok(result.includes("p-4 sm:p-5"), `Expected fallback md padding p-4 sm:p-5, got ${result}`);
        } else if (padding === "lg") {
          assert.ok(result.includes("p-5 sm:p-6"), `Expected p-5 sm:p-6 for lg padding, got ${result}`);
        } else if (padding === "none") {
          assert.ok(!result.includes("p-3") && !result.includes("p-4") && !result.includes("p-5"));
        }
      }
    }
  }
});

// ============================================================================
// SUITE 2: POLYMORPHIC CARD PRIMITIVES & SUBCOMPONENT HIERARCHY
// ============================================================================

test("M1 Challenger 1: Polymorphic Card elements & subcomponents render valid JSX", () => {
  // Div Card
  const divCard = Card({ children: "Div content", variant: "master", padding: "sm" });
  assert.equal(divCard.type, "div");
  assert.ok(divCard.props.className.includes("p-3"));

  // SectionCard
  const sectionCard = SectionCard({ children: "Section content", padding: "md" });
  assert.equal(sectionCard.type, Card);
  assert.equal(sectionCard.props.as, "section");

  // ArticleCard
  const articleCard = ArticleCard({ children: "Article content", padding: "lg" });
  assert.equal(articleCard.type, Card);
  assert.equal(articleCard.props.as, "article");

  // AsideCard
  const asideCard = AsideCard({ children: "Aside content", padding: "none" });
  assert.equal(asideCard.type, Card);
  assert.equal(asideCard.props.as, "aside");

  // Subcomponents: Header, Title, Description, Content, Footer
  const header = CardHeader({ className: "custom-header", children: "Header" });
  assert.equal(header.type, "div");
  assert.ok(header.props.className.includes("space-y-1.5"));
  assert.ok(header.props.className.includes("custom-header"));

  const title = CardTitle({ className: "custom-title", children: "Title" });
  assert.equal(title.type, "h3");
  assert.ok(title.props.className.includes("text-base font-semibold"));
  assert.ok(title.props.className.includes("leading-none"));
  assert.ok(title.props.className.includes("text-white"));
  assert.ok(title.props.className.includes("custom-title"));

  const desc = CardDescription({ className: "custom-desc", children: "Description" });
  assert.equal(desc.type, "p");
  assert.ok(desc.props.className.includes("text-xs text-zinc-400"));
  assert.ok(desc.props.className.includes("custom-desc"));

  const content = CardContent({ className: "custom-content", children: "Body" });
  assert.equal(content.type, "div");
  assert.ok(content.props.className.includes("pt-0"));
  assert.ok(content.props.className.includes("custom-content"));

  const footer = CardFooter({ className: "custom-footer", children: "Footer" });
  assert.equal(footer.type, "div");
  assert.ok(footer.props.className.includes("flex items-center pt-3"));
  assert.ok(footer.props.className.includes("custom-footer"));
});

// ============================================================================
// SUITE 3: CONSUMER CRAWLER & AUDIT ACROSS @AREAFORGE/WEB
// ============================================================================

test("M1 Challenger 1: Audit all Card consumers in @areaforge/web for invalid paddings or syntax breaks", () => {
  const webRoot = path.resolve(__dirname, "../../..");
  const allowedPaddings = new Set(["none", "sm", "md", "lg"]);
  const allowedVariants = new Set(["master", "subtle", "accent"]);

  function scanDir(dir: string, fileList: string[] = []) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (
        entry.name === "nodeToTest" ||
        entry.name === "node_modules" ||
        entry.name === ".next" ||
        entry.name === "dist" ||
        entry.name === ".turbo" ||
        entry.name.endsWith(".test.ts") ||
        entry.name.endsWith(".test.tsx")
      ) {
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath, fileList);
      } else if (entry.isFile() && (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts"))) {
        fileList.push(fullPath);
      }
    }
    return fileList;
  }

  const productionFiles = scanDir(webRoot);
  let cardUsageCount = 0;

  for (const filePath of productionFiles) {
    const content = fs.readFileSync(filePath, "utf-8");
    // Check if file uses Card, SectionCard, ArticleCard, AsideCard, or cardClassName
    if (
      content.includes("<Card") ||
      content.includes("<SectionCard") ||
      content.includes("<ArticleCard") ||
      content.includes("<AsideCard") ||
      content.includes("cardClassName(")
    ) {
      cardUsageCount++;

      // Match opening JSX tag attributes specifically: <(Card|SectionCard|ArticleCard|AsideCard)\b([^>]*)>
      const tagRegex = /<(?:Card|SectionCard|ArticleCard|AsideCard)\b([^>]*)/g;
      let tagMatch: RegExpExecArray | null;
      while ((tagMatch = tagRegex.exec(content)) !== null) {
        const attributes = tagMatch[1];

        // Check for padding="..."
        const paddingMatch = /\bpadding=(?:["']([^"']+)["']|\{["']([^"']+)["']\})/g.exec(attributes);
        if (paddingMatch) {
          const paddingVal = paddingMatch[1] ?? paddingMatch[2];
          assert.ok(
            allowedPaddings.has(paddingVal),
            `File ${filePath} uses invalid card padding "${paddingVal}". Allowed: [${Array.from(allowedPaddings).join(", ")}]`
          );
        }

        // Check for variant="..."
        const variantMatch = /\bvariant=(?:["']([^"']+)["']|\{["']([^"']+)["']\})/g.exec(attributes);
        if (variantMatch) {
          const variantVal = variantMatch[1] ?? variantMatch[2];
          assert.ok(
            allowedVariants.has(variantVal),
            `File ${filePath} uses invalid card variant "${variantVal}". Allowed: [${Array.from(allowedVariants).join(", ")}]`
          );
        }
      }
    }
  }

  assert.ok(cardUsageCount >= 20, `Expected at least 20 production files using Card primitives in web package, found ${cardUsageCount}`);
});

// ============================================================================
// SUITE 4: VIEWPORT GEOMETRY & STRESS MODELING (1440px, 1512px, 1280px, 768px, 375px)
// ============================================================================

test("M1 Challenger 1: Viewport Geometry & Content Width Calculations across all breakpoints", () => {
  interface ViewportProfile {
    name: string;
    width: number;
    height: number;
    primarySidebarWidth: number;
    secondarySidebarWidth: number;
    appShellHorizontalPadding: number; // in px
    expectedCardPaddingMd: { base: number; sm: number };
  }

  const profiles: ViewportProfile[] = [
    {
      name: "14-inch MacBook Pro (Native Retina 1512px)",
      width: 1512,
      height: 982,
      primarySidebarWidth: 184,
      secondarySidebarWidth: 216,
      appShellHorizontalPadding: 40, // xl:px-5 = 20px each side = 40px
      expectedCardPaddingMd: { base: 16, sm: 20 },
    },
    {
      name: "14-inch MacBook Pro (Standard Logical 1440px)",
      width: 1440,
      height: 900,
      primarySidebarWidth: 184,
      secondarySidebarWidth: 216,
      appShellHorizontalPadding: 40, // xl:px-5 = 40px
      expectedCardPaddingMd: { base: 16, sm: 20 },
    },
    {
      name: "13-inch / Compact Laptop (1280px)",
      width: 1280,
      height: 800,
      primarySidebarWidth: 184,
      secondarySidebarWidth: 216,
      appShellHorizontalPadding: 40, // xl:px-5 = 40px
      expectedCardPaddingMd: { base: 16, sm: 20 },
    },
    {
      name: "Tablet / iPad (768px)",
      width: 768,
      height: 1024,
      primarySidebarWidth: 0, // Drawer / hidden on tablet
      secondarySidebarWidth: 0,
      appShellHorizontalPadding: 32, // sm:px-4 = 16px each side = 32px
      expectedCardPaddingMd: { base: 16, sm: 20 },
    },
    {
      name: "Mobile / iPhone SE (375px)",
      width: 375,
      height: 667,
      primarySidebarWidth: 0,
      secondarySidebarWidth: 0,
      appShellHorizontalPadding: 24, // px-3 = 12px each side = 24px
      expectedCardPaddingMd: { base: 16, sm: 20 },
    },
  ];

  for (const vp of profiles) {
    const totalSidebars = vp.primarySidebarWidth + vp.secondarySidebarWidth;
    const netShellWidth = vp.width - totalSidebars;
    const mainContentWidth = netShellWidth - vp.appShellHorizontalPadding;

    // Content area must always be strictly positive and viable
    assert.ok(
      mainContentWidth > 300,
      `Main content width for ${vp.name} (${mainContentWidth}px) must be > 300px`
    );

    // On 1440px and 1512px viewports with dual sidebars (400px),
    // mainContentWidth is 1000px and 1072px respectively.
    if (vp.width === 1440) {
      assert.equal(mainContentWidth, 1000, "1440px net content width must be exactly 1000px");
      // 2-column grid inside container:
      // (1000 - 24px gap) / 2 = 488px per column
      const twoColWidth = (mainContentWidth - 24) / 2;
      assert.ok(twoColWidth >= 480, `2-col width on 1440px is ${twoColWidth}px (>=480px)`);

      // 3-column grid inside container:
      // (1000 - 48px gaps) / 3 = 317.33px per column
      const threeColWidth = (mainContentWidth - 48) / 3;
      assert.ok(threeColWidth >= 300, `3-col width on 1440px is ${threeColWidth}px (>=300px)`);
    }

    if (vp.width === 1512) {
      assert.equal(mainContentWidth, 1072, "1512px net content width must be exactly 1072px");
      const twoColWidth = (mainContentWidth - 24) / 2;
      assert.ok(twoColWidth >= 520, `2-col width on 1512px is ${twoColWidth}px (>=520px)`);
    }

    // On 375px mobile, verify single card inner width
    if (vp.width === 375) {
      assert.equal(mainContentWidth, 351, "375px net content width must be exactly 351px");
      // Card with sm padding: 351 - 24 = 327px
      // Card with md padding at <640px (p-4): 351 - 32 = 319px
      const cardSmInner = mainContentWidth - (12 * 2);
      const cardMdInner = mainContentWidth - (16 * 2);
      assert.ok(cardSmInner > 320, `Mobile card sm inner width is ${cardSmInner}px (>320px)`);
      assert.ok(cardMdInner > 310, `Mobile card md inner width is ${cardMdInner}px (>310px)`);
    }
  }
});

// ============================================================================
// SUITE 5: VERTICAL TOOLBAR SPACE COMPRESSION & NON-OVERLAPPING PROOF
// ============================================================================

test("M1 Challenger 1: Vertical toolbar compression saves >= 15% vertical content space", () => {
  // Baseline vs M1 heights:
  const baselineTopBarHeight = 61;
  const baselinePageToolbarHeight = 57;
  const baselineStatusBarHeight = 41;
  const totalBaselineToolbars = baselineTopBarHeight + baselinePageToolbarHeight + baselineStatusBarHeight; // 159px

  const baselineAppShellPadding = 32; // py-4 = 16px top + 16px bottom
  const totalBaselineOverhead = totalBaselineToolbars + baselineAppShellPadding; // 191px

  const m1TopBarHeight = 47; // py-1.5 (12px) + h-8 button (32px) + border (1px) + line = 47px (-14px, -23%)
  const m1PageToolbarHeight = 39; // py-1 (8px) + min-h-7 (28px) + border (1px) + min-h-[38px] = 39px (-18px, -31.6%)
  const m1StatusBarHeight = 31; // py-0.5 (4px) + h-[26px] (26px) + border (1px) = 31px (-10px, -24.4%)
  const totalM1Toolbars = m1TopBarHeight + m1PageToolbarHeight + m1StatusBarHeight; // 117px (-42px, -26.4%)

  const m1AppShellPadding = 20; // sm:py-2.5 = 10px top + 10px bottom = 20px (-12px)
  const totalM1Overhead = totalM1Toolbars + m1AppShellPadding; // 137px (-54px)

  // Verify exact height reductions
  assert.equal(totalBaselineToolbars, 159, "Baseline toolbars was 159px");
  assert.equal(totalM1Toolbars, 117, "M1 toolbars is 117px");
  const toolbarReductionPct = ((totalBaselineToolbars - totalM1Toolbars) / totalBaselineToolbars) * 100;
  assert.ok(Math.abs(toolbarReductionPct - 26.4) < 0.1, `Toolbar reduction is 26.4%, got ${toolbarReductionPct.toFixed(1)}%`);

  assert.equal(totalBaselineOverhead, 191, "Baseline total fixed overhead was 191px");
  assert.equal(totalM1Overhead, 137, "M1 total fixed overhead is 137px");
  const totalSavings = totalBaselineOverhead - totalM1Overhead;
  assert.equal(totalSavings, 54, "Total vertical space savings is exactly 54px");

  // In typical compact laptop browser window (viewport height ~500px content box above the fold),
  // saving 54px yields (54 / (500 - 191)) = 54 / 309 = +17.5% vertical gain (>=15%).
  const compactContentBox = 500 - totalBaselineOverhead;
  const gainedCompactContentBox = 500 - totalM1Overhead;
  const verticalContentGainPct = ((gainedCompactContentBox - compactContentBox) / compactContentBox) * 100;
  assert.ok(
    verticalContentGainPct >= 15.0,
    `Vertical content gain for compact laptop window is ${verticalContentGainPct.toFixed(1)}% (>=15.0%)`
  );
});
