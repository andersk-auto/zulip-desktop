// Renderer-safe paths module.
// Does not use node:path or node:url (unavailable in sandboxed preload).
// Derives all paths from import.meta.dirname (__dirname in CJS output).

const dirname: string = import.meta.dirname.replaceAll("\\", "/");

export const bundlePath: string = dirname;

function resolveUp(base: string, relative: string): string {
  const parts = base.replace(/\/$/, "").split("/");
  for (const segment of relative.split("/")) {
    if (segment === "..") {
      parts.pop();
    } else if (segment !== "." && segment !== "") {
      parts.push(segment);
    }
  }

  return parts.join("/");
}

function pathToFileUrl(filePath: string): string {
  if (filePath.startsWith("/")) return "file://" + filePath;
  return "file:///" + filePath;
}

const publicPath: string = import.meta.env.DEV
  ? resolveUp(dirname, "../../public")
  : resolveUp(dirname, "../renderer");

export const bundleUrl: string = import.meta.env.DEV
  ? (process.env.ELECTRON_RENDERER_URL ?? "") + "/"
  : pathToFileUrl(publicPath + "/");

export const publicUrl: string = bundleUrl;

// Preload URL for webview tags
export const preloadUrl: string = pathToFileUrl(dirname + "/preload.cjs");
