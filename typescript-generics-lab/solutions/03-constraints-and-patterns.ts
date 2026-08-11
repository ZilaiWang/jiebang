/**
 * Solution 3: Type Constraints & Common Patterns
 */

// Task 1: Create firstMatching<T>
function firstMatching<T extends object>(
  items: T[],
  predicate: (item: T) => boolean
): T | undefined {
  return items.find(predicate);
}

// Task 2: Create MyPick<T, K>
type MyPick<T, K extends keyof T> = {
  [P in K]: T[P];
};

// Task 3: Create groupBy<T, K>
function groupBy<T, K extends string>(
  items: T[],
  keyExtractor: (item: T) => K
): Record<K, T[]> {
  const result = {} as Record<K, T[]>;
  
  for (const item of items) {
    const key = keyExtractor(item);
    if (!result[key]) {
      result[key] = [];
    }
    result[key].push(item);
  }
  
  return result;
}

// Tests
const people = [
  { name: "Alice", age: 30 },
  { name: "Bob", age: 25 },
  { name: "Carol", age: 30 },
];

const firstAdult = firstMatching(people, p => p.age >= 18);
console.log(firstAdult); // { name: "Alice", age: 30 }

type PersonName = MyPick<{ name: string; age: number; email: string }, "name" | "email">;
// PersonName is { name: string; email: string }

const grouped = groupBy(people, p => String(p.age));
console.log(grouped); 
// { "30": [{ name: "Alice", ... }, { name: "Carol", ... }], "25": [{ name: "Bob", ... }] }
