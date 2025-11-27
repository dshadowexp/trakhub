import { mkdir } from "fs/promises";
import { TrakFileSystem } from "../file-system";
import { TrakRepository } from "../repository";

export async function createRepo(path: string) {
    const repo = new TrakRepository(path, true);

    if (TrakFileSystem.exists(repo.workTree)) {
        if (!TrakFileSystem.isDirectory(repo.workTree))
            throw new Error(`${ path } is not a directory`);
        if (TrakFileSystem.exists(repo.trakDir)) {
            try {
                if ((await TrakFileSystem.readDirectory(repo.trakDir) as string[]).length > 0) {
                    throw new Error(`${ path } is not empty`);
                }
            } catch (error) {}
        }
    } else {
        await mkdir(repo.workTree);
    }

    await TrakRepository.repoDir(repo, true, "objects");
    await TrakRepository.repoDir(repo, true, "refs", "tags");
    await TrakRepository.repoDir(repo, true, "refs", "heads");

    const headFile = await TrakRepository.repoFile(repo, false, "HEAD");
    if (headFile)
        await TrakFileSystem.writeFile(headFile, 'ref: refs/heads/master');
    
    const descriptionFile = await TrakRepository.repoFile(repo, false, "description");
    if (descriptionFile)
        await TrakFileSystem.writeFile(descriptionFile, "Unnamed repository; edit this file 'description' to name the repository.\n");

    return repo;
}