// Exercise 2: Array Utilities
// Build generic functions for working with arrays.

// TODO: Create a generic function called 'findInArray'
// that finds the first element matching a condition

function findInArray<T>(arr: T[], predicate: (item: T) => boolean): T | undefined {
  for (const item of arr) {
    if (predicate(item)) {
      return item;
    }
  }
  return undefined;
}

// Test cases
const numbers = [1, 2, 3, 4, 5];
console.log(findInArray(numbers, (n) => n > 3)); // should return 4

const names = ["Alice", "Bob", "Charlie"];
console.log(findInArray(names, (n) => n.startsWith("B"))); // should return "Bob"

// TODO: Create a generic function called 'filterByType'
// that filters an array and returns only items of a specific type

function filterByType<T>(arr: unknown[], typeGuard: (item: unknown) => item is T): T[] {
  return arr.filter(typeGuard) as T[];
}

// Helper type guard
function isString(item: unknown): item is string {
  return typeof item === "string";
}

// Test cases
const mixed: (string | number | boolean)[] = [1, "hello", 2, "world", true];
console.log(filterByType(mixed, isString)); // should return ["hello", "world"]
