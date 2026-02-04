/**
 * Solid-specific transform for Vite source inspector
 *
 * Solid.js compiles JSX to _$template tagged templates:
 *   const _tmpl$ = _$template(`<div>Hello</div>`)
 *
 * This transform injects data-inspector attributes into the template strings.
 */

import MagicString from "magic-string";

export interface SolidTransformResult {
  code: string;
  map: ReturnType<MagicString["generateMap"]> | null;
}

/**
 * Transform Solid.js compiled template strings to add data-inspector attributes
 */
export function transformSolidCompiledOutput(
  code: string,
  id: string,
): SolidTransformResult | null {
  // Check for Solid.js compiled patterns
  if (!code.includes("_$template") && !code.includes("_tmpl$")) {
    return null;
  }

  // Skip node_modules (except for testing)
  if (id.includes("node_modules") && !id.includes("solid-js")) {
    return null;
  }

  const s = new MagicString(code);
  let hasChanges = false;
  const cleanPath = id.split("?")[0];

  // Pattern 1: _$template(`<tag>...</tag>`)
  // Match template calls with template literal content
  const templatePattern = /_\$template\s*\(\s*`([^`]+)`\s*\)/g;

  let match;
  while ((match = templatePattern.exec(code)) !== null) {
    const templateContent = match[1];
    const templateStart = match.index + match[0].indexOf("`") + 1;

    // Find the first HTML tag in the template
    const firstTagMatch = /<([a-zA-Z][a-zA-Z0-9-]*)(\s|>)/i.exec(
      templateContent,
    );

    if (firstTagMatch) {
      const tagName = firstTagMatch[1];
      const tagEndInTemplate = firstTagMatch.index + 1 + tagName.length;

      // Calculate line number from the template position in code
      const linesBefore = code.slice(0, match.index).split("\n");
      const lineNumber = linesBefore.length;
      const columnNumber = linesBefore[linesBefore.length - 1].length + 1;

      const inspectorAttr = ` data-inspector="${cleanPath}:${lineNumber}:${columnNumber}"`;

      // Insert into the template string
      const insertPos = templateStart + tagEndInTemplate;
      s.appendLeft(insertPos, inspectorAttr);
      hasChanges = true;
    }
  }

  // Pattern 2: _tmpl$ = _$template(`...`)
  // Some Solid versions use this pattern
  const tmplVarPattern =
    /(const|let|var)\s+_tmpl\$?\d*\s*=\s*\/\*[^*]*\*\/\s*_\$template\s*\(\s*`([^`]+)`\s*\)/g;

  while ((match = tmplVarPattern.exec(code)) !== null) {
    const templateContent = match[2];
    const templateStart = match.index + match[0].indexOf("`") + 1;

    const firstTagMatch = /<([a-zA-Z][a-zA-Z0-9-]*)(\s|>)/i.exec(
      templateContent,
    );

    if (firstTagMatch) {
      const tagName = firstTagMatch[1];
      const tagEndInTemplate = firstTagMatch.index + 1 + tagName.length;

      const linesBefore = code.slice(0, match.index).split("\n");
      const lineNumber = linesBefore.length;
      const columnNumber = linesBefore[linesBefore.length - 1].length + 1;

      const inspectorAttr = ` data-inspector="${cleanPath}:${lineNumber}:${columnNumber}"`;

      const insertPos = templateStart + tagEndInTemplate;
      s.appendLeft(insertPos, inspectorAttr);
      hasChanges = true;
    }
  }

  // Pattern 3: Solid's createComponent calls
  // _$createComponent(Component, { props })
  // We can't easily inject HTML attributes here, but we can add a marker
  // This would be handled by the component's root element instead

  // Pattern 4: Dynamic elements with _$insert
  // These are handled at runtime, so we can't inject at compile time
  // The browser client will use stack trace fallback for these

  if (!hasChanges) {
    return null;
  }

  return {
    code: s.toString(),
    map: s.generateMap({ hires: true }),
  };
}

/**
 * Transform Solid JSX before compilation
 *
 * This adds data-inspector attributes directly to JSX elements.
 */
export function transformSolidJsx(
  code: string,
  id: string,
): SolidTransformResult | null {
  // Only process TSX/JSX files that use Solid
  if (!id.endsWith(".tsx") && !id.endsWith(".jsx")) {
    return null;
  }

  // Check if this is a Solid file (has solid-js import)
  if (
    !code.includes("solid-js") &&
    !code.includes("createSignal") &&
    !code.includes("createEffect")
  ) {
    return null;
  }

  // Skip node_modules
  if (id.includes("node_modules")) {
    return null;
  }

  const s = new MagicString(code);
  let hasChanges = false;
  const cleanPath = id.split("?")[0];

  // Match JSX opening tags
  // This is a simplified pattern - a proper implementation would use a parser
  const jsxPattern = /<([A-Z][a-zA-Z0-9.]*|[a-z][a-z0-9-]*)(\s|>|\/)/g;

  let match;
  while ((match = jsxPattern.exec(code)) !== null) {
    const tagStart = match.index;
    const tagName = match[1];
    const afterTag = match[2];

    // Skip closing tags
    const before = code.slice(Math.max(0, tagStart - 1), tagStart);
    if (before === "/") continue;

    // Skip if inside a string or comment
    // (This is a simplified check - proper implementation needs parser)
    const lineStart = code.lastIndexOf("\n", tagStart) + 1;
    const lineContent = code.slice(lineStart, tagStart);
    if (lineContent.includes("//") || lineContent.includes("/*")) continue;

    // Calculate line and column
    const linesBefore = code.slice(0, tagStart).split("\n");
    const lineNumber = linesBefore.length;
    const columnNumber = linesBefore[linesBefore.length - 1].length + 1;

    const inspectorAttr = ` data-inspector="${cleanPath}:${lineNumber}:${columnNumber}"`;
    const insertIdx = tagStart + 1 + tagName.length;

    s.appendLeft(insertIdx, inspectorAttr);
    hasChanges = true;
  }

  if (!hasChanges) {
    return null;
  }

  return {
    code: s.toString(),
    map: s.generateMap({ hires: true }),
  };
}

/**
 * Combined Solid transform
 */
export function transformSolid(
  code: string,
  id: string,
): SolidTransformResult | null {
  // For compiled output (contains _$template), transform templates
  if (code.includes("_$template") || code.includes("_tmpl$")) {
    return transformSolidCompiledOutput(code, id);
  }

  // For source JSX files, transform before compilation
  // Note: This needs to run BEFORE Solid's JSX transform
  // which is typically handled by vite-plugin-solid
  return transformSolidJsx(code, id);
}
