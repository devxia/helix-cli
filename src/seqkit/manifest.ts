export const SEQKIT_VERSION = "2.13.0";
export const SEQKIT_SUPPORTED_RANGE = ">=2.13.0 <2.14.0";

export interface SeqkitAsset {
  readonly platform: "darwin" | "linux";
  readonly arch: "x64" | "arm64";
  readonly assetName: string;
  readonly url: string;
  readonly sha256: string;
  readonly size: number;
}

const RELEASE_BASE = `https://github.com/shenwei356/seqkit/releases/download/v${SEQKIT_VERSION}`;

export const SEQKIT_ASSETS: readonly SeqkitAsset[] = [
  {
    platform: "darwin",
    arch: "x64",
    assetName: "seqkit_darwin_amd64.tar.gz",
    url: `${RELEASE_BASE}/seqkit_darwin_amd64.tar.gz`,
    sha256: "7db4264a1a49d9ad7cc6d02f572c8573469d6f91881da2a2420b7f5426d63951",
    size: 8_662_154,
  },
  {
    platform: "darwin",
    arch: "arm64",
    assetName: "seqkit_darwin_arm64.tar.gz",
    url: `${RELEASE_BASE}/seqkit_darwin_arm64.tar.gz`,
    sha256: "c36d68cfe4d8796c017a136a625b4706b4f7dc2664f1a555e4b4ced4ee394a28",
    size: 8_188_794,
  },
  {
    platform: "linux",
    arch: "x64",
    assetName: "seqkit_linux_amd64.tar.gz",
    url: `${RELEASE_BASE}/seqkit_linux_amd64.tar.gz`,
    sha256: "7d686de448464fada1b1988e2e07d693bec68768312da62846bc0e2b502bfc46",
    size: 8_589_589,
  },
  {
    platform: "linux",
    arch: "arm64",
    assetName: "seqkit_linux_arm64.tar.gz",
    url: `${RELEASE_BASE}/seqkit_linux_arm64.tar.gz`,
    sha256: "2bce55ea352ceab56a428b2d6e06e6565485a446c17dc17cadb5dc28ab7a9cdc",
    size: 7_963_731,
  },
];

export function getSeqkitAsset(platform = process.platform, arch = process.arch): SeqkitAsset {
  const asset = SEQKIT_ASSETS.find((candidate) => candidate.platform === platform && candidate.arch === arch);
  if (!asset) {
    throw new Error(`SeqKit is not managed on ${platform}/${arch}; supported platforms are macOS and Linux on x64 or arm64.`);
  }
  return asset;
}
