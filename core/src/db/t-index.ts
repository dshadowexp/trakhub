import { TrakRepository } from "../repository";
import type { TrakIndexEntry, TrakIndexRecord } from "../types";
import { FileSystem } from "../lib/standard";
import { createHash } from "crypto";

const HEADER_SIZE = 12;
const SIGNATURE = "DIRC";
const MAX_PATH_SIZE = 0xfff;

export class TrakIndex {
    static version = 2;
    static entries: Record<string, TrakIndexEntry> = {};

    /**
     * 
     * @param buf 
     * @param offset 
     * @returns 
     */
    private static _readUInt32BE(buf: Buffer, offset: number): number {
        return buf.readUInt32BE(offset);
    }

    /**
     * 
     * @param value 
     * @param buffer 
     * @param offset 
     */
    private static _writeUInt32BE(value: number, buffer: Buffer, offset: number) {
        buffer.writeUInt32BE(value, offset);
    }

    /**
     * 
     * @param path 
     * @param hash 
     * @returns 
     */
    private static _createIndexEntry(path: string, hash: string): TrakIndexEntry {
        // Get file stats
        const stats = FileSystem.stats(path);
        
        // Return the values of the index entry
        return {
            ctimeSec:  Math.floor(stats.ctime.getTime() / 1000),
            ctimeNano: stats.ctime.getMilliseconds(),
            mtimeSec: Math.floor(stats.mtime.getTime() / 1000),
            mtimeNano: stats.mtime.getMilliseconds(),
            dev: stats.dev,
            ino: stats.ino,
            mode: parseInt(FileSystem.mode(stats)),
            uid: stats.uid,
            gid: stats.gid,
            size: stats.size,
            sha1: Buffer.from(hash, "hex"),
            flags: Math.min(Buffer.from(path).byteLength, MAX_PATH_SIZE),
            path,
        };
    }

    /**
     * 
     * @param path 
     * @param hash 
     */
    static async add(path: string, hash: string) {
        const entry = this._createIndexEntry(path, hash);
        this.entries[path] = entry;
    }

    /**
     * 
     * @param repo 
     */
    static async clear(repo: TrakRepository) {
        this.entries = {}
        await TrakIndex.save(repo);
    }

    /**
     * 
     * @param repo 
     * @returns 
     */
    static async load(repo: TrakRepository) {
        const indexPath = await TrakRepository.repoFile(repo, false, "index");
        if (!indexPath || !FileSystem.exists(indexPath))
            return {};

        if (!FileSystem.exists(indexPath)) return {};

        const data = await FileSystem.readFile(indexPath);

        // --- Verify SHA-1 checksum ---
        const fileWithoutChecksum = data.subarray(0, data.length - 20);
        const checksum = data.subarray(data.length - 20);

        const actualDigest = createHash("sha1").update(fileWithoutChecksum).digest();

        if (!actualDigest.equals(checksum)) throw new Error("Invalid index checksum");

        // --- Header ---
        const signature = data.subarray(0, 4).toString("ascii");
        const version = data.readUInt32BE(4);
        const numEntries = data.readUInt32BE(8);

        if (signature !== SIGNATURE) throw new Error("Invalid index signature");
        if (version !== this.version) throw new Error(`Unsupported index version ${version}`);

        const entries: TrakIndexEntry[] = [];

        let offset = 12;                          // start of entries
        const end = data.length - 20;             // before checksum

        while (offset + 62 < end && entries.length < numEntries) {
            // Parse fixed fields (62 bytes)
            const fieldsEnd = offset + 62;
            const fixed = data.subarray(offset, fieldsEnd);

            const ctimeSec = this._readUInt32BE(fixed, 0);
            const ctimeNano = this._readUInt32BE(fixed, 4);
            const mtimeSec = this._readUInt32BE(fixed, 8);
            const mtimeNano = this._readUInt32BE(fixed, 12);
            const dev = this._readUInt32BE(fixed, 16);
            const ino = this._readUInt32BE(fixed, 20);
            const mode = this._readUInt32BE(fixed, 24);
            const uid = this._readUInt32BE(fixed, 28);
            const gid = this._readUInt32BE(fixed, 32);
            const size = this._readUInt32BE(fixed, 36);
            const sha1 = fixed.subarray(40, 60);
            const flags = fixed.readUInt16BE(60);

            // Parse file path (null-terminated)
            let pathEnd = fieldsEnd;
            while (pathEnd < end && data[pathEnd] !== 0x00) {
                pathEnd++;
            }

            if (pathEnd >= end) throw new Error("Index path missing null terminator");

            const filePath = data.subarray(fieldsEnd, pathEnd).toString("utf8");

            // Build entry object
            entries.push({
                ctimeSec,
                ctimeNano,
                mtimeSec,
                mtimeNano,
                dev,
                ino,
                mode,
                uid,
                gid,
                size,
                sha1,
                flags,
                path: filePath,
            });

            // Entry size with padding:
            const pathLength = pathEnd - fieldsEnd;
            const entryLength = Math.ceil((62 + pathLength + 1) / 8) * 8; // +1 for null

            offset += entryLength;
        }

        if (entries.length !== numEntries) {
            throw new Error("Index entry count mismatch");
        }

        this.entries = entries.reduce((result, current) => {
            return { ...result, [current.path]: current};
        }, {});
    }

