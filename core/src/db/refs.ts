import { FileSystem } from "../lib/standard";
import { TrakRepository } from "../repository";
import { isValidSha } from "../util";

export class TrakRefs {
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
        const headRef = await this._readReference(repo, "HEAD");
        if (!headRef || headRef.trim() === "") {
            return null;
        }
    
        // CASE 1: Symbolic reference (ref: refs/heads/main)
        if (headRef.startsWith("ref:")) {
            const branchRef = this._extractBranchFromSymbolic(headRef);
            if (!branchRef) return null;
            return await this._readReference(repo, branchRef);
        }
    
        // CASE 2: Detached HEAD (HEAD contains a commit SHA)
        return headRef.trim();
    }
    
    private static async _readReference(repo: TrakRepository, refPath: string) {
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