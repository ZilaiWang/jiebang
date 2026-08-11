// Exercise 3: Stack Implementation
// Implement a generic Stack data structure.

// TODO: Create a generic Stack class with the following methods:
// - push(item: T): void - adds an item to the top
// - pop(): T | undefined - removes and returns the top item
// - peek(): T | undefined - returns the top item without removing
// - isEmpty(): boolean - checks if the stack is empty
// - size(): number - returns the number of items

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

  isEmpty(): boolean {
    return this.items.length === 0;
  }

  size(): number {
    return this.items.length;
  }
}

// Test cases
const numberStack = new Stack<number>();
numberStack.push(1);
numberStack.push(2);
numberStack.push(3);

console.log(numberStack.peek()); // should return 3
console.log(numberStack.size()); // should return 3
console.log(numberStack.pop()); // should return 3
console.log(numberStack.size()); // should return 2

const stringStack = new Stack<string>();
stringStack.push("hello");
stringStack.push("world");

console.log(stringStack.peek()); // should return "world"
console.log(stringStack.isEmpty()); // should return false
stringStack.pop();
stringStack.pop();
console.log(stringStack.isEmpty()); // should return true
