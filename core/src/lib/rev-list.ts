import type { BaseEntry } from "../repo/entries";
import { TObjectType, type TCommit } from "../repo/objects";
import type { TRepository } from "../repo/repository";
import { PathFilter } from "./path-filter";
import { Revision } from "./revision";

enum Flags {
    SEEN = ':seen',
    ADDED = ':added',
    UNINTERESTING = ':uninteresting'
}

const RANGE = /^(.*)\.\.(.*)$/;
const EXCLUDE = /^\^(.+)$/;

export class RevList {
    private _pending: string[];
    private _queue: TCommit[];
    private _prune: string[];
    private _commits: Map<string, TCommit>;
    private _flags: Map<string, Set<Flags>>;
    private _objects: boolean;
    private _walk: boolean;
    private _limited: boolean;
    private _filter: PathFilter;

    constructor(private _repo: TRepository, private _rev: Revision, options: any = {}) {
        this._pending = [];
        this._queue = [];
        this._prune = [];
        this._commits = new Map();
        this._flags = new Map();
        this._objects = options.objects || false;
        this._walk = options.walk || true;
        this._limited = false;
        this._filter = PathFilter.build(this._prune);
    }

    private async _handleRevision(rev: string) {
        let match = RANGE.exec(rev);

        if (this._repo.workspace.stats(rev)) {
            this._prune.push(rev);
            return;
        } else if (match) {
            this._setStartPoint(match[1], false);
            this._setStartPoint(match[2], true);
            return;
        } 

        match = EXCLUDE.exec(rev);
        if (match) {
            this._setStartPoint(match[1], false);
        } else {
            this._setStartPoint(rev, true);
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

    private _markParentsUninteresting(commit: TCommit | null) {
        if (!commit) return;

        while (commit!.parentHashes.length || 0 > 0) {
            if (!this._mark(commit!.hash!, Flags.UNINTERESTING))
                return;

            commit = this._commits.get(commit!.parentHashes[0]) ?? null;
        }
    }

    async each() {
        if (this._limited) {

        }
    }

    async traverseCommits() {
        while (this._queue.length > 0) {
            const commit = this._queue.shift()!;
            await this.addParents(commit);

        }
    }

    async addParents(commit: TCommit) {
        if (!this._mark(commit.hash!, Flags.ADDED))
            return;

        for (const parentHash of commit.parentHashes) {
            const parentCommit = await this._loadCommit(parentHash);
            if (!parentCommit) continue;
            this._enqueueCommit(parentCommit);
        } 
    }
    _enqueueCommit(commit: TCommit | null) {
        if (!commit) return;

        if (!this._mark(commit.hash!, Flags.SEEN))
            return;

        const index = this._queue.findIndex(c => c.date < commit.date );
        if (index === -1) {
            this._queue.push(commit);
        } else {
            this._queue.splice(index, 0, commit);
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

    private _traverseTree(entry: BaseEntry) {

    }

    private _traverseCommit() {
        
    }

    private _isMarked(commitHash: string, flag: Flags): boolean {
        return !!this._flags.get(commitHash)?.has(flag);
    }

    private _mark(oid: string, flag: Flags) {
        let isContained = false;
        if (!this._flags.has(oid)) {
            isContained = true;
            this._flags.set(oid, new Set());
        }
            
        this._flags.get(oid)?.add(flag);
        return isContained;
    }

    private _markTreeUninteresting(oid: string) {
        const entry = this._repo.objects.treeEntry(oid);

    }
}