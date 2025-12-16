import { TCommit, TObjects, TObjectType } from "../repo/objects";
import { TRefs } from "../repo/refs";
import { TrakRepository } from "../repository";
import { FileSystem } from "./standard";
import { isAbbreviatedSha, isValidSha } from "../util";

/*********************************************************************************************************
 * Revision parser/resolver
 */

export async function resolveStartPoint(repo: TrakRepository, startPoint: string): Promise<string | null> {
    // CASE 1: Branch name
    if (await TRefs.branchExists(repo, startPoint)) {
        return await TRefs.getBranchCommit(repo, startPoint);
    }

    // CASE 2: Tag name
    if (await TRefs.tagExists(repo, startPoint)) {
        const tagPath = `.git/refs/tags/${startPoint}`;
        const tagContent = (await FileSystem.readFile(tagPath)).toString().trim();

        if (await isCommitObject(repo, tagContent)) {
            return tagContent; // lightweight tag
        } else {
            // annotated tag
            const tagObj = await TObjects.readObject(repo, tagContent);
            return tagObj!.hash();
        }
    }

    // CASE 3: HEAD
    if (startPoint === "@" || startPoint === "HEAD") {
        return await TRefs.getCurrentHeadCommit(repo);
    }

    // CASE 4: Relative reference (HEAD~1, main^, HEAD^^, etc.)
    if (_isRelativeReference(startPoint)) {
        return await _resolveRelativeReference(repo, startPoint);
    }

    // CASE 5: Remote branch (origin/main)
    if (await _isRemoteBranch(repo, startPoint)) {
        return await _resolveRemoteBranch(repo, startPoint);
    }

    // CASE 6: Direct commit SHA (full or abbreviated)
    if (isValidSha(startPoint)) {
        // abbreviated
        if (isAbbreviatedSha(startPoint)) {
            const fullSha = await _expandAbbreviatedSha(repo, startPoint);
            if (fullSha !== null) 
                return fullSha;
        } else {
            // full SHA
            if (await TObjects.exists(repo, startPoint)) 
                return startPoint;
        }
    }

    // CASE 7: Symbolic ref like refs/heads/main
    if (startPoint.startsWith("refs/")) {
        const refPath = `.git/${startPoint}`;
        if (FileSystem.exists(refPath)) {
            return (await FileSystem.readFile(refPath)).toString().trim();
        }
    }

    return null;
}

async function _resolveRelativeReference(repo: TrakRepository, ref: string): Promise<string | null> {
    // --- Handle "~" syntax (first parent steps) ---
    if (ref.includes("~")) {
        const [base, stepsStr] = ref.split("~");
        const steps = stepsStr ? parseInt(stepsStr, 10) : 1;

        const baseCommit = await resolveStartPoint(repo, base);
        if (baseCommit === null) 
            return null;

        let current = baseCommit;
        for (let i = 0; i < steps; i++) {
            const commit = (await TObjects.readObject(repo, current)) as TCommit;
            if (commit.parentHashes.length === 0) 
                return null;

            current = commit.parentHashes[0];
        }

        return current;
    }

    // --- Handle "^" syntax (parent references) ---
    if (ref.includes("^")) {
        // Example: HEAD^^, main^2, feature^^^
        const base = ref.replace(/\^+$/, "");
        const caretCount = ref.length - base.length;

        // Case: HEAD^2 (second parent)
        const parentNumMatch = base.match(/(.*)\^(\d+)$/);
        if (parentNumMatch) {
            const commitRef = parentNumMatch[1];
            const parentNum = parseInt(parentNumMatch[2], 10);

            const baseCommit = await resolveStartPoint(repo, commitRef);
            if (!baseCommit) return null;

            const commit = (await TObjects.readObject(repo, baseCommit)) as TCommit;

            if (parentNum === 1) return commit.parentHashes[0] ?? null;
            if (parentNum === 2) return commit.parentHashes[1] ?? null;

            return null;
        }

        // Case: HEAD^^ (walk n times through first parent)
        const baseCommit = await resolveStartPoint(repo, base);
        if (!baseCommit) return null;

        let current = baseCommit;
        for (let i = 0; i < caretCount; i++) {
            const commit = (await TObjects.readObject(repo, current)) as TCommit;
            if (commit.parentHashes.length === 0) 
                return null;

            current = commit.parentHashes[0];
        }

        return current;
    }

    return null;
}

function _isRelativeReference(ref: string): boolean {
    return ref.includes("~") || ref.includes("^");
}

async function _isRemoteBranch(repo: TrakRepository, ref: string): Promise<boolean> {
    if (!ref.includes("/")) return false;

    const remoteRef = await TrakRepository.repoFile(repo, false, "ref", "remotes", ref);
    return remoteRef !== undefined && FileSystem.exists(remoteRef);
}

async function _resolveRemoteBranch(repo: TrakRepository, ref: string): Promise<string | null> {
    const remotePath = await TrakRepository.repoFile(repo, false, "ref", "remotes", ref);
    if (!remotePath || !FileSystem.exists(remotePath))
        return null;

    return (await FileSystem.readFile(remotePath)).toString().trim();
}

async function _expandAbbreviatedSha(repo: TrakRepository, shortSha: string): Promise<string | null> {
    const prefix = shortSha.slice(0, 2);
    const objectsDir = await TrakRepository.repoFile(repo, false, "objects", prefix);

    if (!objectsDir || !FileSystem.exists(objectsDir)) return null;

    const candidates: string[] = [];
    const files = await FileSystem.readDirectory(objectsDir);

    for (const file of files) {
        const fullSha = prefix + file;
        if (fullSha.startsWith(shortSha)) {
            candidates.push(fullSha);
        }
    }

    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    throw new Error(`fatal: short SHA1 '${shortSha}' is ambiguous\nThe candidates are \n${ candidates.join('\n')}`);
}

async function isCommitObject(repo: TrakRepository, hash: string): Promise<boolean> {
    const path = await TrakRepository.repoFile(repo, false, "objects", hash.substring(0, 2), hash.substring(2));
    if (!path || !FileSystem.exists(path))
        return false;

    const object = await TObjects.readObject(repo, hash);
    if (!object)
        return false;

    return object.type === TObjectType.COMMIT;
}

