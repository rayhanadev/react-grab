/**
 * Browser-side source resolution for multiple frameworks
 *
 * This module provides strategies for resolving the source location
 * of DOM elements across different frameworks:
 * 1. Data attributes (data-inspector) - injected at compile time
 * 2. React fiber - via bippy library
 * 3. Vue component instance - via __vueParentComponent
 * 4. Stack trace symbolication - runtime fallback
 */

export interface SourceLocation {
  file: string;
  line: number;
  column: number;
  componentName?: string;
}

/**
 * Parse data-inspector attribute value
 * Format: "/path/to/file.tsx:10:5"
 */
export function parseInspectorAttribute(value: string): SourceLocation | null {
  if (!value) return null;

  // Handle Windows paths that may have drive letter with colon
  // Format: C:\path\file.tsx:10:5 or /path/file.tsx:10:5
  const lastColonIdx = value.lastIndexOf(":");
  if (lastColonIdx === -1) return null;

  const secondLastColonIdx = value.lastIndexOf(":", lastColonIdx - 1);
  if (secondLastColonIdx === -1) return null;

  const file = value.slice(0, secondLastColonIdx);
  const line = parseInt(value.slice(secondLastColonIdx + 1, lastColonIdx), 10);
  const column = parseInt(value.slice(lastColonIdx + 1), 10);

  if (isNaN(line) || isNaN(column)) return null;

  return { file, line, column };
}

/**
 * Strategy 1: Resolve source from data-inspector attribute
 * This is the fastest and most reliable method.
 */
export function resolveFromDataAttribute(
  element: Element,
): SourceLocation | null {
  const attr = element.getAttribute("data-inspector");
  if (attr) {
    return parseInspectorAttribute(attr);
  }

  // Walk up the DOM tree to find the nearest element with data-inspector
  let current: Element | null = element.parentElement;
  while (current) {
    const parentAttr = current.getAttribute("data-inspector");
    if (parentAttr) {
      return parseInspectorAttribute(parentAttr);
    }
    current = current.parentElement;
  }

  return null;
}

/**
 * Strategy 2: Resolve source from React fiber
 * Uses the existing bippy-based approach.
 */
export function resolveFromReactFiber(element: Element): SourceLocation | null {
  // Get fiber from element
  const fiber = getReactFiber(element);
  if (!fiber) return null;

  // Try _debugSource first (React 18 and earlier)
  if (fiber._debugSource) {
    return {
      file: fiber._debugSource.fileName,
      line: fiber._debugSource.lineNumber,
      column: fiber._debugSource.columnNumber || 0,
    };
  }

  // Try _debugInfo (React 19)
  if (fiber._debugInfo && Array.isArray(fiber._debugInfo)) {
    for (const info of fiber._debugInfo) {
      if (info && typeof info === "object") {
        const source = info.source || info;
        if (source.fileName) {
          return {
            file: source.fileName,
            line: source.lineNumber || 1,
            column: source.columnNumber || 0,
          };
        }
      }
    }
  }

  // Walk up the fiber tree to find component with source info
  let currentFiber = fiber.return;
  while (currentFiber) {
    if (currentFiber._debugSource) {
      return {
        file: currentFiber._debugSource.fileName,
        line: currentFiber._debugSource.lineNumber,
        column: currentFiber._debugSource.columnNumber || 0,
        componentName: getReactComponentName(currentFiber),
      };
    }
    currentFiber = currentFiber.return;
  }

  return null;
}

/**
 * Get React fiber from DOM element
 */
