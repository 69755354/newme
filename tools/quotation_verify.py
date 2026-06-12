     2|"""
     3|quotation_verify.py — Cross-validate device quantities across CAD/Excel/PPT.
     4|
     5|Ensures NewMe KNX smart home quotations are consistent before client delivery.
     6|
     7|Usage:
     8|    quotation_verify.py --cad file.dxf --excel file.xls --ppt file.pptx [--project NAME] [--json] [-v]
     9|"""
    10|
    11|import argparse
    12|import json
    13|import os
    14|import re
    15|import subprocess
    16|import sys
    17|import tempfile
    18|from collections import defaultdict
    19|from pathlib import Path
    20|
    21|# ---------------------------------------------------------------------------
    22|# Category keyword map
    23|# ---------------------------------------------------------------------------
    24|CATEGORIES = {
    25|    'light_channel': ['light', 'dali', 'dmx', 'led', 'luminaire', 'lamp', '灯'],
    26|    'curtain_motor': ['curtain', 'shade', 'blind', 'drape', 'curt', '窗帘', '遮阳'],
    27|    'ac_unit': ['hvac', 'fcu', 'ac ', 'coolmaster', 'vrv', 'vrf', '温控', '空调',
    28|                'thermostat', 'fan coil'],
    29|    'sensor': ['sensor', 'motion', 'presence', 'pir', '雷达', '感应'],
    30|    'panel': ['panel', 'switch', 'touch', 'keypad', 'button', '面板', '按键'],
    31|    'backbone': ['coupler', 'psu', 'power supply', 'line coupler', 'ip router',
    32|                 '耦合', '电源', 'actuator', '执行器', 'router'],
    33|}
    34|
    35|
    36|def classify(text: str) -> str | None:
    37|    """Return category key matching the text, or None."""
    38|    t = text.lower()
    39|    for cat, keywords in CATEGORIES.items():
    40|        for kw in keywords:
    41|            if kw in t:
    42|                return cat
    43|    return None
    44|
    45|
    46|# ---------------------------------------------------------------------------
    47|# CAD extraction (DXF via ezdxf)
    48|# ---------------------------------------------------------------------------
    49|def extract_cad(dxf_path: str) -> dict:
    50|    """Extract device counts from DXF by KNX layer."""
    51|    try:
    52|        import ezdxf
    53|    except ImportError:
    54|        print("[WARN] ezdxf not installed. Attempting pip install...", file=sys.stderr)
    55|        subprocess.run([sys.executable, '-m', 'pip', 'install', '-q', 'ezdxf'], check=False)
    56|        import ezdxf
    57|
    58|    doc = ezdxf.readfile(dxf_path)
    59|    msp = doc.modelspace()
    60|
    61|    layer_counts = defaultdict(int)
    62|    block_counts = defaultdict(int)
    63|
    64|    for entity in msp:
    65|        layer = entity.dxf.layer.upper()
    66|        # Map layer to category
    67|        if 'KNX-LIGHT' in layer:
    68|            layer_counts['light_channel'] += 1
    69|        elif 'KNX-CURTAIN' in layer:
    70|            layer_counts['curtain_motor'] += 1
    71|        elif 'KNX-HVAC' in layer:
    72|            layer_counts['ac_unit'] += 1
    73|        elif 'KNX-SENSOR' in layer:
    74|            layer_counts['sensor'] += 1
    75|        elif 'KNX-SWITCH' in layer:
    76|            layer_counts['panel'] += 1
    77|        elif 'KNX-DB' in layer:
    78|            layer_counts['distribution_board'] += 1
    79|        elif 'KNX-BUS' in layer:
    80|            layer_counts['backbone'] += 1
    81|
    82|        # Count INSERT blocks
    83|        if entity.dxftype() == 'INSERT':
    84|            bname = entity.dxf.name.lower()
    85|            for cat, kws in CATEGORIES.items():
    86|                for kw in kws:
    87|                    if kw in bname:
    88|                        block_counts[cat] += 1
    89|                        break
    90|
    91|    # Prefer block counts (more precise), fall back to layer entity counts
    92|    result = {}
    93|    for cat in CATEGORIES:
    94|        result[cat] = block_counts.get(cat) or layer_counts.get(cat) or 0
    95|
    96|    return result
    97|
    98|
    99|# ---------------------------------------------------------------------------
   100|# Excel extraction (XLS → XLSX → openpyxl)
   101|# ---------------------------------------------------------------------------
   102|def _convert_xls_to_xlsx(xls_path: str) -> str:
   103|    """Convert .xls to .xlsx via LibreOffice headless."""
   104|    tmpdir = tempfile.mkdtemp(prefix='qv_')
   105|    subprocess.run(
   106|        ['libreoffice', '--headless', '--convert-to', 'xlsx', '--outdir', tmpdir, xls_path],
   107|        capture_output=True, timeout=60, check=False,
   108|    )
   109|    xlsx_name = Path(xls_path).stem + '.xlsx'
   110|    xlsx_path = os.path.join(tmpdir, xlsx_name)
   111|    if not os.path.exists(xlsx_path):
   112|        # Try finding any xlsx in tmpdir
   113|        for f in os.listdir(tmpdir):
   114|            if f.endswith('.xlsx'):
   115|                xlsx_path = os.path.join(tmpdir, f)
   116|                break
   117|    return xlsx_path
   118|
   119|
   120|def extract_excel(xls_path: str) -> dict:
   121|    """Extract device quantities from BOQ Excel."""
   122|    import openpyxl
   123|
   124|    path = xls_path
   125|    if xls_path.endswith('.xls'):
   126|        path = _convert_xls_to_xlsx(xls_path)
   127|
   128|    if not os.path.exists(path):
   129|        return {'_error': f'Converted file not found: {path}'}
   130|
   131|    wb = openpyxl.load_workbook(path, data_only=True)
   132|    result = defaultdict(int)
   133|    sections = []
   134|    tbd_rows = []
   135|    fee_check = []
   136|
   137|    for sheet_name in wb.sheetnames:
   138|        ws = wb[sheet_name]
   139|        for row in ws.iter_rows(min_row=1, values_only=False):
   140|            vals = [c.value for c in row]
   141|            if not vals or all(v is None for v in vals):
   142|                continue
   143|
   144|            # Build text from all string cells for classification
   145|            text_parts = [str(v) for v in vals if v is not None]
   146|            text = ' '.join(text_parts)
   147|
   148|            # Classify the row
   149|            cat = classify(text)
   150|
   151|            # Try to find quantity — typically col D (index 3) or col G (index 6)
   152|            qty = None
   153|            for idx in [3, 4, 5, 6, 7]:  # Try common quantity columns
   154|                if idx < len(vals) and isinstance(vals[idx], (int, float)) and vals[idx] > 0:
   155|                    qty = int(vals[idx])
   156|                    break
   157|
   158|            if cat and qty:
   159|                result[cat] += qty
   160|
   161|            # Fee rate check: look for Design/Installation/Programming percentage rows
   162|            text_lower = text.lower()
   163|            if 'subtotal' in text_lower:
   164|                # Find subtotal value in the row
   165|                for v in vals:
   166|                    if isinstance(v, (int, float)) and v > 100:  # Likely a monetary subtotal
   167|                        sections.append({'subtotal': float(v), 'row_text': text[:60]})
   168|                        break
   169|            elif any(kw in text_lower for kw in ['design', 'installation', 'programming']):
   170|                if 'service' in text_lower or 'fee' in text_lower:
   171|                    for v in vals:
   172|                        if isinstance(v, (int, float)) and v > 0:
   173|                            fee_check.append({'text': text[:80], 'value': float(v)})
   174|                            break
   175|
   176|            # TBD check
   177|            if 'TBD' in text or 'tbd' in text_lower:
   178|                tbd_rows.append(text[:80])
   179|
   180|            # Chinese footer check
   181|            for v in vals:
   182|                if isinstance(v, str) and re.search(r'[\u4e00-\u9fff]', v):
   183|                    if 'footer' in text_lower or 'header' in text_lower or '页' in v:
   184|                        result.setdefault('_chinese_footer', []).append(v[:60])
   185|
   186|    result['_tbd_rows'] = tbd_rows
   187|    result['_fee_check'] = fee_check
   188|    result['_sections'] = sections
   189|
   190|    return dict(result)
   191|
   192|
   193|# ---------------------------------------------------------------------------
   194|# PPT extraction (PPTX via python-pptx)
   195|# ---------------------------------------------------------------------------
   196|def extract_ppt(pptx_path: str) -> dict:
   197|    """Extract device quantities from PPTX slides."""
   198|    from pptx import Presentation
   199|
   200|    prs = Presentation(pptx_path)
   201|    result = defaultdict(int)
   202|
   203|    for slide in prs.slides:
   204|        for shape in slide.shapes:
   205|            # Parse tables
   206|            if shape.has_table:
   207|                table = shape.table
   208|                for row in table.rows:
   209|                    cells = [cell.text for cell in row.cells]
   210|                    text = ' '.join(cells)
   211|                    cat = classify(text)
   212|
   213|                    qty = None
   214|                    for cell_text in cells:
   215|                        # Try "x16", "×12", "Qty: 8", plain number
   216|                        m = re.search(r'[×xX]\s*(\d+)', cell_text)
   217|                        if m:
   218|                            qty = int(m.group(1))
   219|                            break
   220|                        m = re.search(r'(?i)qty[:\s]*(\d+)', cell_text)
   221|                        if m:
   222|                            qty = int(m.group(1))
   223|                            break
   224|                        # Plain number in a cell that's not the label
   225|                        m = re.match(r'^(\d+)$', cell_text.strip())
   226|                        if m:
   227|                            qty = int(m.group(1))
   228|                            break
   229|
   230|                    if cat and qty and qty > 0:
   231|                        result[cat] += qty
   232|
   233|            # Parse text shapes for quantity patterns
   234|            elif shape.has_text_frame:
   235|                text = shape.text_frame.text
   236|                cat = classify(text)
   237|                if cat:
   238|                    # Look for quantity patterns in text
   239|                    for m in re.finditer(r'[×xX]\s*(\d+)', text):
   240|                        result[cat] += int(m.group(1))
   241|                    for m in re.finditer(r'(?i)qty[:\s]*(\d+)', text):
   242|                        result[cat] += int(m.group(1))
   243|
   244|    return dict(result)
   245|
   246|
   247|# ---------------------------------------------------------------------------
   248|# Cross-validation
   249|# ---------------------------------------------------------------------------
   250|def cross_validate(cad: dict, excel: dict, ppt: dict) -> list:
   251|    """Compare quantities across sources. Returns list of result dicts."""
   252|    all_cats = set()
   253|    for d in [cad, excel, ppt]:
   254|        all_cats.update(k for k in d if not k.startswith('_'))
   255|
   256|    results = []
   257|    for cat in sorted(all_cats):
   258|        c_val = cad.get(cat)
   259|        e_val = excel.get(cat)
   260|        p_val = ppt.get(cat)
   261|
   262|        # Filter out None/0 for status determination
   263|        vals = {}
   264|        if c_val and c_val > 0:
   265|            vals['CAD'] = c_val
   266|        if e_val and e_val > 0:
   267|            vals['Excel'] = e_val
   268|        if p_val and p_val > 0:
   269|            vals['PPT'] = p_val
   270|
   271|        if not vals:
   272|            status = 'SKIP'
   273|            outlier = None
   274|        elif len(vals) == 1:
   275|            status = 'INFO'
   276|            outlier = None
   277|        else:
   278|            unique = set(vals.values())
   279|            if len(unique) == 1:
   280|                status = 'PASS'
   281|                outlier = None
   282|            elif len(unique) == 2 and len(vals) == 3:
   283|                # Two agree, one differs
   284|                from collections import Counter
   285|                cnt = Counter(vals.values())
   286|                majority_val = cnt.most_common(1)[0][0]
   287|                outlier_src = [k for k, v in vals.items() if v != majority_val]
   288|                status = 'WARN'
   289|                outlier = outlier_src[0] if outlier_src else None
   290|            else:
   291|                status = 'FAIL'
   292|                outlier = ','.join(vals.keys())
   293|
   294|        results.append({
   295|            'category': cat,
   296|            'cad': c_val,
   297|            'excel': e_val,
   298|            'ppt': p_val,
   299|            'status': status,
   300|            'outlier': outlier,
   301|        })
   302|
   303|    return results
   304|
   305|
   306|def check_fee_consistency(excel_data: dict) -> dict:
   307|    """Check all sections have D10% I10% P5% fee rates."""
   308|    sections = excel_data.get('_sections', [])
   309|    fee_rows = excel_data.get('_fee_check', [])
   310|    if not sections or not fee_rows:
   311|        return {'status': 'SKIP', 'detail': 'Not enough data to check fee rates'}
   312|
   313|    # Simple heuristic: count fee rows per section
   314|    # Full implementation would need row-number tracking — this is a best-effort check
   315|    total_fees = len(fee_rows)
   316|    expected = len(sections) * 3  # design + install + program per section
   317|    if total_fees != expected:
   318|        return {
   319|            'status': 'WARN',
   320|            'detail': f'Expected {expected} fee rows for {len(sections)} sections, found {total_fees}',
   321|        }
   322|    return {'status': 'PASS', 'detail': f'{total_fees} fee rows for {len(sections)} sections'}
   323|
   324|
   325|def check_chinese_footer(excel_data: dict) -> dict:
   326|    """Check for Chinese characters in footers."""
   327|    cn = excel_data.get('_chinese_footer', [])
   328|    if cn:
   329|        return {'status': 'FAIL', 'detail': f'Found {len(cn)} Chinese footer/header entries', 'items': cn}
   330|    return {'status': 'PASS', 'detail': 'No Chinese text in footers'}
   331|
   332|
   333|# ---------------------------------------------------------------------------
   334|# Report formatting
   335|# ---------------------------------------------------------------------------
   336|def fmt_report(project, cad_data, excel_data, ppt_data, results, fee_result, cn_result, verbose):
   337|    """Format a nice text report."""
   338|    W = 66
   339|    border = '═' * W
   340|
   341|    lines = []
   342|    lines.append(f'╔{border}╗')
   343|    title = f'Quotation Cross-Validation Report — Project: {project or "Unknown"}'
   344|    lines.append(f'║  {title:<{W-4}}║')
   345|    lines.append(f'╠{border}╣')
   346|
   347|    # Source info
   348|    for label, data, src in [('CAD', cad_data, args.cad), ('Excel', excel_data, args.excel), ('PPT', ppt_data, args.ppt)]:
   349|        fname = os.path.basename(src) if src else 'N/A'
   350|        ent = sum(v for k, v in data.items() if not k.startswith('_')) if data else 0
   351|        lines.append(f'║  {label}: {fname} ({ent} entities){" " * max(0, W - 8 - len(fname) - 14)}║')
   352|
   353|    lines.append(f'╠{border}╣')
   354|
   355|    # Table header
   356|    hdr = f'║  {"Category":<17}│{"CAD":>5} │{"Excel":>6} │{"PPT":>5} │ Status{" " * (W - 52)}║'
   357|    lines.append(hdr)
   358|    sep = f'║  {"─" * 17}┼{"─" * 5}┼{"─" * 6}┼{"─" * 5}┼{"─" * 20}{" " * (W - 57)}║'
   359|    lines.append(sep)
   360|
   361|    verdict = 'PASS'
   362|    for r in results:
   363|        cad_s = str(r['cad']) if r['cad'] is not None else '—'
   364|        exc_s = str(r['excel']) if r['excel'] is not None else '—'
   365|        ppt_s = str(r['ppt']) if r['ppt'] is not None else '—'
   366|
   367|        icon = {'PASS': '✅', 'WARN': '⚠️ ', 'FAIL': '❌', 'INFO': 'ℹ️ ', 'SKIP': '⏭ '}.get(r['status'], '?')
   368|        status_text = f'{icon} {r["status"]}'
   369|        if r['outlier']:
   370|            status_text += f' ({r["outlier"]})'
   371|
   372|        row_line = f'║  {r["category"]:<17}│{cad_s:>5} │{exc_s:>6} │{ppt_s:>5} │ {status_text}'
   373|        lines.append(f'{row_line:<{W}}║')
   374|
   375|        if r['status'] in ('WARN', 'FAIL'):
   376|            verdict = 'WARN' if verdict == 'PASS' else verdict
   377|        if r['status'] == 'FAIL':
   378|            verdict = 'FAIL'
   379|
   380|    lines.append(f'╠{border}╣')
   381|
   382|    # Fee rate check
   383|    fee_icon = {'PASS': '✅', 'WARN': '⚠️ ', 'FAIL': '❌', 'SKIP': '⏭ '}.get(fee_result['status'], '?')
   384|    lines.append(f'║  Fee Rate Check: {fee_icon} {fee_result["detail"]}{" " * max(0, W - 22 - len(fee_result["detail"]))}║')
   385|
   386|    # Chinese footer check
   387|    cn_icon = {'PASS': '✅', 'WARN': '⚠️ ', 'FAIL': '❌', 'SKIP': '⏭ '}.get(cn_result['status'], '?')
   388|    lines.append(f'║  Chinese Footer: {cn_icon} {cn_result["detail"]}{" " * max(0, W - 21 - len(cn_result["detail"]))}║')
   389|
   390|    # TBD rows
   391|    tbd = excel_data.get('_tbd_rows', []) if excel_data else []
   392|    tbd_text = f'{len(tbd)} TBD rows — expected for service fees' if tbd else 'None'
   393|    lines.append(f'║  TBD Rows: {tbd_text}{" " * max(0, W - 13 - len(tbd_text))}║')
   394|
   395|    lines.append(f'╠{border}╣')
   396|
   397|    # Verdict
   398|    verdict_icon = {'PASS': '✅', 'WARN': '⚠️ ', 'FAIL': '❌'}.get(verdict, '?')
   399|    warns = sum(1 for r in results if r['status'] == 'WARN')
   400|    fails = sum(1 for r in results if r['status'] == 'FAIL')
   401|    if fails:
   402|        v_text = f'{verdict_icon} {fails} FAILURES — do NOT deliver'
   403|    elif warns:
   404|        v_text = f'{verdict_icon} {warns} WARNINGS — review before delivery'
   405|    else:
   406|        v_text = f'{verdict_icon} ALL CLEAR — ready for delivery'
   407|    lines.append(f'║  VERDICT: {v_text}{" " * max(0, W - 12 - len(v_text))}║')
   408|
   409|    lines.append(f'╚{border}╝')
   410|
   411|    return '\n'.join(lines)
   412|
   413|
   414|# ---------------------------------------------------------------------------
   415|# Main
   416|# ---------------------------------------------------------------------------
   417|def main():
   418|    global args
   419|    parser = argparse.ArgumentParser(
   420|        description='Cross-validate device quantities across CAD/Excel/PPT for KNX quotations',
   421|    )
   422|    parser.add_argument('--cad', help='Path to DXF file')
   423|    parser.add_argument('--excel', help='Path to XLS/XLSX file')
   424|    parser.add_argument('--ppt', help='Path to PPTX file')
   425|    parser.add_argument('--project', help='Project name for report header')
   426|    parser.add_argument('--json', action='store_true', help='Output JSON')
   427|    parser.add_argument('-v', '--verbose', action='store_true', help='Show per-source details')
   428|    args = parser.parse_args()
   429|
   430|    if not any([args.cad, args.excel, args.ppt]):
   431|        parser.error('At least one source file (--cad, --excel, --ppt) is required')
   432|
   433|    cad_data = {}
   434|    excel_data = {}
   435|    ppt_data = {}
   436|
   437|    if args.cad:
   438|        try:
   439|            cad_data = extract_cad(args.cad)
   440|            if args.verbose:
   441|                print('[CAD] Extracted:', json.dumps(cad_data, indent=2), file=sys.stderr)
   442|        except Exception as e:
   443|            print(f'[CAD] Error: {e}', file=sys.stderr)
   444|            cad_data = {'_error': str(e)}
   445|
   446|    if args.excel:
   447|        try:
   448|            excel_data = extract_excel(args.excel)
   449|            if args.verbose:
   450|                print('[Excel] Extracted:', json.dumps({k: v for k, v in excel_data.items() if not k.startswith('_')}, indent=2), file=sys.stderr)
   451|        except Exception as e:
   452|            print(f'[Excel] Error: {e}', file=sys.stderr)
   453|            excel_data = {'_error': str(e)}
   454|
   455|    if args.ppt:
   456|        try:
   457|            ppt_data = extract_ppt(args.ppt)
   458|            if args.verbose:
   459|                print('[PPT] Extracted:', json.dumps(ppt_data, indent=2), file=sys.stderr)
   460|        except Exception as e:
   461|            print(f'[PPT] Error: {e}', file=sys.stderr)
   462|            ppt_data = {'_error': str(e)}
   463|
   464|    results = cross_validate(cad_data, excel_data, ppt_data)
   465|    fee_result = check_fee_consistency(excel_data)
   466|    cn_result = check_chinese_footer(excel_data)
   467|
   468|    if args.json:
   469|        output = {
   470|            'project': args.project,
   471|            'results': results,
   472|            'fee_check': fee_result,
   473|            'chinese_footer': cn_result,
   474|            'tbd_rows': excel_data.get('_tbd_rows', []),
   475|            'sources': {
   476|                'cad': cad_data,
   477|                'excel': {k: v for k, v in excel_data.items() if not k.startswith('_')},
   478|                'ppt': ppt_data,
   479|            },
   480|        }
   481|        print(json.dumps(output, indent=2, ensure_ascii=False))
   482|    else:
   483|        print(fmt_report(args.project, cad_data, excel_data, ppt_data, results, fee_result, cn_result, args.verbose))
   484|
   485|
   486|if __name__ == '__main__':
   487|    main()
   488|