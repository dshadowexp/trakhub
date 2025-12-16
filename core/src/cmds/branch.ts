import { TRefs } from "../repo/refs";
import { FileSystem, Terminal } from "../lib/standard";
import { TrakRepository } from "../repository";
import { TCommit, TObjects } from "../repo/objects";
import { shortHash } from "../util";
import { resolveStartPoint } from "../lib/revision";
import { BaseCommand } from "../types";

interface BranchArgs { 
    list?: boolean,
    verbose?: boolean, 
    delete?: boolean,
    forceDelete?: boolean, 
    create?: boolean,
    startPoint?: string
}

export class Branch extends BaseCommand<BranchArgs> {
    constructor(args: any[] = []) {
        super(
            'branch', 
            'Manage branches',
            [
                { name: 'branches', type: String, multiple: true, defaultOption: true },
                { name: 'verbose', alias: 'v', type: Boolean },
                { name: 'delete', alias: 'd', type: Boolean },
                { name: 'forceDelete', alias: 'D', type: Boolean },
            ],
            args
        )
    }

    async execute(): Promise<void> {
        await super.execute();
        console.log(this._args);
    } 
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
        const newBranchCommitHash = await createBranch(repo, branchName, options.startPoint);
        if (!newBranchCommitHash) {
            Terminal.println('No commits yet, cannot create a new branch');
        } else {
            Terminal.println(`Created branch ${ branchName }`);
        }
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
    const currentBranch = await TRefs.getCurrentBranch(repo);

    // check for empty branches
    for (const branch of branches.sort()) {
        const currentMarker = branch == currentBranch ? "* " : "  ";
        let suffixInfo = '';
        if (verbose) {
            const commit = await TRefs.getBranchCommit(repo, branch);
            if (commit) {
                const commitObj = await TObjects.readObject(repo, commit) as TCommit;
                if (commitObj) {
                    suffixInfo = `${ shortHash(commit) } ${ commitObj.message.split('\n')[0] }`
                }
            }
        }
        Terminal.println(`${ currentMarker }${ branch } ${suffixInfo}`);
    }
}

export async function createBranch(repo: TrakRepository, branchName: string, startPoint?: string): Promise<string | null> {
    // Validate branch name
    if (!_isValidBranchName(branchName))
        throw new Error(`${ branchName } is not a valid branch name`);

    // Check if branch already exists
    if (await TRefs.branchExists(repo, branchName))
        throw new Error(`A branch named ${ branchName } already exists`);

    // Determine starting point for new branch
    if (!startPoint)
        startPoint = "HEAD";

    let commitHash: string | null;
    if (startPoint) {
        commitHash = await resolveStartPoint(repo, startPoint);
    } else {
        commitHash = await TRefs.getCurrentHeadCommit(repo);
    }
        
    if (commitHash) {
        await TRefs.setBranchCommit(repo, branchName, commitHash);
    }

    return commitHash;
}

async function _deleteBranch(repo: TrakRepository, branchName: string, force: boolean = false) {
    // Check if branch exists
    if (!(await TRefs.branchExists(repo, branchName)))
        throw new Error(`error: branch ${ branchName } was not found`);

    // Check if it's the current branch
    const currentBranch = await TRefs.getCurrentBranch(repo);
    if (currentBranch === branchName)
        throw new Error(`Cannot delete branch ${ branchName } checked out at {path}`);

    // Check if branch is merged (unless force delete)
    if (!force) {
        const branchCommit = await TRefs.getBranchCommit(repo, currentBranch);
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
    const currentBranch = await TRefs.getCurrentBranch(repo);
    
    // If only new_name provided, rename current branch
    if (!oldName) {
        oldName = currentBranch;

        if (!newName)
            throw new Error("Branch name required");
    }

    // Check if old branch exists
    if (!(await TRefs.branchExists(repo, oldName)))
        throw new Error(`Branch ${ oldName } was not found`);

    // Check if new branch name is valid
    if (!_isValidBranchName(newName))
        throw new Error(`${ newName } is not a valid branch name`);

    // Check if new branch already exists (unless force)
    if ((await TRefs.branchExists(repo, oldName)) && !force)
        throw new Error(`A branch named ${ newName } already exists`);

    // Get commit SHA from old branch
    const commit = await TRefs.getBranchCommit(repo, oldName);
    if (commit)
        await TRefs.setBranchCommit(repo, oldName, commit);

    // Update HEAD if renaming current branch
    if (oldName === currentBranch)
        await TRefs.setCurrentBranch(repo, newName);

    // # 8. Delete old branch reference
    Terminal.println(`Renamed branch ${ oldName } to ${ newName }`);
}

async function _isBranchMerged(repo: TrakRepository, branchCommit: string) {
    // Check if a branch is merged into HEAD
    // Get current branch
    const currentBranch = await TRefs.getCurrentBranch(repo);
    const headCommit = await TRefs.getBranchCommit(repo, currentBranch);
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
        const commit = (await TObjects.readObject(repo, currentSha)) as TCommit;

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
