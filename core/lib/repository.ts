import { mkdir, realpath } from "fs/promises";
import { join } from "path";
import { TrakFileSystem } from "./file-system";

export class TrakRepository {
    private _trakDir: string;

    constructor(private _workTree: string, force: boolean = false) {
        this._trakDir = join(this._workTree, ".trak");

        if (!(force || TrakFileSystem.exists(this._trakDir) && TrakFileSystem.isDirectory(this._trakDir))) {
            throw new Error(`Not a Git repository ${this._workTree}`)
        }
    }

    get trakDir(): string {
        return this._trakDir;
    }

    get workTree(): string {
        return this._workTree;
    }

    static repoPath(repo: TrakRepository, ...path: string[]): string {
        return join(repo.trakDir, ...path);
    }

    static async repoFile(repo: TrakRepository, mkDir: boolean, ...path: string[]) {
        if (await this.repoDir(repo, mkDir, ...path.slice(0, -1))) {
            return this.repoPath(repo, ...path);
        }
    }

    static async repoDir(repo: TrakRepository, mkDir: boolean, ...path: string[]) {
        const fullPath = this.repoPath(repo, ...path);

        if (TrakFileSystem.exists(fullPath)) {
            if (TrakFileSystem.isDirectory(fullPath)) {
                return fullPath;
            } else {
                throw new Error(`Not a directory ${ fullPath }`);
            }
        }

        if (mkDir) {
            await mkdir(fullPath, { recursive: true });
            return fullPath;
        } else {
            return null;
        }
    }

    static async repoFind(path: string = '.', required: boolean = true): Promise<TrakRepository | null> {
        path = await realpath(path);

        if (TrakFileSystem.isDirectory(join(path, '.trak'))) {
            return new TrakRepository(path);
        }

        const parent = await realpath(join(path, ".."));
        if (parent === path) {
            if (required) {
                throw new Error('No git directory');
            } else {
                return null;
            }
        }

        return await this.repoFind(parent, required);
    }
}