    /**
     * 
     * @param repo 
     * @returns 
     */
    static async save(repo: TrakRepository) {
        const indexPath = await TrakRepository.repoFile(repo, true, "index");
        if (!indexPath)
            return;

        const packedEntries: Buffer[] = [];

        for (const entry of Object.values(this.entries)) {
            // --- Build the 62-byte header ---
            const head = Buffer.alloc(62);

            this._writeUInt32BE(entry.ctimeSec, head, 0);
            this._writeUInt32BE(entry.ctimeNano, head, 4);
            this._writeUInt32BE(entry.mtimeSec, head, 8);
            this._writeUInt32BE(entry.mtimeNano, head, 12);
            this._writeUInt32BE(entry.dev, head, 16);
            this._writeUInt32BE(entry.ino, head, 20);
            this._writeUInt32BE(entry.mode, head, 24);
            this._writeUInt32BE(entry.uid, head, 28);
            this._writeUInt32BE(entry.gid, head, 32);
            this._writeUInt32BE(entry.size, head, 36);

            // sha1 (20 bytes)
            entry.sha1.copy(head, 40);

            // flags (2 bytes, BE)
            head.writeUInt16BE(entry.flags, 60);

            // --- Path bytes ---
            const pathBytes = Buffer.from(entry.path, "utf8");
            const pathLen = pathBytes.length;

            // --- Compute padded entry size ---
            const entryLength = Math.ceil((62 + pathLen + 1) / 8) * 8; // +1 for null

            const total = Buffer.alloc(entryLength);

            // 62-byte header
            head.copy(total, 0);

            // file path
            pathBytes.copy(total, 62);

            // null + padding already zero-filled because Buffer.alloc()

            packedEntries.push(total);
        }

        // --- HEADER (DIRC, version 2, entry count) ---
        const header = Buffer.alloc(HEADER_SIZE);
        header.write(SIGNATURE, 0, "ascii");
        header.writeUInt32BE(this.version, 4);           // version 2
        header.writeUInt32BE(Object.keys(this.entries).length, 8);

        const allData = Buffer.concat([header, ...packedEntries]);

        // --- SHA-1 checksum ---
        const digest = createHash("sha1").update(allData).digest();

        // --- Write final file ---
        await FileSystem.writeFile(indexPath, Buffer.concat([allData, digest]));
    }

    // /**
    //  * 
    //  * @param repo 
    //  * @returns 
    //  */
    // static async loadIndex(repo: TrakRepository): Promise<TrakIndexRecord> {
    //     const indexFilePath = await TrakRepository.repoFile(repo, false, "index");
    //     if (!indexFilePath || !FileSystem.exists(indexFilePath))
    //         return {};

    //     try {
    //         const indexContent = (await FileSystem.readFile(indexFilePath)).toString();
    //         if (!indexContent.trim())
    //             return {};

    //         const indexEntries: TrakIndexRecord = {};
    //         for (const [key, value] of Object.entries(JSON.parse(indexContent))) {
    //             const valuesSplit = (value as string).split(" ");
    //             indexEntries[key] = valuesSplit[valuesSplit.length - 3] || valuesSplit[0]; // Remove || when writing the actual
    //         }

    //         return indexEntries;
    //     } catch (error) {
    //         throw new Error(`Error loading index: ${error}`);
    //     }
    // }

    // static async saveIndex(repo: TrakRepository, indexEntries: TrakIndexRecord) {
    //     const indexFilePath = await TrakRepository.repoFile(repo, true, "index");
    //     if (!indexFilePath)
    //         return;

    //     //const header = Buffer.concat([Buffer.from(signature), Buffer.from(version.toString()), Buffer.from(index.length)]);
    //     // const rawEntries = Object.entries(indexEntries).map(([path, oid]) => TrakIndex._createIndexEntry(path, oid));
    //     // console.log(rawEntries);
        
    //     try {
    //         await FileSystem.writeFile(indexFilePath, JSON.stringify(indexEntries, null, 2));
    //     } catch (error) {
    //         throw new Error(`Error saving index: ${error}`);
    //     }
    // }


}