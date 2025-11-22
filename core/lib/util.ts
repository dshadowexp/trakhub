import { createHash } from "crypto";

export function createSHA1hash(data: string): string {
    const hash = createHash('sha1');
    hash.update(data);
    return hash.digest('hex');
}

export function getByteSize(str: string): number {
    return Buffer.byteLength(str, 'ascii');
}