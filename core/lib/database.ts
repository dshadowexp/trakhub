import { createReadStream, createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { createDeflate, createInflate } from "zlib";
import { Readable, Writable } from "stream";
import { TrakRepository } from "./repository";
import { TrakBlob, TrakCommit, TrakObject, TrakTree } from "./objects";

export class TrakObjects {
    static async writeObject(object: TrakObject, repo?: TrakRepository | null) {
        // Compute object hash
        const objectHash = object.hash();

        if (repo) {
            // Create the directory structure (e.g., .git/objects/ab/)
            const objectFilePath = await TrakRepository.repoFile(repo, true, "objects",  objectHash.substring(0, 2), objectHash.substring(2));

            // Ensure directory exists
            if (objectFilePath && !TrakRepository.exists(objectFilePath)) {
                const result = Buffer.concat([Buffer.from(`${object.type} ${object.content.byteLength}\0`), object.content]);
        
                await pipeline(
                    Readable.from(result), 
                    createDeflate(), 
                    createWriteStream(objectFilePath)
                );
            }
        }

        return objectHash;
    }

    static async readObject(repo: TrakRepository, hash: string) {
        const path = await TrakRepository.repoFile(repo, false, "objects", hash.substring(0, 2), hash.substring(2));

        if (!path || !TrakRepository.exists(path))
            throw new Error(`Object ${hash} not found`);

        if (!TrakRepository.isFile(path))
            return null;

        const chunks: Buffer[] = [];
        const collectStream = new Writable({
            write(chunk, encoding, callback) {
                chunks.push(chunk);
                callback();
            }
        });

        await pipeline(
            createReadStream(path),
            createInflate(),
            collectStream
        );

        // Gather decompressed byte
        const decompressed = Buffer.concat(chunks);

        // Find index of null byte
        const nullIdx = decompressed.indexOf(0);
        if (nullIdx === -1) {
            throw new Error('Invalid object format: no null byte found');
        }

        const header = decompressed.subarray(0, nullIdx);
        const content = decompressed.subarray(nullIdx + 1);

        const parts = header.toString().split(' ');
        if (parts.length !== 2) {
            throw new Error(`Invalid header format: "${header}"`);
        }

        const [objectType, sizeStr] = parts;
        const size = parseInt(sizeStr, 10);
        
        // Verify content size matches header
        if (content.byteLength !== size) {
            console.warn(`Size mismatch: expected ${size}, got ${content.byteLength}`);
        }

        const baseObject = new TrakObject(objectType, content);
        switch(objectType) {
            case 'blob':
                return TrakBlob.deserialize(baseObject.content);
            case 'tree':
                return TrakTree.deserialize(baseObject.content);
            case 'commit':
                return TrakCommit.deserialize(baseObject.content);
            default:
                throw new Error(`Unknown type ${ objectType } for object ${ hash }`);
        }
    }   
}