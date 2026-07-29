import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

function writeAscii(target: Uint8Array, offset: number, length: number, value: string): void {
  const bytes = new TextEncoder().encode(value);
  target.set(bytes.subarray(0, length), offset);
}

function octal(value: number, length: number): string {
  return value.toString(8).padStart(length - 1, "0") + "\0";
}

export function makeTarGz(name: string, content: Uint8Array): Uint8Array {
  const header = new Uint8Array(512);
  writeAscii(header, 0, 100, name);
  writeAscii(header, 100, 8, octal(0o755, 8));
  writeAscii(header, 108, 8, octal(0, 8));
  writeAscii(header, 116, 8, octal(0, 8));
  writeAscii(header, 124, 12, octal(content.byteLength, 12));
  writeAscii(header, 136, 12, octal(0, 12));
  header.fill(32, 148, 156);
  header[156] = "0".charCodeAt(0);
  writeAscii(header, 257, 6, "ustar\0");
  writeAscii(header, 263, 2, "00");
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  writeAscii(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);

  const paddedLength = Math.ceil(content.byteLength / 512) * 512;
  const tar = new Uint8Array(512 + paddedLength + 1024);
  tar.set(header, 0);
  tar.set(content, 512);
  return Bun.gzipSync(tar);
}

export async function createExecutable(directory: string, name = "seqkit"): Promise<string> {
  await mkdir(directory, { recursive: true });
  const path = join(directory, name);
  await writeFile(path, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  await chmod(path, 0o700);
  return path;
}
