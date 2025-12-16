import { join } from "path";
import { realpathSync } from "fs";
import { TObjects } from "./objects";
import { TIndex } from "./t-index";
import { TRefs } from "./refs";
import { FileSystem } from "../lib/standard";
import { Workspace } from "./workspace";

export class TRepository {
    private _trakDir: string;
    private _workspace: Workspace | undefined;
    private _objects: TObjects | undefined;
    private _index: TIndex | undefined;
    private _refs: TRefs | undefined;
    private _config: undefined;

    constructor(private _workTree: string) {
        this._trakDir = join(this._workTree, ".trak");
    }

    get objects(): TObjects {
        return this._objects ??= new TObjects(join(this._trakDir, "objects"));
    }

    get index(): TIndex {
        return this._index ??= new TIndex(join(this._trakDir, "index"));
    }

    get refs(): TRefs {
        return this._refs ??= new TRefs(join(this._trakDir, "refs"));
    }

    get workspace(): Workspace {
        return this._workspace ??= new Workspace(this._workTree);
    }

    static repoFind(path: string = '.', required: boolean = true): TRepository | null {
        path = realpathSync(path);

        if (FileSystem.isDirectory(join(path, '.trak'))) { //replace with the workspace
            return new TRepository(path);
        }

        const parent = realpathSync(join(path, ".."));
        if (parent === path) {
            if (required) {
                throw new Error('No git directory');
            } else {
                return null;
            }
        }

        return this.repoFind(parent, required);
    }
}
