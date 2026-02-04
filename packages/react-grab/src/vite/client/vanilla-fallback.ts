/**
 * Vanilla JS runtime fallback for source resolution
 *
 * This module provides runtime stack trace capture and source map
 * symbolication for elements created without framework-specific markers.
 *
 * Approach:
 * 1. Intercept document.createElement to capture stack traces
 * 2. Store stack traces in a WeakMap keyed by element
 * 3. On hover, fetch source map and symbolicate the stack
 */

import type { SourceLocation } from "./resolve.js";

// WeakMap to store captured stack traces for elements
const elementStackMap = new WeakMap<Element, string>();

// Cache for fetched source maps
const sourceMapCache = new Map<string, any>();

// Flag to track if interception is enabled
let isInterceptionEnabled = false;

// Original createElement function
let originalCreateElement: typeof document.createElement | null = null;

/**
 * Parse a stack frame string into components
 */
interface ParsedStackFrame {
  functionName: string | null;
  url: string;
  line: number;
  column: number;
}

function parseStackFrame(frame: string): ParsedStackFrame | null {
  // Chrome/Edge format: "    at functionName (url:line:column)"
  // or "    at url:line:column"
  const chromeMatch = frame.match(/at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?/);
  if (chromeMatch) {
    return {
      functionName: chromeMatch[1] || null,
      url: chromeMatch[2],
      line: parseInt(chromeMatch[3], 10),
      column: parseInt(chromeMatch[4], 10),
    };
  }

  // Firefox format: "functionName@url:line:column"
  const firefoxMatch = frame.match(/^(.+?)@(.+?):(\d+):(\d+)$/);
  if (firefoxMatch) {
    return {
      functionName: firefoxMatch[1] || null,
      url: firefoxMatch[2],
      line: parseInt(firefoxMatch[3], 10),
      column: parseInt(firefoxMatch[4], 10),
    };
  }

  // Safari format: similar to Firefox
  const safariMatch = frame.match(/(.+)@(.+):(\d+):(\d+)/);
  if (safariMatch) {
    return {
      functionName: safariMatch[1] || null,
      url: safariMatch[2],
      line: parseInt(safariMatch[3], 10),
      column: parseInt(safariMatch[4], 10),
    };
  }

  return null;
}

/**
 * Parse a full stack trace into array of frames
 */
function parseStackTrace(stack: string): ParsedStackFrame[] {
  const lines = stack.split("\n");
  const frames: ParsedStackFrame[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const frame = parseStackFrame(trimmed);
    if (frame) {
      frames.push(frame);
    }
  }

  return frames;
}

/**
 * Check if a URL is a source file (not node_modules, not internal)
 */
function isSourceUrl(url: string): boolean {
  // Skip browser internals
  if (url.includes("extensions://")) return false;
  if (url.includes("chrome://")) return false;
  if (url.startsWith("native")) return false;

  // Skip node_modules
  if (url.includes("node_modules/")) return false;

  // Skip this inspector's own code
  if (url.includes("react-grab")) return false;
  if (url.includes("vite/client")) return false;
  if (url.includes("@vite/client")) return false;

  // Accept source files
  return (
    url.endsWith(".js") ||
    url.endsWith(".ts") ||
    url.endsWith(".jsx") ||
    url.endsWith(".tsx") ||
    url.endsWith(".vue") ||
    url.endsWith(".svelte")
  );
}

/**
 * Find the first application frame in a stack trace
 */
function findFirstAppFrame(stack: string): ParsedStackFrame | null {
  const frames = parseStackTrace(stack);

  for (const frame of frames) {
    if (isSourceUrl(frame.url)) {
      return frame;
    }
  }

  return null;
}

/**
 * Fetch and parse a source map for a given URL
 */
