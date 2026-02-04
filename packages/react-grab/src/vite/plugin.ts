/**
 * Universal Vite Source Inspector Plugin
 *
 * This plugin enables click-to-source functionality for any Vite project,
 * supporting React, Vue, Svelte, Solid, and vanilla JS.
 *
 * Usage:
 * ```ts
 * // vite.config.ts
 * import { sourceInspector } from 'react-grab/vite'
 *
 * export default {
 *   plugins: [sourceInspector()]
 * }
 * ```
 */

import type { Plugin, ViteDevServer } from "vite";
import { detectFramework, shouldTransform, type Framework } from "./detect.js";
import { transformReact, patchJsxDevRuntime } from "./transforms/react.js";
import { transformVue } from "./transforms/vue.js";
import { transformSvelte } from "./transforms/svelte.js";
import { transformSolid } from "./transforms/solid.js";

export interface SourceInspectorOptions {
  /**
   * Enable React support (jsx-dev-runtime patching + fiber traversal)
   * @default true
   */
  react?: boolean;

  /**
   * Enable Vue support (SFC template transform)
   * @default true
   */
  vue?: boolean;

  /**
   * Enable Svelte support (compiled output transform)
   * @default true
   */
  svelte?: boolean;

  /**
   * Enable Solid support (template transform)
   * @default true
   */
  solid?: boolean;

  /**
   * Enable vanilla JS support (runtime stack trace capture)
   * @default true
   */
  vanilla?: boolean;

  /**
   * Activation key combination
   * @default 'alt' (Option on Mac)
   */
  toggleCombo?: "alt" | "meta" | "ctrl" | "ctrl+shift";

  /**
   * Show floating toggle button
   * @default true
   */
  showToggleButton?: boolean;

  /**
   * Position of the toggle button
   * @default 'bottom-right'
   */
  toggleButtonPosition?:
    | "bottom-right"
    | "bottom-left"
    | "top-right"
    | "top-left";

  /**
   * Preferred editor to open files in
   * Uses launch-editor-middleware under the hood
   * @default auto-detected
   */
  editor?: "code" | "webstorm" | "sublime" | "atom" | "idea" | "vim";

  /**
   * Custom transform function for additional processing
   */
  customTransform?: (code: string, id: string) => string | null;

  /**
   * Files to include (glob patterns)
   * @default ['**\/*.tsx', '**\/*.jsx', '**\/*.vue', '**\/*.svelte']
   */
  include?: string[];

  /**
   * Files to exclude (glob patterns)
   * @default ['node_modules/**', 'dist/**']
   */
  exclude?: string[];
}

const DEFAULT_OPTIONS: Required<SourceInspectorOptions> = {
  react: true,
  vue: true,
  svelte: true,
  solid: true,
  vanilla: true,
  toggleCombo: "alt",
  showToggleButton: true,
  toggleButtonPosition: "bottom-right",
  editor: "code",
  customTransform: () => null,
  include: ["**/*.tsx", "**/*.jsx", "**/*.vue", "**/*.svelte", "**/*.ts", "**/*.js"],
  exclude: ["node_modules/**", "dist/**", ".git/**"],
};

/**
 * Create the Vite source inspector plugin
 */
export function sourceInspector(
  userOptions: SourceInspectorOptions = {},
): Plugin {
  const options = { ...DEFAULT_OPTIONS, ...userOptions };
  let server: ViteDevServer | null = null;

  return {
    name: "vite-plugin-source-inspector",

    // Only apply in development mode
    apply: "serve",

    // Run this transform after framework-specific plugins but before final bundling
    enforce: "post",

    configureServer(_server) {
      server = _server;

      // Add middleware for source map endpoint
      server.middlewares.use("/__inspector", (req, res, next) => {
        const url = new URL(req.url || "/", `http://${req.headers.host}`);

        // Endpoint to get source map for a module
        if (url.pathname === "/__inspector/sourcemap") {
          const moduleId = url.searchParams.get("id");
          if (!moduleId) {
            res.statusCode = 400;
            res.end("Missing module id");
            return;
          }

          // Get module from graph
          const mod = server?.moduleGraph.getModuleById(moduleId);
          if (!mod?.transformResult?.map) {
            res.statusCode = 404;
            res.end("Source map not found");
            return;
          }

          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(mod.transformResult.map));
          return;
        }

        next();
      });
    },

    /**
     * Transform hook - inject data-inspector attributes
     */
    transform(code, id) {
      // Skip if not a transformable file
      if (!shouldTransform(id)) {
        return null;
      }

      // Detect framework from file content
      const detection = detectFramework(id, code);

      // Apply framework-specific transform
      if (detection) {
        const { framework } = detection;

        switch (framework) {
          case "react":
            if (options.react) {
              // First try jsx-dev-runtime patching
              const runtimePatch = patchJsxDevRuntime(code, id);
              if (runtimePatch) {
                return {
                  code: runtimePatch.code,
                  map: runtimePatch.map,
                };
              }
              // Then try general React transform
              const reactResult = transformReact(code, id);
              if (reactResult) {
                return {
                  code: reactResult.code,
                  map: reactResult.map,
                };
              }
            }
            break;

          case "vue":
            if (options.vue) {
              const vueResult = transformVue(code, id);
              if (vueResult) {
                return {
                  code: vueResult.code,
                  map: vueResult.map,
                };
              }
            }
            break;

          case "svelte":
            if (options.svelte) {
              const svelteResult = transformSvelte(code, id);
              if (svelteResult) {
                return {
                  code: svelteResult.code,
                  map: svelteResult.map,
                };
              }
            }
            break;

          case "solid":
            if (options.solid) {
              const solidResult = transformSolid(code, id);
              if (solidResult) {
                return {
                  code: solidResult.code,
                  map: solidResult.map,
                };
              }
            }
            break;
        }
      }

      // Apply custom transform if provided
      if (options.customTransform) {
        const customResult = options.customTransform(code, id);
        if (customResult) {
          return { code: customResult };
        }
      }

      return null;
    },

    /**
     * Inject browser client script into HTML
     */
    transformIndexHtml() {
      // Generate client configuration
      const clientConfig = JSON.stringify({
        toggleCombo: options.toggleCombo,
        showToggleButton: options.showToggleButton,
        toggleButtonPosition: options.toggleButtonPosition,
        vanilla: options.vanilla,
      });

      return [
        {
          tag: "script",
          attrs: { type: "module" },
          children: `
// Vite Source Inspector - Browser Client
(function() {
  const config = ${clientConfig};

  // Initialize react-grab with inspector configuration
  if (typeof window !== 'undefined') {
    window.__VITE_INSPECTOR_CONFIG__ = config;

    // Enable vanilla JS stack trace capture if configured
    if (config.vanilla) {
      import('react-grab').then(module => {
        // The main react-grab module auto-initializes
        // We just need to ensure it's loaded
      }).catch(err => {
        console.warn('[inspector] Failed to load react-grab:', err);
      });
    }
  }
})();
          `.trim(),
          injectTo: "head-prepend",
        },
      ];
    },
  };
}

/**
 * Alternative export name for the plugin
 */
export const viteSourceInspector = sourceInspector;

/**
 * Export plugin as default
 */
export default sourceInspector;
