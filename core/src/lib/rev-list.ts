import type { DiffEntry, DiffMap } from "./tree-diff";
import type { TreeEntry } from "../repo/entries";
import { TObjectType, type TCommit } from "../repo/objects";
import type { TRepository } from "../repo/repository";
import { PathFilter } from "./path-filter";
import { Revision } from "./revision";
import type { SymRef } from "../repo/refs";

enum Flags {
    SEEN = ':seen',
    ADDED = ':added',
    UNINTERESTING = ':uninteresting',
    TREESAME = ':treesame'
}

const RANGE = /^(.*)\.\.(.*)$/;
const EXCLUDE = /^\^(.+)$/;

export class RevList {
    private _output: TCommit[];
    private _pending: TreeEntry[];
    private _queue: TCommit[];
    private _prune: string[];
    private _commits: Map<string, TCommit>;
    private _flags: Map<string, Set<Flags>>;
    private _diff: Map<string, any>;
    private _filter: PathFilter;
    private _objects: boolean | undefined;
    private _walk: boolean | undefined;
    private _limited: boolean;

    constructor(private _repo: TRepository, private _revs: string[]) {
        this._output = [];
        this._pending = [];
        this._queue = [];
        this._prune = [];
        this._commits = new Map();
        this._flags = new Map();
        this._diff = new Map();
        this._limited = false;
        this._filter = PathFilter.build(this._prune);
    }

    async initialize(options: any = {}) {
        this._objects = options.objects || false;
        this._walk = options.walk || true;
        if (Object.hasOwn(options, 'all')) {
            const refs = await this._repo!.refs.listAllRefs();
            for (const ref of refs) {
                await this._includeRefs(refs);
            }
        }

        for (const rev of this._revs) {
            await this._handleRevision(rev);
        }

        if (this._queue.length === 0) {
            await this._handleRevision(Revision.HEAD);
        }
    }

    private async _includeRefs(refs: SymRef[]): Promise<void> {
        const oids = (await Promise.all(
            refs.map(ref => ref.readHash())
        )).filter((oid): oid is string => oid !== null);
        
        for (const oid of oids) {
            await this._handleRevision(oid);
        }
    }

    private async _handleRevision(rev: string) {
        let match = RANGE.exec(rev);

        if (this._repo.workspace.stats(rev)) {
            this._prune.push(rev);
            return;
        } else
        
        if (match) {
            await this._setStartPoint(match[1], false);
            await this._setStartPoint(match[2], true);
            return;
        } 

        match = EXCLUDE.exec(rev);
        if (match) {
            await this._setStartPoint(match[1], false);
        } else {
            await this._setStartPoint(rev, true);
        }
    }

    private async _setStartPoint(rev: string, isInteresting: boolean) {
        const oid = await (new Revision(this._repo, rev)).resolve(TObjectType.COMMIT);
        const commit = await this._loadCommit(oid);
        this._enqueueCommit(commit);

        if (!isInteresting) {
            this._limited = true;
            this._mark(oid, Flags.UNINTERESTING);
            this._markParentsUninteresting(commit);
        }
    }

    async* each() {
        if (this._limited)
            await this._limitList();

        for await (const commit of this._traverseCommits()) {
            yield commit;
        }
    }

    private async* _traverseCommits() {
        while (this._queue.length > 0) {
            const commit = this._queue.shift()!;
            if (!this._limited)
                await this.addParents(commit);

            if (
                this._isMarked(commit.hash!, Flags.UNINTERESTING) 
                || this._isMarked(commit.hash!, Flags.TREESAME)
            ) {
                continue;
            }

            this._pending.push(this._repo!.objects.treeEntry(commit.treeHash));
            yield commit;
        }
    }

    private async* _traverseTree(entry: TreeEntry): AsyncGenerator<TreeEntry> {
        yield entry;
    
        if (!entry.isTree()) 
            return;
        
        const tree = await this._repo.objects.loadTree(entry.hash);
        
        for (const [name, item] of tree.entries) {
            yield* this._traverseTree(item as TreeEntry);
        }
    }

    private async* _traversePending() {
        if (!this._objects)
            return;

        for (const entry of this._pending) {
            for await (const obj of this._traverseTree(entry)) {
                if (this._isMarked(obj.hash, Flags.UNINTERESTING))
                    continue;

                if (!this._mark(obj.hash, Flags.SEEN))
                    continue;

                yield obj;
                // return true
            }
        }
    }

