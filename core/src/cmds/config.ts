import type { ConfigFileLevel } from "../db/config";
import { getConfig, setConfig } from "../db/config"
import { TrakRepository } from "../repository";
import { Terminal } from "../lib/standard";

interface ConfigArgs {
    level?: ConfigFileLevel,
    key?: string,
    value?: string,
    list?: boolean,
    showOrigin?: boolean,
    showScope?: boolean,
    unset?: boolean,
    unsetAll?: boolean,
    removeSection?: boolean,
    add?: boolean,
    get?: boolean,
    getAll?: boolean
}

export async function config(args: ConfigArgs) {
    const repo = await TrakRepository.repoFind();
    if (!repo && args.level === 'local') {
        Terminal.println("fatal: not in a trak repository");
        return;
    }

    const level: ConfigFileLevel = args.level || 'local';

    try {
        // List all configurations
        if (args.list) {
            await listConfig(level, args);
            return;
        }

        // Remove entire section
        if (args.removeSection && args.key) {
            await removeSection(level, args.key);
            return;
        }

        // Unset a configuration key
        if (args.unset && args.key) {
            await unsetConfig(level, args.key, false);
            return;
        }

        // Unset all values for a key
        if (args.unsetAll && args.key) {
            await unsetConfig(level, args.key, true);
            return;
        }

        // Get all values for a key
        if (args.getAll && args.key) {
            await getAllConfig(level, args.key);
            return;
        }

        // Get a single value
        if (args.get && args.key) {
            await getConfigValue(level, args.key);
            return;
        }

        // Add a value (allows multiple values for same key)
        if (args.add && args.key && args.value) {
            await addConfig(level, args.key, args.value);
            return;
        }

        // Set a value (default behavior)
        if (args.key && args.value) {
            await setConfigValue(level, args.key, args.value);
            return;
        }

        // Get a value (if only key is provided, no explicit --get flag)
        if (args.key && !args.value) {
            await getConfigValue(level, args.key);
            return;
        }

        Terminal.println("usage: trak config [<options>]");
        Terminal.println("  --local, --global, --system    specify config level");
        Terminal.println("  --list, -l                     list all config");
        Terminal.println("  --get <key>                    get value for key");
        Terminal.println("  --get-all <key>                get all values for key");
        Terminal.println("  --add <key> <value>            add a new value");
        Terminal.println("  --unset <key>                  remove a key");
        Terminal.println("  --unset-all <key>              remove all values for key");
        Terminal.println("  --remove-section <name>        remove a section");

    } catch (error) {
        Terminal.println(`error: ${error}`);
    }
}

async function listConfig(level: ConfigFileLevel, args: ConfigArgs) {
    const cfg = await getConfig(level);
    const lines = cfg.list();

    for (const line of lines) {
        let output = line;

        if (args.showScope) {
            output = `${level}\t${output}`;
        }

        if (args.showOrigin) {
            const configPath = getConfigPath(level);
            output = `${configPath}\t${output}`;
        }

        Terminal.println(output);
    }
}

async function getConfigValue(level: ConfigFileLevel, key: string) {
    const { section, subsection, name } = parseKey(key);
    const cfg = await getConfig(level);
    const value = cfg.get(section, name, subsection);

    if (value === null) {
        Terminal.println(`error: key '${key}' not found`);
        return;
    }

    Terminal.println(value);
}

async function getAllConfig(level: ConfigFileLevel, key: string) {
    const { section, subsection, name } = parseKey(key);
    const cfg = await getConfig(level);
    const values = cfg.getAll(section, name, subsection);

    if (values.length === 0) {
        Terminal.println(`error: key '${key}' not found`);
        return;
    }

    for (const value of values) {
        Terminal.println(value);
    }
}

async function setConfigValue(level: ConfigFileLevel, key: string, value: string) {
    const { section, subsection, name } = parseKey(key);
    const cfg = await getConfig(level);
    cfg.set(section, name, value, subsection);
    await setConfig(level, cfg.toString());
    Terminal.println(`Set '${key}' to '${value}'`);
}

async function addConfig(level: ConfigFileLevel, key: string, value: string) {
    const { section, subsection, name } = parseKey(key);
    const cfg = await getConfig(level);
    cfg.add(section, name, value, subsection);
    await setConfig(level, cfg.toString());
    Terminal.println(`Added '${key}' = '${value}'`);
}

async function unsetConfig(level: ConfigFileLevel, key: string, unsetAll: boolean) {
    const { section, subsection, name } = parseKey(key);
    const cfg = await getConfig(level);
    
    if (unsetAll) {
        cfg.unset(section, name, subsection);
        await setConfig(level, cfg.toString());
        Terminal.println(`Unset all values for '${key}'`);
    } else {
        cfg.unset(section, name, subsection);
        await setConfig(level, cfg.toString());
        Terminal.println(`Unset '${key}'`);
    }
}

async function removeSection(level: ConfigFileLevel, sectionName: string) {
    const parts = sectionName.split('.');
    const section = parts[0];
    const subsection = parts.length > 1 ? parts.slice(1).join('.') : null;

    const cfg = await getConfig(level);
    const sectionObj = cfg.getSection(section, subsection);

    if (!sectionObj) {
        Terminal.println(`error: section '${sectionName}' not found`);
        return;
    }

    // Remove the section from the map
    const key = subsection ? `${section.toLowerCase()}.${subsection}` : section.toLowerCase();
    cfg.sections.delete(key);

    await setConfig(level, cfg.toString());
    Terminal.println(`Removed section '${sectionName}'`);
}



function getConfigPath(level: ConfigFileLevel): string {
    switch (level) {
        case 'local':
            return ".trak/config";
        case 'global':
            return "~/.trakconfig";
        case 'system':
            return "/etc/trakconfig";
        default:
            return "unknown";
    }
}

/**
 * 
 * @param key 
 * @returns 
 */
export function parseKey(key: string): { section: string; subsection: string | null; name: string } {
    const keys = key.split('.');
    
    if (keys.length < 2) {
        throw new Error(`invalid key format: '${key}' (expected format: section.key or section.subsection.key)`);
    }

    const section = keys[0];
    const subsection = keys.length > 2 ? keys[1] : null;
    const name = keys[keys.length - 1];

    return { section, subsection, name };
}