/**
 * Svelte-specific transform for Vite source inspector
 *
 * Svelte compiles templates to imperative DOM creation code like:
 *   div = element("div");
 *   set_attributes(div, { class: "foo" });
 *
 * This transform injects data-inspector attributes after element creation.
 */

import MagicString from "magic-string";

export interface SvelteTransformResult {
  code: string;
  map: ReturnType<MagicString["generateMap"]> | null;
}

/**
 * Transform Svelte compiled output to add data-inspector attributes
 *
 * Svelte 4/5 compile templates to:
 * - element("tagname") for DOM elements
 * - text(value) for text nodes
 * - component(Component, props) for child components
 */
export function transformSvelteCompiledOutput(
  code: string,
  id: string,
): SvelteTransformResult | null {
  // Only process Svelte files
  if (!id.includes(".svelte")) {
    return null;
  }

  const s = new MagicString(code);
  let hasChanges = false;
  const cleanPath = id.split("?")[0];

  // Pattern 1: Svelte 4 style - variable = element("tag")
  // Example: div = element("div");
  const elementPattern = /(\w+)\s*=\s*element\s*\(\s*["']([^"']+)["']\s*\)/g;

  let match;
  while ((match = elementPattern.exec(code)) !== null) {
    const varName = match[1];
    const tagName = match[2];
    const statementEnd = code.indexOf(";", match.index + match[0].length);

    if (statementEnd === -1) continue;

    // Calculate line number
    const linesBefore = code.slice(0, match.index).split("\n");
    const lineNumber = linesBefore.length;
    const columnNumber = linesBefore[linesBefore.length - 1].length + 1;

    // Insert setAttribute call after the element creation
    const attrCall = `\n\t${varName}.setAttribute("data-inspector", "${cleanPath}:${lineNumber}:${columnNumber}");`;
    s.appendRight(statementEnd + 1, attrCall);
    hasChanges = true;
  }

  // Pattern 2: Svelte 5 runes style - $.element("tag")
  // Example: var div = $.element("div");
  const runesElementPattern =
    /(var|let|const)\s+(\w+)\s*=\s*\$\s*\.\s*element\s*\(\s*["']([^"']+)["']\s*\)/g;

  while ((match = runesElementPattern.exec(code)) !== null) {
    const varName = match[2];
    const tagName = match[3];
    const statementEnd = code.indexOf(";", match.index + match[0].length);

    if (statementEnd === -1) continue;

    const linesBefore = code.slice(0, match.index).split("\n");
    const lineNumber = linesBefore.length;
    const columnNumber = linesBefore[linesBefore.length - 1].length + 1;

    const attrCall = `\n\t${varName}.setAttribute("data-inspector", "${cleanPath}:${lineNumber}:${columnNumber}");`;
    s.appendRight(statementEnd + 1, attrCall);
    hasChanges = true;
  }

  // Pattern 3: template() function for static HTML
  // Example: var root = $.template(`<div>...</div>`);
  // These create template elements, we need to handle differently
  const templatePattern =
    /(var|let|const)\s+(\w+)\s*=\s*\$?\s*\.?\s*template\s*\(\s*`([^`]+)`\s*\)/g;

  while ((match = templatePattern.exec(code)) !== null) {
    const varName = match[2];
    let templateContent = match[3];
    const templateStart = match.index + match[0].indexOf("`") + 1;

    // Inject data-inspector into the first element of the template
    const firstTagMatch = /<([a-zA-Z][a-zA-Z0-9-]*)(\s|>)/i.exec(
      templateContent,
    );
    if (firstTagMatch) {
      const tagName = firstTagMatch[1];
      const afterTag = firstTagMatch[2];
      const tagEnd = firstTagMatch.index + 1 + tagName.length;

      const linesBefore = code.slice(0, match.index).split("\n");
      const lineNumber = linesBefore.length;
      const columnNumber = linesBefore[linesBefore.length - 1].length + 1;

      const inspectorAttr = ` data-inspector="${cleanPath}:${lineNumber}:${columnNumber}"`;

      // Insert the attribute into the template string
      const insertPos = templateStart + tagEnd;
      s.appendLeft(insertPos, inspectorAttr);
      hasChanges = true;
    }
  }

  // Pattern 4: open() calls for dynamic element creation
  // Example: $.open(node, "div", false);
  const openPattern =
    /\$\s*\.\s*open\s*\(\s*(\w+)\s*,\s*["']([^"']+)["']\s*,/g;

  while ((match = openPattern.exec(code)) !== null) {
    const nodeVar = match[1];
    const tagName = match[2];
    const callEnd = code.indexOf(";", match.index + match[0].length);

    if (callEnd === -1) continue;

    const linesBefore = code.slice(0, match.index).split("\n");
    const lineNumber = linesBefore.length;
    const columnNumber = linesBefore[linesBefore.length - 1].length + 1;

    // After $.open, the node variable contains the element
    const attrCall = `\n\tif (${nodeVar}) ${nodeVar}.setAttribute("data-inspector", "${cleanPath}:${lineNumber}:${columnNumber}");`;
    s.appendRight(callEnd + 1, attrCall);
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
 * Transform Svelte template before compilation (for .svelte files)
 *
 * This adds data-inspector attributes directly to the template HTML.
 */
export function transformSvelteTemplate(
  code: string,
  id: string,
): SvelteTransformResult | null {
  if (!id.endsWith(".svelte")) {
    return null;
  }

  // Check if this is uncompiled Svelte (has HTML-like content)
  if (!code.includes("<") || code.includes("function create_fragment")) {
    return null;
  }

  const s = new MagicString(code);
  let hasChanges = false;
  const cleanPath = id.split("?")[0];

  // Find script and style sections to skip
  const scriptMatch = /<script[^>]*>[\s\S]*?<\/script>/gi;
  const styleMatch = /<style[^>]*>[\s\S]*?<\/style>/gi;

  const skipRanges: Array<{ start: number; end: number }> = [];

  let scriptM;
  while ((scriptM = scriptMatch.exec(code)) !== null) {
    skipRanges.push({
      start: scriptM.index,
      end: scriptM.index + scriptM[0].length,
    });
  }

  let styleM;
  while ((styleM = styleMatch.exec(code)) !== null) {
    skipRanges.push({
      start: styleM.index,
      end: styleM.index + styleM[0].length,
    });
  }

  const isInSkipRange = (pos: number): boolean => {
    return skipRanges.some((range) => pos >= range.start && pos < range.end);
  };

  // Find all opening tags in the template portion
  const tagPattern = /<([a-zA-Z][a-zA-Z0-9:-]*)(\s|>)/g;

  let tagMatch;
  while ((tagMatch = tagPattern.exec(code)) !== null) {
    // Skip if in script or style section
    if (isInSkipRange(tagMatch.index)) {
      continue;
    }

    const tagName = tagMatch[1];

    // Skip script, style, svelte:* special tags
    if (
      tagName === "script" ||
      tagName === "style" ||
      tagName.startsWith("svelte:")
    ) {
      continue;
    }

    const afterTag = tagMatch[2];
    const insertIdx = tagMatch.index + 1 + tagName.length;

    // Calculate line number
    const linesBefore = code.slice(0, tagMatch.index).split("\n");
    const lineNumber = linesBefore.length;
    const columnNumber = linesBefore[linesBefore.length - 1].length + 1;

    const inspectorAttr = ` data-inspector="${cleanPath}:${lineNumber}:${columnNumber}"`;

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
 * Combined Svelte transform
 */
export function transformSvelte(
  code: string,
  id: string,
): SvelteTransformResult | null {
  // For raw .svelte files, transform the template
  if (id.endsWith(".svelte") && !id.includes("?")) {
    const templateResult = transformSvelteTemplate(code, id);
    if (templateResult) {
      return templateResult;
    }
  }

  // For compiled output, inject after element creation
  return transformSvelteCompiledOutput(code, id);
}
