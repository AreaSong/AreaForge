import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  areaForgeTokens,
  colors,
  heights,
  layers,
  radii,
  shadows,
  transitions,
} from "@areaforge/ui";
import {
  ArticleCard,
  AsideCard,
  Card,
  CardContent,
  CardDescription,
  CardElement,
  CardFooter,
  CardHeader,
  CardPadding,
  CardTitle,
  CardVariant,
  SectionCard,
  cardClassName,
} from "./card";
import {
  ArticleSurface,
  AsideSurface,
  SectionSurface,
  Surface,
  SurfaceElement,
  SurfacePadding,
  SurfaceTone,
  surfaceClassName,
  surfacePaddingClasses,
  surfaceToneClasses,
} from "./surface";

// ============================================================================
// 1. TOKEN INVARIANT ORACLE & STATIC PROPERTY STRESS TESTS
// ============================================================================

test("Stress Oracle: Colors token values are valid hex or rgba format with zero null/undefined", () => {
  const hexRegex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
  const rgbRegex = /^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*[\d\.]+\s*)?\)$/;

  function validateColorTree(obj: Record<string, unknown>, pathPrefix = "colors") {
    for (const [key, value] of Object.entries(obj)) {
      const currentPath = `${pathPrefix}.${key}`;
      if (typeof value === "string") {
        assert.ok(
          value.length > 0,
          `Color at ${currentPath} should not be empty`
        );
        const isValid = hexRegex.test(value) || rgbRegex.test(value);
        assert.ok(
          isValid,
          `Color value "${value}" at ${currentPath} is neither valid hex nor rgb(a)`
        );
      } else if (typeof value === "object" && value !== null) {
        validateColorTree(value as Record<string, unknown>, currentPath);
      } else {
        assert.fail(`Unexpected color token type at ${currentPath}: ${typeof value}`);
      }
    }
  }

  validateColorTree(colors);
});

test("Stress Oracle: Radii, heights, shadows, and layers conform to strict numerical and CSS invariants", () => {
  const unitRegex = /^(\d+(\.\d+)?(px|rem|em)|9999px)$/;

  for (const [k, v] of Object.entries(radii)) {
    assert.ok(
      unitRegex.test(v),
      `Radius "${k}" value "${v}" should have a valid CSS unit (px/rem/em)`
    );
  }

  for (const [k, v] of Object.entries(heights)) {
    assert.ok(
      unitRegex.test(v),
      `Height "${k}" value "${v}" should have a valid CSS unit`
    );
  }

  for (const [k, v] of Object.entries(shadows)) {
    assert.ok(
      typeof v === "string" && v.length > 0,
      `Shadow "${k}" must be a non-empty string`
    );
    assert.ok(
      !v.includes("undefined") && !v.includes("null"),
      `Shadow "${k}" contains invalid literal`
    );
  }

  // Verify layer monotonic order & type
  const layerValues = Object.entries(layers);
  for (const [k, v] of layerValues) {
    assert.equal(typeof v, "number", `Layer "${k}" must be numeric`);
    assert.ok(Number.isInteger(v) && v > 0, `Layer "${k}" must be positive integer`);
  }
  assert.ok(layers.shellBase < layers.modal);
  assert.ok(layers.modal < layers.critical);

  // Verify transitions
  for (const [k, v] of Object.entries(transitions)) {
    assert.ok(typeof v === "string" && v.length > 0, `Transition "${k}" must be non-empty string`);
  }
});

test("Stress Oracle: Legacy areaForgeTokens structure and aliases never return undefined", () => {
  assert.equal(areaForgeTokens.colors, colors);
  assert.equal(areaForgeTokens.radius, radii);
  assert.equal(areaForgeTokens.shadows, shadows);
  assert.equal(areaForgeTokens.heights, heights);
  assert.equal(areaForgeTokens.layers, layers);
  assert.equal(areaForgeTokens.transitions, transitions);
  assert.equal(areaForgeTokens.accent, colors.accent);

  // Check critical legacy keys
  assert.equal(areaForgeTokens.radius.sm, "6px");
  assert.equal(areaForgeTokens.radius.md, "8px");
  assert.equal(areaForgeTokens.accent.forge, "#14b8a6");
  assert.equal(areaForgeTokens.accent.warning, "#f59e0b");
  assert.equal(areaForgeTokens.accent.danger, "#ef4444");
  assert.equal(areaForgeTokens.accent.progress, "#38bdf8");
});

// ============================================================================
// 2. CSS VARIABLES & GLOBALS.CSS VERIFICATION
// ============================================================================

