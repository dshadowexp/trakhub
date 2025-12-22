import { join, relative, dirname, resolve } from "path";
import { statSync } from "fs";
import { writeFile, readFile, readdir } from "fs/promises";
import { FileSystem } from "../lib/standard";
import { TrakRepository } from "../repository";
import { getConfig, setConfig, TrakConfig } from "./config";
import { Revision } from "../lib/revision";
import { unlink } from "fs/promises";
import { rmdir } from "fs/promises";
import type { TRepository } from "./repository";

const SYMREF = /^ref: (.+)$/;

export class SymRef {
    constructor(public path: string, private _refs: TRefs) {}

    get shortName() {
        return this._refs.shortName(this.path);
    }

    isHead(): boolean {
        return this.path === "HEAD";
    }

    async readHash(): Promise<string | null> {
        return await this._refs.readRef(this.path);
    }
}

class Ref {
    constructor(public oid: string) {}

    readHash(): string {
        return this.oid;
    }
}

export class TRefs {
    constructor(private _repoPath: string) {}

    get headPath(): string {
        return join(this._repoPath, "HEAD");
    }

    get refsPath(): string {
        return join(this._repoPath, "refs");
    }

    get headsPath(): string {
        return join(this.refsPath, "heads");
    }

    async updateHead(hash: string) {
        await this._updateSymRef(this.headPath, hash);
    }

    async readHead() {
        return this._readSymRef(this.headPath);
    }

    async setHead(revision: string, hash: string) {
        const head = this.headPath;
        const path = join(this.headsPath, revision);

        if (FileSystem.isFile(path)) {
            const reltv = relative(this._repoPath, path);
            await this._updateRefFile(head, `ref: ${ reltv }`);
        } else {
            await this._updateRefFile(head, hash);
        }
    }

    readRef(name: string) {
        const path = this._pathForName(name);
        return !path ? null : this._readSymRef(path);
    }

    async currentRef(source: string = "HEAD"): Promise<SymRef> {
        const ref = await this._readOidOrSymref(join(this._repoPath, source));

        if (ref instanceof SymRef) {
            return await this.currentRef(ref.path);
        } else if (ref instanceof Ref) {
            return new SymRef(source, this);
        }

        return new SymRef(source, this);
    }

    async reverseRefs() {
        const table = new Map<string, SymRef>();
        const refs = await this.listAllRefs();
        for (const ref of refs) {
            const hash = await ref.readHash();
            if (!hash) 
                continue;
            table.set(hash, ref);
        }
        return table;
    }

    async listAllRefs() {
        return [new SymRef("HEAD", this), ...await this._listRefs(this.headsPath)]
    }

    async createBranch(branchName: string, startHash: string) {
        if (Revision.INVALID_NAME.test(branchName))
            throw new Error(`${ branchName } is not a valid branch name`);

        const path = join(this.headsPath, branchName);

        if (FileSystem.exists(path))
            throw new Error(`A branch named ${ branchName } already exists`);

        await this._updateRefFile(path, startHash);
    }

    async listBranches() {
        return await this._listRefs(this.headsPath);
    }

    async deleteBranch(branchName: string) {
        const path = join(this.headsPath, branchName);
        const oid = await this._readSymRef(path);
        if (!oid)
            throw new Error(`No such branch: ${ branchName }`);

        await this._removeRefFile(path);
        return oid;
    }

    private async _listRefs(dirname: string): Promise<SymRef[]> {
        try {
            const names = await readdir(dirname);
            const refs: SymRef[] = [];

            for (const name of names) {
                const fullPath = join(dirname, name);

                if (statSync(fullPath).isDirectory()) {
                    refs.push(...(await this._listRefs(fullPath)));
                await this._listRefs(fullPath);
                } else {
                    const rel = relative(this._repoPath, fullPath);
                    refs.push(new SymRef(rel, this));
                }
            }

            return refs;
        } catch (err: any) {
            if (err.code === "ENOENT") {
                return [];
            }
            throw err;
        }
    }

    private async _readSymRef(path: string): Promise<string | null> {
        const ref = await this._readOidOrSymref(path);

        if (ref instanceof SymRef) {
            return await this._readSymRef(join(this._repoPath, ref.path));
        } else if (ref instanceof Ref) {
            return ref.oid;
        } else {
            return null;
        }
    }

    private async _updateSymRef(path: string, hash: string) {
        const ref = await this._readOidOrSymref(path);

        if (!(ref instanceof SymRef)) {
            await this._updateRefFile(path, hash);
        } else if (ref instanceof SymRef) {
            await this._updateSymRef(join(this._repoPath, ref.path), hash);
        } 
    }

    private async _readOidOrSymref(path: string): Promise<SymRef | Ref | null> {
        const data = await this._readRefFile(path);
        if (!data) return null;

        const match = SYMREF.exec(data);
        return match ? new SymRef(match[1], this) : new Ref(data);
    }