async function fetchSourceMap(url: string): Promise<any | null> {
  // Check cache first
  if (sourceMapCache.has(url)) {
    return sourceMapCache.get(url);
  }

  try {
    // First, try to fetch the source file and find sourceMappingURL
    const sourceResponse = await fetch(url);
    if (!sourceResponse.ok) {
      sourceMapCache.set(url, null);
      return null;
    }

    const sourceText = await sourceResponse.text();

    // Look for sourceMappingURL comment
    const sourceMappingMatch = sourceText.match(
      /\/\/[#@]\s*sourceMappingURL=(.+?)(?:\s|$)/,
    );

    if (!sourceMappingMatch) {
      sourceMapCache.set(url, null);
      return null;
    }

    const sourceMappingUrl = sourceMappingMatch[1];

    // Handle data URL source maps
    if (sourceMappingUrl.startsWith("data:")) {
      const base64Match = sourceMappingUrl.match(
        /data:application\/json;(?:charset=utf-8;)?base64,(.+)/,
      );
      if (base64Match) {
        const decoded = atob(base64Match[1]);
        const sourceMap = JSON.parse(decoded);
        sourceMapCache.set(url, sourceMap);
        return sourceMap;
      }
    }

    // Handle external source map URLs
    const baseUrl = url.substring(0, url.lastIndexOf("/") + 1);
    const mapUrl = sourceMappingUrl.startsWith("http")
      ? sourceMappingUrl
      : baseUrl + sourceMappingUrl;

    const mapResponse = await fetch(mapUrl);
    if (!mapResponse.ok) {
      sourceMapCache.set(url, null);
      return null;
    }

    const sourceMap = await mapResponse.json();
    sourceMapCache.set(url, sourceMap);
    return sourceMap;
  } catch (error) {
    console.warn("[inspector] Failed to fetch source map:", url, error);
    sourceMapCache.set(url, null);
    return null;
  }
}

/**
 * Trace a position through a source map to find original location
 *
 * This is a simplified VLQ decoder. For production, use @jridgewell/trace-mapping.
 */
function tracePosition(
  sourceMap: any,
  line: number,
  column: number,
): SourceLocation | null {
  if (!sourceMap || !sourceMap.mappings || !sourceMap.sources) {
    return null;
  }

  // Parse the VLQ-encoded mappings
  // This is a simplified implementation - for full accuracy, use a library
  try {
    const lines = sourceMap.mappings.split(";");
    if (line - 1 >= lines.length) {
      return null;
    }

    const segments = lines[line - 1].split(",");
    if (segments.length === 0 || segments[0] === "") {
      return null;
    }

    // Decode the first segment of the line
    // VLQ format: [generatedColumn, sourceIndex, sourceLine, sourceColumn, nameIndex]
    const decoded = decodeVlq(segments[0]);
    if (!decoded || decoded.length < 4) {
      return null;
    }

    const sourceIndex = decoded[1];
    const sourceLine = decoded[2] + 1; // 0-indexed to 1-indexed
    const sourceColumn = decoded[3];

    if (sourceIndex >= sourceMap.sources.length) {
      return null;
    }

    let sourcePath = sourceMap.sources[sourceIndex];

    // Handle sourceRoot
    if (sourceMap.sourceRoot) {
      sourcePath = sourceMap.sourceRoot + sourcePath;
    }

    return {
      file: sourcePath,
      line: sourceLine,
      column: sourceColumn,
    };
  } catch (error) {
    console.warn("[inspector] Failed to parse source map:", error);
    return null;
  }
}

/**
 * Decode a VLQ-encoded segment
 */
function decodeVlq(segment: string): number[] | null {
  const values: number[] = [];
  let shift = 0;
  let value = 0;

  const VLQ_BASE_SHIFT = 5;
  const VLQ_BASE = 1 << VLQ_BASE_SHIFT;
  const VLQ_CONTINUATION_BIT = VLQ_BASE;

  const charToInt: Record<string, number> = {};
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  for (let i = 0; i < chars.length; i++) {
    charToInt[chars[i]] = i;
  }

  for (let i = 0; i < segment.length; i++) {
    const c = segment[i];
    const digit = charToInt[c];
    if (digit === undefined) {
      return null;
    }

    const hasContinuation = !!(digit & VLQ_CONTINUATION_BIT);
    value += (digit & (VLQ_BASE - 1)) << shift;

    if (hasContinuation) {
      shift += VLQ_BASE_SHIFT;
    } else {
      // Convert from VLQ signed format
      const shouldNegate = value & 1;
      value = value >> 1;
      if (shouldNegate) {
        value = -value;
      }
      values.push(value);
      value = 0;
      shift = 0;
    }
  }

  return values;
}

/**
 * Symbolicate a stack trace to get original source location
 */
export async function symbolicateStack(
  stack: string,
): Promise<SourceLocation | null> {
  const frame = findFirstAppFrame(stack);
  if (!frame) {
    return null;
  }

  // Try to fetch source map
  const sourceMap = await fetchSourceMap(frame.url);
  if (sourceMap) {
    const traced = tracePosition(sourceMap, frame.line, frame.column);
    if (traced) {
      return traced;
    }
  }

  // Fall back to the stack frame location (bundled, not original)
  // Convert URL to file path for Vite's /__open-in-editor
  let file = frame.url;

  // Strip origin for local files
  const origin = window.location.origin;
  if (file.startsWith(origin)) {
    file = file.slice(origin.length);
  }

  return {
    file,
    line: frame.line,
    column: frame.column,
  };
}

/**
 * Get stored stack trace for an element
 */
export function getElementStack(element: Element): string | undefined {
  return elementStackMap.get(element);
}

/**
 * Resolve source from stored stack trace
 */
export async function resolveFromStackTrace(
  element: Element,
): Promise<SourceLocation | null> {
  const stack = elementStackMap.get(element);
  if (!stack) {
    return null;
  }

  return symbolicateStack(stack);
}

/**
 * Enable createElement interception for stack trace capture
 */
export function enableStackTraceCapture(): void {
  if (isInterceptionEnabled) return;

  originalCreateElement = document.createElement.bind(document);

  document.createElement = function <K extends keyof HTMLElementTagNameMap>(
    tagName: K,
    options?: ElementCreationOptions,
  ): HTMLElementTagNameMap[K] {
    const element = originalCreateElement!(tagName, options);

    // Capture stack trace
    const stack = new Error().stack;
    if (stack) {
      elementStackMap.set(element, stack);
    }

    return element;
  };

  isInterceptionEnabled = true;
}

/**
 * Disable createElement interception
 */
export function disableStackTraceCapture(): void {
  if (!isInterceptionEnabled || !originalCreateElement) return;

  document.createElement = originalCreateElement;
  originalCreateElement = null;
  isInterceptionEnabled = false;
}

/**
 * Clear source map cache
 */
export function clearSourceMapCache(): void {
  sourceMapCache.clear();
}
