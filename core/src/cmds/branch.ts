import { Dirent } from "fs";
import { TrakRefs } from "../db/refs";
import { TrakFileSystem } from "../file-system";
import { TrakRepository } from "../repository";
import { isAncestor } from "./-shared";

export async function branch(branchName: string, deleteBranch: boolean = false) {
    const repo = await TrakRepository.repoFind();
    if (!repo)
        return;

    if (deleteBranch && branchName) {
        const branchFile = await TrakRepository.repoFile(repo, true, "refs", "heads", branchName);
        if (!branchFile)
            return;

        if (TrakFileSystem.exists(branchFile)) {
            await TrakFileSystem.removeFile(branchFile);
            process.stdout.write(`Delete branch ${ branchName }\n`);
        } else {
            process.stdout.write(`Branch ${ branchName } not found`);
        }

        return;
    }

    const currentBranch = await TrakRefs.getCurrentBranch(repo);
    if (branchName) {
        const currentCommit = await TrakRefs.getBranchCommit(repo, currentBranch);
        if (currentCommit) {
            await TrakRefs.setBranchCommit(repo, branchName, currentCommit);
            process.stdout.write(`Created branch ${ branchName }\n`);
        } else {
            process.stdout.write('No commits yet, cannot create a new branch\n');
        }
    } else {
        _listBranches(repo);
    }
}

async function _listBranches(repo: TrakRepository) {
    const headsDir = await TrakRepository.repoDir(repo, true, "refs", "heads");
    if (!headsDir) 
        return

    const branches = await TrakFileSystem.listFiles(headsDir);

    // Get current branch
    const currentBranch = await TrakRefs.getCurrentBranch(repo);

    // check for empty branches
    for (const branch of branches.sort()) {
        const currentMarker = branch == currentBranch ? "* " : "  ";
        process.stdout.write(`${ currentMarker }${ branch }\n`);
    }
}

async function _createBranch(repo: TrakRepository, branchName: string) {
    if (!_isValidBranchName(branchName))
        throw new Error(`${ branchName } is not a valid branch name`);

    if (await TrakRefs.branchExists(repo, branchName))
        throw new Error(`A branch named ${ branchName } already exists`);

    const currentBranch = await TrakRefs.getCurrentBranch(repo);
    if (branchName) {
        const currentCommit = await TrakRefs.getBranchCommit(repo, currentBranch);
        if (currentCommit) {
            await TrakRefs.setBranchCommit(repo, branchName, currentCommit);
            process.stdout.write(`Created branch ${ branchName }\n`);
        } else {
            process.stdout.write('No commits yet, cannot create a new branch\n');
        }
    }
}

async function _deleteBranch(repo: TrakRepository, branchName: string, force: boolean = false) {
    // Check if branch exists
    if (!(await TrakRefs.branchExists(repo, branchName)))
        throw new Error(`Branch ${ branchName } was not found`);

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

    process.stdout.write(`Delete branch ${ branchName }\n`);
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
    process.stdout.write(`Renamed branch ${ oldName } to ${ newName }`);
}

async function _isBranchMerged(repo: TrakRepository, branchCommit: string) {
    // Check if a branch is merged into HEAD
    // Get current branch
    const currentBranch = await TrakRefs.getCurrentBranch(repo);
    const headCommit = await TrakRefs.getBranchCommit(repo, currentBranch);
    if (!headCommit)
        return null;

    return await isAncestor(repo, branchCommit, headCommit);
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
