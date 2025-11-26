//abstraction for config

import { TrakFileSystem } from "../file-system";
import { TrakRepository } from "../repository";

class Config {
    async read(repo: TrakRepository) {
        const configFilePath = await TrakRepository.repoFile(repo, false, "config");
        const configContent = (await TrakFileSystem.readFile(configFilePath!)).toString();
        const lines = configContent.split("\n");
    }

    _parseLine(line: string) {

    }
}

class Line {
    constructor(private text: string, private section: Section, private variable: Variable) {}

}

class Section {
    constructor(private name: string) {}

    normalize() {
        if (this.name || this.name.length === 0)
            return [];
        const chars = this.name.split('');
        return [chars[0].toLowerCase(), chars.slice(1).join('.')];
    }

    headingLine() {
        const chars = this.name.split('');
        const line = [`[${ chars[0] }`];
        if (chars.length > 1)
            line.push(` ${ chars.slice(1).join('.') }`);
        line.push("]\n");
        return line.join('');
    }
}

class Variable {
    constructor(public readonly name: string, public readonly value: string) {}

    serialize() {
        return `\t${ this.name } = ${ this.value }\n`;
    }
}



