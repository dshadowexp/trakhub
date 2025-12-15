import { createReadStream, createWriteStream } from "fs";
import type { FileHandle } from "fs/promises";
import { open } from "fs/promises";
import { readdir } from "fs/promises";
import { join } from "path";
import { performance } from "perf_hooks";

async function* osWalkRecurse(dir: string, parentDir: string = '', level: number = 0): AsyncGenerator<string> {
    const fullPath = join(parentDir, dir);

    const dirEntities = await readdir(fullPath, { withFileTypes: true });

    for (const entity of dirEntities) {
        if (entity.isDirectory()) {
            yield* osWalkRecurse(entity.name, fullPath, level + 1);
        } else {
            yield `${' '.repeat(level * 2)} ${ join(fullPath, entity.name) }`;
        }
    } 
}

async function* osWalkIter(dir: string): AsyncGenerator<string> {
    const stack: [string, string, number][] = [];
    stack.push([dir, '', 0]);

    while (stack.length > 0) {
        const [currentDir, parentDir, level] = stack.pop()!;
        const fullPath = join(parentDir, currentDir);
        const dirEntities = await readdir(fullPath, { withFileTypes: true });

        for (const entity of dirEntities) {
            if (entity.isDirectory()) {
                stack.push([entity.name, fullPath, level + 1]);
            } else {
                yield `${' '.repeat(level * 2)} ${ join(fullPath, entity.name) }`;
            }
        }
    }
}

function countDigits(num: number): number {
    let digitCounter = 0;

    while (num > 0) {
        num = Math.floor(num / 10);
        digitCounter++;
    }

    return digitCounter;
}

function isPrime(num: number): boolean {
    if (num <= 1) return false;

    for (let i = 2; i < Math.sqrt(num + 1); i++) {
        if (num % i === 0) return false;
    }

    return true;
}

function countPrimesUpTo(limit: number): number {
    let count = 0;

    for (let i = 1; i <= limit; i++) {
        if (isPrime(i)) {
            count++;
        }
    }

    return count;
}

function processChunk(chunk: Buffer, filter: (num: number) => boolean) {
    const chunkString = chunk.toString('utf-8');
    const chunkArray = chunkString.split(' ');
    let maxDigitCount = 0, lastNum = -1;
    let collection: number[] = [];

    for (const num of chunkArray) {
        const numInt = parseInt(num);
        const digitCount = countDigits(numInt);
        if (digitCount < maxDigitCount || (digitCount === maxDigitCount && numInt < lastNum)) {
            return {
                incomplete: Buffer.from(num),
                collection
            };
        }

        if (filter(numInt))
            collection.push(numInt);
        
        maxDigitCount = Math.max(maxDigitCount, digitCount);
        lastNum = numInt;
    }

    return {
        incomplete: Buffer.alloc(0),
        collection
    };
}

function streamRead() {
    const start = performance.now();

    const readStream = createReadStream('./writeMany.txt');
    const writeStream = createWriteStream('./writeManyCopy.txt');
    let remainderBuffer: Buffer = Buffer.alloc(0);
    let collectionCount = 0;

    readStream.on('data', (chunk) => {
        const { incomplete, collection } = processChunk(Buffer.concat([remainderBuffer, chunk as Buffer]), isPrime);
        remainderBuffer = incomplete;
        collectionCount += collection.length;

        if (!writeStream.write(collection.join(' '))) {
            readStream.pause();
        }
    });

    writeStream.on('drain', () => {
        readStream.resume();
    });

    readStream.on('end', () => {
        console.log(`Took: ${((performance.now() - start) / 1000).toFixed(2)}s for ${ collectionCount } prime numbers. expected ${countPrimesUpTo(10e4)}`);
    });
}

async function manualRead() {
    let readFd: FileHandle | undefined;
    let writeFd: FileHandle | undefined;
    const start = performance.now();

    try {
        const readFd = await open('./writeMany.txt', 'r');
        const writeFd = await open('./writeManyCopy1.txt', 'w');

        let bytesRead = -1;

        while (bytesRead !== 0) {
            const content = await readFd.read();
            bytesRead = content.bytesRead;
            await writeFd.write(content.buffer);
        }  
    } catch (error) {
        console.log(error);
    } finally {
        readFd?.close();
        writeFd?.close();
        console.log(`Took: ${((performance.now() - start) / 1000).toFixed(2)}s`);
    }
}

(async () => {
    await manualRead();
    streamRead();
})()



