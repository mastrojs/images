/**
 * Module with helper function to transform images.
 * Uses `@imagemagick/magick-wasm` under the hood.
 * @module
 */

import {
  ImageMagick,
  type IMagickImage,
  initializeImageMagick,
  MagickFormat,
} from "@imagemagick/magick-wasm";
import { findFiles, getParams, readFile } from "@mastrojs/mastro";
import { staticCacheControlVal } from "@mastrojs/mastro/server";
import { contentType } from "@std/media-types";

/**
 * Image format, for example `"WEBP"`.
 */
export type ImageFormat = MagickFormat;

/**
 * Preset to transform an image to the specified format, using a transform function
 * which gets passed an [IMagickImage](https://github.com/dlemstra/magick-wasm/blob/82a4c4e45d5fda6c88becbaba8340df3f5d30c13/src/magick-image.ts#L81)
 * on which you can call methods like `.resize(64, 64)`;
 */
export interface ImagePreset {
  /** defaults to WEBP */
  format?: ImageFormat;
  transform: (image: IMagickImage) => void;
}

const version = "0.0.36";
const wasmUrl = new URL(
  `https://cdn.jsdelivr.net/npm/@imagemagick/magick-wasm@${version}/dist/magick.wasm`,
);

/**
 * Creates a route to transform images according to the specified presets.
 *
 * Important: Cache-Control maxage is set to 7 days if not on localhost. Thus once you deploy it,
 * you may need to change the preset name (`small` in the example below) for things to update.
 *
 * Usage: with `/routes/_images/[...slug].server.ts` containing:
 *
 * ```
 * import { createImagesRoute } from "@mastrojs/images";
 * export const { GET, getStaticPaths } = createImagesRoute({
 *   small: {
 *     transform: image => image.resize(300, 300),
 *   },
 * });
 * ```
 *
 * and an image placed at `/images/blue-marble.jpg`, you can use the transformed image with:
 *
 * ```
 * <img src="/_images/small/blue-marble.jpg.webp" alt="Planet Earth">
 * ```
 */
export const createImagesRoute = (
  presets: Record<string, ImagePreset>,
  baseDir = "images/",
): {
  GET: (req: Request) => Promise<Response>;
  getStaticPaths: () => Promise<string[]>;
} => {
  const GET = async (req: Request) => {
    const { slug } = getParams(req.url);
    if (!slug) {
      return new Response("404 not found", { status: 404 });
    }
    const [presetName, path] = splitAt(slug, slug.indexOf("/"));
    const [filePath, suffix] = splitAt(path, path.lastIndexOf("."));
    if (!presetName || !filePath || !suffix) {
      return new Response("404 not found", { status: 404 });
    }

    const preset = presets[presetName];
    if (!preset) {
      const names = Object.keys(presets).join('", "');
      return new Response(
        `404 Image preset "${presetName}" not found.\n\nMust be one of: "${names}".`,
        { status: 404 },
      );
    }
    const format = preset.format || MagickFormat.WebP;
    if (format !== suffix.toUpperCase()) {
      return new Response(
        `404 Format for preset ${presetName} must be ${format} instead of ${suffix.toUpperCase()}`,
        { status: 404 },
      );
    }

    const img: Uint8Array<any> = await transformImage(
      baseDir + filePath,
      { ...preset, format },
    );

    const res = new Response(img);
    res.headers.set("Content-Type", contentType(format) || "image/?");
    const cacheHeader = staticCacheControlVal(req);
    if (cacheHeader) {
      res.headers.set("Cache-Control", cacheHeader);
    }
    return res;
  };

  const getStaticPaths = async () => {
    const images = await findFiles(baseDir + "**/*");
    return images.flatMap((img) =>
      Object.keys(presets).map((preset) =>
        `/_images/${preset}/${img.slice(baseDir.length + 1)}.webp`
      )
    );
  };

  return { GET, getStaticPaths };
};

const splitAt = (
  str: string,
  index: number,
) => [str.substring(0, index), str.substring(index + 1)];

let inialized = false;

/**
 * Lower-level function that reads an image from disk and returns it transformed.
 * Exported mainly for tests.
 */
export const transformImage = async (
  path: string,
  preset: Required<ImagePreset>,
): Promise<Uint8Array> => {
  if (!inialized) {
    await initialize();
    inialized = true;
  }
  const data = await readFile(path);
  return new Promise((resolve) =>
    ImageMagick.read(data, (image: IMagickImage) => {
      preset.transform(image);
      image.write(preset.format, resolve);
    })
  );
};

const initialize = async () => {
  if (typeof document === "undefined" && typeof Deno === "undefined") {
    const nodeJsInit = async (wasmLocation: string) =>
      initializeImageMagick(await readFile(wasmLocation));
    try {
      // pnpm
      await nodeJsInit(
        `node_modules/.pnpm/@imagemagick+magick-wasm@${version}/node_modules/@imagemagick/magick-wasm/dist/magick.wasm`,
      );
    } catch {
      // npm
      await nodeJsInit("node_modules/@imagemagick/magick-wasm/dist/magick.wasm");
    }
  } else {
    // Deno, browser
    const cache = await caches.open("magick_native");
    const cached = await cache.match(wasmUrl);
    if (cached) {
      await initializeImageMagick(new Int8Array(await cached.arrayBuffer()));
    } else {
      const response = await fetch(wasmUrl);
      await cache.put(wasmUrl, response.clone());
      await initializeImageMagick(new Int8Array(await response.arrayBuffer()));
    }
  }
};
