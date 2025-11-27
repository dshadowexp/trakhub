//abstraction for config

import { TrakFileSystem } from "../file-system";

type ConfigFileLevel = 'local' | 'global' | 'system';

export class TrakConfig {
    private static async _getConfigFilePath(level: ConfigFileLevel) {
        switch (level) {
            case 'local':
                return ".trak/config";
            case 'global':
                return "~/.trakconfig";
            case 'system':
                return "/etc/trakconfig";
            default:
                throw new Error("Specify config level");
        }
    }

    private static async _getConfig(level: ConfigFileLevel): Promise<Config> {
        const configFilePath = await this._getConfigFilePath(level);
        const gitConfigText = (await TrakFileSystem.readFile(configFilePath)).toString();
        return Config.parse(gitConfigText);
    }

    private static async _setConfig(level: ConfigFileLevel, content: string): Promise<void> {
        const configFilePath = await this._getConfigFilePath(level);
        await TrakFileSystem.writeFile(configFilePath, content);
    }

    static async set(level: ConfigFileLevel, name: string, key: string, value: string, subsection: string | null = null): Promise<void> {
        const config = await this._getConfig(level);
        config.set(name, key, value, subsection);
        await this._setConfig(level, config.toString());
    }

    static async get(level: ConfigFileLevel, name: string, key: string, subsection: string | null = null): Promise<string | null> {
        const config = await this._getConfig(level);
        return config.get(name, key, subsection);
    }

    static async getAll(level: ConfigFileLevel, name: string, key: string, subsection: string | null = null): Promise<string[]> {
        const config = await this._getConfig(level);
        return config.getAll(name, key, subsection);
    }

    static async findAll(name: string, key: string, subsection: string | null = null): Promise<string[]> {
        let values: string[] = [];
        for (const level of ['local', 'global', 'system']) {
            const response = await this.getAll(level as ConfigFileLevel, name, key, subsection);
            values = [...values, ...response];
        }
        return values;
    }
}

class Config {
    private sections: Map<string, Section[]> = new Map();

    static parse(text: string): Config {
        const config = new Config();
        const lines = text.split('\n');
        let currentSection: Section | null = null;

        for (let i = 0; i < lines.length; i++) {
            const line = new Line(lines[i], i + 1);

            // Skip blank lines and comments
            if (line.isBlank() || line.isComment()) {
                continue;
            }

            // Parse section header
            if (line.isSection()) {
                currentSection = Section.parse(line);
                if (currentSection) {
                    config.addSection(currentSection);
                }
                continue;
            }

            // Parse variable (property)
            if (currentSection) {
                const variable = Variable.parse(line);
                if (variable) {
                    currentSection.addVariable(variable);
                }
            }
        }

        return config;
    }

    private addSection(section: Section): void {
        const key = this.sectionKey(section.name, section.subsection);
        if (!this.sections.has(key)) {
            this.sections.set(key, []);
        }
        this.sections.get(key)!.push(section);
    }

    private sectionKey(name: string, subsection: string | null): string {
        const normalizedName = name.toLowerCase();
        return subsection ? `${normalizedName}.${subsection}` : normalizedName;
    }

    getSection(name: string, subsection: string | null = null): Section | null {
        const key = this.sectionKey(name, subsection);
        const sections = this.sections.get(key);
        return sections && sections.length > 0 ? sections[0] : null;
    }

    getSections(name: string): Section[] {
        const result: Section[] = [];
        const prefix = name.toLowerCase();

        for (const [key, sections] of this.sections) {
            if (key.startsWith(prefix)) {
                result.push(...sections);
            }
        }

        return result;
    }

    get(name: string, key: string, subsection: string | null = null): string | null {
        const section = this.getSection(name, subsection);
        return section ? section.getVariable(key) : null;
    }

    getAll(name: string, key: string, subsection: string | null = null): string[] {
        const section = this.getSection(name, subsection);
        return section ? section.getAllVariable(key) : [];
    }

    set(name: string, key: string, value: string, subsection: string | null = null): void {
        let section = this.getSection(name, subsection);
        
        if (!section) {
            section = new Section(name, subsection);
            this.addSection(section);
        }

        // Remove existing values
        section.unset(key);
        // Add new value
        section.addVariable(new Variable(key, value));
    }

