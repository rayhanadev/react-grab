/**
 * React-specific transform for Vite source inspector
 *
 * This module handles:
 * 1. Patching jsx-dev-runtime to restore _debugSource (broken in React 19)
 * 2. Injecting data-inspector attributes into JSX elements
 */

import MagicString from "magic-string";

export interface ReactTransformResult {
  code: string;
  map: ReturnType<MagicString["generateMap"]> | null;
}

/**
 * Patch React's jsx-dev-runtime to preserve _debugSource on fiber nodes
 *
 * React 19 removed _debugSource from fibers, breaking click-to-source functionality.
 * This patch restores it by modifying the jsxDEV function.
 */
export function patchJsxDevRuntime(
  code: string,
  id: string,
): ReactTransformResult | null {
  // Only patch the jsx-dev-runtime module
  if (
    !id.includes("react/jsx-dev-runtime") &&
    !id.includes("react/jsx-runtime")
  ) {
    return null;
  }

  const s = new MagicString(code);
  let hasChanges = false;

  // Pattern 1: React 19+ where _debugInfo is set to null
  // Find: value: null (in _debugInfo context)
  // Replace: value: source
  const debugInfoNullPattern = /(_debugInfo[^}]*?)value:\s*null/g;
  let match;

  while ((match = debugInfoNullPattern.exec(code)) !== null) {
    const fullMatch = match[0];
    const prefix = match[1];
    const startIdx = match.index;
    const endIdx = startIdx + fullMatch.length;

    // Replace 'value: null' with 'value: source'
    s.overwrite(startIdx, endIdx, `${prefix}value: source`);
    hasChanges = true;
  }

  // Pattern 2: For React 18 and earlier, ensure _debugSource is set
  // Look for where jsxDEV creates elements and ensure source is passed through
  const jsxDevPattern =
    /function\s+jsxDEV\s*\([^)]*source[^)]*\)\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}/g;

  while ((match = jsxDevPattern.exec(code)) !== null) {
    const funcBody = match[1];

    // Check if _debugSource is already being set
    if (!funcBody.includes("_debugSource")) {
      // Find the return statement or element creation
      const returnMatch = /return\s+\{([^}]+)\}/g.exec(funcBody);
      if (returnMatch) {
        const returnIdx = match.index + match[0].indexOf(returnMatch[0]);
        const insertIdx = returnIdx + returnMatch[0].length - 1;

        // Add _debugSource to the returned object
        s.appendLeft(insertIdx, ", _debugSource: source");
        hasChanges = true;
      }
    }
  }

  // Pattern 3: Patch ReactElement creation to include source
  // In React 19, look for ReactElement or element creation patterns
  const reactElementPattern =
    /ReactElement\s*\(\s*type\s*,\s*key\s*,\s*ref\s*,\s*owner\s*,\s*props\s*\)/g;

  while ((match = reactElementPattern.exec(code)) !== null) {
    // Check if there's a source parameter nearby that could be passed
    const context = code.slice(
      Math.max(0, match.index - 200),
      match.index + match[0].length + 50,
    );
    if (context.includes("source") && !context.includes("_debugSource")) {
      // The function has a source parameter, ensure it's used
      const endIdx = match.index + match[0].length;
      s.appendRight(endIdx, "\n  element._debugSource = source;");
      hasChanges = true;
    }
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
 * Inject data-inspector attribute into JSX elements
 *
 * This transforms JSX to include source location data attributes:
 * <div> becomes <div data-inspector="/path/file.tsx:10:5">
 */
export function injectReactSourceAttributes(
  code: string,
  id: string,
): ReactTransformResult | null {
  // Skip node_modules and non-JSX files
  if (id.includes("node_modules")) {
    return null;
  }

  if (!id.endsWith(".tsx") && !id.endsWith(".jsx")) {
    return null;
  }

  const s = new MagicString(code);
  let hasChanges = false;

  // Match JSX opening tags - simplified pattern for common cases
  // This handles: <div, <Component, <div.something, etc.
  const jsxOpeningPattern = /<([A-Z][a-zA-Z0-9.]*|[a-z][a-z0-9-]*)(\s|>|\/)/g;

  let match;
  while ((match = jsxOpeningPattern.exec(code)) !== null) {
    const tagStart = match.index;
    const tagName = match[1];
    const afterTag = match[2];

    // Skip if it's a closing tag context
    const before = code.slice(Math.max(0, tagStart - 1), tagStart);
    if (before === "/") continue;

    // Find line and column number
    const linesBefore = code.slice(0, tagStart).split("\n");
    const lineNumber = linesBefore.length;
    const columnNumber = linesBefore[linesBefore.length - 1].length + 1;

    // Create the data-inspector attribute
    const inspectorAttr = ` data-inspector="${id}:${lineNumber}:${columnNumber}"`;

    // Insert after the tag name
    const insertIdx = tagStart + 1 + tagName.length;

    // Only insert if there's a space or the tag is self-closing
    if (afterTag === " " || afterTag === "/" || afterTag === ">") {
      s.appendLeft(insertIdx, inspectorAttr);
      hasChanges = true;
    }
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
 * Combined React transform that handles both runtime patching and source injection
 */
export function transformReact(
  code: string,
  id: string,
): ReactTransformResult | null {
  // Try jsx-dev-runtime patching first
  const runtimePatch = patchJsxDevRuntime(code, id);
  if (runtimePatch) {
    return runtimePatch;
  }

  // For source files, inject data-inspector attributes
  // Note: This is optional - bippy/fiber traversal is more accurate for React
  // Uncomment if you want attribute-based source resolution as fallback
  // return injectReactSourceAttributes(code, id);

  return null;
}
