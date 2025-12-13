/**
 * 
 * @param target 
 * @returns 
 */
export function Singleton<T extends { new (...args: any[]): {} }>(target: T) {
    let instance: any;

    return class extends target {
        constructor(...args: any[]) {
           if (instance) return instance;
           instance = super(...args);
           return instance;
        }
    }
}