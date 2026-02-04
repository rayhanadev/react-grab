/**
 * Browser client module exports for Vite source inspector
 */

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
} from "./resolve.js";

export {
  symbolicateStack,
  getElementStack,
  resolveFromStackTrace,
  enableStackTraceCapture,
  disableStackTraceCapture,
  clearSourceMapCache,
} from "./vanilla-fallback.js";
