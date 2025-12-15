import type { CreateUserInput, UpdateUserInput, User } from "../../types/user";

class UserService {
    private users: Map<number, User> = new Map();
    private currentId: number = 1;

    create(input: CreateUserInput): User {
        const user: User = {
            id: this.currentId++,
            ...input,
            createdAt: new Date().toISOString(),
        };

        this.users.set(user.id, user);
        return user;
    }

    findAll(): User[] {
        return Array.from(this.users.values());
    }

    findById(id: number): User | undefined {
        return this.users.get(id);
    }

    update(id: number, input: UpdateUserInput): User | undefined {
        const user = this.users.get(id);
        if (!user) return undefined;

        const updatedUser: User = {
            ...user,
            ...input,
            updatedAt: new Date().toISOString(),
        };

        this.users.set(id, updatedUser);
        return updatedUser;
    }

    delete(id: number): boolean {
        return this.users.delete(id);
    }

    count(): number {
        return this.users.size;
    }
}

export const userService = new UserService();