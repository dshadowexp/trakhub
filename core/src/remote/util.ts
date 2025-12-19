import { TObject } from "../repo/objects";
import type { TRepository } from "../repo/repository";
import type { RemoteAgent } from "./agent";
import { PackReader, PackStreamReader, PackWriter } from "./pack";

export async function sendPackedObjects(repo: TRepository, agent: RemoteAgent, revs: string[]) {
    const revOptions = { objects: true, missing: true };
    const revList: TObject[] = [];
    const cfg = await repo.config.getConfig('local');
    const packCompression = cfg.get("pack", "compression") || cfg.get("core", "compression");
    const writerOptions = { compression: packCompression ? parseInt(packCompression) : undefined }
    const writer = new PackWriter(repo, agent.conn!.output, writerOptions);
    await writer.writeObjects(revList);
}

export async function recvPackedObjects(repo: TRepository, agent: RemoteAgent, prefix: string = "") {
    const stream = new PackStreamReader(agent.conn!.input, Buffer.from(prefix));
    const reader = new PackReader(repo, stream);
    reader.readHeader();

    for (let i = 0; i < reader.count; i++) {
        const [record, _] = await stream.capture(reader.readRecord);
        const obj = new TObject(record.type, record.data); // CHECK
        await repo.objects.store(obj);
    }

    stream.verifyChecksum();
}