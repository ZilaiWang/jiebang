/**
 * Exercise 2: Generic Interfaces & Types
 * 
 * Learning goals:
 * - Use generics in interfaces and type aliases
 * - Create flexible, reusable data structures
 * - Understand type constraints
 */

// ❌ Without generics - need separate interfaces for each type
interface StringBox {
  value: string;
}

interface NumberBox {
  value: number;
}

// ✅ With generics - one interface works for any type
interface Box<T> {
  value: T;
  toString(): string;
}

// Your tasks:

// 1. Create a generic interface called `ApiResponse<T>` with:
//    - success: boolean
//    - data: T | null
//    - error: string | null
interface ApiResponse<T> {
  // Your implementation here
}

// 2. Create a generic type called `Optional<T>` that represents a value
//    that might not exist. It should be: { value: T } | { value: null }
type Optional<T> = 
  // Your implementation here
  never;

// 3. Create a generic class called `Stack<T>` with:
//    - private items: T[]
//    - push(item: T): void
//    - pop(): T | undefined
//    - peek(): T | undefined
//    - get size(): number
class Stack<T> {
  // Your implementation here
}

// Tests (uncomment to verify your implementation)
// const response: ApiResponse<number> = { success: true, data: 42, error: null };
// const stack = new Stack<string>();
// stack.push("hello");
// stack.push("world");
// console.log(stack.pop());   // "world"
// console.log(stack.size);    // 1
