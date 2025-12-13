import { PackFileObjectTypeEnum } from "../types";
import { inflateSync, type Inflate } from "zlib";

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

const fetchRefs = async (trakUrl: string) => {
    try {
        const response = await fetch(
            `${trakUrl}/info/refs?service=git-upload-pack`,
            { method: "GET" }
        );

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

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
    } catch (error) {
        console.error(error);
    }

    return null;
};