    add(name: string, key: string, value: string, subsection: string | null = null): void {
        let section = this.getSection(name, subsection);
        
        if (!section) {
            section = new Section(name, subsection);
            this.addSection(section);
        }

        section.addVariable(new Variable(key, value));
    }

    unset(name: string, key: string, subsection: string | null = null): void {
        const section = this.getSection(name, subsection);
        if (section) {
            section.unset(key);
        }
    }

    toString(): string {
        const lines: string[] = [];

        for (const sections of this.sections.values()) {
            for (const section of sections) {
                lines.push(...section.lines());
            }
            lines.push("");
        }

        return lines.join('\n');
    }
}

class Line {
    constructor(public readonly text: string, public readonly number: number) {}

    isBlank(): boolean {
        return this.text.trim() === "";
    }

    isComment(): boolean {
        const trimmed = this.text.trim();
        return trimmed.startsWith('#') || trimmed.startsWith(';');
    }

    isSection(): boolean {
        return /^\[.+\]$/.test(this.trimmed());
    }

    isVariable(): boolean {
        return /^[^=]+=\s*.+$/.test(this.trimmed());
    }

    trimmed(): string {
        return this.text.trim();
    }
}

class Section {
    private variables: Map<string, Variable[]> = new Map();

    constructor(public readonly name: string, public readonly subsection: string | null = null) {}

    header(): string {
        return this.subsection ? `[${ this.name } "${ this.subsection }"]`: `[${ this.name }]`;
    }

    addVariable(variable: Variable): void {
        const key = variable.normalize();
        if (!this.variables.has(key))
            this.variables.set(key, []);
        this.variables.get(key)!.push(variable);
    }

    getVariable(key: string): string | null {
        const normalized = key.toLowerCase();
        const vars = this.variables.get(normalized);
        return vars && vars.length > 0 ? vars[vars.length - 1].value : null;
    }

    getAllVariable(key: string): string[] {
        const normalized = key.toLowerCase();
        const vars = this.variables.get(normalized);
        return vars ? vars.map(v => v.value) : [];
    }

    unset(key: string): void {
        const normalized = key.toLowerCase();
        this.variables.delete(normalized);
    }

    lines(): string[] {
        const result: string[] = [this.header()];
        
        for (const vars of this.variables.values()) {
            for (const variable of vars) {
                result.push(variable.toString());
            }
        }
        
        return result;
    }

    static parse(line: Line): Section | null {
        if (!line.isSection()) 
            return null;

        const match = line.trimmed().match(/^\[([^\]"]+?)(?:\s+"([^"]+)")?\]$/);
        if (!match) return null;

        const name = match[1].trim();
        const subsection = match[2] || null;
        
        return new Section(name, subsection);
    }
}

class Variable {
    constructor(public readonly name: string, public readonly value: string) {}

    normalize(): string {
        return this.name.toLowerCase();
    }

    toString(): string {
        return `  ${ this.name } = ${ this.value }`;
    }

    static parse(line: Line): Variable | null {
        if (!line.isVariable())
            return null;

        const [key, value] = line.text.split("=");
        return new Variable(key.trim(), value.trim());
    }
}

// // Example usage demonstrating the Building Git approach
// const gitConfigText = `# Git configuration file
// [core]
// 	repositoryformatversion = 0
// 	filemode = true
// 	bare = false
// 	logallrefupdates = true

// [remote "origin"]
// 	url = https://github.com/user/repo.git
// 	fetch = +refs/heads/*:refs/remotes/origin/*

// [branch "main"]
// 	remote = origin
// 	merge = refs/heads/main

// [user]
// 	name = John Doe
// 	email = john@example.com
// `;

// const config = Config.parse(gitConfigText);

// console.log('Core repository format version:', config.get('core', 'repositoryformatversion'));
// console.log('Core repository file mode:', config.get('core', 'filemode'));
// console.log('Remote origin fetch:', config.get('remote', 'fetch', 'origin'));

// console.log('\n=== Modifying Config ===\n');
// config.set('user', 'name', 'Jane Smith');
// config.set('user', 'email', 'jane@example.com');
// config.add('remote', 'pushurl', 'https://github.com/user/repo-push.git', 'origin');

// console.log('\n=== Regenerated Config ===\n');
// console.log(config.toString());