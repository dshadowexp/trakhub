import { mkdir } from "fs/promises";
import { FileSystem } from "../standard-lib";
import { TrakRepository } from "../repository";

export async function createRepo(path: string) {
    const repo = new TrakRepository(path, true);

    if (FileSystem.exists(repo.workTree)) {
        if (!FileSystem.isDirectory(repo.workTree))
            throw new Error(`${ path } is not a directory`);
        if (FileSystem.exists(repo.trakDir)) {
            try {
                if ((await FileSystem.readDirectory(repo.trakDir) as string[]).length > 0) {
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
        await FileSystem.writeFile(headFile, 'ref: refs/heads/master');
    
    const descriptionFile = await TrakRepository.repoFile(repo, false, "description");
    if (descriptionFile)
        await FileSystem.writeFile(descriptionFile, "Unnamed repository; edit this file 'description' to name the repository.\n");

    return repo;
}