function getReactFiber(element: Element): any {
  // React 18+ fiber key format
  for (const key of Object.keys(element)) {
    if (key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$")) {
      return (element as any)[key];
    }
  }

  // Fallback: check for React DevTools hook
  const hook = (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (hook && hook.renderers) {
    for (const [, renderer] of hook.renderers) {
      if (renderer.findFiberByHostInstance) {
        const fiber = renderer.findFiberByHostInstance(element);
        if (fiber) return fiber;
      }
    }
  }

  return null;
}

/**
 * Get React component display name from fiber
 */
function getReactComponentName(fiber: any): string | undefined {
  if (!fiber || !fiber.type) return undefined;

  // Function component
  if (typeof fiber.type === "function") {
    return fiber.type.displayName || fiber.type.name;
  }

  // Class component
  if (fiber.type.prototype?.isReactComponent) {
    return fiber.type.displayName || fiber.type.name;
  }

  // Forward ref
  if (fiber.type.$$typeof?.toString() === "Symbol(react.forward_ref)") {
    return fiber.type.displayName || fiber.type.render?.displayName || fiber.type.render?.name;
  }

  // Memo
  if (fiber.type.$$typeof?.toString() === "Symbol(react.memo)") {
    return fiber.type.displayName || getReactComponentName({ type: fiber.type.type });
  }

  return undefined;
}

/**
 * Strategy 3: Resolve source from Vue component instance
 */
export function resolveFromVueComponent(element: Element): SourceLocation | null {
  // Vue 3 stores component instance on element
  const vueInstance = (element as any).__vueParentComponent;

  if (vueInstance) {
    // Get file path from component type
    const componentType = vueInstance.type;
    if (componentType && componentType.__file) {
      return {
        file: componentType.__file,
        line: 1, // Vue doesn't provide line numbers at runtime
        column: 0,
        componentName: componentType.__name || componentType.name,
      };
    }

    // Try getting from proxy
    if (vueInstance.proxy?.$options?.__file) {
      return {
        file: vueInstance.proxy.$options.__file,
        line: 1,
        column: 0,
        componentName: vueInstance.proxy.$options.name,
      };
    }
  }

  // Walk up to find parent with __vueParentComponent
  let current: Element | null = element.parentElement;
  while (current) {
    const parentVue = (current as any).__vueParentComponent;
    if (parentVue?.type?.__file) {
      return {
        file: parentVue.type.__file,
        line: 1,
        column: 0,
        componentName: parentVue.type.__name || parentVue.type.name,
      };
    }
    current = current.parentElement;
  }

  return null;
}

/**
 * Strategy 4: Resolve source from Svelte component
 * Svelte stores component info differently per version
 */
export function resolveFromSvelteComponent(element: Element): SourceLocation | null {
  // Svelte 5 uses __svelte_component_instance__
  const svelteInstance = (element as any).__svelte_component_instance__;
  if (svelteInstance) {
    // Check for $$file property
    const file = svelteInstance.$$?.file || svelteInstance.$$.ctx?.$$file;
    if (file) {
      return { file, line: 1, column: 0 };
    }
  }

  // Svelte 4 uses different structure
  const svelte4 = (element as any).__svelte__;
  if (svelte4) {
    const component = svelte4.component || svelte4.ctx?.[0];
    if (component?.$$?.file) {
      return { file: component.$$.file, line: 1, column: 0 };
    }
  }

  return null;
}

/**
 * Strategy 5: Resolve source from Solid.js
 * Solid doesn't attach component info to DOM by default
 * We rely on data-inspector attributes for Solid
 */
export function resolveFromSolidComponent(element: Element): SourceLocation | null {
  // Solid.js primarily uses compile-time injection
  // Check for data-inspector first (handled by resolveFromDataAttribute)

  // Check for Solid's dev mode markers if available
  const solidInfo = (element as any).__solid_dev__;
  if (solidInfo?.file) {
    return {
      file: solidInfo.file,
      line: solidInfo.line || 1,
      column: solidInfo.column || 0,
      componentName: solidInfo.component,
    };
  }

  return null;
}

/**
 * Combined source resolution that tries all strategies
 */
export function resolveSource(element: Element): SourceLocation | null {
  // Strategy 1: Data attributes (fastest, most reliable)
  const dataAttrSource = resolveFromDataAttribute(element);
  if (dataAttrSource) return dataAttrSource;

  // Strategy 2: React fiber
  const reactSource = resolveFromReactFiber(element);
  if (reactSource) return reactSource;

  // Strategy 3: Vue component
  const vueSource = resolveFromVueComponent(element);
  if (vueSource) return vueSource;

  // Strategy 4: Svelte component
  const svelteSource = resolveFromSvelteComponent(element);
  if (svelteSource) return svelteSource;

  // Strategy 5: Solid component
  const solidSource = resolveFromSolidComponent(element);
  if (solidSource) return solidSource;

  return null;
}

/**
 * Get the detected framework for an element
 */
export function detectElementFramework(element: Element): "react" | "vue" | "svelte" | "solid" | "vanilla" | null {
  // Check for React fiber
  for (const key of Object.keys(element)) {
    if (key.startsWith("__reactFiber") || key.startsWith("__reactInternalInstance")) {
      return "react";
    }
  }

  // Check for Vue
  if ((element as any).__vueParentComponent) {
    return "vue";
  }

  // Check for Svelte
  if ((element as any).__svelte__ || (element as any).__svelte_component_instance__) {
    return "svelte";
  }

  // Check for Solid (usually has data-inspector from compile time)
  if (element.hasAttribute("data-inspector") && (window as any).Solid) {
    return "solid";
  }

  // Check for data-inspector attribute (could be any framework)
  if (element.hasAttribute("data-inspector")) {
    return "vanilla"; // Default to vanilla if we can't determine
  }

  return null;
}
