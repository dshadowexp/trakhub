import { mkdir } from "fs/promises";
import { FileSystem } from "../lib/standard";
import { TrakRepository } from "../repository";
import { BaseCommand } from "./-base";
import { TRefs } from "../repo/refs";

const DEFAULT_BRANCH = "master";

interface InitArgs {
    path: string;
}

export class Init extends BaseCommand<InitArgs> {
    constructor(args: any[] = []) {
        super(
            'init', 
            'lists the contents of a tree object',
            [
                { name: 'path', type: String, multiple: false, defaultOption: true },
            ],
            args,
            false
        )
    }

    async run(): Promise<void> {
        const path = this._args.path ?? process.cwd();

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

        TrakRepository.repoDir(repo, true, "objects");
        TrakRepository.repoDir(repo, true, "refs", "remotes");
        TrakRepository.repoDir(repo, true, "refs", "heads");

        const refs = new TRefs(repo.trakDir);
        const defaultBranchFilePath = TrakRepository.repoFile(repo, false, "refs", "heads", DEFAULT_BRANCH);
        if (defaultBranchFilePath) {
            await refs.updateHead(defaultBranchFilePath);
        }
            
        
        const descriptionFile = TrakRepository.repoFile(repo, false, "description");
        if (descriptionFile)
            await FileSystem.writeFile(descriptionFile, "Unnamed repository; edit this file 'description' to name the repository.\n");

        // return repo;

        process.exit(0);
    }
}