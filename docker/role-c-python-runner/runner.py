import ast
import contextlib
import io
import json
import sys


class OutputLimitExceeded(Exception):
    pass


class OutputBudget:
    def __init__(self, byte_limit):
        self.remaining = byte_limit

    def consume(self, value):
        self.consume_bytes(len(str(value).encode("utf-8")))

    def consume_bytes(self, byte_count):
        if byte_count > self.remaining:
            self.remaining = 0
            raise OutputLimitExceeded()
        self.remaining -= byte_count


class LimitedWriter(io.TextIOBase):
    def __init__(self, budget):
        self.budget = budget
        self.parts = []

    def write(self, value):
        text = str(value)
        self.budget.consume(text)
        self.parts.append(text)
        return len(text)

    def getvalue(self):
        return "".join(self.parts)


def compile_submission(code, contract, platform_allowed_imports):
    tree = ast.parse(code, "submission.py", "exec")
    allowed = {
        name.split(".")[0]
        for name in contract.get("allowed_imports", [])
    } & set(platform_allowed_imports)
    never_allowed = {
        "builtins",
        "ctypes",
        "importlib",
        "inspect",
        "marshal",
        "multiprocessing",
        "os",
        "pathlib",
        "pickle",
        "resource",
        "shutil",
        "signal",
        "socket",
        "subprocess",
        "sys",
        "threading",
    }
    blocked_calls = {
        "eval",
        "exec",
        "compile",
        "open",
        "breakpoint",
        "__import__",
        "globals",
        "locals",
        "vars",
        "getattr",
        "setattr",
        "delattr",
        "memoryview",
    }
    blocked_attributes = {
        "f_back", "f_locals", "f_globals", "gi_frame", "cr_frame", "ag_frame",
        "__class__", "__bases__", "__mro__", "__subclasses__", "__globals__",
        "__code__", "__closure__", "__builtins__",
    }
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            roots = {alias.name.split(".")[0] for alias in node.names}
            if any(root in never_allowed or root not in allowed for root in roots):
                raise PermissionError("import_policy")
        if isinstance(node, ast.ImportFrom):
            root = (node.module or "").split(".")[0]
            if root in never_allowed or root not in allowed:
                raise PermissionError("import_policy")
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            if node.func.id in blocked_calls:
                raise PermissionError("call_policy")
        if isinstance(node, ast.Attribute) and (node.attr.startswith("__") or node.attr in blocked_attributes):
            raise PermissionError("attribute_policy")
        if isinstance(node, ast.Subscript):
            key = node.slice
            if isinstance(key, ast.Constant) and isinstance(key.value, str) and (
                key.value in blocked_calls or key.value in blocked_attributes
            ):
                raise PermissionError("subscript_policy")
    return compile(tree, "submission.py", "exec")


def run_test(compiled, contract, test_input, output_budget):
    writer = LimitedWriter(output_budget)
    namespace = {"__name__": "__submission__"}
    with contextlib.redirect_stdout(writer), contextlib.redirect_stderr(writer):
        if contract["execution_mode"] == "function":
            exec(compiled, namespace, namespace)
            function = namespace.get(contract.get("entry_point"))
            if not callable(function):
                raise LookupError("entry_point_missing")
            if isinstance(test_input, dict) and "args" in test_input:
                return function(
                    *test_input.get("args", []),
                    **test_input.get("kwargs", {}),
                )
            return function(test_input)

        old_stdin = sys.stdin
        sys.stdin = io.StringIO(str(test_input))
        try:
            exec(compiled, namespace, namespace)
        finally:
            sys.stdin = old_stdin
        return writer.getvalue()


def main():
    payload = json.loads(sys.stdin.read())
    code = payload["code"]
    contract = payload["execution_contract"]
    test_inputs = payload["test_inputs"]
    output_limit = int(payload["max_output_bytes"])
    output_budget = OutputBudget(output_limit)

    compiled = None
    compile_failure = None
    try:
        compiled = compile_submission(
            code,
            contract,
            payload["platform_allowed_imports"],
        )
    except PermissionError:
        compile_failure = "static_policy"
    except BaseException:
        compile_failure = "syntax_error"

    results = []
    for test_input in test_inputs:
        if compile_failure is not None:
            results.append({"outcome": compile_failure})
            continue
        try:
            actual = run_test(compiled, contract, test_input, output_budget)
            try:
                serialized = json.dumps(actual, allow_nan=False, ensure_ascii=False)
                serialized_size = len(serialized.encode("utf-8"))
                if contract["execution_mode"] == "function":
                    output_budget.consume_bytes(serialized_size)
                else:
                    raw_size = len(str(actual).encode("utf-8"))
                    output_budget.consume_bytes(max(0, serialized_size - raw_size))
                results.append({"outcome": "returned", "actual": actual})
            except (TypeError, ValueError):
                results.append({"outcome": "non_json_output"})
        except OutputLimitExceeded:
            results.append({"outcome": "output_limit"})
        except BaseException as error:
            results.append({
                "outcome": "runtime_error",
                "error_type": type(error).__name__,
            })

    print(json.dumps({
        "status": "completed",
        "results": results,
    }, allow_nan=False, ensure_ascii=False))


if __name__ == "__main__":
    main()
