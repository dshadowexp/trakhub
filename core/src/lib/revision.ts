import { type TCommit, TObjectType } from "../repo/objects";
import type { TRepository } from "../repo/repository";

export type RevisionNode = Ref | Parent | Ancestor;

export interface Resolvable {
    resolve(context: any): string | undefined;
}

export class Ref implements Resolvable {
    constructor(public readonly name: string) {}

    resolve(context: any): string | undefined {
        return context.readRef(this.name);
    }
}

export class Parent implements Resolvable {
    constructor(public readonly rev: RevisionNode) {}

    resolve(context: any): string | undefined {
        const oid = this.rev.resolve(context);
        if (!oid) return undefined;

        return context.commitParent(oid);
    }
}

export class Ancestor implements Resolvable {
    constructor(
        public readonly rev: RevisionNode,
        public readonly n: number
    ) {}

    resolve(context: any): string | undefined {
        let oid = this.rev.resolve(context);
        if (!oid) return undefined;

        for (let i = 0; i < this.n; i++) {
            oid = context.commitParent(oid);
            if (!oid) return undefined;
        }

        return oid;
    }
}

export class Revision {
    // Same invalid-name rules as Git
    static readonly INVALID_NAME = new RegExp(
        [
            "^\\.",
            "\\/\\.",
            "\\.\\.",
            "^\\/",
            "\\/$",
            "\\.lock$",
            "@\\{",
            "[\\x00-\\x20*:?[\\\\\\]^~\\x7f]"
        ].join("|")
    );

    private static readonly PARENT = /^(.+)\^$/;
    private static readonly ANCESTOR = /^(.+)~(\d+)$/;

    private static readonly REF_ALIASES: Record<string, string> = {
        "@": "HEAD"
    };

    private _query: RevisionNode | undefined;
    private _errors: Error[];

    constructor(private _repo: TRepository, private _expr: string) {
        this._query = Revision.parse(_expr);
        this._errors = [];
    }

    get errors() {
        return this._errors;
    }

    async resolve(type: TObjectType | null = null) {
        let hash: string | undefined | null = this._query?.resolve(this);

        if (type && !(await this.loadTypedObject(hash, type)))
            hash = null;
        if (hash)
            return hash;
        throw new Error(`Not a valid object name: ${ this._expr }`);

    }

    readRef(name: string) {
        const hash = this._repo.refs.readRef(name);
        if (hash) return hash;

        const candidates = this._repo.objects.prefixMatch(name);
        if (candidates.length === 1)
            return candidates[0];
        else if (candidates.length > 1)
            this._logAmbigiousHash(name, candidates);

        return null;
    }

    private async _logAmbigiousHash(name: string, candidations: string[]) {
        const objects: string[] = [];
        for (const candidate of candidations) {
            const object = await this._repo.objects.readObject(candidate);
            const short = this._repo!.objects.shortHash(object.hash!);
            const info = ` ${ short } ${ object.type }`;
            if (object.type === TObjectType.COMMIT) {
                const commit = object as TCommit;
                objects.push(`${ info } ${ commit.author.timestamp } ${ commit.titleLine }`);
            } else {
                objects.push(info);
            }
        }

        const message = `short SHA1 ${ name } is ambigious`;
        const hint = `The candidates are:\n${ objects.join("\n") }`;
        // this._errors.push(new HintedError(message, [hint]));
    }

    async commitParent(oid: string | undefined | null) {
        if (!oid) return null;
        const commit = await this.loadTypedObject(oid, TObjectType.COMMIT);
        if (!commit)
            return null;

        return (commit as TCommit).parentHashes[0];
    }

    async loadTypedObject(oid: string | undefined, type: string | null) {
        if (!oid) return null;
    
        const object = await this._repo.objects.readObject(oid);
    
        if (object.type === type) {
            return object;
        } else {
            const message = `object ${oid} is a ${object.type}, not a ${type}`;
            // this._errors.push(new HintedError(message, []));
            return null;
        }
    }

    static parse(revision: string): RevisionNode | undefined {
        let match: RegExpMatchArray | null;

        // parent: rev^
        match = revision.match(this.PARENT);
        if (match) {
            const rev = this.parse(match[1]);
            return rev ? new Parent(rev) : undefined;
        }

        // ancestor: rev~n
        match = revision.match(this.ANCESTOR);
        if (match) {
            const rev = this.parse(match[1]);
            return rev
                ? new Ancestor(rev, Number(match[2]))
                : undefined;
        }

        // ref
        if (this.validRef(revision)) {
            const name = this.REF_ALIASES[revision] ?? revision;
            return new Ref(name);
        }

        return undefined;
    }

    static validRef(revision: string): boolean {
        return !this.INVALID_NAME.test(revision);
    }
}


// export async function resolveStartPoint(repo: TrakRepository, startPoint: string): Promise<string | null> {
//     // CASE 1: Branch name
//     if (await TRefs.branchExists(repo, startPoint)) {
//         return await TRefs.getBranchCommit(repo, startPoint);
//     }

//     // CASE 2: Tag name
//     if (await TRefs.tagExists(repo, startPoint)) {
//         const tagPath = `.git/refs/tags/${startPoint}`;
//         const tagContent = (await FileSystem.readFile(tagPath)).toString().trim();

//         if (await isCommitObject(repo, tagContent)) {
//             return tagContent; // lightweight tag
//         } else {
//             // annotated tag
//             const tagObj = await TObjects.readObject(repo, tagContent);
//             return tagObj!.hash();
//         }
//     }