    private async _updateRefFile(path: string, hash: string) {
        try {
            await writeFile(path, hash);
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
                return;
            }
            throw err;
        }
    }

    private async _readRefFile(path: string) {
        try {
            return (await readFile(path, 'utf-8')).trim();
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
                return null;
            }
            throw err;
        }
    }

    private async _removeRefFile(path: string) {
        try {
            await unlink(path);
            await this._removeParentDirs(path);
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
                return null;
            }
            throw err;
        }
    }

    private async _removeParentDirs(path: string) {
        const headsPath = resolve(this.headsPath);
        let current = dirname(resolve(path));

        while (true) {
            if (current === headsPath) break;

            try {
                await rmdir(current);
            } catch (err: any) {
                // Equivalent to Errno::ENOTEMPTY
                if (err.code === "ENOTEMPTY" || err.code === "EEXIST") {
                    break;
                }
                throw err;
            }

            const parent = dirname(current);
            if (parent === current) break; // reached filesystem root
            current = parent;
        }
    }

    private _pathForName(name: string) {
        const prefixes = [this._repoPath, this.refsPath, this.headsPath];
        const prefix = prefixes.find((path) => {
            try {
                return FileSystem.stats(join(path, name)).isFile();
            } catch {
                return false;
            }
        });
        if (!prefix) return null;
        return join(prefix, name);
    }

    shortName(path: string): string {
        const fullPath = resolve(this._repoPath, path);
    
        const prefixes = [this.headsPath, this._repoPath];
    
        const prefix = prefixes.find((dir) => {
            let current = dirname(fullPath);
    
            while (true) {
                if (current === dir) return true;
    
                const parent = dirname(current);
                if (parent === current) break; // reached filesystem root
                current = parent;
            }
    
            return false;
        });
    
        if (!prefix) {
            throw new Error("No valid prefix found");
        }
    
        return relative(prefix, fullPath);
    }
}

export class TRemotes {
    static readonly DEFAULT_REMOTE = "origin";

    constructor(private _repo: TRepository) {

    }

    static async add(repo: TrakRepository, name: string, url: string, branches: string[]) {
        branches = branches.length === 0 ? ["*"] : branches;
        const cfg = await getConfig('local');

        if (cfg.get("remote", name, "url")) {
            //@config.save might be needed
            throw new Error(`remote ${ name } already exists.`);
        }

        cfg.set("remote", name, url, "url");

        for (const branch of branches) {
            const source = (TrakRepository.repoFile(repo, false, "refs", "heads", branch))!;
            const target = (TrakRepository.repoFile(repo, false, "refs", "remotes", name, branch))!;
            const spec = new Refspec(source, target, true);
            cfg.add("remote", name, spec.toString(), "fetch");
        }

        await setConfig('local', cfg.toString());
    }

    static async remove(name: string) {
        const cfg = await getConfig('local');

        if (!cfg.removeSection(name)) {
            throw new Error(`No such remote: ${ name }`);
        }

        await setConfig('local', cfg.toString());
    }

    static async listRemotes(): Promise<string[]> {
        const cfg = await getConfig('local');
        const remoteSection = cfg.getSections("remote");
        return remoteSection.map(section => section.subsection).filter(Boolean) as string[];
    }

    async get(subSection: string): Promise<ConfigRemoteSection | null> {
        const cfg = await this._repo.config.getConfig('local');
        if(!cfg.getSection("remote", subSection))
            return null;

        return new ConfigRemoteSection(cfg, subSection);
    }

    async getUpstream(branch: string) {
        const cfg = await this._repo.config.getConfig('local');
        const name = cfg.get("branch", "merge", branch) || '';
        return (await this.get(name))?.getUpstream(branch);
    }
}

class ConfigRemoteSection {
    constructor(private _config: TrakConfig, private _name: string) {}

    get fetchUrl() {
        return this._config.get("remote", "url", this._name);
    }

    get pushUrl() {
        return this._config.get("remote", "pushUrl", this._name) || this.fetchUrl;
    }

    get fetchSpecs() {
        return this._config.getAll("remote", "fetch", this._name);
    }

    get uploader() {
        return this._config.get("remote", "uploadpack", this._name);
    }

    getUpstream(branch: string) {
        const merge = this._config.get("branch", "merge", branch) || '';
        const target = Refspec.expand(this.fetchSpecs, [merge]);
        return Object.keys(target)[0];
    }
}

export class Refspec {
    private static readonly REFSPEC_FORMAT = /^(\+?)([^:]+):([^:]+)$/;

    constructor(private _source: string, private _target: string, private _forced: boolean) {}

    toString() {
        let spec = this._forced ? "+" : "";
        return `${ spec }${ this._source }:${ this._target }`;
    }

    matchRefs(refs: string[]): Record<string, [string, boolean]> {
        // If no wildcard, return single mapping
        if (this._source.includes("*")) {
            return { [this._target]: [this._source, this._forced] };
        }

        // Create pattern by replacing * with capture group
        const patternStr = this._source.replace("*", "(.*)");
        const pattern = new RegExp(`^${ patternStr }$`);
        
        const mappings: Record<string, [string, boolean]> = {};

        for (const ref of refs) {
            const match = ref.match(pattern);
            if (!match) continue;

            const captured = match[1];
            const dst = captured ? this._target.replace("*", captured) : this._target;
            
            mappings[dst] = [ref, this._forced];
        }

        return mappings;
    }

    static parse(spec: string): Refspec | null {
        const match = spec.match(Refspec.REFSPEC_FORMAT);
        
        if (!match) {
            return null;
        }

        const force = match[1] === "+";
        const source = match[2];
        const target = match[3];

        return new Refspec(source, target, force);
    }

    static canonical(name: string) {}

    static expand(specs: string[], refs: string[]): Record<string, [string, boolean]> {
        const refSpecs = specs.map(spec => Refspec.parse(spec));
        return refSpecs.reduce((accum, curr) => {
            if (!curr) return accum;
            return { ...accum, ...curr.matchRefs(refs) };
        }, {} as Record<string, [string, boolean]>);
    }
}