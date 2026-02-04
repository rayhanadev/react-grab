/**
 * Vite Source Inspector Plugin
 *
 * Universal click-to-source functionality for Vite projects.
 * Supports React, Vue, Svelte, Solid, and vanilla JS.
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import { sourceInspector } from 'react-grab/vite'
 *
 * export default {
 *   plugins: [sourceInspector()]
 * }
 * ```
 */

// Main plugin export
export {
  sourceInspector,
  viteSourceInspector,
  type SourceInspectorOptions,
} from "./plugin.js";

// Framework detection
export { detectFramework, shouldTransform, type Framework } from "./detect.js";

// Transform functions (for advanced usage)
export {
  transformReact,
  patchJsxDevRuntime,
  injectReactSourceAttributes,
} from "./transforms/react.js";

export {
  transformVue,
  transformVueCompiledOutput,
  transformVueTemplate,
} from "./transforms/vue.js";

export {
  transformSvelte,
  transformSvelteCompiledOutput,
  transformSvelteTemplate,
} from "./transforms/svelte.js";

export {
  transformSolid,
  transformSolidCompiledOutput,
  transformSolidJsx,
} from "./transforms/solid.js";

// Browser client utilities (for custom implementations)
export {
  resolveSource,
  resolveFromDataAttribute,
  resolveFromReactFiber,
  resolveFromVueComponent,
  resolveFromSvelteComponent,
  resolveFromSolidComponent,
  parseInspectorAttribute,
  detectElementFramework,
  type SourceLocation,
} from "./client/resolve.js";

export {
  symbolicateStack,
  getElementStack,
  resolveFromStackTrace,
  enableStackTraceCapture,
  disableStackTraceCapture,
  clearSourceMapCache,
} from "./client/vanilla-fallback.js";

// Default export is the plugin
export { sourceInspector as default } from "./plugin.js";
