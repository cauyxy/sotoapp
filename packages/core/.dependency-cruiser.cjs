// dependency-cruiser config for @soto/core — enforces the internal layering:
//   foundation -> contract -> capabilities -> domain   (downward only)
//
// Resolver options are mandatory: @soto/core source uses the TS extension-
// rewrite convention — `.ts` files import sibling modules with a `.js`
// specifier (e.g. "../foundation/chord/chord.js") while there are ZERO `.js`
// files under src/. Without the extensionAlias below, dependency-cruiser's
// default resolver reports "module not found" on every edge, turning the
// "0 violations" result into a false pass. See spec §5.

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment:
        "Circular dependencies break the layered architecture and make modules impossible to reason about in isolation.",
      from: {},
      to: { circular: true },
    },
    {
      name: "foundation-no-upward",
      severity: "error",
      comment:
        "foundation is layer 1 (pure): it must not import contract, capabilities, or domain.",
      from: { path: "^src/foundation/" },
      to: { path: "^src/(contract|capabilities|domain)/" },
    },
    {
      name: "contract-no-upward",
      severity: "error",
      comment:
        "contract is layer 2: it may import foundation only, never capabilities or domain.",
      from: { path: "^src/contract/" },
      to: { path: "^src/(capabilities|domain)/" },
    },
    {
      name: "capabilities-no-upward",
      severity: "error",
      comment:
        "capabilities is layer 3: it may import contract + foundation, never domain.",
      from: { path: "^src/capabilities/" },
      to: { path: "^src/domain/" },
    },
  ],
  options: {
    // Make the resolver understand @soto/core's TS extension-rewrite convention
    // (.ts source importing ".js" specifiers) — without this every internal
    // edge would be a false "module not found". See spec §5.
    //
    // NOTE: spec §5 also listed `extensionAlias: { ".js": [".ts", ".js"] }`,
    // but dependency-cruiser's config schema (`additionalProperties: false` on
    // enhancedResolveOptions, in every published 16.x/17.x) rejects that key.
    // The tsConfig-driven resolver + `extensions: [".ts", ".js"]` already maps
    // the ".js" specifiers onto the ".ts" sources — verified by the §5 smoke
    // check: `depcruise src --output-type json` reports 52 analyzed modules /
    // 99 deps with ZERO unresolved edges, so "0 violations" is a real pass.
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      extensions: [".ts", ".js"],
    },
  },
};
