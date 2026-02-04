/**
 * Framework detection for Vite transforms
 */

export type Framework = "react" | "vue" | "svelte" | "solid" | "vanilla";

export interface FrameworkDetectionResult {
  framework: Framework;
  confidence: "high" | "medium" | "low";
}

/**
 * Detect framework based on file extension and content
 */
export function detectFramework(
  id: string,
  code: string,
): FrameworkDetectionResult | null {
  // Vue SFC files
  if (id.endsWith(".vue")) {
    return { framework: "vue", confidence: "high" };
  }

  // Svelte files
  if (id.endsWith(".svelte")) {
    return { framework: "svelte", confidence: "high" };
  }

  // TSX/JSX files - need to check content to distinguish React vs Solid
  if (id.endsWith(".tsx") || id.endsWith(".jsx")) {
    // Check for Solid.js patterns
    if (
      code.includes("from 'solid-js'") ||
      code.includes('from "solid-js"') ||
      code.includes("_$template") ||
      code.includes("@solidjs/")
    ) {
      return { framework: "solid", confidence: "high" };
    }

    // Check for React patterns
    if (
      code.includes("from 'react'") ||
      code.includes('from "react"') ||
      code.includes("react/jsx-runtime") ||
      code.includes("react/jsx-dev-runtime") ||
      code.includes("__REACT_DEVTOOLS_GLOBAL_HOOK__")
    ) {
      return { framework: "react", confidence: "high" };
    }

    // Default JSX/TSX to React (most common)
    return { framework: "react", confidence: "low" };
  }

  // Check for React jsx-dev-runtime (needed for patching)
  if (id.includes("react/jsx-dev-runtime") || id.includes("react/jsx-runtime")) {
    return { framework: "react", confidence: "high" };
  }

  // Plain JS/TS files
  if (id.endsWith(".js") || id.endsWith(".ts")) {
    // Check for compiled Svelte output
    if (
      code.includes("element(") &&
      code.includes("create_component") &&
      code.includes("svelte")
    ) {
      return { framework: "svelte", confidence: "medium" };
    }

    // Check for compiled Solid output
    if (
      code.includes("_$template") ||
      code.includes("_$createComponent") ||
      code.includes("from 'solid-js'") ||
      code.includes('from "solid-js"')
    ) {
      return { framework: "solid", confidence: "medium" };
    }

    // Check for compiled Vue output
    if (
      code.includes("_createElementVNode") ||
      code.includes("__VUE_OPTIONS_API__") ||
      code.includes("resolveComponent")
    ) {
      return { framework: "vue", confidence: "medium" };
    }
  }

  return null;
}

/**
 * Check if a file should be transformed (source file, not node_modules)
 */
export function shouldTransform(id: string): boolean {
  // Skip node_modules (except for React runtime patching)
  if (
    id.includes("node_modules") &&
    !id.includes("react/jsx-dev-runtime") &&
    !id.includes("react/jsx-runtime")
  ) {
    return false;
  }

  // Skip virtual modules
  if (id.startsWith("\0") || id.startsWith("virtual:")) {
    return false;
  }

  // Skip non-source files
  const sourceExtensions = [".tsx", ".jsx", ".vue", ".svelte", ".ts", ".js"];
  return sourceExtensions.some((ext) => id.endsWith(ext));
}

/**
 * Extract source location from file ID
 */
export function extractSourceLocation(id: string): {
  file: string;
  isSourceFile: boolean;
} {
  // Remove query parameters and hash
  const cleanId = id.split("?")[0].split("#")[0];

  // Check if it's a source file (not in node_modules)
  const isSourceFile = !cleanId.includes("node_modules");

  return {
    file: cleanId,
    isSourceFile,
  };
}
