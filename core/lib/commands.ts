import { existsSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { join, resolve } from "path";
import { TObjectsBase, WorkSpace, TBlob, TTree, TCommit, Author } from "./objects";
import { readFile } from "fs/promises";
import { createSHA1hash, getByteSize } from "./util";


const OBJECTS_DIR = 'objects';
const REFS_DIR = 'refs';
const HEAD_FILE = 'HEAD';

function getTrakRepository(rootPath: string): string {
    if (!existsSync(rootPath)) {
        throw new Error('Please provide a valid path\n');
    }

    return join(rootPath, '.trak');
}

export async function initCommand(path: string = ".") {
    try {
        const repositoryPath = getTrakRepository(path === '.' ? process.cwd() : resolve(path));
        if (existsSync(repositoryPath)) {
            throw new Error('Repository already exists\n');
        }

        const objectsPath = join(repositoryPath, OBJECTS_DIR);
        const refsPath = join(repositoryPath, REFS_DIR);
        const headPath = join(repositoryPath, HEAD_FILE);

        await mkdir(repositoryPath);
        await mkdir(objectsPath);
        await mkdir(refsPath);
        await writeFile(headPath, 'ref: refs/heads/core\n');

        process.stdout.write(`Initialized empty Trak directory in ${repositoryPath}\n`);
    } catch (error) {
        process.stderr.write(`Fatal: ${error}`);
    }
}

export async function hashObjectCommand(path: string) {
    try {
        const data = await readFile(path);
        const blob = new TBlob(data);
        const objectString = blob.toString();
        const content = `${blob.type} ${getByteSize(objectString)}\0${objectString}`;
        blob.id = createSHA1hash(content);
        process.stdout.write(`${blob.id}\n`);
    } catch (error) {
        process.stderr.write(`Fatal: ${error}`);
    }
}

export async function commitCommand(message: string = '') {
    try {
        const repositoryPath = getTrakRepository(process.cwd());
        if (!existsSync(repositoryPath)) {
            throw new Error('Repository does not exists. Please initialize!\n');
        }

        const objectsPath = join(repositoryPath, OBJECTS_DIR);
        const workspace = new WorkSpace(process.cwd());
        const objectsBase = new TObjectsBase(objectsPath);

        let entries: { name: string, oid: string }[] = [];

        for await (const path of workspace.listFiles()) {
            const data = await workspace.readFileData(path);
            const blob = new TBlob(data);
            await objectsBase.store(blob);
            entries.push({ name: path, oid: blob.id as string });
        }

        const tree = new TTree(entries);
        await objectsBase.store(tree);

        const author = new Author('', '', new Date()); // handle inside author
        const message = "First commit"; // Read from command line
        const commit = new TCommit(tree.id!, author, message);
        await objectsBase.store(commit);

        await writeFile(join(repositoryPath, HEAD_FILE), commit.id!);
        console.log(`[(root-commit) ${ commit.id }] ${ message }`);
    } catch (error) {
        process.stderr.write(`Fatal: ${error}`);
    }
}