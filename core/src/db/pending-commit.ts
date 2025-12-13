import { TrakRepository } from "../repository";
import { FileSystem } from "../lib/standard";

export class PendingCommit {
    static async message(repo: TrakRepository) {
        const messagePath = await TrakRepository.repoFile(repo, false, "MERGE_MSG");
        if (!messagePath)
            throw new Error(`fatal: There is no merge in progress (${ 'name' } missing)`);

        return (await FileSystem.readFile(messagePath)).toString();
    }

    static async oid(repo: TrakRepository) {
        const headPath = await TrakRepository.repoFile(repo, false, "MERGE_HEAD");
        if (!headPath)
            throw new Error("fatal: Not a merge");

        return (await FileSystem.readFile(headPath)).toString();
    }


    static async start(repo: TrakRepository, oid: string, message: string) {
        const headPath = await TrakRepository.repoFile(repo, false, "MERGE_HEAD");
        const messagePath = await TrakRepository.repoFile(repo, false, "MERGE_MSG");

        if (!headPath || !messagePath)
            throw new Error("fatal: Not a merge");

        await FileSystem.writeFile(headPath, oid);
        await FileSystem.writeFile(messagePath, message);
    }

    static async inProgress(repo: TrakRepository) {
        const headPath = await TrakRepository.repoFile(repo, false, "MERGE_HEAD");
        return headPath && FileSystem.exists(headPath); 
    }

    static async clear(repo: TrakRepository) {
        const headPath = await TrakRepository.repoFile(repo, false, "MERGE_HEAD");
        const messagePath = await TrakRepository.repoFile(repo, false, "MERGE_MSG");

        if (!headPath || !messagePath)
            return;

        await FileSystem.removeFile(headPath);
        await FileSystem.removeFile(messagePath);
    }
}