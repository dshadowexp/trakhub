import { FileSystem } from "../standard-lib";
import { TrakRepository } from "../repository";
import { isValidSHA } from "../util";

export class TrakRefs {
    static async branchExists(repo: TrakRepository, branchName: string) {
        const refsFilePath = (await TrakRepository.repoFile(repo, false, "refs", "heads", branchName))!;
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
        if(isValidSHA(ref))
            return ref;
        
        // Check HEAD
        if (ref == "HEAD")
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
            return

        return (await FileSystem.readFile(branchFile)).toString().trim();
    }

    static async setBranchCommit(repo: TrakRepository, branchName: string, commitHash: string) {
        // Construct branch file path
        const branchFile = await TrakRepository.repoFile(repo, true, "refs", "heads", branchName);
        if (!branchFile) 
            return

        await FileSystem.writeFile(branchFile, commitHash);
    }
}