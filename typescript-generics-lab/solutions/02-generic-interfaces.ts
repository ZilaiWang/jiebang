/**
 * Solution 2: Generic Interfaces & Types
 */

// Task 1: Create ApiResponse<T>
interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error: string | null;
}

// Task 2: Create Optional<T>
type Optional<T> = { value: T } | { value: null };

// Task 3: Create Stack<T> class
class Stack<T> {
  private items: T[] = [];

  push(item: T): void {
    this.items.push(item);
  }

  pop(): T | undefined {
    return this.items.pop();
  }

  peek(): T | undefined {
    return this.items[this.items.length - 1];
  }

  get size(): number {
    return this.items.length;
  }
}

// Tests
const response: ApiResponse<number> = { 
  success: true, 
  data: 42, 
  error: null 
};
console.log(response); // { success: true, data: 42, error: null }

const stack = new Stack<string>();
stack.push("hello");
stack.push("world");
console.log(stack.pop());   // "world"
console.log(stack.size);    // 1
console.log(stack.peek());  // "hello"