test("Stress Verification: globals.css contains exact token bindings and @source config", () => {
  const cssPath = path.resolve(process.cwd(), "app/globals.css");
  assert.ok(fs.existsSync(cssPath), "apps/web/app/globals.css must exist");

  const css = fs.readFileSync(cssPath, "utf-8");

  // Check UI source scanning for Tailwind v4
  assert.ok(
    css.includes('@source "../../../packages/ui/src"'),
    "globals.css must include @source directive for packages/ui/src"
  );

  // Check required custom properties in :root
  const requiredVars = [
    "--af-canvas: #080b0f;",
    "--af-surface-card: #0e1619;",
    "--af-surface-card-alpha: rgba(14, 22, 25, 0.90);",
    "--af-surface-subtle: rgba(255, 255, 255, 0.02);",
    "--af-radius-card: 1rem;",
    "--af-radius-control: 0.75rem;",
    "--af-shadow-teal-glow: 0 0 20px rgba(45, 212, 191, 0.35);",
    "--af-shadow-teal-glow-hover: 0 0 28px rgba(45, 212, 191, 0.50);",
  ];

  for (const v of requiredVars) {
    assert.ok(css.includes(v), `globals.css must contain "${v}"`);
  }

  // Check @theme inline mappings
  assert.ok(css.includes("--color-af-canvas: var(--af-canvas);"));
  assert.ok(css.includes("--color-af-surface-card: var(--af-surface-card);"));
  assert.ok(css.includes("--color-af-surface-subtle: var(--af-surface-subtle);"));
  assert.ok(css.includes("--radius-af-card: var(--af-radius-card);"));
  assert.ok(css.includes("--radius-af-control: var(--af-radius-control);"));
  assert.ok(css.includes("--shadow-af-teal-glow: var(--af-shadow-teal-glow);"));
});

// ============================================================================
// 3. CARD CLASSNAME GENERATOR & BOUNDARY STRESS TESTS
// ============================================================================

test("Stress Test: cardClassName exhaustive Cartesian product (variants x paddings)", () => {
  const variants: CardVariant[] = ["master", "subtle", "accent"];
  const paddings: CardPadding[] = ["none", "sm", "md", "lg"];

  for (const variant of variants) {
    for (const padding of paddings) {
      const cls = cardClassName({ variant, padding });
      assert.ok(cls.startsWith("min-w-0"), `Class should start with min-w-0 for ${variant}/${padding}`);
      assert.ok(!cls.includes("undefined"), `Class should not contain "undefined" for ${variant}/${padding}`);
      assert.ok(!cls.includes("  "), `Class should not contain double spaces for ${variant}/${padding}`);

      if (variant === "master") {
        assert.ok(cls.includes("rounded-2xl") && cls.includes("bg-[#0e1619]/90") && cls.includes("border-white/10") && cls.includes("shadow-lg"));
      } else if (variant === "subtle") {
        assert.ok(cls.includes("rounded-xl") && cls.includes("border-white/5") && cls.includes("bg-white/[0.02]"));
      } else if (variant === "accent") {
        assert.ok(cls.includes("rounded-2xl") && cls.includes("border-teal-500/20") && cls.includes("shadow-[0_0_16px_rgba(45,212,191,0.15)]"));
      }

      if (padding === "none") {
        assert.ok(!cls.includes("p-3") && !cls.includes("p-4") && !cls.includes("p-5"));
      } else if (padding === "sm") {
        assert.ok(cls.includes("p-3 sm:p-4"));
      } else if (padding === "md") {
        assert.ok(cls.includes("p-4 sm:p-5"));
      } else if (padding === "lg") {
        assert.ok(cls.includes("p-5 sm:p-6 lg:p-8"));
      }
    }
  }
});

test("Stress Test: cardClassName boundary, undefined, and malformed inputs", () => {
  // Empty invocation
  const def = cardClassName();
  assert.equal(def, "min-w-0 rounded-2xl border border-white/10 bg-[#0e1619]/90 shadow-lg p-4 sm:p-5");

  // Undefined props
  const undef = cardClassName({ variant: undefined, padding: undefined, className: undefined });
  assert.equal(undef, def);

  // Invalid / unknown variant fallback
  const invalidVariant = cardClassName({ variant: "super-card" as unknown as CardVariant });
  assert.ok(invalidVariant.includes("rounded-2xl"), "Invalid variant should cleanly fall back to master");
  assert.ok(!invalidVariant.includes("undefined"));

  // Invalid / unknown padding fallback
  const invalidPadding = cardClassName({ padding: "colossal" as unknown as CardPadding });
  assert.ok(invalidPadding.includes("p-4 sm:p-5"), "Invalid padding should cleanly fall back to md");
  assert.ok(!invalidPadding.includes("undefined"));

  // Malformed className with excessive whitespace, tabs, and newlines
  const messy = cardClassName({
    className: "   custom-1 \t  custom-2  \n custom-3   ",
  });
  assert.ok(messy.endsWith("custom-1 custom-2 custom-3"));
  assert.ok(!messy.includes("  "));
  assert.ok(!messy.includes("\t"));
  assert.ok(!messy.includes("\n"));
});

