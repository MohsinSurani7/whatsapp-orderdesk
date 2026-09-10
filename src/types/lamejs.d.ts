declare module "lamejs" {
  export class Mp3Encoder {
    constructor(channels: number, sampleRate: number, kbps: number);
    encodeBuffer(samples: Int16Array): Int8Array;
    flush(): Int8Array;
  }
}

declare module "lamejs/src/js/MPEGMode.js" {
  const MPEGMode: unknown;
  export default MPEGMode;
}

declare module "lamejs/src/js/Lame.js" {
  const Lame: unknown;
  export default Lame;
}

declare module "lamejs/src/js/BitStream.js" {
  const BitStream: unknown;
  export default BitStream;
}
