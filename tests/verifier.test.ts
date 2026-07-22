import assert from "node:assert/strict";
import test from "node:test";
import { PNG } from "pngjs";
import { compareImages } from "../server/verifier.ts";

function solidPng(red: number, green: number, blue: number): Buffer {
  const image = new PNG({ width: 4, height: 4 });
  for (let offset = 0; offset < image.data.length; offset += 4) {
    image.data[offset] = red;
    image.data[offset + 1] = green;
    image.data[offset + 2] = blue;
    image.data[offset + 3] = 255;
  }
  return PNG.sync.write(image);
}

test("visual verifier detects subtle background color changes", () => {
  const before = solidPng(0xec, 0xeb, 0xe7);
  const after = solidPng(0xee, 0xf5, 0xfc);
  assert.equal(compareImages(before, after).ratio, 1);
});
