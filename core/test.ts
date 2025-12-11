import { createWriteStream } from "fs";
import { type FileHandle, open } from "fs/promises";
import { performance } from "perf_hooks";

// let fd: FileHandle | undefined;
// let start: number | undefined;

// try {
//     start = performance.now();
//     fd = await open("./writeMany.txt", "w");
//     for (let i = 0; i < 10e4; i++) {
//         await fd.writeFile(`${ i + 1 } `);
//     }
// } catch (error) {
//     console.log(error);
// } finally {
//     if (fd) fd.close();
//     console.log(`Write many took: ${((performance.now() - (start || 0)) / 1000).toFixed(2)}s`);
// }

const start = performance.now();
const fileWriteStream = createWriteStream("./writeMany.txt",);
let i = 0;

const writeToStream = () => {
    while (i < 10e4) {
        if (i === 10e4 - 1) {
            fileWriteStream.end(`${ i + 1 } `);
            break;
        }

        if (!fileWriteStream.write(`${ i + 1 } `)) {
            i++;
            break;
        }
    
        i++;
    }
}

fileWriteStream.on('drain', () => {
    writeToStream();
});

fileWriteStream.on('finish', () => {
    console.log(`Write many took: ${((performance.now() - (start || 0)) / 1000).toFixed(2)}s`);
});

fileWriteStream.on('error', (err) => {
    console.log('Error:', err)
});

writeToStream();


