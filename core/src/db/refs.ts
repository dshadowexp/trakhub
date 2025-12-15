import { FileSystem } from "../lib/standard";
import { TrakRepository } from "../repository";
import { isValidSha } from "../util";
import { getConfig, setConfig, TrakConfig } from "./config";

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
        const pattern = new RegExp(`^${patternStr}$`);
        
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
}

export class TrakRemotes {
    static readonly DEFAULT_REMOTE = "origin";

    static async add(repo: TrakRepository, name: string, url: string, branches: string[]) {
        branches = branches.length === 0 ? ["*"] : branches;
        const cfg = await getConfig('local');

        if (cfg.get("remote", name, "url")) {
            //@config.save might be needed
            throw new Error(`remote ${ name } already exists.`);
        }

        cfg.set("remote", name, url, "url");

        for (const branch of branches) {
            const source = (await TrakRepository.repoFile(repo, false, "refs", "heads", branch))!;
            const target = (await TrakRepository.repoFile(repo, false, "refs", "remotes", name, branch))!;
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

    static async get(subSection: string): Promise<ConfigRemoteSection | null> {
        const cfg = await getConfig('local');
        if(!cfg.getSection("remote", subSection))
            return null;

        return new ConfigRemoteSection(cfg, subSection);
    }
}

class SymRef {
    constructor(public readonly path: string) {}

    isHead(): boolean {
        return this.path === "HEAD";
    }

    async readOid(repo: TrakRepository): Promise<string | null> {
        return await TrakRefs.readRef(repo, this.path);
    }
}

export class TrakRefs {
    static async listAllRefs(repo: TrakRepository): Promise<SymRef[]> {
        const refsPath = TrakRepository.repoPath(repo, "refs");
        return [new SymRef('HEAD'), ...await this.listRefs(refsPath)]
    }

    static async listBranches(repo: TrakRepository): Promise<SymRef[]> {
        const headsPath = TrakRepository.repoPath(repo, "refs", "heads");
        return await this.listRefs(headsPath);
    }

    private static async listRefs(dirname: string): Promise<SymRef[]> {
        try {
            const refs = await FileSystem.listFiles(dirname);
            return refs.map(ref => new SymRef(ref));
        } catch {
            return [];
        }
    }

    static async branchExists(repo: TrakRepository, branchName: string) {
        const refsFilePath = (await TrakRepository.repoFile(repo, false, "refs", "heads", branchName))!;
        return FileSystem.exists(refsFilePath);
    }

    static async tagExists(repo: TrakRepository, branchName: string) {
        const refsFilePath = (await TrakRepository.repoFile(repo, false, "refs", "tags", branchName))!;
        return FileSystem.exists(refsFilePath);
    }
    
    static async resolve(repo: TrakRepository, ref: string) {
        // Check if it's a branch
        const refsFilePath = (await TrakRepository.repoFile(repo, false, "refs", "heads", ref))!;
        if (FileSystem.exists(refsFilePath))
            return (await FileSystem.readFile(refsFilePath)).toString();
        
        // Check if it's a tag
        const tagsFilePath = (await TrakRepository.repoFile(repo, false, "refs", "tags", ref))!;
        if (FileSystem.exists(tagsFilePath))
            return (await FileSystem.readFile(tagsFilePath)).toString();
        
        // Check if it's a direct SHA
        if(isValidSha(ref))
            return ref;
        
        // Check HEAD
        if (ref === "HEAD")
            return ''; //dereference_symbolic_ref("HEAD")
        
        return null;
    }

    static async updateHead(repo: TrakRepository, commitHash: string) {
        const headFilePath = await TrakRepository.repoFile(repo, true, "HEAD");
        if (!headFilePath)
            return;

        await FileSystem.writeFile(headFilePath, commitHash);
    }

    static async setCurrentBranch(repo: TrakRepository, branchName: string) {
        const headFilePath = await TrakRepository.repoFile(repo, true, "HEAD");
        if (!headFilePath || !FileSystem.exists(headFilePath))
            return "master";
        
        await FileSystem.writeFile(headFilePath, `ref: refs/heads/${branchName}`);
    }

    static async getCurrentBranch(repo: TrakRepository): Promise<string> {
        const headFilePath = await TrakRepository.repoFile(repo, true, "HEAD");
        if (!headFilePath)
            return "master";

        const headContent = (await FileSystem.readFile(headFilePath)).toString().trim();
        const prefix = 'ref: refs/heads/';
        if (headContent.startsWith(prefix))
            return headContent.substring(prefix.length)

        // detached HEAD
        return "HEAD";
    }

    static async getBranchCommit(repo: TrakRepository, branchName: string) {
        // Construct branch file path
        const branchFile = await TrakRepository.repoFile(repo, true, "refs", "heads", branchName);
        if (!branchFile || !FileSystem.exists(branchFile)) 
            return null

        return (await FileSystem.readFile(branchFile)).toString().trim();
    }

    static async setBranchCommit(repo: TrakRepository, branchName: string, commitHash: string) {
        // Construct branch file path
        const branchFile = await TrakRepository.repoFile(repo, true, "refs", "heads", branchName);
        if (!branchFile) 
            return

        await FileSystem.writeFile(branchFile, commitHash);
    }

    static async setCurrentHeadCommit(repo: TrakRepository, commitHash: string) {
        const currentBranch = await this.getCurrentBranch(repo);
        await this.setBranchCommit(repo, currentBranch, commitHash);
    }

    static async getCurrentHeadCommit(repo: TrakRepository,) {
        const headRef = await this.readRef(repo, "HEAD");
        if (!headRef || headRef.trim() === "") {
            return null;
        }
    
        // CASE 1: Symbolic reference (ref: refs/heads/main)
        if (headRef.startsWith("ref:")) {
            const branchRef = this._extractBranchFromSymbolic(headRef);
            if (!branchRef) return null;
            return await this.readRef(repo, branchRef);
        }
    
        // CASE 2: Detached HEAD (HEAD contains a commit SHA)
        return headRef.trim();
    }
    
    static async readRef(repo: TrakRepository, refPath: string) {
        const fullPath = await TrakRepository.repoFile(repo, false, refPath);
        if (!fullPath || !FileSystem.exists(fullPath))
            return null;
        
        return (await FileSystem.readFile(fullPath)).toString().trim();
    }
    
    
    private static _extractBranchFromSymbolic(symbolic: string): string | null {
        // Expect format: "ref: <path>"
        // Example: "ref: refs/heads/main"
        const parts = symbolic.split(" ");
    
        if (parts.length !== 2) return null;
    
        const refPath = parts[1].trim();
        return refPath !== "" ? refPath : null;
    }
}