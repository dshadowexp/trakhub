import { realpath } from "fs/promises";
import { join } from "path";
import { FileSystem } from "./lib/standard";
import { mkdirSync } from "fs";

export class TrakRepository {
    private _trakDir: string;

    constructor(private _workTree: string, force: boolean = false) {
        this._trakDir = join(this._workTree, ".trak");

        if (!(force || FileSystem.exists(this._trakDir) && FileSystem.isDirectory(this._trakDir))) {
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

    static repoFile(repo: TrakRepository, mkDir: boolean, ...path: string[]) {
        if (this.repoDir(repo, mkDir, ...path.slice(0, -1))) {
            return this.repoPath(repo, ...path);
        }
    }

    static repoDir(repo: TrakRepository, mkDir: boolean, ...path: string[]) {
        const fullPath = this.repoPath(repo, ...path);

        if (FileSystem.exists(fullPath)) {
            if (FileSystem.isDirectory(fullPath)) {
                return fullPath;
            } else {
                throw new Error(`Not a directory ${ fullPath }`);
            }
        }

        if (mkDir) {
            mkdirSync(fullPath, { recursive: true });
            return fullPath;
        } else {
            return null;
        }
    }

    static async repoFind(path: string = '.', required: boolean = true): Promise<TrakRepository | null> {
        path = await realpath(path);

        if (FileSystem.isDirectory(join(path, '.trak'))) {
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

    static async isRepoIgnore(repo: TrakRepository, filePath: string) {
        const ignoreFile = join(repo.workTree, ".gitignore");
        if (FileSystem.exists(ignoreFile))
            return false

        const ignorePatterns = (await FileSystem.readFile(ignoreFile)).toString().split("\n");
        for (let pattern of ignorePatterns) {
            pattern = pattern.trim();
            if (pattern === "" || pattern.startsWith("#"))
                continue;

            
        }
    }
}