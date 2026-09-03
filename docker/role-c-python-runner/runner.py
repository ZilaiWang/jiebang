import ast
import contextlib
import io
import importlib
import json
import os
import signal
import sys
import tempfile
import resource


# The audit hook covers builtin open, io.open, FileIO and indirect library calls.
# Docker isolation is still mandatory; the hook additionally protects the harness
# and other tests inside the same container from the learner program.
active_directory = None
opened_files = set()


def restrict_file_access(event, args):
    if active_directory is None:
        return
    if event == "open":
        name = args[0]
        if not isinstance(name, str) or os.path.isabs(name):
            raise PermissionError("file_scope")
        if not name or name in (".", "..") or any(c in name for c in ("/", "\\", ":", "\x00")) or len(name) > 120:
            raise PermissionError("file_scope")
        path = os.path.realpath(name)
        if os.path.dirname(path) != active_directory:
            raise PermissionError("file_scope")
        opened_files.add(path)
        if len(opened_files) > 32:
            raise PermissionError("file_count_limit")
    elif event.startswith(("os.", "subprocess.", "socket.")) or event in ("sys.settrace", "sys.setprofile"):
        raise PermissionError("process_policy")


@contextlib.contextmanager
def isolated_files(test_input, contract):
    fixtures = test_input.get("files", {}) if contract["execution_mode"] == "function" and isinstance(test_input, dict) and "args" in test_input else {}
    if not isinstance(fixtures, dict) or len(fixtures) > 16:
        raise PermissionError("file_fixtures")
    total = 0
    for name, text in fixtures.items():
        if not isinstance(name, str) or not name or name in (".", "..") or any(c in name for c in ("/", "\\", ":", "\x00")) or len(name) > 120 or not isinstance(text, str):
            raise PermissionError("file_fixtures")
        total += len(text.encode("utf-8"))
    if total > 65_536:
        raise PermissionError("file_fixtures")
    with tempfile.TemporaryDirectory(prefix="role-c-") as directory:
        for name, text in fixtures.items():
            with open(os.path.join(directory, name), "w", encoding="utf-8") as handle:
                handle.write(text)
        yield directory


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
        if isinstance(node, ast.Name) and node.id == "__builtins__":
            raise PermissionError("builtins_policy")
        if isinstance(node, ast.Subscript):
            key = node.slice
            if isinstance(key, ast.Constant) and isinstance(key.value, str) and (
                key.value in blocked_calls or key.value in blocked_attributes
            ):
                raise PermissionError("subscript_policy")
    return compile(tree, "submission.py", "exec")


def run_test(compiled, contract, test_input, output_budget):
    writer = LimitedWriter(output_budget)
    # stdin/stdout submissions are complete Python programs and must observe
    # normal script semantics. Function submissions stay import-like so a
    # learner's main guard cannot run unrelated top-level I/O before grading.
    namespace = {
        "__name__": (
            "__submission__"
            if contract["execution_mode"] == "function"
            else "__main__"
        )
    }
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
    # Preload only the platform standard library before file isolation starts.
    # Submission imports remain restricted by compile_submission.
    for name in payload["platform_allowed_imports"]:
        importlib.import_module(name)
    sys.addaudithook(restrict_file_access)
    resource.setrlimit(resource.RLIMIT_FSIZE, (1_048_576, 1_048_576))

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

    # The harness is PID 1 inside Docker: default terminating signals can be
    # ignored there. Explicit handlers preserve timeout identity (124), distinct
    # from an OOM/SIGKILL (137). These modules remain forbidden to submissions.
    def terminate_on_timeout(_signal, _frame):
        os._exit(124)

    signal.signal(signal.SIGALRM, terminate_on_timeout)
    signal.signal(signal.SIGXCPU, terminate_on_timeout)
    timeout_seconds = contract["resource_limits"]["timeout_ms"] / 1000
    signal.setitimer(signal.ITIMER_REAL, timeout_seconds)
    results = []
    for test_input in test_inputs:
        if compile_failure is not None:
            results.append({"outcome": compile_failure})
            continue
        results.append(run_isolated_test(compiled, contract, test_input, output_budget))

    signal.setitimer(signal.ITIMER_REAL, 0)
    print(json.dumps({
        "status": "completed",
        "results": results,
    }, allow_nan=False, ensure_ascii=False))


def run_isolated_test(compiled, contract, test_input, output_budget):
    global active_directory, opened_files
    with isolated_files(test_input, contract) as directory:
        read_fd, write_fd = os.pipe()
        child = os.fork()
        if child == 0:
            # Only JSON crosses back to the parent. Learner objects, open file
            # handles, module mutations and finalizers never survive a test.
            os.close(read_fd)
            os.chdir(directory)
            opened_files = set()
            active_directory = os.path.realpath(directory)
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
                    result = {"outcome": "returned", "actual": json.loads(serialized)}
                except (TypeError, ValueError):
                    result = {"outcome": "non_json_output"}
            except OutputLimitExceeded:
                result = {"outcome": "output_limit"}
            except BaseException as error:
                result = {"outcome": "runtime_error", "error_type": type(error).__name__}
            encoded = json.dumps({"result": result, "remaining": output_budget.remaining}, ensure_ascii=False).encode("utf-8")
            while encoded:
                encoded = encoded[os.write(write_fd, encoded):]
            os._exit(0)
        os.close(write_fd)
        parts = []
        try:
            while True:
                part = os.read(read_fd, 65536)
                if not part:
                    break
                parts.append(part)
        finally:
            os.close(read_fd)
        _, status = os.waitpid(child, 0)
        if os.WIFSIGNALED(status):
            if os.WTERMSIG(status) in (signal.SIGXCPU, signal.SIGALRM):
                os._exit(124)
            return {"outcome": "runtime_error", "error_type": "MemoryError" if os.WTERMSIG(status) == signal.SIGKILL else "ChildProcessError"}
        if os.WEXITSTATUS(status) == 124:
            os._exit(124)
        if os.WEXITSTATUS(status) != 0 or not parts:
            return {"outcome": "runtime_error", "error_type": "ChildProcessError"}
        result = json.loads(b"".join(parts))
        output_budget.remaining = result["remaining"]
        return result["result"]


if __name__ == "__main__":
    main()
