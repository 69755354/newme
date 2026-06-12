     2|"""Browser session checkpoint/restore mechanism for Hermes agent.
     3|
     4|Provides a simple JSON-file-based checkpoint system so that browser session
     5|progress survives crashes or context compression.
     6|
     7|Checkpoint files are stored under ~/.newme/checkpoints/{task_id}.json
     8|Completed tasks are moved to ~/.newme/checkpoints/completed/{task_id}.json
     9|
    10|Usage:
    11|    python3 checkpoint.py save <task_id> <step> <url> [json_data]
    12|    python3 checkpoint.py load <task_id>
    13|    python3 checkpoint.py list
    14|    python3 checkpoint.py complete <task_id>
    15|    python3 checkpoint.py clean [max_age_hours]
    16|"""
    17|
    18|import json
    19|import os
    20|import shutil
    21|import sys
    22|import time
    23|from datetime import datetime, timezone
    24|from pathlib import Path
    25|
    26|CHECKPOINTS_DIR = Path(os.environ.get("NEWME_CHECKPOINT_DIR", os.path.join(os.path.expanduser("~"), ".newme", "checkpoints")))
    27|COMPLETED_DIR = CHECKPOINTS_DIR / "completed"
    28|
    29|
    30|def _ensure_dirs():
    31|    """Create checkpoint directories if they don't exist."""
    32|    CHECKPOINTS_DIR.mkdir(parents=True, exist_ok=True)
    33|    COMPLETED_DIR.mkdir(parents=True, exist_ok=True)
    34|
    35|
    36|def _checkpoint_path(task_id: str, completed: bool = False) -> Path:
    37|    """Return the path for a task's checkpoint file."""
    38|    base = COMPLETED_DIR if completed else CHECKPOINTS_DIR
    39|    return base / f"{task_id}.json"
    40|
    41|
    42|def save(task_id: str, step: str, url: str, data: dict | None = None) -> dict:
    43|    """Save a checkpoint for the given task.
    44|
    45|    Args:
    46|        task_id: String identifier for the task.
    47|        step: Current step number or name.
    48|        url: Current browser URL.
    49|        data: Arbitrary task-specific state (form fields filled, buttons
    50|              clicked, results found, etc.).
    51|
    52|    Returns:
    53|        The checkpoint dict that was written.
    54|    """
    55|    _ensure_dirs()
    56|    # Load existing checkpoint to preserve history
    57|    existing = load(task_id)
    58|    history = existing.get("history", []) if existing else []
    59|
    60|    checkpoint = {
    61|        "task_id": task_id,
    62|        "step": step,
    63|        "url": url,
    64|        "data": data or {},
    65|        "timestamp": datetime.now(timezone.utc).isoformat(),
    66|        "history": history + [{"step": step, "url": url, "timestamp": datetime.now(timezone.utc).isoformat()}],
    67|    }
    68|
    69|    path = _checkpoint_path(task_id)
    70|    path.write_text(json.dumps(checkpoint, indent=2) + "\n")
    71|    return checkpoint
    72|
    73|
    74|def load(task_id: str) -> dict | None:
    75|    """Load a checkpoint for the given task.
    76|
    77|    Checks both active and completed directories.
    78|
    79|    Args:
    80|        task_id: String identifier for the task.
    81|
    82|    Returns:
    83|        The checkpoint dict, or None if not found.
    84|    """
    85|    # Check active first
    86|    path = _checkpoint_path(task_id)
    87|    if path.exists():
    88|        return json.loads(path.read_text())
    89|
    90|    # Check completed
    91|    path = _checkpoint_path(task_id, completed=True)
    92|    if path.exists():
    93|        return json.loads(path.read_text())
    94|
    95|    return None
    96|
    97|
    98|def list_tasks() -> list[dict]:
    99|    """List all checkpointed tasks with last step and timestamp.
   100|
   101|    Returns:
   102|        List of dicts with task_id, step, timestamp, and status fields.
   103|    """
   104|    _ensure_dirs()
   105|    results = []
   106|
   107|    # Active checkpoints
   108|    for path in CHECKPOINTS_DIR.glob("*.json"):
   109|        try:
   110|            cp = json.loads(path.read_text())
   111|            results.append({
   112|                "task_id": cp.get("task_id", path.stem),
   113|                "step": cp.get("step", "unknown"),
   114|                "timestamp": cp.get("timestamp", ""),
   115|                "status": "active",
   116|            })
   117|        except (json.JSONDecodeError, KeyError):
   118|            results.append({
   119|                "task_id": path.stem,
   120|                "step": "unknown",
   121|                "timestamp": "",
   122|                "status": "active (corrupt)",
   123|            })
   124|
   125|    # Completed checkpoints
   126|    for path in COMPLETED_DIR.glob("*.json"):
   127|        try:
   128|            cp = json.loads(path.read_text())
   129|            results.append({
   130|                "task_id": cp.get("task_id", path.stem),
   131|                "step": cp.get("step", "unknown"),
   132|                "timestamp": cp.get("timestamp", ""),
   133|                "status": "completed",
   134|            })
   135|        except (json.JSONDecodeError, KeyError):
   136|            results.append({
   137|                "task_id": path.stem,
   138|                "step": "unknown",
   139|                "timestamp": "",
   140|                "status": "completed (corrupt)",
   141|            })
   142|
   143|    # Sort by timestamp descending (most recent first)
   144|    results.sort(key=lambda r: r.get("timestamp", ""), reverse=True)
   145|    return results
   146|
   147|
   148|def complete(task_id: str) -> dict | None:
   149|    """Mark a task as completed by moving its checkpoint to the completed dir.
   150|
   151|    Args:
   152|        task_id: String identifier for the task.
   153|
   154|    Returns:
   155|        The updated checkpoint dict with status='completed', or None if
   156|        the task was not found.
   157|    """
   158|    _ensure_dirs()
   159|    path = _checkpoint_path(task_id)
   160|    if not path.exists():
   161|        return None
   162|
   163|    cp = json.loads(path.read_text())
   164|    cp["status"] = "completed"
   165|    cp["completed_at"] = datetime.now(timezone.utc).isoformat()
   166|
   167|    dest = _checkpoint_path(task_id, completed=True)
   168|    dest.write_text(json.dumps(cp, indent=2) + "\n")
   169|    path.unlink()
   170|    return cp
   171|
   172|
   173|def clean(max_age_hours: int = 72) -> int:
   174|    """Remove completed checkpoints older than max_age_hours.
   175|
   176|    Args:
   177|        max_age_hours: Maximum age in hours for completed checkpoints.
   178|                       Default is 72 hours (3 days).
   179|
   180|    Returns:
   181|        Number of checkpoints removed.
   182|    """
   183|    _ensure_dirs()
   184|    removed = 0
   185|    cutoff = time.time() - (max_age_hours * 3600)
   186|
   187|    for path in COMPLETED_DIR.glob("*.json"):
   188|        if path.stat().st_mtime < cutoff:
   189|            path.unlink()
   190|            removed += 1
   191|
   192|    return removed
   193|
   194|
   195|def _print_usage():
   196|    """Print CLI usage information."""
   197|    print(
   198|        "Usage:\n"
   199|        "  checkpoint.py save <task_id> <step> <url> [json_data]\n"
   200|        "  checkpoint.py load <task_id>\n"
   201|        "  checkpoint.py list\n"
   202|        "  checkpoint.py complete <task_id>\n"
   203|        "  checkpoint.py clean [max_age_hours]"
   204|    )
   205|
   206|
   207|def main():
   208|    if len(sys.argv) < 2:
   209|        _print_usage()
   210|        sys.exit(1)
   211|
   212|    command = sys.argv[1].lower()
   213|
   214|    if command == "save":
   215|        if len(sys.argv) < 5:
   216|            print("Error: save requires <task_id> <step> <url> [json_data]")
   217|            sys.exit(1)
   218|        task_id = sys.argv[2]
   219|        step = sys.argv[3]
   220|        url = sys.argv[4]
   221|        data = {}
   222|        if len(sys.argv) > 5:
   223|            try:
   224|                data = json.loads(sys.argv[5])
   225|            except json.JSONDecodeError as e:
   226|                print(f"Error: invalid JSON data: {e}")
   227|                sys.exit(1)
   228|        cp = save(task_id, step, url, data)
   229|        print(f"✓ Checkpoint saved: {task_id} @ step '{step}'")
   230|        print(json.dumps(cp, indent=2))
   231|
   232|    elif command == "load":
   233|        if len(sys.argv) < 3:
   234|            print("Error: load requires <task_id>")
   235|            sys.exit(1)
   236|        task_id = sys.argv[2]
   237|        cp = load(task_id)
   238|        if cp is None:
   239|            print(f"✗ No checkpoint found for: {task_id}")
   240|            sys.exit(1)
   241|        print(json.dumps(cp, indent=2))
   242|
   243|    elif command == "list":
   244|        tasks = list_tasks()
   245|        if not tasks:
   246|            print("No checkpoints found.")
   247|        else:
   248|            print(f"{'Task ID':<30} {'Step':<20} {'Status':<15} {'Timestamp'}")
   249|            print("-" * 90)
   250|            for t in tasks:
   251|                ts = t["timestamp"][:19].replace("T", " ") if t["timestamp"] else "n/a"
   252|                print(f"{t['task_id']:<30} {t['step']:<20} {t['status']:<15} {ts}")
   253|
   254|    elif command == "complete":
   255|        if len(sys.argv) < 3:
   256|            print("Error: complete requires <task_id>")
   257|            sys.exit(1)
   258|        task_id = sys.argv[2]
   259|        cp = complete(task_id)
   260|        if cp is None:
   261|            print(f"✗ No active checkpoint found for: {task_id}")
   262|            sys.exit(1)
   263|        print(f"✓ Task completed: {task_id}")
   264|        print(json.dumps(cp, indent=2))
   265|
   266|    elif command == "clean":
   267|        max_age = int(sys.argv[2]) if len(sys.argv) > 2 else 72
   268|        removed = clean(max_age)
   269|        print(f"✓ Cleaned {removed} completed checkpoint(s) older than {max_age}h")
   270|
   271|    else:
   272|        print(f"Error: unknown command '{command}'")
   273|        _print_usage()
   274|        sys.exit(1)
   275|
   276|
   277|if __name__ == "__main__":
   278|    main()
   279|