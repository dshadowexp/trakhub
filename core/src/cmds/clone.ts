import { inflateSync, type Inflate } from "zlib";
import { PackFileObjectTypeEnum } from "../types";

const fetchRefs = async (trakUrl: string) => {
    try {
        const response = await fetch(
            `${trakUrl}/info/refs?service=git-upload-pack`,
            { method: "GET" }
        );

        if (response.ok) {
            const text = await response.text();
            const [additions, ...refs] = text.split("\n").slice(1, -1);
            const capabilities = additions.split("\0")[1].split(" ");
            const symref = capabilities.find((cap) => cap.startsWith("symref=HEAD:"));

            return {
                capabilities,
                HEAD: symref?.split("symref=HEAD:")[1] || "",
                data: refs.map((ref) => {
                const [hash, name] = ref.split(" ");

                // the first 4 bytes represent the size of the entire string
                return { hash: hash.slice(4), ref: name };
                }),
            };
        }
    } catch (error) {
        console.error(error);
    }

    return null;
};

const fetchPackFiles = async (trakUrl: string, wantLines: string[]) => {
    try {
        const response = await fetch(`${trakUrl}/git-upload-pack`, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-git-upload-pack-request",
            },
            body: Buffer.concat([
                ...wantLines.map(Buffer.from),
                Buffer.from("00000009done\n"),
            ]),
        });

        if (response.ok) {
            const blob = await response.blob();
            return Buffer.from(await blob.arrayBuffer());
        }
    } catch (error) {
        console.error(error);
    }
};

class WantLine {
    #capabilities = "";

    constructor(private hash: string) {}

    get #wantStr() {
        return this.#capabilities
        ? `want ${this.hash} ${this.#capabilities}\n`
        : `want ${this.hash}\n`;
    }

    get #length() {
        const length = this.#wantStr.length + 4;

        return length.toString(16).padStart(4, "0");
    }

    addCapabilities(str: string) {
        this.#capabilities = str;
    }

    toString() {
        return `${this.#length}${this.#wantStr}`;
    }

    toBuffer() {
        return Buffer.from(this.toString());
    }
}

class PackFile {
    VERSION: number;
    numOfObjects: number;

    constructor(private raw: Buffer) {
        // Skip side-band data
        let startOfPack = this.raw.indexOf(Buffer.from("PACK"));
        if (startOfPack === -1) {
        throw new Error("PACK signature not found");
        }
        this.raw = this.raw.slice(startOfPack);

        const version = this.raw.readUInt32BE(4);
        const length = this.raw.readUInt32BE(8);

        this.VERSION = version;
        this.numOfObjects = length;
    }

    get objects() {
        const objs: {
            type: PackFileObjectTypeEnum;
            size: number;
            reference?: string;
            data: Buffer;
        }[] = [];

        let offset = 12; // Start after PACK header
        for (let i = 0; i < this.numOfObjects; i++) {
            let reference = "";
            const curByte = this.raw[offset];
            let size = curByte & 0x0f;
            const type: PackFileObjectTypeEnum = (curByte >> 4) & 0x07;

            let shift = 4;
            let hasMore = (curByte & 0x80) !== 0;
            offset++;

            while (hasMore) {
                const nextByte = this.raw[offset];
                size |= (nextByte & 0x7f) << shift;
                hasMore = (nextByte & 0x80) !== 0;
                shift += 7;
                offset++;
            }

            if (type === PackFileObjectTypeEnum.REF_DELTA) {
                reference = this.raw.toString("hex", offset, offset + 20);
                offset += 20;
            }

            const { buffer: decompressedData, engine } = inflateSync(
                this.raw.subarray(offset),
                { info: true }
            ) as Buffer & { engine: Inflate };
            offset += engine.bytesWritten;

            objs.push({
                type,
                size,
                reference,
                data: Buffer.from(decompressedData),
            });
        }

        return objs;
    }
}

class RefDelta {
  #offset = 0;
  #sourceBuffer: Buffer;
  #targetBuffer: Buffer;
  #deltaBuffer: Buffer;
  #sourceSize: number;
  #targetSize: number;

  constructor(deltaBuffer: Buffer, sourceBuffer: Buffer) {
    this.#deltaBuffer = deltaBuffer;
    this.#sourceBuffer = sourceBuffer;

    this.#sourceSize = this.#readSize();
    this.#targetSize = this.#readSize();
    this.#targetBuffer = Buffer.alloc(this.#targetSize);

    let targetOffset = 0;
    while (this.#offset < this.#deltaBuffer.length) {
      const instruction = this.#deltaBuffer[this.#offset++];
      if (instruction & 0x80) {
        // Copy instruction
        let copyOffset = 0;
        let copySize = 0;
        if (instruction & 0x01)
          copyOffset |= this.#deltaBuffer[this.#offset++] << 0;
        if (instruction & 0x02)
          copyOffset |= this.#deltaBuffer[this.#offset++] << 8;
        if (instruction & 0x04)
          copyOffset |= this.#deltaBuffer[this.#offset++] << 16;
        if (instruction & 0x08)
          copyOffset |= this.#deltaBuffer[this.#offset++] << 24;
        if (instruction & 0x10)
          copySize |= this.#deltaBuffer[this.#offset++] << 0;
        if (instruction & 0x20)
          copySize |= this.#deltaBuffer[this.#offset++] << 8;
        if (instruction & 0x40)
          copySize |= this.#deltaBuffer[this.#offset++] << 16;
        if (copySize === 0) copySize = 0x10000;

        this.#sourceBuffer.copy(
          this.#targetBuffer,
          targetOffset,
          copyOffset,
          copyOffset + copySize
        );
        targetOffset += copySize;
      } else {
        // Add instruction
        const addSize = instruction & 0x7f;
        this.#deltaBuffer.copy(
          this.#targetBuffer,
          targetOffset,
          this.#offset,
          this.#offset + addSize
        );
        this.#offset += addSize;
        targetOffset += addSize;
      }
    }
  }

  get buffer() {
    return this.#targetBuffer;
  }

  #readSize() {
    let size = 0;
    let shift = 0;
    let byte;
    do {
      byte = this.#deltaBuffer[this.#offset++];
      size |= (byte & 0x7f) << shift;
      shift += 7;
    } while (byte & 0x80);
    return size;
  }
}
