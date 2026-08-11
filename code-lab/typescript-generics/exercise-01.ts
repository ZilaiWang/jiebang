// Exercise 1: Identity Function
// Implement a generic identity function that takes any type and returns it.

// TODO: Create a generic identity function called 'identity'
// The function should:
// - Accept a parameter of any type T
// - Return the same value with type T

function identity<T>(value: T): T {
  return value;
}

// Test cases - uncomment to verify your implementation
console.log(identity("hello")); // should be type 'string'
console.log(identity(42)); // should be type 'number'
console.log(identity(true)); // should be type 'boolean'

// TODO: Create a generic function called 'firstElement'
// that takes an array of any type and returns the first element

function firstElement<T>(arr: T[]): T | undefined {
  return arr[0];
}

// Test cases
console.log(firstElement([1, 2, 3])); // should return 1
console.log(firstElement(["a", "b", "c"])); // should return "a"
