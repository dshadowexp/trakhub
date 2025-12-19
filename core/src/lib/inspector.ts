import { Stats } from 'fs';
import type { BaseEntry, IndexEntry } from "../repo/entries";
import type { TRepository } from "../repo/repository";
import { DiffAction } from '../types';
import { TBlob } from '../repo/objects';

export class Inspector {
    constructor(private _repo: TRepository) {}

    async trackableFile(path: string, stat: Stats | null): Promise<boolean> {
        if (!stat) return false;
        if (stat.isFile()) return !this._repo!.index.isTracked(path);
        if (!stat.isDirectory()) return false;
    
        const items = await this._repo!.workspace.listFiles(path);
        
        // Separate files and directories
        const files: [string, Stats][] = [];
        const dirs: [string, Stats][] = [];
        
        for (const [itemPath, itemStat] of items) {
            if (itemStat.isFile()) {
                files.push([itemPath, itemStat]);
            } else if (itemStat.isDirectory()) {
                dirs.push([itemPath, itemStat]);
            }
        }
        
        // Check files first
        for (const [itemPath, itemStat] of files) {
            if (await this.trackableFile(itemPath, itemStat)) {
                return true;
            }
        }
        
        // Then check directories
        for (const [itemPath, itemStat] of dirs) {
            if (await this.trackableFile(itemPath, itemStat)) {
                return true;
            }
        }
        
        return false;
    }

    async compareIndexToWorkspace(entry: IndexEntry | undefined, stat: Stats | undefined): Promise<DiffAction | null> {
        if (!entry) return DiffAction.UNTRACKED;
        if (!stat) return DiffAction.DELETE;
        if (!entry.statMatch(stat)) return DiffAction.MODIFY;
        if (entry.timesMatch(stat)) return null;

        const data = await this._repo.workspace.readFile(entry.path);
        const blob = new TBlob(data);
        const hash = this._repo.objects.hashObject(blob);
        if (hash !== entry.hash) 
            return DiffAction.MODIFY;
        return null;
    }

    compareTreeToIndex(item: BaseEntry | undefined, entry: IndexEntry | undefined): DiffAction | null {
        if (!item) return DiffAction.ADD;
        if (!entry) return DiffAction.DELETE;
        if (item.hash !== entry.hash || item.mode !== entry.mode) 
            return DiffAction.MODIFY;
        return null;
    }
}