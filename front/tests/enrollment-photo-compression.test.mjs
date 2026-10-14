import test from "node:test";
import assert from "node:assert/strict";
import { compressEnrollmentPhoto, PHOTO_MAX_BYTES } from "../src/features/enrollments/compressEnrollmentPhoto.ts";

test("small photos and PDFs remain unchanged", async () => {
  const small = new File([new Uint8Array(PHOTO_MAX_BYTES)], "photo.png", {type:"image/png"});
  const pdf = new File([new Uint8Array(4_000_000)], "id.pdf", {type:"application/pdf"});
  assert.equal(await compressEnrollmentPhoto(small), small);
  assert.equal(await compressEnrollmentPhoto(pdf), pdf);
});
test("oversized photos become JPEG below 3 MB and release their decoded image", async () => {
  let closed = false, attempts = 0;
  const canvas = { width:0, height:0, getContext:() => ({ fillRect(){}, drawImage(){} }), toBlob(callback, type, quality) {
    attempts++; callback(new Blob([new Uint8Array(quality > .85 ? 3_100_000 : 2_800_000)], {type}));
  }};
  globalThis.document = {createElement:() => canvas};
  globalThis.createImageBitmap = async () => ({width:8000,height:6000,close(){closed=true;}});
  const result = await compressEnrollmentPhoto(new File([new Uint8Array(5_000_000)], "id.png", {type:"image/png"}));
  assert.equal(result.type,"image/jpeg"); assert.equal(result.name,"id.jpg");
  assert.ok(result.size <= PHOTO_MAX_BYTES); assert.equal(attempts,2);
  assert.equal(canvas.width,4096); assert.equal(canvas.height,3072); assert.equal(closed,true);
});
test("encoding errors do not silently send the oversized original", async () => {
  globalThis.document = {createElement:() => ({getContext:() => ({fillRect(){},drawImage(){}}),toBlob(callback){callback(null);}})};
  globalThis.createImageBitmap = async () => ({width:4000,height:3000,close(){}});
  await assert.rejects(compressEnrollmentPhoto(new File([new Uint8Array(4_000_000)],"photo.jpg",{type:"image/jpeg"})), /comprimir/);
});
