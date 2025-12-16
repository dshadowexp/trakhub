import { getConfig } from "../repo/config";
import { TObject, TObjects } from "../repo/objects";
import type { TrakRepository } from "../repository";
import { PackReader, PackStreamReader, PackWriter } from "./pack";
import type { Protocol } from "./protocol";

export async function sendPackedObjects(repo: TrakRepository, conn: Protocol | undefined, revs: string[]) {
    const revOptions = { objects: true, missing: true };
    const revList: TObject[] = [];
    const cfg = await getConfig('local');
    const packCompression = cfg.get("pack", "compression") || cfg.get("core", "compression");
    const writerOptions = { compression: packCompression ? parseInt(packCompression) : undefined }
    const writer = new PackWriter(repo, conn!.output, writerOptions);
    await writer.writeObjects(revList);
}

export async function recvPackedObjects(repo: TrakRepository, conn: Protocol | undefined, prefix: string = "") {
    const stream = new PackStreamReader(conn!.input, Buffer.from(prefix));
    const reader = new PackReader(repo, stream);
    reader.readHeader();

    for (let i = 0; i < reader.count; i++) {
        const [record, _] = await stream.capture(reader.readRecord);
        const obj = new TObject(record.type, record.data);
        await TObjects.writeObject(obj, repo);
    }

    stream.verifyChecksum();
}