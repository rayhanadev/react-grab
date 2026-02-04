/**
 * Vue-specific transform for Vite source inspector
 *
 * This module handles injecting data-inspector attributes into Vue SFC templates.
 * Two strategies are used:
 * 1. Transform the compiled render function output (more reliable)
 * 2. Parse and transform the template directly (alternative approach)
 */

import MagicString from "magic-string";

export interface VueTransformResult {
  code: string;
  map: ReturnType<MagicString["generateMap"]> | null;
}

/**
 * Inject data-inspector attributes into compiled Vue render functions
 *
 * Vue compiles templates to render functions like:
 * _createElementVNode("div", { class: "foo" }, ...)
 *
 * This transform adds data-inspector to the props object.
 */
export function transformVueCompiledOutput(
  code: string,
  id: string,
): VueTransformResult | null {
  // Only process Vue files or their compiled output
  if (!id.includes(".vue")) {
    return null;
  }

  const s = new MagicString(code);
  let hasChanges = false;

  // Clean the file path for the attribute
  const cleanPath = id.split("?")[0];

  // Pattern 1: _createElementVNode("tag", props, children)
  // We need to inject data-inspector into the props object
  const createElementPattern =
    /_createElementVNode\s*\(\s*["']([^"']+)["']\s*,\s*(\{[^}]*\}|null)/g;

  let match;
  while ((match = createElementPattern.exec(code)) !== null) {
    const tagName = match[1];
    const propsArg = match[2];
    const propsStart = match.index + match[0].indexOf(propsArg);
    const propsEnd = propsStart + propsArg.length;

    // Estimate line number from position in code
    const linesBefore = code.slice(0, match.index).split("\n");
    const lineNumber = linesBefore.length;
    const columnNumber = linesBefore[linesBefore.length - 1].length + 1;

    const inspectorValue = `"${cleanPath}:${lineNumber}:${columnNumber}"`;

    if (propsArg === "null") {
      // Replace null with object containing data-inspector
      s.overwrite(
        propsStart,
        propsEnd,
        `{ "data-inspector": ${inspectorValue} }`,
      );
      hasChanges = true;
    } else {
      // Add data-inspector to existing props object
      // Insert after the opening brace
      const insertIdx = propsStart + 1;
      s.appendRight(insertIdx, ` "data-inspector": ${inspectorValue},`);
      hasChanges = true;
    }
  }

  // Pattern 2: _createVNode for components
  const createVNodePattern =
    /_createVNode\s*\(\s*([^,]+)\s*,\s*(\{[^}]*\}|null)/g;

  while ((match = createVNodePattern.exec(code)) !== null) {
    const propsArg = match[2];
    const propsStart = match.index + match[0].indexOf(propsArg);
    const propsEnd = propsStart + propsArg.length;

    const linesBefore = code.slice(0, match.index).split("\n");
    const lineNumber = linesBefore.length;
    const columnNumber = linesBefore[linesBefore.length - 1].length + 1;

    const inspectorValue = `"${cleanPath}:${lineNumber}:${columnNumber}"`;

    if (propsArg === "null") {
      s.overwrite(
        propsStart,
        propsEnd,
        `{ "data-inspector": ${inspectorValue} }`,
      );
      hasChanges = true;
    } else {
      const insertIdx = propsStart + 1;
      s.appendRight(insertIdx, ` "data-inspector": ${inspectorValue},`);
      hasChanges = true;
    }
  }

  // Pattern 3: openBlock() + createElementBlock() pattern
  const createBlockPattern =
    /_createElementBlock\s*\(\s*["']([^"']+)["']\s*,\s*(\{[^}]*\}|null)/g;

  while ((match = createBlockPattern.exec(code)) !== null) {
    const propsArg = match[2];
    const propsStart = match.index + match[0].indexOf(propsArg);
    const propsEnd = propsStart + propsArg.length;

    const linesBefore = code.slice(0, match.index).split("\n");
    const lineNumber = linesBefore.length;
    const columnNumber = linesBefore[linesBefore.length - 1].length + 1;

    const inspectorValue = `"${cleanPath}:${lineNumber}:${columnNumber}"`;

    if (propsArg === "null") {
      s.overwrite(
        propsStart,
        propsEnd,
        `{ "data-inspector": ${inspectorValue} }`,
      );
      hasChanges = true;
    } else {
      const insertIdx = propsStart + 1;
      s.appendRight(insertIdx, ` "data-inspector": ${inspectorValue},`);
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
 * Transform Vue SFC template before compilation
 *
 * This is an alternative approach that adds data-inspector attributes
 * directly to the template HTML. It runs before the Vue compiler.
 *
 * Note: This requires running BEFORE vite-plugin-vue transforms the file.
 */
export function transformVueTemplate(
  code: string,
  id: string,
): VueTransformResult | null {
  if (!id.endsWith(".vue")) {
    return null;
  }

  // Extract template section
  const templateMatch = /<template[^>]*>([\s\S]*?)<\/template>/i.exec(code);
  if (!templateMatch) {
    return null;
  }

  const templateStart =
    templateMatch.index + templateMatch[0].indexOf(">") + 1;
  const templateContent = templateMatch[1];
  const cleanPath = id.split("?")[0];

  const s = new MagicString(code);
  let hasChanges = false;

  // Find all opening tags in the template
  // Match: <tagname or <TagName (but not </ for closing tags)
  const tagPattern = /<([a-zA-Z][a-zA-Z0-9-]*)(\s|>)/g;

  let tagMatch;
  while ((tagMatch = tagPattern.exec(templateContent)) !== null) {
    const tagName = tagMatch[1];
    const afterTag = tagMatch[2];
    const tagPosition = templateStart + tagMatch.index;

    // Calculate line number within the template
    const contentBefore = templateContent.slice(0, tagMatch.index);
    const linesBefore = contentBefore.split("\n");

    // Add line offset for lines before <template>
    const templateLineOffset = code.slice(0, templateStart).split("\n").length;
    const lineNumber = templateLineOffset + linesBefore.length - 1;
    const columnNumber = linesBefore[linesBefore.length - 1].length + 1;

    // Create the data-inspector attribute
    const inspectorAttr = ` data-inspector="${cleanPath}:${lineNumber}:${columnNumber}"`;

    // Calculate actual position in the full code
    const insertIdx = tagPosition + 1 + tagName.length;

    if (afterTag === " ") {
      // There are other attributes, insert before them
      s.appendLeft(insertIdx, inspectorAttr);
      hasChanges = true;
    } else if (afterTag === ">") {
      // Self-closing or no attributes, insert before >
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
 * Combined Vue transform - uses the compiled output approach by default
 */
export function transformVue(
  code: string,
  id: string,
): VueTransformResult | null {
  // For .vue files that haven't been compiled yet, use template transform
  if (id.endsWith(".vue") && !id.includes("?")) {
    // Check if this is the raw SFC (has <template> tag)
    if (code.includes("<template")) {
      return transformVueTemplate(code, id);
    }
  }

  // For compiled Vue output, inject into render functions
  return transformVueCompiledOutput(code, id);
}
