import { TrakRepository } from "../repository";
import { MAX_PATH_SIZE } from "../constants";
import type { TrakIndexEntry, TrakIndexRecord } from "../types";
import { TrakFileSystem } from "../file-system";

const HEADER_SIZE = 12;
const HEADER_FORMAT = "a4N2";
const SIGNATURE = "DIRC";
const VERSION = 2;

export class TrakIndex {
    private static _createIndexEntry(path: string, oid: string): string {
        // Get file stats
        const stats = TrakFileSystem.stats(path);
        
        // Initialize index extr
        const entry: TrakIndexEntry = {
            ctimeSeconds: stats.ctime.getTime() / 1000,
            ctimeNanoseconds: stats.ctime.getMilliseconds(),
            mtimeSeconds: stats.mtime.getTime() / 1000,
            mtimeNanoseconds: stats.mtime.getMilliseconds(),
            dev: stats.dev,
            ino: stats.ino,
            mode: stats.mode,
            uid: stats.uid,
            gid: stats.gid,
            size: stats.size,
            oid: Buffer.from(oid),
            flags: Math.min(Buffer.from(path).byteLength, MAX_PATH_SIZE),
            path,
        };
        // Return the values of the index entry
        return Object.values(entry).join(" ");
    }

    static async loadIndex(repo: TrakRepository): Promise<TrakIndexRecord> {
        const indexFilePath = await TrakRepository.repoFile(repo, false, "index");

        if (!indexFilePath || !TrakFileSystem.exists(indexFilePath))
            return {};

        try {
            const indexContent = (await TrakFileSystem.readFile(indexFilePath)).toString();
            if (!indexContent.trim())
                return {};

            const indexEntries: TrakIndexRecord = {};
            for (const [key, value] of Object.entries(JSON.parse(indexContent))) {
                const valuesSplit = (value as string).split(" ");
                indexEntries[key] = valuesSplit[valuesSplit.length - 3] || valuesSplit[0]; // Remove || when writing the actual
            }

            return indexEntries;
        } catch (error) {
            throw new Error(`Error loading index: ${error}`);
        }
    }

    static async saveIndex(repo: TrakRepository, indexEntries: TrakIndexRecord) {
        const indexFilePath = await TrakRepository.repoFile(repo, true, "index");
        if (!indexFilePath)
            return;

        //const header = Buffer.concat([Buffer.from(signature), Buffer.from(version.toString()), Buffer.from(index.length)]);
        // const rawEntries = Object.entries(indexEntries).map(([path, oid]) => TrakIndex._createIndexEntry(path, oid));
        // console.log(rawEntries);
        
        try {
            await TrakFileSystem.writeFile(indexFilePath, JSON.stringify(indexEntries, null, 2));
        } catch (error) {
            throw new Error(`Error saving index: ${error}`);
        }
    }

    static async clearIndex(repo: TrakRepository) {
        await TrakIndex.saveIndex(repo, {});
    }
}