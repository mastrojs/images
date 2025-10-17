import { assert } from "@std/assert";
import { transformImage } from "./images.ts";

Deno.test("transformImage", async () => {
  const img = await transformImage(
    "test-images/blue-marble.jpg",
    { format: "WEBP", transform: image => image.resize(300, 300) },
  );
  assert(img instanceof Uint8Array);
});
