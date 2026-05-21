// Boundary checks for the --ref-*-url form of provider refs.
// PAI fetches server-side, so loopback URLs are unreachable; rejecting
// at the boundary avoids a downstream `content_filtered` (200 no image).

import test from "node:test";
import assert from "node:assert/strict";

import { buildProviderRefs } from "../local_mirror.js";

test("buildProviderRefs: rejects http://localhost:* URLs with bad_args", async () => {
  await assert.rejects(
    () => buildProviderRefs({ urls: ["http://localhost:3000/foo.png"], sourceIds: [] }),
    (err) => {
      assert.equal(err.klass, "bad_args");
      assert.match(err.message, /localhost/i);
      assert.match(err.message, /--ref-source-id/);
      return true;
    },
  );
});

test("buildProviderRefs: rejects 127.0.0.1 and [::1] URLs", async () => {
  for (const url of ["http://127.0.0.1:7488/x", "http://[::1]/y"]) {
    await assert.rejects(
      () => buildProviderRefs({ urls: [url], sourceIds: [] }),
      (err) => err.klass === "bad_args",
      `expected bad_args for ${url}`,
    );
  }
});

test("buildProviderRefs: passes public URLs through unchanged", async () => {
  const urls = [
    "https://example.trycloudflare.com/projects/x/assets/images/image_1.png",
    "https://cdn.example.com/foo.jpg",
  ];
  const out = await buildProviderRefs({ urls, sourceIds: [] });
  assert.deepEqual(out, urls);
});

test("buildProviderRefs: still rejects data: URIs (regression guard)", async () => {
  await assert.rejects(
    () => buildProviderRefs({ urls: ["data:image/png;base64,iVBORw0KGgo="], sourceIds: [] }),
    (err) => err.klass === "bad_args" && /data:/i.test(err.message),
  );
});