// ============================================================================
// 4. SURFACE CLASSNAME GENERATOR & BOUNDARY STRESS TESTS
// ============================================================================

test("Stress Test: surfaceClassName exhaustive Cartesian product and fallbacks", () => {
  const tones: SurfaceTone[] = ["subtle", "default", "raised", "card", "canvas"];
  const paddings: SurfacePadding[] = ["none", "sm", "md", "lg"];

  for (const tone of tones) {
    for (const padding of paddings) {
      const cls = surfaceClassName({ tone, padding });
      assert.ok(cls.startsWith("min-w-0 rounded-[var(--af-radius-surface)] border border-[var(--af-border)]"));
      assert.ok(!cls.includes("undefined"));
      assert.ok(!cls.includes("  "));
      assert.ok(cls.includes(surfaceToneClasses[tone]));
      if (padding !== "none") {
        assert.ok(cls.includes(surfacePaddingClasses[padding]));
      }
    }
  }

  // Fallbacks
  const def = surfaceClassName();
  assert.equal(def, "min-w-0 rounded-[var(--af-radius-surface)] border border-[var(--af-border)] bg-[var(--af-surface)] p-4 sm:p-5");

  const invalidTone = surfaceClassName({ tone: "unknown-tone" as unknown as SurfaceTone });
  assert.ok(invalidTone.includes("bg-[var(--af-surface)]"), "Invalid tone should fall back to default");

  const invalidPadding = surfaceClassName({ padding: "unknown-padding" as unknown as SurfacePadding });
  assert.ok(invalidPadding.includes("p-4 sm:p-5"), "Invalid padding should fall back to md");
});

// ============================================================================
// 5. REACT ELEMENT & POLYMORPHISM STRESS TESTS
// ============================================================================

test("Stress Test: Card polymorphic 'as' element rendering across all allowed tags", () => {
  const tags: CardElement[] = ["div", "section", "article", "aside", "header", "footer"];

  for (const tag of tags) {
    const el = Card({
      as: tag,
      variant: "subtle",
      padding: "sm",
      id: `card-${tag}`,
      title: `title-${tag}`,
      role: "region",
      "aria-label": `Card label ${tag}`,
      children: `Content for ${tag}`,
    });

    assert.equal(el.type, tag);
    assert.equal(el.props.id, `card-${tag}`);
    assert.equal(el.props.title, `title-${tag}`);
    assert.equal(el.props.role, "region");
    assert.equal(el.props["aria-label"], `Card label ${tag}`);
    assert.equal(el.props.children, `Content for ${tag}`);
    assert.ok(el.props.className.includes("rounded-xl"));
    assert.ok(el.props.className.includes("p-3 sm:p-4"));
  }
});

test("Stress Test: Surface polymorphic 'as' element rendering across all allowed tags", () => {
  const tags: SurfaceElement[] = ["div", "section", "article", "aside", "header", "footer"];

  for (const tag of tags) {
    const el = Surface({
      as: tag,
      tone: "canvas",
      padding: "lg",
      id: `surface-${tag}`,
      role: "region",
      "aria-label": `Surface ${tag}`,
      children: `Surface text ${tag}`,
    });

    assert.equal(el.type, tag);
    assert.equal(el.props.id, `surface-${tag}`);
    assert.equal(el.props.role, "region");
    assert.equal(el.props["aria-label"], `Surface ${tag}`);
    assert.ok(el.props.className.includes("bg-[var(--af-canvas)]"));
    assert.ok(el.props.className.includes("p-5 sm:p-6 lg:p-8"));
  }
});

test("Stress Test: Native HTML attribute spreading and event handler support on Card & Surface", () => {
  let clicked = false;
  const clickHandler = () => { clicked = true; };

  const card = Card({
    id: "attr-test-card",
    tabIndex: 0,
    role: "dialog",
    title: "Card Dialog",
    "aria-modal": true,
    "aria-labelledby": "dialog-title",
    onClick: clickHandler,
    children: "Interactive Card",
  });

  assert.equal(card.props.id, "attr-test-card");
  assert.equal(card.props.tabIndex, 0);
  assert.equal(card.props.role, "dialog");
  assert.equal(card.props.title, "Card Dialog");
  assert.equal(card.props["aria-modal"], true);
  assert.equal(card.props["aria-labelledby"], "dialog-title");
  assert.equal(card.props.onClick, clickHandler);
  card.props.onClick();
  assert.equal(clicked, true);

  const surface = Surface({
    id: "attr-test-surface",
    role: "group",
    title: "Surface Group",
    "aria-expanded": true,
    onClick: clickHandler,
    children: "Interactive Surface",
  });

  assert.equal(surface.props.id, "attr-test-surface");
  assert.equal(surface.props.role, "group");
  assert.equal(surface.props.title, "Surface Group");
  assert.equal(surface.props["aria-expanded"], true);
  assert.equal(surface.props.onClick, clickHandler);
});

