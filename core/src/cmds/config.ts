import { TrakRepository } from "../repository";
import { TrakConfig } from "../db/config";
import { Terminal } from "../lib/standard";

type ConfigOptions = {
  global?: boolean;
  system?: boolean;
  local?: boolean;
  list?: boolean;
  unset?: boolean;
  add?: boolean;
  get?: boolean;
  getAll?: boolean;
  edit?: boolean;
};

type ConfigArgs = {
  key?: string;
  value?: string;
  options?: ConfigOptions;
};

/**
 * Handle git config command
 * 
 * Examples:
 * - config({ key: "user.name", value: "John", options: { global: true } })
 * - config({ key: "user.name", options: { get: true, global: true } })
 * - config({ options: { list: true, global: true } })
 * - config({ key: "remote.origin.fetch", options: { getAll: true } })
 */
export async function config(args: ConfigArgs = {}) {
    const repo = await TrakRepository.repoFind();
    if (!repo)
        return;
    
    const { key, value, options = {} } = args;

    // Determine config level (default to local)
    const level = options.global ? 'global' : 
                    options.system ? 'system' : 
                    'local';

    try {
        // Handle --list: show all config values
        if (options.list) {
            await handleList(level);
            return;
        }

        // Handle --edit: open config file in editor
        if (options.edit) {
            await handleEdit(level);
            return;
        }

        // Key is required for other operations
        if (!key) {
            throw new Error("Config key is required");
        }

        const { section, subsection, variableKey } = parseKey(key);

        // Handle --unset: remove a config value
        if (options.unset) {
            await TrakConfig.set(level, section, variableKey, "", subsection);
            Terminal.println(`Unset ${key} in ${level} config`);
            return;
        }

        // Handle --get-all: get all values for a key
        if (options.getAll) {
            const values = await TrakConfig.getAll(level, section, variableKey, subsection);
            if (values.length === 0) {
                Terminal.println(`No values found for ${key}`);
            } else {
                values.forEach(v => Terminal.println(v));
            }
            return;
        }

        // Handle --get or just reading a value
        if (options.get || !value) {
            const result = await TrakConfig.get(level, section, variableKey, subsection);
            if (result === null) {
                throw new Error(`Config key '${key}' not found`);
            }
            Terminal.println(result);
            return;
        }

        // Handle --add: add a value (allows multiple values)
        if (options.add) {
            const configInstance = await (TrakConfig as any)._getConfig(level);
            configInstance.add(section, variableKey, value, subsection);
            await (TrakConfig as any)._setConfig(level, configInstance.toString());
            Terminal.println(`Added ${key} = ${value} in ${level} config`);
            return;
        }

        // Default: set a value (replaces existing)
        if (value) {
            await TrakConfig.set(level, section, variableKey, value, subsection);
            Terminal.println(`Set ${key} = ${value} in ${level} config`);
            return;
        }

        throw new Error("Invalid config command");
    } catch (error) {
        Terminal.println(`Error: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
    }
}

/**
 * Parse config key into section, subsection, and variable
 * Examples:
 * - "user.name" -> { section: "user", subsection: null, variableKey: "name" }
 * - "remote.origin.url" -> { section: "remote", subsection: "origin", variableKey: "url" }
 * - "branch.main.merge" -> { section: "branch", subsection: "main", variableKey: "merge" }
 */
function parseKey(key: string): { 
    section: string; 
    subsection: string | null; 
    variableKey: string;
} {
    const parts = key.split('.');

    if (parts.length < 2) {
        throw new Error(`Invalid config key format: ${key}`);
    }

    // Check if this is a subsection key (section.subsection.key)
    // Common patterns: remote.origin.url, branch.main.merge
    const sectionsWithSubsections = ['remote', 'branch', 'submodule', 'url'];
    
    if (parts.length === 3 && sectionsWithSubsections.includes(parts[0])) {
        return {
            section: parts[0],
            subsection: parts[1],
            variableKey: parts[2]
        };
    }

    // Default case: section.key (e.g., user.name, core.editor)
    return {
        section: parts[0],
        subsection: null,
        variableKey: parts.slice(1).join('.')
    };
}

/**
 * Handle --list: display all config values
 */
async function handleList(level: 'local' | 'global' | 'system') {
    try {
        const configInstance = await (TrakConfig as any)._getConfig(level);
        const configText = configInstance.toString();
        
        if (!configText.trim()) {
            Terminal.println(`No configuration found in ${level} config`);
            return;
        }

        // Parse and display in key=value format
        const lines = configText.split('\n');
        let currentSection = '';
        let currentSubsection: string | null = null;

        for (const line of lines) {
            const trimmed = line.trim();
            
            // Skip blank lines and comments
            if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) {
                continue;
            }

            // Parse section header
            const sectionMatch = trimmed.match(/^\[([^\]"]+?)(?:\s+"([^"]+)")?\]$/);
            if (sectionMatch) {
                currentSection = sectionMatch[1];
                currentSubsection = sectionMatch[2] || null;
                continue;
            }

            // Parse variable
            const varMatch = trimmed.match(/^([^=]+?)\s*=\s*(.+)$/);
            if (varMatch && currentSection) {
                const key = varMatch[1].trim();
                const value = varMatch[2].trim();
                
                const fullKey = currentSubsection 
                    ? `${currentSection}.${currentSubsection}.${key}`
                    : `${currentSection}.${key}`;
                
                Terminal.println(`${fullKey}=${value}`);
            }
        }
    } catch (error) {
        Terminal.println(`Error reading ${level} config: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Handle --edit: open config file in editor
 */
async function handleEdit(level: 'local' | 'global' | 'system') {
  Terminal.println(`Opening ${level} config file in editor...`);
  // This would typically spawn an editor process
  // For now, just show the path
  const path = await (TrakConfig as any)._getConfigFilePath(level);
  Terminal.println(`Config file: ${path}`);
  Terminal.println("(Editor functionality not implemented in this example)");
}

/**
 * Find config value across all levels (system -> global -> local)
 * Returns the most specific value found
 */
export async function findConfig(key: string): Promise<string | null> {
    const { section, subsection, variableKey } = parseKey(key);
    
    // Check in order of precedence: local -> global -> system
    for (const level of ['local', 'global', 'system'] as const) {
        try {
            const value = await TrakConfig.get(level, section, variableKey, subsection);
            if (value !== null) {
                return value;
            }
        } catch {
            // Config file might not exist at this level
            continue;
        }
    }
    
    return null;
}

/**
 * Get all values for a key across all config levels
 */
export async function findAllConfig(key: string): Promise<string[]> {
    const { section, subsection, variableKey } = parseKey(key);
    return await TrakConfig.findAll(section, variableKey, subsection);
}