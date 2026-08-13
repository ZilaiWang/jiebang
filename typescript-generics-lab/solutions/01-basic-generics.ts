/**
 * Solution 1: Basic Generic Functions
 */

// ✅ WITH generics - preserves type information
function identity<T>(value: T): T {
  return value;
}

// Task 1: Verify type is string
const result2 = identity("hello"); // type is `string` ✓

// Task 2: Create generic `first` function
function first<T>(items: T[]): T | undefined {
  return items[0];
}

// Task 3: Create generic `wrap` function
function wrap<T>(value: T): { value: T; timestamp: number } {
  return {
    value,
    timestamp: Date.now(),
  };
}

// Tests
console.log(first([1, 2, 3]));           // 1
console.log(first([]));                  // undefined
console.log(wrap("hello"));              // { value: "hello", timestamp: 1234567890 }
