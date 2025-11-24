import { TrakRepository } from "./repository";

export class TrakRefs {
    static async updateHead(repo: TrakRepository, oid: string) {
        const headFilePath = await TrakRepository.repoFile(repo, true, "HEAD");
        if (!headFilePath || !TrakRepository.exists(headFilePath))
            return "master";
        
        await TrakRepository.writeFile(headFilePath, `ref: refs/heads/${oid}`);
    }
}