import { TrakRepository } from "../repository";
import { FileSystem } from "../lib/standard";
import { createHash } from "crypto";

const HEADER_SIZE = 12;
const SIGNATURE = "DIRC";
const MAX_PATH_SIZE = 0xfff;

export type TrakIndexEntry = {
    ctimeSec: number;
    ctimeNano: number;
    mtimeSec: number;
    mtimeNano: number;
    dev: number;
    ino: number;
    mode: number;
    uid: number;
    gid: number;
    size: number;
    sha1: Buffer;
    flags: number;
    path: string;
}

export class TrakIndex {
    static version = 2;
    private static _entries: TrakIndexEntry[] = [];

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
        const flags = Math.min(Buffer.from(path).byteLength, MAX_PATH_SIZE);
        
        // Return the values of the index entry
        return {
            ctimeSec: Math.floor(stats.ctime.getTime() / 1000),
            ctimeNano: stats.ctime.getMilliseconds(),
            mtimeSec: Math.floor(stats.mtime.getTime() / 1000),
            mtimeNano: stats.mtime.getMilliseconds(),
            dev: stats.dev,
            ino: stats.ino,
            mode: parseInt(FileSystem.mode(path)),
            uid: stats.uid,
            gid: stats.gid,
            size: stats.size,
            sha1: Buffer.from(hash, "hex"),
            flags: flags,
            path,
        };
    }

    private static _createIndexEntryFromDb(path: string, item: { mode: string, hash: string}, n: number) {
        const flags = Math.min(Buffer.from(path).byteLength, MAX_PATH_SIZE);
        return {
            ctimeSec: 0,
            ctimeNano: 0,
            mtimeSec: 0,
            mtimeNano: 0,
            dev: 0,
            ino: 0,
            mode: parseInt(item.mode),
            uid: 0,
            gid: 0,
            size: 0,
            sha1: Buffer.from(item.hash, "hex"),
            flags: ( n << 12) | flags,
            path,
        };
    }

    private static _stage(flags: number): number {
        return (flags >> 12) & 0x3;
    }

    private static _removeWithStage(path: string, stage: number) {
        this._entries = this._entries.filter(value => value.path === path && this._stage(value.flags) === stage);
    }

    /**
     * 
     */
    static get entries(): TrakIndexEntry[] {
        return this._entries;
    }

    /**
     * 
     * @param path 
     * @returns 
     */
    static isTracked(path: string): boolean {
        return [1, 2, 3].some((value) => this.getEntry(path, value) !== undefined);
    }

    /**
     * 
     * @param path 
     * @param stage 
     * @returns 
     */
    static getEntry(path: string, stage: number = 0): TrakIndexEntry | undefined {
        return this._entries.find(value => value.path === path && this._stage(value.flags) === stage);
    }

    /**
     * 
     * @param path 
     * @param hash 
     */
    static add(path: string, hash: string) {
        console.log(`+>>>>Index adding - ${ path }`);
        const entry = this._createIndexEntry(path, hash);
        this._entries.push(entry);
    }

    /**
     * 
     * @param path 
     * @param items 
     */
    static addConflictSet(path: string, items: { mode: string, hash: string}[]) {
        this._removeWithStage(path, 0);
        items.forEach((value, i) => {
            const entry = this._createIndexEntryFromDb(path, value, i + 1);
            this._entries.push(entry);
        })
    }

    /**
     * 
     * @returns 
     */
    static hasConflict() {
        return this._entries.some(value => this._stage(value.flags) > 0);
    }

    /**
     * 
     * @param path 
     */
    static remove(path: string) {
        console.log(`-<<<<<Index removing - ${ path }`);
        [1, 2, 3].forEach((value) => {
            this._removeWithStage(path, value);
        });
        console.log(this.getFilePaths());
    }

    static getFilePaths(): string[] {
        return this._entries.map(value => value.path);
    }

    static hasConflicts(): boolean {
        return this.entries.some(value => this._stage(value.flags) > 0);
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

        this._entries = entries;
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

        for (const entry of Object.values(this._entries)) {
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
        header.writeUInt32BE(Object.keys(this._entries).length, 8);

        const allData = Buffer.concat([header, ...packedEntries]);

        // --- SHA-1 checksum ---
        const digest = createHash("sha1").update(allData).digest();

        // --- Write final file ---
        await FileSystem.writeFile(indexPath, Buffer.concat([allData, digest]));
    }

    /**
     * 
     * @param repo 
     */
    static async clear() {
        this._entries = []
    }
}