//     // CASE 3: HEAD
//     if (startPoint === "@" || startPoint === "HEAD") {
//         return await TRefs.getCurrentHeadCommit(repo);
//     }

//     // CASE 4: Relative reference (HEAD~1, main^, HEAD^^, etc.)
//     if (_isRelativeReference(startPoint)) {
//         return await _resolveRelativeReference(repo, startPoint);
//     }

//     // CASE 5: Remote branch (origin/main)
//     if (await _isRemoteBranch(repo, startPoint)) {
//         return await _resolveRemoteBranch(repo, startPoint);
//     }

//     // CASE 6: Direct commit SHA (full or abbreviated)
//     if (isValidSha(startPoint)) {
//         // abbreviated
//         if (isAbbreviatedSha(startPoint)) {
//             const fullSha = await _expandAbbreviatedSha(repo, startPoint);
//             if (fullSha !== null) 
//                 return fullSha;
//         } else {
//             // full SHA
//             if (await TObjects.exists(repo, startPoint)) 
//                 return startPoint;
//         }
//     }

//     // CASE 7: Symbolic ref like refs/heads/main
//     if (startPoint.startsWith("refs/")) {
//         const refPath = `.git/${startPoint}`;
//         if (FileSystem.exists(refPath)) {
//             return (await FileSystem.readFile(refPath)).toString().trim();
//         }
//     }

//     return null;
// }

// async function _resolveRelativeReference(repo: TrakRepository, ref: string): Promise<string | null> {
//     // --- Handle "~" syntax (first parent steps) ---
//     if (ref.includes("~")) {
//         const [base, stepsStr] = ref.split("~");
//         const steps = stepsStr ? parseInt(stepsStr, 10) : 1;

//         const baseCommit = await resolveStartPoint(repo, base);
//         if (baseCommit === null) 
//             return null;

//         let current = baseCommit;
//         for (let i = 0; i < steps; i++) {
//             const commit = (await TObjects.readObject(repo, current)) as TCommit;
//             if (commit.parentHashes.length === 0) 
//                 return null;

//             current = commit.parentHashes[0];
//         }

//         return current;
//     }

//     // --- Handle "^" syntax (parent references) ---
//     if (ref.includes("^")) {
//         // Example: HEAD^^, main^2, feature^^^
//         const base = ref.replace(/\^+$/, "");
//         const caretCount = ref.length - base.length;

//         // Case: HEAD^2 (second parent)
//         const parentNumMatch = base.match(/(.*)\^(\d+)$/);
//         if (parentNumMatch) {
//             const commitRef = parentNumMatch[1];
//             const parentNum = parseInt(parentNumMatch[2], 10);

//             const baseCommit = await resolveStartPoint(repo, commitRef);
//             if (!baseCommit) return null;

//             const commit = (await TObjects.readObject(repo, baseCommit)) as TCommit;

//             if (parentNum === 1) return commit.parentHashes[0] ?? null;
//             if (parentNum === 2) return commit.parentHashes[1] ?? null;

//             return null;
//         }

//         // Case: HEAD^^ (walk n times through first parent)
//         const baseCommit = await resolveStartPoint(repo, base);
//         if (!baseCommit) return null;

//         let current = baseCommit;
//         for (let i = 0; i < caretCount; i++) {
//             const commit = (await TObjects.readObject(repo, current)) as TCommit;
//             if (commit.parentHashes.length === 0) 
//                 return null;

//             current = commit.parentHashes[0];
//         }

//         return current;
//     }

//     return null;
// }

// function _isRelativeReference(ref: string): boolean {
//     return ref.includes("~") || ref.includes("^");
// }

// async function _isRemoteBranch(repo: TrakRepository, ref: string): Promise<boolean> {
//     if (!ref.includes("/")) return false;

//     const remoteRef = await TrakRepository.repoFile(repo, false, "ref", "remotes", ref);
//     return remoteRef !== undefined && FileSystem.exists(remoteRef);
// }

// async function _resolveRemoteBranch(repo: TrakRepository, ref: string): Promise<string | null> {
//     const remotePath = await TrakRepository.repoFile(repo, false, "ref", "remotes", ref);
//     if (!remotePath || !FileSystem.exists(remotePath))
//         return null;

//     return (await FileSystem.readFile(remotePath)).toString().trim();
// }

// async function _expandAbbreviatedSha(repo: TrakRepository, shortSha: string): Promise<string | null> {
//     const prefix = shortSha.slice(0, 2);
//     const objectsDir = await TrakRepository.repoFile(repo, false, "objects", prefix);

//     if (!objectsDir || !FileSystem.exists(objectsDir)) return null;

//     const candidates: string[] = [];
//     const files = await FileSystem.readDirectory(objectsDir);

//     for (const file of files) {
//         const fullSha = prefix + file;
//         if (fullSha.startsWith(shortSha)) {
//             candidates.push(fullSha);
//         }
//     }

//     if (candidates.length === 0) return null;
//     if (candidates.length === 1) return candidates[0];

//     throw new Error(`fatal: short SHA1 '${shortSha}' is ambiguous\nThe candidates are \n${ candidates.join('\n')}`);
// }

// async function isCommitObject(repo: TrakRepository, hash: string): Promise<boolean> {
//     const path = await TrakRepository.repoFile(repo, false, "objects", hash.substring(0, 2), hash.substring(2));
//     if (!path || !FileSystem.exists(path))
//         return false;

//     const object = await TObjects.readObject(repo, hash);
//     if (!object)
//         return false;

//     return object.type === TObjectType.COMMIT;
// }