test("Stress Test: Deeply nested Card and Subcomponent tree construction", () => {
  // Build a complex nested layout
  const tree = Card({
    as: "section",
    variant: "master",
    padding: "none",
    className: "overflow-hidden",
    children: [
      CardHeader({
        className: "p-6 border-b border-white/5",
        children: [
          CardTitle({ id: "section-title", children: "Master Workstation Card" }),
          CardDescription({ children: "High-texture dark glass container with ergonomic hierarchy" }),
        ],
      }),
      CardContent({
        className: "p-6 space-y-4",
        children: [
          Card({
            as: "article",
            variant: "subtle",
            padding: "sm",
            children: "Nested Subtle Card",
          }),
          Card({
            as: "aside",
            variant: "accent",
            padding: "md",
            children: "Nested Accent Glowing Card",
          }),
        ],
      }),
      CardFooter({
        className: "p-6 border-t border-white/5 justify-end",
        children: "Action Footer",
      }),
    ],
  });

  assert.equal(tree.type, "section");
  assert.ok(tree.props.className.includes("rounded-2xl"));
  assert.ok(tree.props.className.includes("overflow-hidden"));
  assert.equal(tree.props.children.length, 3);

  // Validate header
  const header = tree.props.children[0];
  assert.equal(header.type, "div");
  assert.ok(header.props.className.includes("space-y-1.5"));
  assert.ok(header.props.className.includes("border-b"));

  // Validate title
  const title = header.props.children[0];
  assert.equal(title.type, "h3");
  assert.equal(title.props.id, "section-title");
  assert.ok(title.props.className.includes("text-base font-semibold"));

  // Validate nested content
  const content = tree.props.children[1];
  assert.equal(content.type, "div");
  assert.equal(content.props.children.length, 2);
  const nestedSubtle = content.props.children[0];
  assert.equal(nestedSubtle.type, "article");
  assert.ok(nestedSubtle.props.className.includes("rounded-xl"));
  assert.ok(nestedSubtle.props.className.includes("bg-white/[0.02]"));
  assert.ok(nestedSubtle.props.className.includes("p-3 sm:p-4"));

  const nestedAccent = content.props.children[1];
  assert.equal(nestedAccent.type, "aside");
  assert.ok(nestedAccent.props.className.includes("rounded-2xl"));
  assert.ok(nestedAccent.props.className.includes("border-teal-500/20"));
  assert.ok(nestedAccent.props.className.includes("shadow-[0_0_16px_rgba(45,212,191,0.15)]"));
  assert.ok(nestedAccent.props.className.includes("p-4 sm:p-5"));
});

test("Stress Test: Semantic helper components forward all props identically", () => {
  const secCard = SectionCard({ id: "sec-1", variant: "accent", padding: "lg", className: "custom-sec" });
  assert.equal(secCard.type, Card);
  assert.equal(secCard.props.as, "section");
  assert.equal(secCard.props.variant, "accent");
  assert.equal(secCard.props.padding, "lg");
  assert.equal(secCard.props.id, "sec-1");
  assert.equal(secCard.props.className, "custom-sec");

  const artCard = ArticleCard({ id: "art-1", variant: "subtle", padding: "none" });
  assert.equal(artCard.type, Card);
  assert.equal(artCard.props.as, "article");
  assert.equal(artCard.props.variant, "subtle");

  const asdCard = AsideCard({ id: "asd-1", variant: "master" });
  assert.equal(asdCard.type, Card);
  assert.equal(asdCard.props.as, "aside");

  const secSurf = SectionSurface({ id: "surf-sec-1", tone: "card", padding: "sm" });
  assert.equal(secSurf.type, Surface);
  assert.equal(secSurf.props.as, "section");
  assert.equal(secSurf.props.tone, "card");

  const artSurf = ArticleSurface({ id: "surf-art-1", tone: "raised" });
  assert.equal(artSurf.type, Surface);
  assert.equal(artSurf.props.as, "article");

  const asdSurf = AsideSurface({ id: "surf-asd-1", tone: "subtle" });
  assert.equal(asdSurf.type, Surface);
  assert.equal(asdSurf.props.as, "aside");
});
