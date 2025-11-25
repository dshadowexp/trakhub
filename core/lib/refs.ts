import { TrakFileSystem } from "./file-system";
import { TrakRepository } from "./repository";

export class TrakRefs {
    static async resolve(repo: TrakRepository, ref: string) {
        // Check if it's a branch
        const refsFilePath = (await TrakRepository.repoFile(repo, false, "refs", "heads", ref))!;
        if (TrakFileSystem.exists(refsFilePath))
            return TrakFileSystem.readFile(refsFilePath);
        
        // Check if it's a tag
        const tagsFilePath = (await TrakRepository.repoFile(repo, false, "refs", "tags", ref))!;
        if (TrakFileSystem.exists(tagsFilePath))
            return TrakFileSystem.readFile(tagsFilePath);
        
        // Check if it's a direct SHA
        if(ref === 'Is valid sha')
            return ref
        
        // Check HEAD
        if (ref == "HEAD")
            return ''//dereference_symbolic_ref("HEAD")
        
        return null
    }

    static async setCurrentBranch(repo: TrakRepository, branchName: string) {
        const headFilePath = await TrakRepository.repoFile(repo, true, "HEAD");
        if (!headFilePath || !TrakFileSystem.exists(headFilePath))
            return "master";
        
        await TrakFileSystem.writeFile(headFilePath, `ref: refs/heads/${branchName}`);
    }

    static async getCurrentBranch(repo: TrakRepository): Promise<string> {
        const headFilePath = await TrakRepository.repoFile(repo, true, "HEAD");
        if (!headFilePath)
            return "master";

        const headContent = (await TrakFileSystem.readFile(headFilePath)).toString().trim();
        const prefix = 'ref: refs/heads/';
        if (headContent.startsWith(prefix))
            return headContent.substring(prefix.length)

        // detached HEAD
        return "HEAD";
    }

    static async getBranchCommit(repo: TrakRepository, branchName: string) {
        // Construct branch file path
        const branchFile = await TrakRepository.repoFile(repo, true, "refs", "heads", branchName);
        if (!branchFile) 
            return

        return (await TrakFileSystem.readFile(branchFile)).toString().trim();
    }

    static async setBranchCommit(repo: TrakRepository, branchName: string, commitHash: string) {
        // Construct branch file path
        const branchFile = await TrakRepository.repoFile(repo, true, "refs", "heads", branchName);
        if (!branchFile) 
            return

        await TrakFileSystem.writeFile(branchFile, commitHash);
    }
}