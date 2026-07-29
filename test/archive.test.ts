import { describe, expect, test } from "bun:test";
import { extractSeqkitFromTarGz } from "../src/seqkit/archive.js";
import { makeTarGz } from "./helpers.js";

describe("SeqKit archive extraction", () => {
  test("extracts the single expected executable", () => {
    const executable = new TextEncoder().encode("seqkit-binary");
    expect(extractSeqkitFromTarGz(makeTarGz("seqkit", executable))).toEqual(executable);
  });

  test("rejects traversal and unexpected entries", () => {
    expect(() => extractSeqkitFromTarGz(makeTarGz("../seqkit", new Uint8Array([1])))).toThrow("Unexpected tar entry");
    expect(() => extractSeqkitFromTarGz(makeTarGz("README", new Uint8Array([1])))).toThrow("Unexpected tar entry");
  });

  test("rejects a tar without standard end markers", () => {
    const archive = makeTarGz("seqkit", new Uint8Array([1]));
    const tar = Bun.gunzipSync(new Uint8Array(archive).buffer);
    const withoutEndMarkers = Bun.gzipSync(Uint8Array.from(tar.subarray(0, tar.length - 1024)));
    expect(() => extractSeqkitFromTarGz(withoutEndMarkers)).toThrow("missing end markers");
  });

  test("rejects invalid gzip data", () => {
    expect(() => extractSeqkitFromTarGz(new Uint8Array([1, 2, 3]))).toThrow("Invalid gzip archive");
  });
});
