import { TrakRefs } from "../db/refs";
import { FileSystem, Terminal } from "../lib/standard";
import { TrakRepository } from "../repository";
import { TrakCommit, TrakObjectsBase } from "../db/objects";
import { shortHash } from "../util";
import { resolveStartPoint } from "../lib/revision";


type BranchArgs = { 
    list?: boolean,
    verbose?: boolean, 
    delete?: boolean,
    forceDelete?: boolean, 
    create?: boolean,
    startPoint?: string
}

export async function branch(branchName: string, options: BranchArgs = {}) {
    const repo = await TrakRepository.repoFind();
    if (!repo)
        return;

    if (options.list) {
        await _listBranches(repo, options.verbose)
    } else if (options.delete) {
        await _deleteBranch(repo, branchName, options.forceDelete);
    } else if (options.create) {
        await _createBranch(repo, branchName, options.startPoint);
    } else {
        await _listBranches(repo, options.verbose);
    }
}

async function _listBranches(repo: TrakRepository, verbose: boolean = false) {
    const headsDir = await TrakRepository.repoDir(repo, true, "refs", "heads");
    if (!headsDir) 
        return

    const branches = await FileSystem.listFiles(headsDir);

    // Get current branch
    const currentBranch = await TrakRefs.getCurrentBranch(repo);

    // check for empty branches
    for (const branch of branches.sort()) {
        const currentMarker = branch == currentBranch ? "* " : "  ";
        let suffixInfo = '';
        if (verbose) {
            const commit = await TrakRefs.getBranchCommit(repo, branch);
            if (commit) {
                const commitObj = await TrakObjectsBase.readObject(repo, commit) as TrakCommit;
                if (commitObj) {
                    suffixInfo = `${ shortHash(commit) } ${ commitObj.message.split('\n')[0] }`
                }
            }
        }
        Terminal.println(`${ currentMarker }${ branch } ${suffixInfo}`);
    }
}

async function _createBranch(repo: TrakRepository, branchName: string, startPoint?: string) {
    if (!_isValidBranchName(branchName))
        throw new Error(`${ branchName } is not a valid branch name`);

    if (await TrakRefs.branchExists(repo, branchName))
        throw new Error(`A branch named ${ branchName } already exists`);

    let commitHash;
    if (startPoint) {
        commitHash = await resolveStartPoint(repo, startPoint);
    } else {
        commitHash = await TrakRefs.getCurrentHeadCommit(repo);
    }
        
    if (commitHash) {
        await TrakRefs.setBranchCommit(repo, branchName, commitHash);
        Terminal.println(`Created branch ${ branchName }`);
    } else {
        Terminal.println('No commits yet, cannot create a new branch');
    }
}

async function _deleteBranch(repo: TrakRepository, branchName: string, force: boolean = false) {
    // Check if branch exists
    if (!(await TrakRefs.branchExists(repo, branchName)))
        throw new Error(`error: branch ${ branchName } was not found`);

    // Check if it's the current branch
    const currentBranch = await TrakRefs.getCurrentBranch(repo);
    if (currentBranch === branchName)
        throw new Error(`Cannot delete branch ${ branchName } checked out at {path}`);

    // Check if branch is merged (unless force delete)
    if (!force) {
        const branchCommit = await TrakRefs.getBranchCommit(repo, currentBranch);
        if (branchCommit) {
            if (!(await _isBranchMerged(repo, branchCommit))) 
                throw new Error(`The branch ${branchName} is not fully merged.\n If you are sure you want to delete it, run 'trak branch -D ${branchName}'.`);
        }
    }

    // TODO: Delete branch file and remove empty directories
    const branchFile = await TrakRepository.repoFile(repo, true, "refs", "heads", branchName);
    await FileSystem.removeFile(branchFile!);
    Terminal.println(`Delete branch ${ branchName }`);
}

async function _renameBranch(repo: TrakRepository, oldName: string, newName: string, force: boolean = false) {
    // Get current branch
    const currentBranch = await TrakRefs.getCurrentBranch(repo);
    
    // If only new_name provided, rename current branch
    if (!oldName) {
        oldName = currentBranch;

        if (!newName)
            throw new Error("Branch name required");
    }

    // Check if old branch exists
    if (!(await TrakRefs.branchExists(repo, oldName)))
        throw new Error(`Branch ${ oldName } was not found`);

    // Check if new branch name is valid
    if (!_isValidBranchName(newName))
        throw new Error(`${ newName } is not a valid branch name`);

    // Check if new branch already exists (unless force)
    if ((await TrakRefs.branchExists(repo, oldName)) && !force)
        throw new Error(`A branch named ${ newName } already exists`);

    // Get commit SHA from old branch
    const commit = await TrakRefs.getBranchCommit(repo, oldName);
    if (commit)
        await TrakRefs.setBranchCommit(repo, oldName, commit);

    // Update HEAD if renaming current branch
    if (oldName === currentBranch)
        await TrakRefs.setCurrentBranch(repo, newName);

    // # 8. Delete old branch reference
    Terminal.println(`Renamed branch ${ oldName } to ${ newName }`);
}

async function _isBranchMerged(repo: TrakRepository, branchCommit: string) {
    // Check if a branch is merged into HEAD
    // Get current branch
    const currentBranch = await TrakRefs.getCurrentBranch(repo);
    const headCommit = await TrakRefs.getBranchCommit(repo, currentBranch);
    if (!headCommit)
        return null;

    return await _isAncestor(repo, branchCommit, headCommit);
}

/**
 * 
 * @param repo 
 * @param ancestorSha 
 * @param descendantSha 
 * @returns 
 */
async function _isAncestor(repo: TrakRepository, ancestorSha: string, descendantSha: string): Promise<boolean> {
    const visited = new Set<string>();
    const queue: string[] = [descendantSha];

    while (queue.length > 0) {
        const currentSha = queue.shift()!;

        if (currentSha === ancestorSha) {
            return true;
        }

        if (visited.has(currentSha)) {
            continue;
        }

        visited.add(currentSha);

        // Load the commit object
        const commit = (await TrakObjectsBase.readObject(repo, currentSha)) as TrakCommit;

        // commit._parentHashes is an array of parent SHAs
        if (commit.parentHashes && commit.parentHashes.length > 0) {
            for (const parent of commit.parentHashes) {
                queue.push(parent);
            }
        }
    }

    return false;
}

function _isValidBranchName(name: string): boolean {
  // Cannot be empty
  if (name === "") return false;

  // Cannot start with . or /
  if (name.startsWith(".") || name.startsWith("/")) return false;

  // Cannot end with .lock
  if (name.endsWith(".lock")) return false;

  // Cannot contain ..
  if (name.includes("..")) return false;

  // Invalid characters
  const invalidChars = ["~", "^", ":", "?", "*", "[", "\\", " ", "\t", "\n"];
  for (const char of invalidChars) {
    if (name.includes(char)) return false;
  }

  // Cannot be HEAD
  if (name === "HEAD") return false;

  return true;
}
