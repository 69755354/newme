     2|"""
     3|md5_gate.py — Delivery gate: verify PPT/XLSX uses the client's real floorplan,
     4|NOT the generic template image.
     5|
     6|Usage:
     7|    md5_gate.py --deliverable <path> --template <path> --client-floorplan <path>
     8|
     9|Exit codes: 0 = PASS, 1 = FAIL, 2 = WARN, 3 = usage/argument error
    10|"""
    11|
    12|import argparse
    13|import hashlib
    14|import json
    15|import os
    16|import sys
    17|import zipfile
    18|
    19|
    20|# ── helpers ──────────────────────────────────────────────────────────────────
    21|
    22|def _md5_of_file(path):
    23|    """Return hex MD5 of a file."""
    24|    h = hashlib.md5()
    25|    with open(path, "rb") as f:
    26|        for chunk in iter(lambda: f.read(65536), b""):
    27|            h.update(chunk)
    28|    return h.hexdigest()
    29|
    30|
    31|def _md5_of_bytes(data):
    32|    """Return hex MD5 of a bytes object."""
    33|    return hashlib.md5(data).hexdigest()
    34|
    35|
    36|def _is_image_file(name):
    37|    """Return True if filename looks like an embedded image."""
    38|    low = name.lower()
    39|    return any(low.endswith(ext) for ext in (
    40|        ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff", ".tif", ".emf", ".wmf",
    41|        ".svg", ".webp",
    42|    ))
    43|
    44|
    45|def _image_entries(zip_path):
    46|    """Yield (archive_path, bytes) for every image inside a PPTX/XLSX zip."""
    47|    try:
    48|        with zipfile.ZipFile(zip_path, "r") as zf:
    49|            for info in zf.infolist():
    50|                # ppt/media/, xl/media/, word/media/ — cover all office formats
    51|                parts = info.filename.replace("\\", "/").split("/")
    52|                if (len(parts) >= 2
    53|                        and parts[-2] == "media"
    54|                        and _is_image_file(parts[-1])
    55|                        and not info.is_dir()):
    56|                    yield info.filename, zf.read(info.filename)
    57|    except zipfile.BadZipFile:
    58|        pass  # not a zip — no images to check
    59|
    60|
    61|def _extract_image_hashes(zip_path):
    62|    """Return dict {md5hex: [archive_paths]} for all images in a PPTX/XLSX."""
    63|    hashes = {}
    64|    for arcpath, data in _image_entries(zip_path):
    65|        h = _md5_of_bytes(data)
    66|        hashes.setdefault(h, []).append(arcpath)
    67|    return hashes
    68|
    69|
    70|# ── core logic ───────────────────────────────────────────────────────────────
    71|
    72|def check_floorplan(deliverable_path, template_path, client_floorplan_path):
    73|    """
    74|    Check that *deliverable_path* (PPTX/XLSX) contains the client's actual
    75|    floorplan image and does NOT contain any image that also appears in
    76|    *template_path*.
    77|
    78|    Returns a dict with keys:
    79|        verdict          – "PASS" | "FAIL" | "WARN"
    80|        template_matches – list of (md5, [paths]) that matched the template
    81|        client_match     – bool, True if client floorplan image was found
    82|        client_md5       – MD5 hex digest of the client floorplan file
    83|        deliverable_images – dict of all images found in the deliverable
    84|        details          – human-readable summary
    85|    """
    86|    # --- gather data --------------------------------------------------------
    87|    if not os.path.isfile(deliverable_path):
    88|        return {
    89|            "verdict": "FAIL",
    90|            "template_matches": [],
    91|            "client_match": False,
    92|            "client_md5": None,
    93|            "deliverable_images": {},
    94|            "details": f"Deliverable file not found: {deliverable_path}",
    95|        }
    96|
    97|    deliverable_hashes = _extract_image_hashes(deliverable_path)
    98|
    99|    if not deliverable_hashes:
   100|        return {
   101|            "verdict": "WARN",
   102|            "template_matches": [],
   103|            "client_match": False,
   104|            "client_md5": None,
   105|            "deliverable_images": {},
   106|            "details": "No images found in deliverable — nothing to validate.",
   107|        }
   108|
   109|    template_hashes = _extract_image_hashes(template_path) if template_path else {}
   110|    client_md5 = _md5_of_file(client_floorplan_path) if client_floorplan_path else None
   111|
   112|    # --- compare: template images present? ----------------------------------
   113|    template_matches = []
   114|    for md5, paths in deliverable_hashes.items():
   115|        if md5 in template_hashes:
   116|            template_matches.append({
   117|                "md5": md5,
   118|                "deliverable_paths": paths,
   119|                "template_paths": template_hashes[md5],
   120|            })
   121|
   122|    # --- compare: client floorplan present? ---------------------------------
   123|    client_match = False
   124|    if client_md5 and client_md5 in deliverable_hashes:
   125|        client_match = True
   126|
   127|    # --- verdict ------------------------------------------------------------
   128|    if template_matches:
   129|        verdict = "FAIL"
   130|        n = len(template_matches)
   131|        paths_flat = [p for m in template_matches for p in m["deliverable_paths"]]
   132|        details = (
   133|            f"FAIL — {n} template image(s) still present in deliverable "
   134|            f"({', '.join(paths_flat)}). Replace with client floorplan."
   135|        )
   136|    elif client_match:
   137|        verdict = "PASS"
   138|        details = (
   139|            f"PASS — client floorplan confirmed in deliverable "
   140|            f"(md5 {client_md5})."
   141|        )
   142|    else:
   143|        verdict = "WARN"
   144|        details = (
   145|            "WARN — no template images found, but client floorplan image "
   146|            "was not detected either. Verify manually."
   147|        )
   148|
   149|    # Build a serialisable version of deliverable_images
   150|    deliverable_images_ser = {
   151|        md5: paths for md5, paths in deliverable_hashes.items()
   152|    }
   153|
   154|    return {
   155|        "verdict": verdict,
   156|        "template_matches": template_matches,
   157|        "client_match": client_match,
   158|        "client_md5": client_md5,
   159|        "deliverable_images": deliverable_images_ser,
   160|        "details": details,
   161|    }
   162|
   163|
   164|# ── CLI ──────────────────────────────────────────────────────────────────────
   165|
   166|def _build_parser():
   167|    p = argparse.ArgumentParser(
   168|        description="Verify PPT/XLSX deliverable uses client floorplan, not template.",
   169|    )
   170|    p.add_argument(
   171|        "--deliverable", required=True,
   172|        help="Path to the PPTX or XLSX deliverable to check.",
   173|    )
   174|    p.add_argument(
   175|        "--template",
   176|        help="Path to the template PPTX whose images must NOT appear.",
   177|    )
   178|    p.add_argument(
   179|        "--client-floorplan",
   180|        help="Path to the client's actual floorplan image.",
   181|    )
   182|    p.add_argument(
   183|        "--json", action="store_true", dest="json_output",
   184|        help="Print full result as JSON (default is just the details line).",
   185|    )
   186|    return p
   187|
   188|
   189|def main(argv=None):
   190|    parser = _build_parser()
   191|    args = parser.parse_args(argv)
   192|
   193|    if not args.template and not args.client_floorplan:
   194|        parser.error("At least one of --template or --client-floorplan is required.")
   195|
   196|    result = check_floorplan(
   197|        deliverable_path=args.deliverable,
   198|        template_path=args.template,
   199|        client_floorplan_path=args.client_floorplan,
   200|    )
   201|
   202|    if args.json_output:
   203|        print(json.dumps(result, indent=2))
   204|    else:
   205|        print(result["details"])
   206|
   207|    return {"PASS": 0, "FAIL": 1, "WARN": 2}.get(result["verdict"], 1)
   208|
   209|
   210|if __name__ == "__main__":
   211|    sys.exit(main())
   212|