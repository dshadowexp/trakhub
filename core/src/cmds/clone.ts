




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
