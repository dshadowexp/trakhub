export interface User {
    id: number;
    name: string;
    email: string;
    age?: number;
    createdAt: string;
    updatedAt?: string;
}
  
export interface CreateUserInput {
    name: string;
    email: string;
    age?: number;
}
  
export interface UpdateUserInput {
    name?: string;
    email?: string;
    age?: number;
}