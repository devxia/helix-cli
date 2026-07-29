const TAR_BLOCK_SIZE = 512;

function readNullTerminated(bytes: Uint8Array): string {
  const end = bytes.indexOf(0);
  return new TextDecoder().decode(end === -1 ? bytes : bytes.subarray(0, end));
}

function readOctal(bytes: Uint8Array, label: string): number {
  const text = readNullTerminated(bytes).trim();
  if (!/^[0-7]+$/.test(text)) {
    throw new Error(`Invalid tar ${label}: ${JSON.stringify(text)}`);
  }
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Unsafe tar ${label}: ${text}`);
  }
  return value;
}

function isZeroBlock(bytes: Uint8Array): boolean {
  return bytes.every((value) => value === 0);
}

function verifyHeaderChecksum(header: Uint8Array): void {
  const expected = readOctal(header.subarray(148, 156), "checksum");
  let actual = 0;
  for (let index = 0; index < header.length; index += 1) {
    actual += index >= 148 && index < 156 ? 32 : header[index]!;
  }
  if (actual !== expected) {
    throw new Error(`Invalid tar header checksum: expected ${expected}, got ${actual}`);
  }
}

export function extractSeqkitFromTarGz(archive: Uint8Array): Uint8Array {
  let tar: Uint8Array;
  try {
    const compressed = new Uint8Array(archive.byteLength);
    compressed.set(archive);
    tar = Bun.gunzipSync(compressed);
  } catch (error) {
    throw new Error(`Invalid gzip archive: ${error instanceof Error ? error.message : String(error)}`);
  }

  let offset = 0;
  let executable: Uint8Array | undefined;
  let reachedEnd = false;

  while (offset + TAR_BLOCK_SIZE <= tar.length) {
    const header = tar.subarray(offset, offset + TAR_BLOCK_SIZE);
    if (isZeroBlock(header)) {
      const secondEndBlock = tar.subarray(offset + TAR_BLOCK_SIZE, offset + TAR_BLOCK_SIZE * 2);
      if (secondEndBlock.length !== TAR_BLOCK_SIZE || !isZeroBlock(secondEndBlock)) {
        throw new Error("Tar archive is missing its second end marker");
      }
      if (!isZeroBlock(tar.subarray(offset + TAR_BLOCK_SIZE * 2))) {
        throw new Error("Tar archive contains data after its end markers");
      }
      reachedEnd = true;
      break;
    }

    verifyHeaderChecksum(header);
    const name = readNullTerminated(header.subarray(0, 100));
    const size = readOctal(header.subarray(124, 136), "size");
    const type = header[156];
    const isRegularFile = type === 0 || type === "0".charCodeAt(0);

    if (!isRegularFile || name !== "seqkit") {
      throw new Error(`Unexpected tar entry: ${name || "<empty>"}`);
    }
    if (executable) {
      throw new Error("SeqKit archive contains more than one file");
    }

    const dataStart = offset + TAR_BLOCK_SIZE;
    const dataEnd = dataStart + size;
    if (dataEnd > tar.length) {
      throw new Error(`Truncated tar entry: ${name}`);
    }
    executable = tar.slice(dataStart, dataEnd);
    offset = dataStart + Math.ceil(size / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;
  }

  if (!reachedEnd) throw new Error("Tar archive is missing end markers");
  if (!executable || executable.length === 0) {
    throw new Error("SeqKit executable was not found in the archive");
  }
  return executable;
}