    private async _limitList() {
        while (this._stillInteresting()) {
            const commit = this._queue.shift();
            if (!commit) 
                break; // TODO check if valid if statment

            await this._addParents(commit);
            if (!this._isMarked(commit!.hash!, Flags.UNINTERESTING)) 
                this._output.push(commit);
        }
    }

    private _stillInteresting() {
        if (this._queue.length === 0) 
            return false;

        const oldestOut = this._output[this._output.length - 1];
        const newestIn = this._queue[0];
        if (oldestOut && oldestOut.date <= newestIn.date)
            return true;

        for (const commit of this._queue) {
            if (!this._isMarked(commit.hash!, Flags.UNINTERESTING))
                return true;
        }

        return false;
    }

    private async _addParents(commit: TCommit) {
        if (!this._mark(commit.hash, Flags.ADDED))
            return;

        const parent = await this._loadCommit(commit.parentHashes[0]);
        if (!parent) 
            return;

        if (this._isMarked(commit.hash!, Flags.UNINTERESTING))
            this._markParentsUninteresting(parent);

        this._enqueueCommit(commit);
    }

    async addParents(commit: TCommit) {
        if (!this._mark(commit.hash, Flags.ADDED))
            return;

        const parentCommit = await this._loadCommit(commit.parentHashes[0]);

        if (this._isMarked(commit.parentHashes[0], Flags.UNINTERESTING)) {
            if (parentCommit)
                this._markParentsUninteresting(parentCommit);
        } else {
            this._simplifyCommit(commit);
        }

        if (parentCommit)
            this._enqueueCommit(parentCommit);
    }

    private async _simplifyCommit(commit: TCommit) {
        if (this._prune.length === 0) 
            return;

        const treeDiff = await this._treeDiff(commit.treeHash, commit.parentHashes[0]);
        if (treeDiff)
            this._mark(commit.hash, Flags.TREESAME)
    }

    private _enqueueCommit(commit: TCommit | null) {
        if (!commit) return;

        if (!this._mark(commit.hash, Flags.SEEN))
            return;

        if (this._walk) {
            const index = this._queue.findIndex(c => c.date < commit.date );
            this._queue.splice(index === -1 ? this._queue.length : index, 0, commit);
        } else {
            this._queue.push(commit);
        }
    }

    private async _loadCommit(oid: string | null) {
        if (!oid) return null;

        let commit = this._commits.get(oid);

        if (!commit) {
            commit = await this._repo.objects.loadCommit(oid);
            this._commits.set(oid, commit);
        }

        return commit;
    }

    private async _treeDiff(a: string, b: string) {
        const key = `${ a },${ b }`;
        if (this._diff.has(key))
            return this._diff.get(key);

        const diffs = await this._repo.objects.treeDiff(a, b);
        this._diff.set(key, diffs);
        return diffs;
    }

    private async _markEdgesUninteresting() {
        for (const commit of this._queue) {
            if (this._isMarked(commit.hash!, Flags.UNINTERESTING)) {
                this._markTreeUninteresting(commit.treeHash);
            }
    
            for (const parentOid of commit.parentHashes) {
                if (!this._isMarked(parentOid, Flags.UNINTERESTING)) {
                    continue;
                }
    
                const parent = await this._repo.objects.loadCommit(parentOid);
                this._markTreeUninteresting(parent.treeHash);
            }
        }
    }

    private _markParentsUninteresting(commit: TCommit | null) {
        if (commit === null) 
            return;

        const queue: string[] = [...commit.parentHashes];
    
        while (queue.length > 0) {
            const oid = queue.shift()!;
            
            if (!this._mark(oid, Flags.UNINTERESTING))
                continue;
            
            const parentCommit = this._commits.get(oid);
            if (parentCommit)
                queue.push(...parentCommit.parentHashes);
        }
    }

    private async _markTreeUninteresting(oid: string) {
        const entry = this._repo.objects.treeEntry(oid);
        for await (const obj of this._traverseTree(entry)) {
            this._mark(obj.hash, Flags.UNINTERESTING);
        }
    }

    private _isMarked(commitHash: string, flag: Flags): boolean {
        return !!this._flags.get(commitHash)?.has(flag);
    }

    private _mark(oid: string, flag: Flags) {
        if (!this._flags.has(oid)) {
            this._flags.set(oid, new Set());
        }
        
        const flags = this._flags.get(oid)!;
        const hadFlag = flags.has(flag);
        flags.add(flag);
        
        return !hadFlag;
    }

    
}