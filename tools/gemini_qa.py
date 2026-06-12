     2|"""
     3|gemini_qa.py — Visual QA with Gemini fallback chain for NewMe deliverables.
     4|
     5|Pipeline: Gemini Vision → (429/503) → GLM-4V → (fail) → Tesseract OCR → (fail) → BLOCK
     6|
     7|Usage:
     8|    gemini_qa.py --image <path_or_url> --question <question> [--json] [-v]
     9|    gemini_qa.py --screenshot <url> --question <question>  # Puppeteer first
    10|"""
    11|
    12|import argparse
    13|import base64
    14|import json
    15|import os
    16|import re
    17|import subprocess
    18|import sys
    19|import tempfile
    20|import time
    21|from pathlib import Path
    22|
    23|# ---------------------------------------------------------------------------
    24|# Config
    25|# ---------------------------------------------------------------------------
    26|GEMINI_KEY = os.environ.get('GEMINI_API_KEY', '')
    27|GLM_KEY = os.environ.get('ZAI_API_KEY', '') or os.environ.get('GLM_API_KEY', '')
    28|GLM_BASE = os.environ.get('ZAI_BASE_URL', 'https://open.bigmodel.cn/api/paas/v4')
    29|
    30|# Retry config for Gemini 503
    31|MAX_RETRIES = 3
    32|BACKOFF_BASE = 2  # seconds, exponential
    33|
    34|
    35|def log(msg, level='INFO'):
    36|    print(f'[{level}] {msg}', file=sys.stderr)
    37|
    38|
    39|# ---------------------------------------------------------------------------
    40|# Image preparation
    41|# ---------------------------------------------------------------------------
    42|def prepare_image(source: str) -> str:
    43|    """Return base64-encoded image data. Accepts file path or URL."""
    44|    if source.startswith(('http://', 'https://')):
    45|        # Download via curl
    46|        tmp = tempfile.NamedTemporaryFile(suffix='.png', delete=False)
    47|        tmp.close()
    48|        result = subprocess.run(
    49|            ['curl', '-sL', '-o', tmp.name, source],
    50|            capture_output=True, timeout=30,
    51|        )
    52|        if result.returncode != 0:
    53|            raise RuntimeError(f'Failed to download image: {source}')
    54|        source = tmp.name
    55|
    56|    if not os.path.exists(source):
    57|        raise FileNotFoundError(f'Image not found: {source}')
    58|
    59|    with open(source, 'rb') as f:
    60|        data = f.read()
    61|
    62|    # Keep under 20MB (Gemini limit)
    63|    if len(data) > 20 * 1024 * 1024:
    64|        raise RuntimeError(f'Image too large: {len(data)} bytes (max 20MB)')
    65|
    66|    return base64.b64encode(data).decode('utf-8')
    67|
    68|
    69|def take_screenshot(url: str) -> str:
    70|    """Take screenshot via Puppeteer. Returns temp file path."""
    71|    script = f'''
    72|    const puppeteer = require('puppeteer');
    73|    (async () => {{
    74|        const browser = await puppeteer.launch({{ headless: true, args: ['--no-sandbox'] }});
    75|        const page = await browser.newPage();
    76|        await page.setViewport({{ width: 1920, height: 1080 }});
    77|        await page.goto('{url}', {{ waitUntil: 'networkidle2', timeout: 30000 }});
    78|        const path = '/tmp/screenshot_' + Date.now() + '.png';
    79|        await page.screenshot({{ path, fullPage: false }});
    80|        console.log(path);
    81|        await browser.close();
    82|    }})();
    83|    '''
    84|    result = subprocess.run(
    85|        ['node', '-e', script],
    86|        capture_output=True, text=True, timeout=60,
    87|    )
    88|    if result.returncode != 0:
    89|        raise RuntimeError(f'Puppeteer failed: {result.stderr}')
    90|    path = result.stdout.strip()
    91|    if not os.path.exists(path):
    92|        raise RuntimeError(f'Screenshot not found: {path}')
    93|    return path
    94|
    95|
    96|# ---------------------------------------------------------------------------
    97|# Tier 1: Gemini Vision
    98|# ---------------------------------------------------------------------------
    99|def query_gemini(image_b64: str, question: str) -> dict:
   100|    """Call Gemini Vision API. Returns {answer, raw, tier}."""
   101|    if not GEMINI_KEY:
   102|        return {'answer': None, 'error': 'GEMINI_API_KEY not set', 'tier': 'gemini'}
   103|
   104|    url = f'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=***
   105|
   106|    payload = {
   107|        'contents': [{
   108|            'parts': [
   109|                {'text': question},
   110|                {'inline_data': {'mime_type': 'image/png', 'data': image_b64}},
   111|            ]
   112|        }],
   113|        'generationConfig': {'temperature': 0.1, 'maxOutputTokens': 1024},
   114|    }
   115|
   116|    for attempt in range(MAX_RETRIES):
   117|        try:
   118|            import urllib.request
   119|            req = urllib.request.Request(
   120|                url,
   121|                data=json.dumps(payload).encode(),
   122|                headers={'Content-Type': 'application/json'},
   123|            )
   124|            resp = urllib.request.urlopen(req, timeout=30)
   125|            data = json.loads(resp.read())
   126|            answer = data['candidates'][0]['content']['parts'][0]['text']
   127|            return {'answer': answer, 'raw': data, 'tier': 'gemini', 'attempts': attempt + 1}
   128|        except Exception as e:
   129|            err_str = str(e)
   130|            if '429' in err_str or 'RESOURCE_EXHAUSTED' in err_str:
   131|                log(f'Gemini 429 (quota), attempt {attempt + 1}/{MAX_RETRIES}', 'WARN')
   132|                if attempt < MAX_RETRIES - 1:
   133|                    time.sleep(BACKOFF_BASE ** attempt + 1)
   134|                continue
   135|            elif '503' in err_str or 'UNAVAILABLE' in err_str:
   136|                log(f'Gemini 503 (overloaded), attempt {attempt + 1}/{MAX_RETRIES}', 'WARN')
   137|                if attempt < MAX_RETRIES - 1:
   138|                    time.sleep(BACKOFF_BASE ** (attempt + 1) + 0.5)
   139|                continue
   140|            else:
   141|                return {'answer': None, 'error': err_str, 'tier': 'gemini'}
   142|
   143|    return {'answer': None, 'error': f'Gemini failed after {MAX_RETRIES} retries', 'tier': 'gemini'}
   144|
   145|
   146|# ---------------------------------------------------------------------------
   147|# Tier 2: GLM-4V (fallback)
   148|# ---------------------------------------------------------------------------
   149|def query_glm4v(image_b64: str, question: str) -> dict:
   150|    """Call GLM-4V as fallback vision provider."""
   151|    if not GLM_KEY:
   152|        return {'answer': None, 'error': 'ZAI_API_KEY/GLM_API_KEY not set', 'tier': 'glm4v'}
   153|
   154|    url = f'{GLM_BASE}/chat/completions'
   155|    payload = {
   156|        'model': 'glm-4v-flash',
   157|        'messages': [{
   158|            'role': 'user',
   159|            'content': [
   160|                {'type': 'text', 'text': question},
   161|                {'type': 'image_url', 'image_url': {'url': f'data:image/png;base64,{image_b64}'}},
   162|            ]
   163|        }],
   164|        'temperature': 0.1,
   165|        'max_tokens': 1024,
   166|    }
   167|
   168|    try:
   169|        import urllib.request
   170|        req = urllib.request.Request(
   171|            url,
   172|            data=json.dumps(payload).encode(),
   173|            headers={
   174|                'Content-Type': 'application/json',
   175|                'Authorization': f'Bearer {GLM_KEY}',
   176|            },
   177|        )
   178|        resp = urllib.request.urlopen(req, timeout=30)
   179|        data = json.loads(resp.read())
   180|        answer = data['choices'][0]['message']['content']
   181|        return {'answer': answer, 'raw': data, 'tier': 'glm4v'}
   182|    except Exception as e:
   183|        return {'answer': None, 'error': str(e), 'tier': 'glm4v'}
   184|
   185|
   186|# ---------------------------------------------------------------------------
   187|# Tier 3: Tesseract OCR (last resort)
   188|# ---------------------------------------------------------------------------
   189|def query_tesseract(image_path: str, question: str) -> dict:
   190|    """Use Tesseract OCR as last-resort text extraction."""
   191|    try:
   192|        result = subprocess.run(
   193|            ['tesseract', image_path, 'stdout', '-l', 'eng'],
   194|            capture_output=True, text=True, timeout=30,
   195|        )
   196|        if result.returncode != 0:
   197|            return {'answer': None, 'error': f'Tesseract failed: {result.stderr}', 'tier': 'ocr'}
   198|        ocr_text = result.stdout.strip()
   199|        if not ocr_text:
   200|            return {'answer': None, 'error': 'OCR returned empty text', 'tier': 'ocr'}
   201|        return {
   202|            'answer': f'[OCR extraction only — cannot answer visual questions]\n\nExtracted text:\n{ocr_text}',
   203|            'tier': 'ocr',
   204|            'raw_text': ocr_text,
   205|        }
   206|    except FileNotFoundError:
   207|        return {'answer': None, 'error': 'Tesseract not installed', 'tier': 'ocr'}
   208|    except Exception as e:
   209|        return {'answer': None, 'error': str(e), 'tier': 'ocr'}
   210|
   211|
   212|# ---------------------------------------------------------------------------
   213|# Fallback chain orchestrator
   214|# ---------------------------------------------------------------------------
   215|def visual_qa(image_source: str, question: str, image_path_override: str = None) -> dict:
   216|    """
   217|    Run visual QA with full fallback chain:
   218|    Gemini → GLM-4V → Tesseract → BLOCK
   219|    """
   220|    chain = []
   221|    image_path = image_path_override
   222|
   223|    # Prepare image
   224|    if not image_path:
   225|        try:
   226|            image_b64 = prepare_image(image_source)
   227|        except Exception as e:
   228|            return {'status': 'BLOCKED', 'error': str(e), 'chain': []}
   229|    else:
   230|        with open(image_path, 'rb') as f:
   231|            image_b64 = base64.b64encode(f.read()).decode('utf-8')
   232|
   233|    # Tier 1: Gemini
   234|    log('Tier 1: Gemini Vision')
   235|    result = query_gemini(image_b64, question)
   236|    chain.append(result)
   237|    if result.get('answer'):
   238|        result['status'] = 'PASS'
   239|        result['chain_summary'] = f'✅ Gemini (attempts: {result.get("attempts", 1)})'
   240|        return result
   241|    log(f'Gemini failed: {result.get("error", "unknown")}', 'WARN')
   242|
   243|    # Tier 2: GLM-4V
   244|    log('Tier 2: GLM-4V fallback')
   245|    result = query_glm4v(image_b64, question)
   246|    chain.append(result)
   247|    if result.get('answer'):
   248|        result['status'] = 'PASS_FALLBACK'
   249|        result['chain_summary'] = '⚠️ GLM-4V fallback (Gemini unavailable)'
   250|        return result
   251|    log(f'GLM-4V failed: {result.get("error", "unknown")}', 'WARN')
   252|
   253|    # Tier 3: Tesseract
   254|    log('Tier 3: Tesseract OCR')
   255|    if image_path:
   256|        result = query_tesseract(image_path, question)
   257|    else:
   258|        # Write b64 to temp file for tesseract
   259|        tmp = tempfile.NamedTemporaryFile(suffix='.png', delete=False)
   260|        tmp.write(base64.b64decode(image_b64))
   261|        tmp.close()
   262|        result = query_tesseract(tmp.name, question)
   263|        os.unlink(tmp.name)
   264|    chain.append(result)
   265|    if result.get('answer'):
   266|        result['status'] = 'PARTIAL'
   267|        result['chain_summary'] = '⚠️ OCR only — visual questions cannot be answered'
   268|        result['chain'] = chain
   269|        return result
   270|
   271|    # BLOCKED
   272|    return {
   273|        'status': 'BLOCKED',
   274|        'chain_summary': '❌ All tiers failed — DELIVERY BLOCKED',
   275|        'chain': chain,
   276|        'answer': None,
   277|    }
   278|
   279|
   280|# ---------------------------------------------------------------------------
   281|# Main
   282|# ---------------------------------------------------------------------------
   283|def main():
   284|    parser = argparse.ArgumentParser(
   285|        description='Visual QA with Gemini → GLM-4V → OCR fallback chain',
   286|    )
   287|    parser.add_argument('--image', help='Image file path or URL')
   288|    parser.add_argument('--screenshot', help='URL to screenshot first (via Puppeteer)')
   289|    parser.add_argument('--question', '-q', required=True, help='Question to ask about the image')
   290|    parser.add_argument('--json', action='store_true', help='JSON output')
   291|    parser.add_argument('-v', '--verbose', action='store_true')
   292|    args = parser.parse_args()
   293|
   294|    if not args.image and not args.screenshot:
   295|        parser.error('Either --image or --screenshot is required')
   296|
   297|    image_path = None
   298|
   299|    if args.screenshot:
   300|        log(f'Taking screenshot of {args.screenshot}')
   301|        try:
   302|            image_path = take_screenshot(args.screenshot)
   303|            image_source = image_path
   304|        except Exception as e:
   305|            print(f'BLOCKED: Screenshot failed: {e}', file=sys.stderr)
   306|            sys.exit(1)
   307|    else:
   308|        image_source = args.image
   309|
   310|    result = visual_qa(image_source, args.question, image_path_override=image_path)
   311|
   312|    if args.json:
   313|        # Clean for JSON output
   314|        clean = {k: v for k, v in result.items() if k != 'raw'}
   315|        print(json.dumps(clean, indent=2, ensure_ascii=False))
   316|    else:
   317|        summary = result.get('chain_summary', 'Unknown')
   318|        answer = result.get('answer', 'No answer')
   319|        status = result.get('status', 'UNKNOWN')
   320|        print(f'[{status}] {summary}')
   321|        print()
   322|        print(answer)
   323|
   324|        if args.verbose and result.get('chain'):
   325|            print('\n--- Fallback Chain ---')
   326|            for i, step in enumerate(result['chain']):
   327|                tier = step.get('tier', '?')
   328|                ok = '✅' if step.get('answer') else '❌'
   329|                err = step.get('error', '')
   330|                print(f'  {i+1}. {tier}: {ok} {err}')
   331|
   332|    # Exit code: 0 = pass, 1 = blocked/partial
   333|    if result.get('status') in ('BLOCKED', 'PARTIAL'):
   334|        sys.exit(1)
   335|
   336|
   337|if __name__ == '__main__':
   338|    main()
   339|